/** ヒアリングフォームの取得処理を実ファイルから抜き出して検証する */
const fs=require('fs'), vm=require('vm'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../hearing/index.html'),'utf8');
let pass=0,fail=0;
const ok=(n,c,x)=>c?(pass++,console.log('  ✅ '+n)):(fail++,console.log('  ❌ '+n+(x!==undefined?'  → '+x:'')));
function cut(name){
  const m=new RegExp('function\\s+'+name+'\\s*\\(').exec(html);
  if(!m) throw new Error('見つからない: '+name);
  let i=html.indexOf('{',m.index),d=0,s=null,e=false;
  for(let j=i;j<html.length;j++){const c=html[j];
    if(e){e=false;continue;} if(s){if(c==='\\')e=true;else if(c===s)s=null;continue;}
    if(c==='"'||c==="'"||c==='`'){s=c;continue;}
    if(c==='{')d++;else if(c==='}'&&--d===0)return html.slice(m.index,j+1);}
  throw new Error('閉じ括弧なし: '+name);
}
function wrap(obj){
  const b=Buffer.from(JSON.stringify(obj),'utf8').toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return '<!doctype html><body><div id="d">@@GUIDE@@'+b+'@@END@@</div></body>';
}
function run(responses){
  let calls=0, shown=null, notFound=false, loadErr=null, saved=null, boxHtml='';
  const ctx={
    console:{log:console.log,warn:()=>{}}, JSON, Date, String, setTimeout:(f)=>f(),
    atob:(b)=>Buffer.from(b,'base64').toString('binary'), Uint8Array, TextDecoder,
    GAS_URL:'https://example.test/exec', encodeURIComponent,
    localStorage:{setItem:(k,v)=>{saved=v;},getItem:()=>null},
    location:{reload(){}},
    document:{getElementById:()=>({ set innerHTML(v){boxHtml=v;}, get innerHTML(){return boxHtml;},
      classList:{add(){},remove(){}} })},
    showForm:(d)=>{shown=d;}, showError:()=>{notFound=true;},
    fetch:()=>{ const r=responses[Math.min(calls,responses.length-1)]; calls++;
      if(r==='throw') return Promise.reject(new Error('ネットワーク'));
      return Promise.resolve({ok:r.ok!==false, status:r.status||200, text:()=>Promise.resolve(r.text)}); },
  };
  vm.createContext(ctx);
  vm.runInContext('var FORM_MAX_RETRY=1;\n'+cut('parseFormPayload')+'\n'+cut('showLoadError')+'\n'+cut('fetchFromGas'), ctx);
  ctx.fetchFromGas('C1','form_C1',true,0);
  return new Promise(r=>setImmediate(()=>setImmediate(()=>setImmediate(()=>
    r({calls, shown, notFound, boxHtml, saved})))));
}
const GOOD={text:wrap({customerId:'C1',customerName:'田中'})};

(async()=>{
console.log('\n== 正常に読める ==');
let r=await run([GOOD]);
ok('1回で表示できる', r.calls===1 && !!r.shown);
ok('中身が復元できている', r.shown && r.shown.customerName==='田中', JSON.stringify(r.shown));
ok('キャッシュに保存する', !!r.saved);

console.log('\n== 1回目が404 → やり直して表示できる（saito の症状）==');
r=await run([{ok:false,status:404,text:''}, GOOD]);
ok('2回呼ぶ', r.calls===2, '呼び出し'+r.calls+'回');
ok('最終的に表示できる', !!r.shown);
ok('「見つかりません」を出さない', r.notFound===false);

console.log('\n== ずっと失敗 → 「見つかりません」ではなく「読み込めませんでした」==');
r=await run(['throw']);
ok('やり直しは1回まで', r.calls===2, '呼び出し'+r.calls+'回');
// 🚨 ここが今回の肝。読み込み失敗を「見つかりません」と言わない
ok('「見つかりません」とは言わない', r.notFound===false);
ok('「読み込めませんでした」と出す', /読み込めませんでした/.test(r.boxHtml), r.boxHtml.slice(0,80));
ok('もう一度読み込むボタンを出す', /もう一度読み込む/.test(r.boxHtml));
ok('理由を小さく添える', /ネットワーク/.test(r.boxHtml));

console.log('\n== 顧客が見つからない場合はやり直さない ==');
r=await run([{text:wrap({error:'not_found'})}, GOOD]);
ok('1回で確定する', r.calls===1, '呼び出し'+r.calls+'回');
ok('「見つかりません」を出す', r.notFound===true);
ok('読み込み失敗の画面は出さない', !/読み込めませんでした/.test(r.boxHtml));

console.log('\n========================================');
console.log(pass+'件 PASS / '+fail+'件 FAIL');
process.exit(fail?1:0);
})();
