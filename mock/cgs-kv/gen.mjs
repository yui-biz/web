import fs from 'fs'; import { chromium } from 'playwright';
const SP='/tmp/claude-0/-home-user-web/5be69990-3805-516b-9cfc-26c5dc7d6f41/scratchpad/';
const U='/root/.claude/uploads/5be69990-3805-516b-9cfc-26c5dc7d6f41/';
const F={a10:'93ce2d9a',a20:'e85a8e14',a30:'7d40ae9a',a40:'f2960531',a50:'66d3338e',
         a60:'aedb94af',a70:'95f6a52c',a80:'dc5c0dbb',a90:'241b4c53',a100:'097d92aa'};
const PNG=['f2960531','241b4c53'];
const EXT=k=>PNG.includes(F[k])?'png':'jpg';
const B=JSON.parse(fs.readFileSync(SP+'bbox.json','utf8'));

// 参照コラージュ（1201x797）から実測した 10 枠（%）。余白も参照のまま
const REF=[
  [ 2.7,  7.5, 15.7, 23.1, 'a70' ],  // 左上・小：いちばん静かな線画
  [21.0,  7.5, 15.7, 23.1, 'a50' ],  // 上左中・小：銅、暖色
  [36.6,  7.5, 23.6, 28.6, 'a40' ],  // 上中央・中：淡いパステル
  [62.9,  7.5, 32.3, 48.7, 'a90' ],  // 右・大：緑の塊
  [ 4.0, 36.6, 20.3, 30.6, 'a100'],  // 左中・中：暗い紺で緑の重さを受ける
  [23.3, 43.2, 36.6, 49.1, 'a10' ],  // 中央・大：いちばん強い多色
  [61.9, 59.2, 12.3, 19.1, 'a60' ],  // 右中・小：赤橙
  [76.9, 61.7, 20.3, 30.6, 'a30' ],  // 右下・中：黒の線画。左上の a70 と対角
  [ 8.0, 70.3, 13.3, 22.1, 'a20' ],  // 左下・小：寒色で下辺を受ける
  [62.3, 79.3, 12.3, 13.0, 'a80' ],  // 右下・小：赤青
];
// 微調整（%）。左右は台紙幅、上下は台紙高さに対して
const NUDGE={ a40:[ +1.2, 0 ], a80:[ -2.6, +1.2 ] };

const SW=Number(process.argv[2] ?? 1500), SH=Math.round(SW*797/1201);
const BG=process.argv[3] ?? '#f6f3ec';   // 地：真っ白ではなく、生成り（本番の --color-logos と同系）
const cells=REF.map(([l,t,w,h,k])=>{ const n=NUDGE[k]||[0,0];
  return {x:(l+n[0])/100*SW, y:(t+n[1])/100*SH, cw:w/100*SW, ch:h/100*SH, k}; });

const html=[`<meta charset=utf-8><style>
  html,body{margin:0}
  .sheet{position:relative;width:${SW}px;height:${SH}px;background:${BG};isolation:isolate;overflow:hidden}
  .c{position:absolute}
  .c img{position:absolute;mix-blend-mode:multiply;display:block}
</style>
<div class='sheet'>`];
for(const c of cells){
  const b=B[c.k];
  // 枠の「面積」に合わせて拾う＝枠の中の余白が最小（比率は保ち、片方向だけ枠からはみ出す）
  const s=Math.sqrt((c.cw*c.ch)/(b.bw*b.bh));
  const brt=Math.min(1.30, 255/Math.min(...b.bg)+0.02).toFixed(2);  // 地を白く飛ばす
  const ox=(c.cw-b.bw*s)/2 - b.x*s, oy=(c.ch-b.bh*s)/2 - b.y*s;
  const d='data:image/'+(EXT(c.k)==='png'?'png':'jpeg')+';base64,'
        + fs.readFileSync(U+F[c.k]+'-image.'+EXT(c.k)).toString('base64');
  html.push(`  <div class='c' style='left:${c.x.toFixed(1)}px;top:${c.y.toFixed(1)}px;width:${c.cw.toFixed(1)}px;height:${c.ch.toFixed(1)}px'>`
    +`<img src='${d}' style='left:${ox.toFixed(1)}px;top:${oy.toFixed(1)}px;width:${(b.w*s).toFixed(1)}px;height:${(b.h*s).toFixed(1)}px;filter:brightness(${brt})'></div>`);
}
html.push('</div>');
fs.writeFileSync(SP+'collage.html', html.join('\n'));

const cx0=(SW-SH)/2, cx1=cx0+SH;
const cut=cells.filter(c=>c.x<cx0||c.x+c.cw>cx1)
  .map(c=>c.k+'('+Math.round(100*(Math.max(0,cx0-c.x)+Math.max(0,c.x+c.cw-cx1))/c.cw)+'%欠け)');
console.log('台紙 '+SW+'x'+SH+'（参照と同じ比率・余白も参照のまま）／地 '+BG);
console.log('微調整: '+Object.entries(NUDGE).map(([k,v])=>k+' '+v[0]+'%,'+v[1]+'%').join(' / '));
console.log('正方形カードで左右が切れるもの: '+(cut.length?cut.join(' '):'なし'));

const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await br.newPage({viewport:{width:SW,height:SH},deviceScaleFactor:1});
await p.goto('file://'+SP+'collage.html');
await p.waitForTimeout(700);
await p.locator('.sheet').screenshot({path:SP+'collage.jpg', type:'jpeg', quality:88});
await br.close();
console.log('collage.jpg '+(fs.statSync(SP+'collage.jpg').size/1024|0)+'KB');
