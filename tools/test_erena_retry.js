/**
 * erena-catalog の gasPost 再送ロジックの検査。
 *
 * 🚨 いちばん守りたいのは「addTracking を再送しないこと」。
 *    addTracking は伝票の【追記】なので、2回通ると同じ注文に伝票が2枚つき二重発送になる。
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

// RETRIABLE_ACTIONS 〜 gasPost の終わりまでを丸ごと持ってくる
const block = cut('const RETRIABLE_ACTIONS =', '  let formDataGlobal', 'gasPost 一式');

let fetchCalls = [];
let responses = [];   // 先頭から順に返す。{status, body} / {throw:true}

const ctx = {
  console,
  setTimeout: (fn) => fn(),        // バックオフ待ちは飛ばす
  Promise, Object, Array, JSON, Error,
  GAS_URL: 'https://example.invalid/exec',
  currentAuthToken: 'tok',
  handleSessionExpired: () => {},
  fetch: (url, opt) => {
    fetchCalls.push(JSON.parse(opt.body));
    const r = responses.shift() || { status: 200, body: { success: true } };
    if (r.throw) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve({
      ok: r.status === 200,
      status: r.status,
      json: () => Promise.resolve(r.body)
    });
  }
};
vm.createContext(ctx);
vm.runInContext(block, ctx);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('NG   ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
function reset(resp) { fetchCalls = []; responses = resp || []; }

const R404 = { status: 404, body: null };
const OK = (body) => ({ status: 200, body });

(async () => {
  // ---- 1. 二重登録の防止（いちばん大事） ----
  reset([R404, R404, R404, R404, R404, R404, R404]);
  let threw = false;
  try { await ctx.gasPost({ action: 'addTracking', params: {} }); } catch (e) { threw = true; }
  check('addTracking は404でも再送しない（1回だけ）', fetchCalls.length === 1, { calls: fetchCalls.length });
  check('addTracking は404なら呼び出し側にエラーを返す', threw);

  reset([R404, R404]);
  threw = false;
  try { await ctx.gasPost({ action: 'requestMagicLinkMaker', params: {} }); } catch (e) { threw = true; }
  check('未登録の action は再送しない', fetchCalls.length === 1, { calls: fetchCalls.length });

  // ---- 2. サーバーの正当な拒否を再送でねじ伏せない ----
  reset([OK({ success: false, error: 'この発注の発送処理権限がありません' })]);
  let r = await ctx.gasPost({ action: 'updateShipment', params: {} });
  check('success:false は再送しない', fetchCalls.length === 1, { calls: fetchCalls.length });
  check('success:false はそのまま返る', r.success === false && !!r.error);

  // ---- 3. 404のときだけ粘る ----
  reset([R404, R404, R404, OK({ success: true, updatedOrders: [{ rowIdx: 5 }] })]);
  r = await ctx.gasPost({ action: 'updateShipment', params: {} });
  check('updateShipment は404で再送して通る', r.success === true, r);
  check('updateShipment の試行回数は4回', fetchCalls.length === 4, { calls: fetchCalls.length });

  reset([R404, R404, R404, R404, R404, R404, R404, R404]);
  threw = false;
  try { await ctx.gasPost({ action: 'updateWebedi', params: {} }); } catch (e) { threw = true; }
  check('更新系の上限は6試行（初回+5再送）', fetchCalls.length === 6, { calls: fetchCalls.length });
  check('上限まで404ならエラーになる（成功を装わない）', threw);

  reset([R404, R404, R404]);
  threw = false;
  try { await ctx.gasPost({ action: 'getOrdersForMaker', params: {} }); } catch (e) { threw = true; }
  check('読み込み系の上限は従来どおり3試行', fetchCalls.length === 3, { calls: fetchCalls.length });

  // ---- 4. 「すでに済んでいます」の読み替え ----
  reset([OK({ success: false, error: 'すでに発送済みです' })]);
  r = await ctx.gasPost({ action: 'updateShipment', params: {} });
  check('初回の「すでに発送済みです」は読み替えない', r.success === false, r);

  reset([R404, OK({ success: false, error: 'すでに発送済みです' })]);
  r = await ctx.gasPost({ action: 'updateShipment', params: {} });
  check('再送後の「すでに発送済みです」は成功として扱う', r.success === true && r._recoveredFromRetry === true, r);
  check('読み替えたら updatedOrders を落として全件再読込に回す', !r.updatedOrders, r);

  reset([R404, OK({ success: false, error: 'すでに計上済みです' })]);
  r = await ctx.gasPost({ action: 'updateWebedi', params: {} });
  check('再送後の「すでに計上済みです」も同じ', r.success === true, r);

  reset([R404, OK({ success: false, error: 'この発注の操作権限がありません' })]);
  r = await ctx.gasPost({ action: 'updateWebedi', params: {} });
  check('再送後でも「済み」以外は読み替えない', r.success === false, r);

  // 取消は「もう未発送だから取消できません」と逆向きの言い方で返る
  reset([R404, OK({ success: false, error: '発送済みの注文のみ取消できます' })]);
  r = await ctx.gasPost({ action: 'undoShipment', params: {} });
  check('再送後の発送取消は成功として扱う', r.success === true, r);

  reset([R404, OK({ success: false, error: '計上済みの注文のみ取消できます' })]);
  r = await ctx.gasPost({ action: 'undoWebedi', params: {} });
  check('再送後の計上取消も成功として扱う', r.success === true, r);

  reset([OK({ success: false, error: '発送済みの注文のみ取消できます' })]);
  r = await ctx.gasPost({ action: 'undoShipment', params: {} });
  check('初回の取消エラーは読み替えない', r.success === false, r);

  // ---- 5. 一括処理 ----
  reset([R404, OK({
    success: true, succeeded: 1, failed: 2,
    failedItems: [{ rowIdx: 7, error: '発送済み済み' }, { rowIdx: 9, error: '権限なし' }],
    updatedOrders: [{ rowIdx: 3 }]
  })]);
  r = await ctx.gasPost({ action: 'updateShipmentBatch', params: {} });
  check('一括: 1回目に通っていた行を成功に数え直す', r.succeeded === 2, r);
  check('一括: 本当の失敗は残す', r.failed === 1 && r.failedItems[0].error === '権限なし', r);
  check('一括: 読み替えたら全件再読込に回す', !r.updatedOrders, r);

  reset([OK({
    success: true, succeeded: 1, failed: 1,
    failedItems: [{ rowIdx: 7, error: '発送済み済み' }], updatedOrders: [{ rowIdx: 3 }]
  })]);
  r = await ctx.gasPost({ action: 'updateShipmentBatch', params: {} });
  check('一括: 初回は数え直さない', r.succeeded === 1 && r.failed === 1, r);
  check('一括: 初回は updatedOrders を残す', !!r.updatedOrders, r);

  // ---- 6. 対象一覧そのものの検査（取りこぼし防止） ----
  // const は vm のコンテキストのプロパティにならないので、式を評価して取り出す
  const IDEM = vm.runInContext('IDEMPOTENT_WRITE_ACTIONS', ctx);
  check('addTracking が再送対象に入っていない', !IDEM.addTracking);
  check('submitForm が更新系の再送対象に混ざっていない', !IDEM.submitForm);
  const expected = ['updateShipment', 'updateWebedi', 'undoShipment', 'undoWebedi',
                    'replaceTrackings', 'updateShipmentBatch', 'updateWebediBatch'].sort();
  const actual = Object.keys(IDEM).sort();
  check('再送対象は宣言した7つだけ', JSON.stringify(expected) === JSON.stringify(actual), actual);

  // ---- 7. 発送処理の本線が【追記】を使っていないこと（実ファイルを直接見る） ----
  // 🚨 ここが再び addTracking に戻ると、404のあと押し直しで伝票が重複する。
  const shipFn = cut('submitShipment = function()', '  closeShipModal =', 'submitShipment');
  check('発送処理の本線が addTracking を呼んでいない', shipFn.indexOf("action: 'addTracking'") < 0);
  check('発送処理の本線は replaceTrackings で置換している', shipFn.indexOf("action: 'replaceTrackings'") >= 0);
  const addTrackingCalls = (src.match(/action: 'addTracking'/g) || []).length;
  check('addTracking の呼び出しはデッドコードの1か所だけ', addTrackingCalls === 1, { count: addTrackingCalls });

  console.log('\n' + (fail === 0 ? '全' + pass + '件 PASS' : pass + '件 PASS / ' + fail + '件 FAIL'));
  process.exit(fail === 0 ? 0 : 1);
})();
