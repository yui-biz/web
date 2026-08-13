/**
 * erena-catalog の【待ち時間の上限】と【スライド式セッション】の検査（2026-08-13）。
 *
 * 背景（実測 2026-08-13・getProducts を15回）:
 *   hop1(GASの実行)   正常 1.06〜1.75秒 / 15回中2回が 26〜28秒（コールドスタート）
 *   hop2(結果の取得)  15回中12回が200(0.31〜0.37秒) / 3回が404で【10.2秒 20.5秒 31.5秒】
 *   → fetch に上限が無かったので、1回落ちるだけで20秒待ち、3回落ちると「送信できない」。
 *
 * ここで固定したいこと:
 *   1. 返ってこない応答を待ち続けない（10秒で打ち切って投げ直す）
 *   2. かといって「遅いが生きている」応答を永久に切り捨てない（投げ直すほど上限を伸ばす）
 *   3. 使っている間はログインが切れない／放置したら切れる（露出時間を延ばさない）
 *
 * 実ファイル(index.html)から該当箇所をそのまま抜き出して vm で動かす。
 * 写して書くとズレるので、抜き出しに失敗したら落とす。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'erena-catalog', 'index.html');
const src = fs.readFileSync(HTML, 'utf8');

function cut(startMarker, endMarker, label) {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error('抜き出せない(開始が見つからない): ' + label);
  const e = src.indexOf(endMarker, s);
  if (e < 0) throw new Error('抜き出せない(終了が見つからない): ' + label);
  return src.slice(s, e);
}

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('NG   ' + name + '  → ' + JSON.stringify(info === undefined ? '' : info)); }
}

// ============================================================
// 仮想時計（実時間を待たずに「10秒後」を再現する）
// ============================================================
let clock = 0, timers = [], tid = 0;
function fakeSetTimeout(fn, ms) { const id = ++tid; timers.push({ id, at: clock + (ms || 0), fn }); return id; }
function fakeClearTimeout(id) { timers = timers.filter(t => t.id !== id); }
const flush = () => new Promise(r => setImmediate(r));
async function drain(maxSteps) {
  for (let i = 0; i < (maxSteps || 2000); i++) {
    await flush();
    if (!timers.length) break;
    timers.sort((a, b) => a.at - b.at);
    const t = timers.shift();
    clock = t.at;
    t.fn();
  }
  await flush();
}

function FakeAbortController() {
  this.signal = { aborted: false, _l: [] };
  this.abort = function () { this.signal.aborted = true; this.signal._l.forEach(f => f()); }.bind(this);
}

// ============================================================
// パート1: 待ち時間の上限（gasPost / _gasPostOnce）
// ============================================================
const netBlock = cut('const RETRIABLE_ACTIONS =', '  let formDataGlobal', 'gasPost 一式');

let posts = [];        // {action, at} 投げた時刻つき
let plan = {};         // action -> [{delay, status, body}] 使い切ったら最後を繰り返す
let touched = 0;       // touchAuth が呼ばれた回数

function setup(p) { posts = []; plan = p; touched = 0; clock = 0; timers = []; }
function nextPlan(action) {
  const list = plan[action];
  if (!list || !list.length) return { delay: 10, status: 200, body: { ok: true } };
  return list.length > 1 ? list.shift() : list[0];
}

const netCtx = {
  console, Promise, Object, Array, JSON, Error, String, Math, Date,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  AbortController: FakeAbortController,
  GAS_URL: 'https://example.invalid/exec',
  currentAuthToken: 'tok',
  currentMakerEmail: 'maker@example.com',
  currentStoreId: '',
  currentIsAdmin: false,
  handleSessionExpired: () => {},
  touchAuth: () => { touched++; },
  fetch: (url, opt) => {
    const payload = JSON.parse(opt.body);
    posts.push({ action: payload.action, at: clock });
    const p = nextPlan(payload.action);
    return new Promise((resolve, reject) => {
      if (opt.signal) {
        opt.signal._l.push(() => {
          const e = new Error('The operation was aborted.');
          e.name = 'AbortError';
          reject(e);
        });
      }
      if (p.delay === Infinity) return;   // 永久に返らない応答
      fakeSetTimeout(() => {
        if (opt.signal && opt.signal.aborted) return;
        if (p.status === 200) resolve({ ok: true, status: 200, json: () => Promise.resolve(p.body || { ok: true }) });
        else resolve({ ok: false, status: p.status });
      }, p.delay);
    });
  }
};
vm.createContext(netCtx);
vm.runInContext(netBlock, netCtx);

function countPosts(action) { return posts.filter(p => p.action === action).length; }

(async function () {
  // ---- 1. 上限そのものの値 ----
  check('読み込みの1回目は5秒で打ち切る（サーバー側1.5〜3秒なので健全な応答は巻き添えにしない）', netCtx._timeoutFor(0, 'getOrders') === 5000, netCtx._timeoutFor(0, 'getOrders'));
  check('2回目も8秒（早い試行で拾えるほうが多い）', netCtx._timeoutFor(1) === 8000, netCtx._timeoutFor(1));
  check('3回目から待つ側に倒す(15秒)', netCtx._timeoutFor(2) === 15000, netCtx._timeoutFor(2));
  check('最後は40秒で頭打ち（無限に伸びない）', netCtx._timeoutFor(9) === 40000, netCtx._timeoutFor(9));

  // 🚨 読み込みと書き込みで所要時間が違うので、上限も分けてある。
  //    書き込み(送信・発送処理)はメール送信を含み6秒前後かかる。5秒で切ると
  //    健全な処理を毎回捨てて確認の往復が増え、かえって遅くなる。
  check('送信の1回目は10秒（メール送信を含むので5秒では切らない）', netCtx._timeoutFor(0, 'submitForm') === 10000, netCtx._timeoutFor(0, 'submitForm'));
  check('発送処理も書き込み側の上限を使う', netCtx._timeoutFor(0, 'updateShipment') === 10000, netCtx._timeoutFor(0, 'updateShipment'));
  check('取消の承認も書き込み側', netCtx._timeoutFor(0, 'approveCancellation') === 10000, netCtx._timeoutFor(0, 'approveCancellation'));
  check('action を渡さなければ読み込み側の上限', netCtx._timeoutFor(0) === 5000, netCtx._timeoutFor(0));
  check('書き込み側も無限には伸びない（40秒で頭打ち）', netCtx._timeoutFor(9, 'submitForm') === 40000, netCtx._timeoutFor(9, 'submitForm'));

  // ---- 2. 返ってこない応答を待ち続けない ----
  setup({ getOrders: [{ delay: Infinity }] });
  let threw = null;
  const p1 = netCtx.gasPost({ action: 'getOrders', params: {} }).catch(e => { threw = e; });
  await drain();
  await p1;
  check('返らない応答は打ち切られる（永久に待たない）', threw !== null, String(threw && threw.name));
  check('打ち切って6試行まで投げ直す', countPosts('getOrders') === 6, { posts: countPosts('getOrders') });
  const at = posts.filter(p => p.action === 'getOrders').map(p => p.at);
  check('読み込みの1回目は5秒で打ち切る', at[1] >= 5000 && at[1] < 6000, { 二回目の投げた時刻: at[1] });
  check('2回目も8秒で打ち切る', at[2] - at[1] >= 8000 && at[2] - at[1] < 9500, { 差: at[2] - at[1] });

  // ---- 3. 「遅いが生きている」応答を切り捨てない（実測の26秒コールドスタート） ----
  setup({ getOrders: [{ delay: 26000, status: 200, body: { orders: [] } }] });
  let got = null;
  const p2 = netCtx.gasPost({ action: 'getOrders', params: {} }).then(r => { got = r; });
  await drain();
  await p2;
  check('26秒かかる「遅いが生きている」応答も、最後の試行で受け取れる（切り捨てない）', got !== null && !!got.orders, { got: !!got });
  check('そのとき5試行かかる（早く切る代償。失敗率50%では早期投げ直しの方が期待値がよい）', countPosts('getOrders') === 5, { posts: countPosts('getOrders') });

  // ---- 4. 404 は打ち切りを待たずに即座に投げ直す ----
  setup({ getOrders: [{ delay: 50, status: 404 }, { delay: 50, status: 200, body: { orders: [] } }] });
  got = null;
  const p3 = netCtx.gasPost({ action: 'getOrders', params: {} }).then(r => { got = r; });
  await drain();
  await p3;
  check('404はすぐ投げ直して2回目で通る', got !== null && !!got.orders, { got: !!got });

  // ---- 5. 操作が通ったらセッションを延ばす ----
  setup({ getOrders: [{ delay: 10, status: 200, body: { orders: [] } }] });
  const p4 = netCtx.gasPost({ action: 'getOrders', params: {} });
  await drain();
  await p4;
  check('通信が通ったらセッションを延ばす', touched === 1, { touched });

  // ---- 6. 死んだセッションは延ばさない ----
  setup({ getOrders: [{ delay: 10, status: 200, body: { error: 'session_expired' } }] });
  const p5 = netCtx.gasPost({ action: 'getOrders', params: {} });
  await drain();
  await p5;
  check('セッション切れの応答では延ばさない', touched === 0, { touched });

  setup({ getOrders: [{ delay: 10, status: 200, body: { error: 'unauthorized' } }] });
  const p6 = netCtx.gasPost({ action: 'getOrders', params: {} });
  await drain();
  await p6;
  check('本人確認NGの応答でも延ばさない', touched === 0, { touched });

  // ============================================================
  // パート2: スライド式セッション（touchAuth / getStoredAuth）
  // ============================================================
  const authBlock = cut("const AUTH_KEY = 'erena_auth';", '  function saveAuthMaker(', '認証保持 一式');

  let store = {};
  let vclock = 1000000;
  const authCtx = {
    console, JSON, Object, Error, String,
    Date: { now: () => vclock },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  };
  vm.createContext(authCtx);
  vm.runInContext(authBlock + String.fromCharCode(10) + ";var __SESSION_HOURS = AUTH_SESSION_HOURS;", authCtx);  // vm では const は context に出ないので var 経由で取り出す

  const H = 60 * 60 * 1000;
  check('放置を許すのは3時間（今と同じ＝開きっぱなしの露出を延ばしていない）',
    authCtx.__SESSION_HOURS === 3, authCtx.__SESSION_HOURS);

  // ログイン直後
  store = {};
  authCtx.saveAuth('S001', 'テスト店', false, 'tok-1');
  let saved = JSON.parse(store['erena_auth']);
  check('ログイン時の期限は3時間後', saved.expiry === vclock + 3 * H, { expiry: saved.expiry - vclock });

  // 2時間後に操作 → 期限がそこから3時間に伸びる
  vclock += 2 * H;
  authCtx.touchAuth();
  saved = JSON.parse(store['erena_auth']);
  check('操作すると、そこから3時間に伸びる', saved.expiry === vclock + 3 * H, { 残り: saved.expiry - vclock });

  // さらに2時間後（ログインからは4時間）でも、まだ生きている＝作業中に切れない
  vclock += 2 * H;
  check('ログインから4時間でも、使っていれば切れない', authCtx.getStoredAuth() !== null);

  // ここから3時間放置 → 切れる
  vclock += 3 * H + 1;
  check('操作せず3時間で切れる（放置端末は今までどおり切れる）', authCtx.getStoredAuth() === null);
  check('切れたら手元の保持も消える', !('erena_auth' in store));

  // 切れたものを touchAuth が生き返らせない
  store = {};
  vclock += 1;
  authCtx.saveAuth('S001', 'テスト店', false, 'tok-2');
  vclock += 3 * H + 1;               // 期限切れ
  authCtx.touchAuth();
  const after = store['erena_auth'] ? JSON.parse(store['erena_auth']) : null;
  check('期限切れを touchAuth が生き返らせない', after !== null && after.expiry < vclock, { 差: after && (after.expiry - vclock) });
  check('期限切れは getStoredAuth が弾く', authCtx.getStoredAuth() === null);

  // 未ログインで呼んでも落ちない
  store = {};
  let boom = null;
  try { authCtx.touchAuth(); } catch (e) { boom = e; }
  check('未ログインで touchAuth を呼んでも落ちない', boom === null, String(boom));

  console.log('\n' + (fail === 0 ? `全${pass}件 PASS` : `${pass}件 PASS / ${fail}件 FAIL`));
  if (fail > 0) process.exit(1);
})();
