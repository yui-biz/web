/**
 * erena-catalog の【商品情報を画面側にも持つ】仕組みの検査（2026-08-13）。
 *
 * 通信は1回あたり5割の確率で404を引き、そのぶん毎回待たされていた。
 * 商品情報は滅多に変わらないので、前回の内容をその場で出して、裏で最新に差し替える。
 *
 * ここで守りたいこと:
 *   1. 版が変わったら捨てる（応答の形が変わったとき、古い内容で画面が壊れる）
 *   2. 古すぎるものは使わない
 *   3. 空や壊れたものを掴んで画面を白紙にしない
 *   4. 🚨 ドロップダウンを2回作らない（TomSelect の二重生成でフォームが操作不能になる）
 *   5. 🚨 裏で差し替えるとき、店舗が選んでいた商品を消さない
 *
 * 実ファイル(index.html)から抜き出して vm で動かす。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'erena-catalog', 'index.html');
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');

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
// 1. キャッシュの読み書き
// ============================================================
const block = cut("const PRODUCT_CACHE_KEY = 'erena_products_v1';", '  function populateProductDropdown(', '商品キャッシュ');

let store = {};
let clock = 1000000000;
let storageWorks = true;
const ctx = {
  JSON, Array, Object, String,
  Date: { now: () => clock },
  APP_BUILD: '20260813d',
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { if (!storageWorks) throw new Error('QuotaExceeded'); store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  }
};
vm.createContext(ctx);
vm.runInContext(block, ctx);

const PRODUCTS = [{ name: '和牛セット', productNo: '1001' }, { name: '銘茶詰合せ', productNo: '1002' }];
const RESULT = { products: PRODUCTS, holidays: ['2026-08-11'] };

store = {};
check('最初は何も無いので null', ctx._loadProductCache() === null);

ctx._saveProductCache(RESULT);
let got = ctx._loadProductCache();
check('保存したものを読み出せる', !!got && got.products.length === 2, got && got.products.length);
check('祝日も一緒に持つ', !!got && got.holidays[0] === '2026-08-11', got && got.holidays);

// 版が違えば捨てる
ctx.APP_BUILD = '20260814a';
check('版が変わったら使わない（応答の形が変わっている恐れ）', ctx._loadProductCache() === null);
ctx.APP_BUILD = '20260813d';
check('版を戻せばまた使える', ctx._loadProductCache() !== null);

// 古すぎるものは使わない
clock += 24 * 60 * 60 * 1000 + 1;
check('1日以上前のものは使わない', ctx._loadProductCache() === null);
clock -= 24 * 60 * 60 * 1000 + 1;
check('1日以内なら使える', ctx._loadProductCache() !== null);

// 空・壊れたもの
store = {};
ctx._saveProductCache({ products: [] });
check('空の商品一覧は保存しない（画面を白紙にしない）', ctx._loadProductCache() === null, store);
ctx._saveProductCache({});
check('products が無い応答も保存しない', ctx._loadProductCache() === null);
ctx._saveProductCache(null);
check('null を渡しても落ちない', ctx._loadProductCache() === null);

store = { 'erena_products_v1': '{壊れたJSON' };
let boom = null;
try { got = ctx._loadProductCache(); } catch (e) { boom = e; }
check('壊れた内容でも落ちない', boom === null && got === null, String(boom));

// localStorage が使えない環境
store = {};
storageWorks = false;
boom = null;
try { ctx._saveProductCache(RESULT); } catch (e) { boom = e; }
check('localStorage が使えなくても落ちない（保存を諦めるだけ）', boom === null, String(boom));
storageWorks = true;

// ============================================================
// 2. ドロップダウンの作り直し（実装の形を固定する）
// ============================================================
const dropdown = cut('  function populateProductDropdown(products) {', '  function displayProductImage(', 'ドロップダウン');

check('🚨 作り直す前に TomSelect を必ず壊す（二重生成でフォームが操作不能になる）',
  /if \(select\.tomselect\) \{[\s\S]*?select\.tomselect\.destroy\(\)/.test(dropdown));
check('壊す処理は innerHTML を書き換える前にある',
  dropdown.indexOf('destroy()') < dropdown.indexOf("select.innerHTML = '<option"));
check('🚨 選んでいた商品を覚えておく', /_prevSelected\s*=\s*\(select\.tomselect \? select\.tomselect\.getValue\(\) : select\.value\)/.test(dropdown));
check('選択を戻すのは TomSelect を作る【前】（後だと拾われない）',
  dropdown.indexOf('select.value = _prevSelected') < dropdown.indexOf('new TomSelect('));
check('選んでいた商品が消えていたら表示も揃える（写真だけ残さない）',
  /select\.value !== _prevSelected[\s\S]*?displayProductImage/.test(dropdown));

// ============================================================
// 3. 読み込み側の使い方
// ============================================================
const loader = cut("const _cachedP = _loadProductCache();", '// 古いタブ検知', '読み込み');
check('キャッシュがあれば先に表示する', /if \(_cachedP\)[\s\S]*?populateProductDropdown\(_cachedP\.products\)/.test(loader));
check('中身が変わっていなければ作り直さない（入力中の操作を邪魔しない）',
  /_same[\s\S]*?if \(!_same\) populateProductDropdown/.test(loader));
check('キャッシュで出せているなら、通信が失敗しても画面をエラーにしない',
  /if \(!_cachedP\) onFailure\(err\)/.test(loader));
check('キャッシュが無いときは従来どおりエラーにする（黙って空にしない）',
  /if \(!_cachedP\) return onFailure\(\{ message: result\.error \}\)/.test(loader));
check('取得できたら保存する', /_saveProductCache\(result\)/.test(loader));

console.log('\n' + (fail === 0 ? `全${pass}件 PASS` : `${pass}件 PASS / ${fail}件 FAIL`));
if (fail > 0) process.exit(1);
