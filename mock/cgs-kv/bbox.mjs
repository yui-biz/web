import fs from 'fs'; import { chromium } from 'playwright';
const U='/root/.claude/uploads/5be69990-3805-516b-9cfc-26c5dc7d6f41/';
const F={a10:'93ce2d9a',a20:'e85a8e14',a30:'7d40ae9a',a40:'f2960531',a50:'66d3338e',
         a60:'aedb94af',a70:'95f6a52c',a80:'dc5c0dbb',a90:'241b4c53',a100:'097d92aa'};
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage();
await p.goto('about:blank');
const out={};
for (const [k,id] of Object.entries(F)) {
  const d='data:image/'+(['f2960531','241b4c53'].includes(id)?'png':'jpeg')+';base64,'+fs.readFileSync(U+id+'-image.'+(['f2960531','241b4c53'].includes(id)?'png':'jpg')).toString('base64');
  out[k]=await p.evaluate(async src => {
    const im=new Image(); im.src=src; await im.decode();
    const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight;
    const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(im,0,0);
    const D=g.getImageData(0,0,c.width,c.height).data;
    const at=(x,y)=>{const i=(y*c.width+x)*4; return [D[i],D[i+1],D[i+2]];};
    // 地の色＝四隅の中央値
    const cor=[at(2,2),at(c.width-3,2),at(2,c.height-3),at(c.width-3,c.height-3)];
    const bg=[0,1,2].map(j=>cor.map(v=>v[j]).sort((a,b)=>a-b)[1]);
    const diff=(x,y)=>{const v=at(x,y);return Math.max(Math.abs(v[0]-bg[0]),Math.abs(v[1]-bg[1]),Math.abs(v[2]-bg[2]));};
    let x0=c.width,y0=c.height,x1=-1,y1=-1;
    for(let y=0;y<c.height;y+=2) for(let x=0;x<c.width;x+=2){
      if(diff(x,y)>34){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    }
    return {w:c.width,h:c.height,bg,x:x0,y:y0,bw:x1-x0+1,bh:y1-y0+1};
  }, d);
  const o=out[k];
  console.log(k.padEnd(5)+' 画像 '+o.w+'x'+o.h+'  図版 '+o.bw+'x'+o.bh+' @('+o.x+','+o.y+')  地 rgb('+o.bg.join(',')+')');
}
fs.writeFileSync(process.cwd()+'/bbox.json', JSON.stringify(out,null,1));
await b.close();
