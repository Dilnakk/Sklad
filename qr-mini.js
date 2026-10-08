/*
 * Minimal QR generator for short inventory codes.
 * V1 intentionally supports QR Version 1 / Error Correction L only.
 * Capacity in byte mode: 17 bytes, which is plenty for item codes such as D-0001 or AU-0001.
 * No external request or service is used.
 */
(function(global){
  'use strict';
  const EXP = new Array(512), LOG = new Array(256);
  let x=1;
  for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}
  for(let i=255;i<512;i++)EXP[i]=EXP[i-255];
  function mul(a,b){if(a===0||b===0)return 0;return EXP[LOG[a]+LOG[b]]}
  function polyMul(p,q){const out=new Array(p.length+q.length-1).fill(0);for(let i=0;i<p.length;i++)for(let j=0;j<q.length;j++)out[i+j]^=mul(p[i],q[j]);return out}
  function generator(degree){let p=[1];for(let i=0;i<degree;i++)p=polyMul(p,[1,EXP[i]]);return p}
  const GEN7=generator(7);
  function ecc(data,n){const rem=new Array(n).fill(0);for(const b of data){const factor=b^rem[0];for(let i=0;i<n-1;i++)rem[i]=rem[i+1]^mul(GEN7[i+1],factor);rem[n-1]=mul(GEN7[n],factor)}return rem}
  function bitsToBytes(bits){const out=[];for(let i=0;i<bits.length;i+=8){let v=0;for(let j=0;j<8;j++)v=(v<<1)|(bits[i+j]||0);out.push(v)}return out}
  function bchTypeInfo(v){let d=v<<10;let g=0x537;while(bitLen(d)-bitLen(g)>=0)d^=g<<(bitLen(d)-bitLen(g));return ((v<<10)|d)^0x5412}
  function bitLen(v){let n=0;while(v){n++;v>>>=1}return n}
  function qrMatrix(text){
    const data=unescape(encodeURIComponent(String(text)));
    const bytes=[];for(let i=0;i<data.length;i++)bytes.push(data.charCodeAt(i));
    if(bytes.length>17)throw new Error('QR kód V1 zvládne maximálně 17 bajtů.');
    const bits=[0,1,0,0]; // byte mode
    for(let i=7;i>=0;i--)bits.push((bytes.length>>i)&1);
    for(const b of bytes)for(let i=7;i>=0;i--)bits.push((b>>i)&1);
    for(let i=0;i<4 && bits.length<152;i++)bits.push(0);
    while(bits.length%8)bits.push(0);
    const dataBytes=bitsToBytes(bits);
    const pads=[0xec,0x11];let pi=0;while(dataBytes.length<19){dataBytes.push(pads[pi++%2])}
    const e=ecc(dataBytes,7);const all=dataBytes.concat(e);
    const size=21;const m=Array.from({length:size},()=>Array(size).fill(null));
    function set(r,c,v){if(r>=0&&r<size&&c>=0&&c<size)m[r][c]=!!v}
    function finder(r0,c0){for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){const inBox=r>=0&&r<=6&&c>=0&&c<=6;const dark=inBox&&(r===0||r===6||c===0||c===6||(r>=2&&r<=4&&c>=2&&c<=4));set(r0+r,c0+c,dark)}}
    finder(0,0);finder(size-7,0);finder(0,size-7);
    for(let i=8;i<size-8;i++){if(m[6][i]===null)m[6][i]=(i%2===0);if(m[i][6]===null)m[i][6]=(i%2===0)}
    // Reserve format information areas.
    for(let i=0;i<9;i++){if(i!==6){m[8][i]=m[8][i]===null?false:m[8][i];m[i][8]=m[i][8]===null?false:m[i][8]}}
    for(let i=0;i<8;i++){m[8][size-1-i]=m[8][size-1-i]===null?false:m[8][size-1-i];m[size-1-i][8]=m[size-1-i][8]===null?false:m[size-1-i][8]}
    m[size-8][8]=true;
    let bitString=bchTypeInfo(0x08); // L + mask 0 (L = 1 << 3)
    function fmtBit(i){return ((bitString>>i)&1)!==0}
    for(let i=0;i<15;i++){
      const v=fmtBit(i);
      if(i<6)m[i][8]=v;else if(i<8)m[i+1][8]=v;else m[size-15+i][8]=v;
      if(i<8)m[8][size-i-1]=v;else if(i<9)m[8][15-i]=v;else m[8][15-i-1]=v;
    }
    // Data placement, mask 0: (row + col) % 2 === 0.
    const databit=[];for(const b of all)for(let i=7;i>=0;i--)databit.push((b>>i)&1);
    let k=0;let row=size-1;let upward=true;
    for(let col=size-1;col>0;col-=2){if(col===6)col--;for(let i=0;i<size;i++){row=upward?size-1-i:i;for(let dx=0;dx<2;dx++){const c=col-dx;if(m[row][c]!==null)continue;let v=k<databit.length?databit[k++]:0;if(((row+c)&1)===0)v^=1;m[row][c]=!!v}}upward=!upward}
    return m;
  }
  function svg(text,cell,margin){const m=qrMatrix(text),n=m.length, s=(n+margin*2)*cell;let d='';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(m[r][c])d+=`<rect x="${(c+margin)*cell}" y="${(r+margin)*cell}" width="${cell}" height="${cell}"/>`;return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" shape-rendering="crispEdges" aria-label="QR kód"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${d}</g></svg>`}
  global.InventoryQR={matrix:qrMatrix,toSvg:svg};
})(window);
