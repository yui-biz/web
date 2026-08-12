/**
 * ご案内ページの取得処理を、実ファイルから抜き出して動かす。
 * fetch を差し替えて「1回目失敗→2回目成功」「ずっと失敗」を再現する。
 */
const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'../guide/index.html'),'utf8');
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
const decls=['GUIDE_MAX_RETRY','GUIDE_TIMEOUT_MS','GUIDE_SLOW_MS']
  .map(n=>new RegExp('var '+n+' = \\d+;').exec(html)[0]).join('\n');

function run(responses){   // responses: 各回の {ok,status,text} か 'throw'
  let calls=0, appHtml='', rendered=null, notFound=false;
  const loadingTexts=[];
  const ctx={
    console, JSON, Date, String, AbortController,
    // 待ち時間は詰める。ただし「上限で中断」のタイマーは走らせない（即発火すると全部中断になる）
    setTimeout:(f,ms)=>{ if(ms>=10000) return 0; f(); return 0; },
    clearTimeout:()=>{},
    GAS_API:'https://example.test/exec',
    localStorage:{setItem(){},getItem(){return null;}},
    location:{reload(){ctx._reloaded=true;}},
    document:{
      getElementById:()=>({ set innerHTML(v){appHtml=v;}, get innerHTML(){return appHtml;} }),
      querySelector:()=>({ set textContent(v){loadingTexts.push(v);}, get textContent(){return '';} }),
    },
    render:(d)=>{rendered=d;},
    showNotFound:()=>{notFound=true;},
    fetch:(u)=>{
      const r=responses[Math.min(calls,responses.length-1)]; calls++;
      if(r==='throw') return Promise.reject(new Error('ネットワーク'));
      return Promise.resolve({ok:r.ok!==false, status:r.status||200, text:()=>Promise.resolve(r.text)});
    },
  };
  vm.createContext(ctx);
  vm.runInContext(decls+'\n'+cut('setLoadingText')+'\n'+cut('fetchFromGas')+'\n'+cut('showError'), ctx);
  ctx.fetchFromGas('C1','guide_C1',true,0);
  return new Promise(r=>setImmediate(()=>setImmediate(()=>setImmediate(()=>
    r({calls, appHtml, rendered, notFound, reloaded:ctx._reloaded, loadingTexts})))));
}

const GOOD={text:JSON.stringify({pages:[{title:'案内',sections:[]}]})};

(async()=>{
console.log('\n== 1回目だけ失敗 → 自動でやり直して表示できる（saito の症状）==');
let r=await run(['throw', GOOD]);
ok('2回呼んでいる', r.calls===2, '呼び出し'+r.calls+'回');
ok('最終的に表示できた', !!r.rendered);
ok('エラー画面を出していない', !/読み込めませんでした/.test(r.appHtml), r.appHtml.slice(0,80));

console.log('\n== GASがJSONでないエラーページを返した場合 ==');
r=await run([{text:'<html>Service invoked too many times</html>'}, GOOD]);
ok('やり直して表示できた', !!r.rendered, '呼び出し'+r.calls+'回');

console.log('\n== HTTPエラーでもやり直す ==');
r=await run([{ok:false,status:500,text:''}, GOOD]);
ok('やり直して表示できた', !!r.rendered);

console.log('\n== ずっと失敗 → 行き止まりにしない ==');
r=await run(['throw']);
ok('2回まで試す（初回+再試行1）＝無言で長く待たせない', r.calls===2, '呼び出し'+r.calls+'回');
ok('「もう一度読み込む」ボタンを出す', /もう一度読み込む/.test(r.appHtml));
ok('押すと再読み込みする', /location\.reload\(\)/.test(r.appHtml));
ok('原因の当たりを伝える', /通信が不安定/.test(r.appHtml));
ok('技術的な理由も小さく添える（報告を受けて切り分けられる）', /ネットワーク/.test(r.appHtml), r.appHtml.slice(-160));
ok('やり直す前に「もう一度試しています」と伝える＝黙らない',
  r.loadingTexts.some(t=>/もう一度試しています/.test(t)), JSON.stringify(r.loadingTexts));

console.log('\n== 「顧客が見つからない」はやり直さない ==');
r=await run([{text:JSON.stringify({error:'not_found'})}, GOOD]);
ok('1回で確定する', r.calls===1, '呼び出し'+r.calls+'回');
ok('専用の画面を出す', r.notFound===true);
ok('エラー画面は出さない', !/もう一度読み込む/.test(r.appHtml));

console.log('\n========================================');
console.log(pass+'件 PASS / '+fail+'件 FAIL');
process.exit(fail?1:0);
})();
