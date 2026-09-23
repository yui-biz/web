/**
 * GAS への中継（ご案内ページ・ヒアリングフォーム専用）
 *
 * ■ なぜ要るか（2026-08-12）
 *   GAS の ContentService(JSON) は script.googleusercontent.com へ302で飛ばされ、
 *   ブラウザがその先を取りに行くと【3〜5割の確率で404】になる（実測）。
 *   ここで中継すると:
 *     ① リダイレクトを踏むのは Worker（サーバ同士）なのでブラウザ側で404にならない
 *     ② CORSヘッダをこちらで付けられる
 *        🚨 HtmlService で返す案は Access-Control-Allow-Origin が無く、
 *           ブラウザから fetch できずに本番を壊した。中継ならその問題が起きない
 *     ③ 応答を覚えておけるので2回目以降が速い
 *
 * ■ 触ってよい範囲
 *   🚨 studio.yui.gift（yui-catalog-studio）とは別のWorker。互いに影響しない。
 */

const GAS_EXEC = 'https://script.google.com/macros/s/AKfycbzk2XDHbIPIh8yPGX5vvt3vHC8cPL1Kle7cIAC-sWsd591nwRo5IZNFCqcV_o0Ig6Os/exec';

// 中継してよい操作だけを並べる。ここに無いものは通さない
// （何でも中継すると、CRMの他の機能を外から叩ける口になってしまう）
// hearingKey＝ヒアリングの送信の印だけ（フォームが答えを受け取り損ねたとき「届いたか」確かめる・2026-09-23）。覚えない
const ALLOWED_ACTIONS = new Set(['guideData', 'formData', 'hearingKey']);
const NO_CACHE_ACTIONS = new Set(['hearingKey']);

// 取ってよい呼び出し元。ご案内ページとフォームは GitHub Pages にある
const ALLOWED_ORIGINS = new Set([
  'https://yui-biz.github.io',
]);

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://yui-biz.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
  return h;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }),
        { status: 405, headers: corsHeaders(origin) });
    }

    const action = url.searchParams.get('action') || '';
    const customer = url.searchParams.get('customer') || '';
    if (!ALLOWED_ACTIONS.has(action)) {
      return new Response(JSON.stringify({ error: 'bad_action' }),
        { status: 400, headers: corsHeaders(origin) });
    }
    if (!customer) {
      return new Response(JSON.stringify({ error: 'not_found' }),
        { status: 200, headers: corsHeaders(origin) });
    }

    const target = GAS_EXEC + '?action=' + encodeURIComponent(action)
      + '&customer=' + encodeURIComponent(customer);

    // ⭐ 一度取れたものは覚えておく。実測で GAS の応答は 2.4〜76秒とばらつくので、
    //    2回目以降が速いだけで体感がまるで違う。中身は分単位で変わるものではない。
    //    ⚠️ ご案内ページの文面を直したら最大30分ぶん古いものが出る。
    const cache = caches.default;
    const cacheKey = new Request(target, { method: 'GET' });
    // fresh=1 ＝覚えているものを使わず取り直し、覚え直す（2026-09-23）。
    //   ヒアリングフォームは送信のあと前回の回答を出すので、30分前の控えだと「まだ答えていない」画面に戻ってしまう。
    //   フォームが送信の直後と、送信から35分以内に開き直したときに付ける
    const fresh = url.searchParams.get('fresh') === '1' || NO_CACHE_ACTIONS.has(action);
    const hit = fresh ? null : await cache.match(cacheKey);
    if (hit) {
      const t = await hit.text();
      return new Response(t, { status: 200, headers: corsHeaders(origin) });
    }

    // 🚨 お客様が画面を閉じても、取り直し（と覚え直し）は最後まで続ける（waitUntil）
    const work = fetchAndCache(target, NO_CACHE_ACTIONS.has(action) ? null : cache, cacheKey);
    if (ctx && ctx.waitUntil) ctx.waitUntil(work.catch(() => {}));
    const out = await work;
    return new Response(out.body, { status: out.status, headers: corsHeaders(origin) });
  },
};

async function fetchAndCache(target, cache, cacheKey) {
    // 🚨 GAS は同じ呼び出しでも404を返すことがある。ここで数回試す。
    //    ブラウザではなくサーバ同士のやり取りなので、利用者を待たせるのは1回ぶんだけ。
    let lastReason = 'unknown';
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(target, { redirect: 'follow' });
        if (!res.ok) { lastReason = 'HTTP ' + res.status; continue; }
        const text = await res.text();
        // GASがエラーページ（HTML）を返すことがあるので、JSONとして読めたときだけ通す
        try {
          JSON.parse(text);
        } catch (e) {
          lastReason = 'not_json';
          continue;
        }
        // 「見つからない」は覚えない（IDの打ち間違いを30分引きずらない）
        try {
          if (cache && !JSON.parse(text).error) {
            await cache.put(cacheKey, new Response(text, {
              headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=1800' },
            }));
          }
        } catch (e) {}
        return { status: 200, body: text };
      } catch (e) {
        lastReason = String(e && e.message ? e.message : e);
      }
    }
    return { status: 502, body: JSON.stringify({ error: 'upstream_failed', reason: lastReason }) };
}
