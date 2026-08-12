/**
 * erena-catalog の更新系「投げる → 落としたら読んで確かめる」の検査。
 *
 * 🚨 いちばん守りたいのは【二重登録しないこと】。
 *    404は応答側で起きるので「実行されたのに答えだけ落ちた」が起こる。そこで盲目的に投げ直すと、
 *    追記系(addTracking)は伝票が重複＝二重発送になる。
 *    だから投げ直すのは「反映されていない」と読み直して確かめたときだけ。
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

const block = cut('const RETRIABLE_ACTIONS =', '  let formDataGlobal', 'gasPost 一式');

let posts = [];        // 投げた payload（action別に数えるため）
let plan = {};         // action -> 応答の配列。使い切ったら最後の応答を繰り返す

function respond(action) {
  const list = plan[action];
  if (!list || list.length === 0) return { status: 200, body: { success: true } };
  return list.length > 1 ? list.shift() : list[0];
}

const ctx = {
  console,
  setTimeout: (fn) => fn(),        // バックオフ待ちは飛ばす
  Promise, Object, Array, JSON, Error, String,
  GAS_URL: 'https://example.invalid/exec',
  currentAuthToken: 'tok',
  currentMakerEmail: 'maker@example.com',
  currentIsAdmin: false,
  handleSessionExpired: () => {},
  fetch: (url, opt) => {
    const payload = JSON.parse(opt.body);
    posts.push(payload);
    const r = respond(payload.action);
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
  else { fail++; console.log('NG   ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function setup(p) { posts = []; plan = p; }
function countPosts(action) { return posts.filter(function(p) { return p.action === action; }).length; }

const R404 = { status: 404, body: null };
const OK = (body) => ({ status: 200, body });
// 読み直しの応答（注文一覧）
const ORDERS = (list) => OK({ orders: list });
const ROW = (o) => Object.assign({ rowIdx: 5, shipStatus: '未発送', carrier: '', trackingNo: '', webediStatus: '未完了', webediAt: '' }, o);

(async () => {
  // ================= 1. 二重登録の防止（いちばん大事） =================

  // 404 → 読み直したら【もう反映済み】→ 投げ直さずに成功
  setup({
    updateShipment: [R404],
    getOrdersForMaker: [ORDERS([ROW({ shipStatus: '発送済', trackingNo: '5104-2339-6615' })])]
  });
  let r = await ctx.gasPost({ action: 'updateShipment', params: { rowIdx: 5, trackingNo: '5104-2339-6615' } });
  check('404でも、実は通っていたなら投げ直さない', countPosts('updateShipment') === 1, { posts: countPosts('updateShipment') });
  check('その場合は成功として返る', r.success === true && r._confirmedByRead === true, r);
  check('読み直した注文を updatedOrders に載せる', Array.isArray(r.updatedOrders), r);

  // 追記系: 読み直しもできない → 投げ直さずに止まる
  setup({ addTracking: [R404], getOrdersForMaker: [R404] });
  let threw = null;
  try { await ctx.gasPost({ action: 'addTracking', params: { rowIdx: 5, trackingNo: '1234-5678-9012' } }); }
  catch (e) { threw = e; }
  check('addTracking: 確認できないときは投げ直さない', countPosts('addTracking') === 1, { posts: countPosts('addTracking') });
  check('addTracking: 何もしていないことを言い切って止まる', !!threw && /確認できませんでした/.test(threw.message), threw && threw.message);

  // 追記系: 読み直して【入っていない】と確かめられたら投げ直してよい
  setup({
    addTracking: [R404, OK({ success: true })],
    getOrdersForMaker: [ORDERS([ROW({ shipStatus: '発送済', trackingNo: '9999-9999-9999' })])]
  });
  r = await ctx.gasPost({ action: 'addTracking', params: { rowIdx: 5, trackingNo: '1234-5678-9012' } });
  check('addTracking: 未反映と確かめたら投げ直す', countPosts('addTracking') === 2, { posts: countPosts('addTracking') });
  check('addTracking: 投げ直して通る', r.success === true, r);

  // 追記系: すでに入っているなら成功（重複追加しない）
  setup({
    addTracking: [R404],
    getOrdersForMaker: [ORDERS([ROW({ shipStatus: '発送済', trackingNo: '9999-9999-9999, 1234-5678-9012' })])]
  });
  r = await ctx.gasPost({ action: 'addTracking', params: { rowIdx: 5, trackingNo: '1234-5678-9012' } });
  check('addTracking: 既に入っていれば追加しない', countPosts('addTracking') === 1 && r.success === true, r);

  // ================= 2. 正当な拒否をねじ伏せない =================
  setup({ updateShipment: [OK({ success: false, error: 'この発注の発送処理権限がありません' })] });
  r = await ctx.gasPost({ action: 'updateShipment', params: { rowIdx: 5, trackingNo: '1' } });
  check('success:false は投げ直さない', countPosts('updateShipment') === 1, { posts: countPosts('updateShipment') });
  check('success:false はそのまま返る', r.success === false && !!r.error, r);
  check('読み直しにも行かない', countPosts('getOrdersForMaker') === 0);

  // ================= 3. 未反映なら投げ直す =================
  setup({
    updateWebedi: [R404, OK({ success: true })],
    getOrdersForMaker: [ORDERS([ROW({ webediStatus: '未完了' })])]
  });
  r = await ctx.gasPost({ action: 'updateWebedi', params: { rowIdx: 5 } });
  check('未反映なら投げ直して通る', countPosts('updateWebedi') === 2 && r.success === true, r);

  setup({ updateWebedi: [R404], getOrdersForMaker: [ORDERS([ROW({ webediStatus: '未完了' })])] });
  threw = null;
  try { await ctx.gasPost({ action: 'updateWebedi', params: { rowIdx: 5 } }); } catch (e) { threw = e; }
  check('巡回の上限は7回（初回+6巡）', countPosts('updateWebedi') === 7, { posts: countPosts('updateWebedi') });
  check('上限まで駄目ならエラーにする（成功を装わない）', !!threw);

  // 判定できない + 弾かれる側 → 投げ直してよい
  setup({ updateWebedi: [R404, R404, OK({ success: true })], getOrdersForMaker: [R404] });
  r = await ctx.gasPost({ action: 'updateWebedi', params: { rowIdx: 5 } });
  check('判定不能でも updateWebedi は投げ直す（サーバーが弾く）', countPosts('updateWebedi') === 3 && r.success === true, r);

  // ================= 4. 状態の見分け =================
  // 発送済だが【別の伝票】＝他の人が発送した。自分の分は通っていないので投げ直す
  setup({
    updateShipment: [R404, OK({ success: false, error: 'すでに発送済みです' })],
    getOrdersForMaker: [ORDERS([ROW({ shipStatus: '発送済', trackingNo: '0000-0000-0000' })])]
  });
  r = await ctx.gasPost({ action: 'updateShipment', params: { rowIdx: 5, trackingNo: '1234-5678-9012' } });
  check('別の伝票で発送済なら自分の分は未反映と見る', countPosts('updateShipment') === 2, { posts: countPosts('updateShipment') });
  check('投げ直して「すでに発送済み」なら成功として読み替える', r.success === true, r);

  // 全角・ハイフン違いでも同じ番号と分かる
  setup({
    updateShipment: [R404],
    getOrdersForMaker: [ORDERS([ROW({ shipStatus: '発送済', trackingNo: '５１０４２３３９６６１５' })])]
  });
  r = await ctx.gasPost({ action: 'updateShipment', params: { rowIdx: 5, trackingNo: '5104-2339-6615' } });
  check('追跡番号は全角/ハイフンの揺れを吸収して比べる', r.success === true && countPosts('updateShipment') === 1, r);

  // 取消
  setup({ undoShipment: [R404], getOrdersForMaker: [ORDERS([ROW({ shipStatus: '未発送' })])] });
  r = await ctx.gasPost({ action: 'undoShipment', params: { rowIdx: 5 } });
  check('発送取消: 未発送に戻っていれば成功', r.success === true && countPosts('undoShipment') === 1, r);

  setup({ undoWebedi: [R404], getOrdersForMaker: [ORDERS([ROW({ webediStatus: '未完了' })])] });
  r = await ctx.gasPost({ action: 'undoWebedi', params: { rowIdx: 5 } });
  check('計上取消: 未完了に戻っていれば成功', r.success === true, r);

  // 伝票の置換
  setup({
    replaceTrackings: [R404],
    getOrdersForMaker: [ORDERS([ROW({ shipStatus: '発送済', trackingNo: '1111-1111-1111, 2222-2222-2222' })])]
  });
  r = await ctx.gasPost({ action: 'replaceTrackings', params: { rowIdx: 5, items: [{ trackingNo: '1111-1111-1111' }, { trackingNo: '2222-2222-2222' }] } });
  check('伝票編集: 中身が一致していれば成功', r.success === true && countPosts('replaceTrackings') === 1, r);

  setup({
    replaceTrackings: [R404, OK({ success: true })],
    getOrdersForMaker: [ORDERS([ROW({ shipStatus: '発送済', trackingNo: '1111-1111-1111' })])]
  });
  r = await ctx.gasPost({ action: 'replaceTrackings', params: { rowIdx: 5, items: [{ trackingNo: '1111-1111-1111' }, { trackingNo: '2222-2222-2222' }] } });
  check('伝票編集: 1件しか入っていなければ未反映と見る', countPosts('replaceTrackings') === 2, { posts: countPosts('replaceTrackings') });

  // ================= 5. 一括処理 =================
  setup({
    updateShipmentBatch: [R404],
    getOrdersForMaker: [ORDERS([
      ROW({ rowIdx: 5, shipStatus: '発送済', trackingNo: '1111-1111-1111' }),
      ROW({ rowIdx: 6, shipStatus: '発送済', trackingNo: '2222-2222-2222' })
    ])]
  });
  r = await ctx.gasPost({ action: 'updateShipmentBatch', params: { items: [
    { rowIdx: 5, trackingNo: '1111-1111-1111' }, { rowIdx: 6, trackingNo: '2222-2222-2222' }] } });
  check('一括: 全部反映済みなら投げ直さない', countPosts('updateShipmentBatch') === 1, { posts: countPosts('updateShipmentBatch') });
  check('一括: 件数を成功として返す', r.success === true && r.succeeded === 2 && r.failed === 0, r);

  setup({
    updateShipmentBatch: [R404, OK({ success: true, succeeded: 1, failed: 1,
      failedItems: [{ rowIdx: 5, error: '発送済み済み' }], updatedOrders: [{ rowIdx: 6 }] })],
    getOrdersForMaker: [ORDERS([
      ROW({ rowIdx: 5, shipStatus: '発送済', trackingNo: '1111-1111-1111' }),
      ROW({ rowIdx: 6, shipStatus: '未発送' })
    ])]
  });
  r = await ctx.gasPost({ action: 'updateShipmentBatch', params: { items: [
    { rowIdx: 5, trackingNo: '1111-1111-1111' }, { rowIdx: 6, trackingNo: '2222-2222-2222' }] } });
  check('一括: 一部だけなら丸ごと投げ直す', countPosts('updateShipmentBatch') === 2, { posts: countPosts('updateShipmentBatch') });
  check('一括: 済みの行を成功に数え直す', r.succeeded === 2 && r.failed === 0, r);

  setup({ updateWebediBatch: [R404],
    getOrdersForMaker: [ORDERS([ROW({ rowIdx: 5, webediStatus: '計上済' }), ROW({ rowIdx: 6, webediStatus: '計上済' })])] });
  r = await ctx.gasPost({ action: 'updateWebediBatch', params: { items: [{ rowIdx: 5 }, { rowIdx: 6 }] } });
  check('一括計上: 全部反映済みなら投げ直さない', countPosts('updateWebediBatch') === 1 && r.succeeded === 2, r);

  // ================= 6. 読み込み系は従来どおり =================
  setup({ getOrdersForMaker: [R404] });
  threw = null;
  try { await ctx.gasPost({ action: 'getOrdersForMaker', params: {} }); } catch (e) { threw = e; }
  check('読み込み系の上限は従来どおり3試行', countPosts('getOrdersForMaker') === 3, { posts: countPosts('getOrdersForMaker') });

  setup({ requestMagicLinkMaker: [R404] });
  threw = null;
  try { await ctx.gasPost({ action: 'requestMagicLinkMaker', params: {} }); } catch (e) { threw = e; }
  check('対象外の action は1回だけ', countPosts('requestMagicLinkMaker') === 1, { posts: countPosts('requestMagicLinkMaker') });

  // ================= 7. 一覧そのものの検査（取りこぼし防止） =================
  const CONF = vm.runInContext('WRITE_CONFIRM', ctx);
  const SAFE = vm.runInContext('SAFE_TO_RESEND', ctx);
  check('addTracking は「判定不能でも投げ直す」側に入っていない', !SAFE.addTracking);
  check('addTracking にも確認の手だてがある', typeof CONF.addTracking === 'function');
  check('submitForm が更新系に混ざっていない', !CONF.submitForm && !SAFE.submitForm);
  const expectConf = ['updateShipment', 'updateWebedi', 'undoShipment', 'undoWebedi',
                      'replaceTrackings', 'addTracking', 'updateShipmentBatch', 'updateWebediBatch'].sort();
  check('確認の対象は宣言した8つ', JSON.stringify(Object.keys(CONF).sort()) === JSON.stringify(expectConf), Object.keys(CONF).sort());
  const expectSafe = expectConf.filter(function(a) { return a !== 'addTracking'; });
  check('判定不能で投げ直してよいのは addTracking を除く7つ',
        JSON.stringify(Object.keys(SAFE).sort()) === JSON.stringify(expectSafe), Object.keys(SAFE).sort());

  // 発送処理の本線が【追記】を使っていないこと（実ファイルを直接見る）
  const shipFn = cut('submitShipment = function()', '  closeShipModal =', 'submitShipment');
  check('発送処理の本線が addTracking を呼んでいない', shipFn.indexOf("action: 'addTracking'") < 0);
  check('発送処理の本線は replaceTrackings で置換している', shipFn.indexOf("action: 'replaceTrackings'") >= 0);
  const addTrackingCalls = (src.match(/action: 'addTracking'/g) || []).length;
  check('addTracking の呼び出しはデッドコードの1か所だけ', addTrackingCalls === 1, { count: addTrackingCalls });

  console.log('\n' + (fail === 0 ? '全' + pass + '件 PASS' : pass + '件 PASS / ' + fail + '件 FAIL'));
  process.exit(fail === 0 ? 0 : 1);
})();
