import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {tintIrisPixels,tintIrisPairPixels} from '../apps/room3d/chibi/faceTint';
import {HUE_PALETTE} from '../apps/room3d/chibi/creatorHairTint';
import highlights from '../apps/room3d/chibi/faceHighlights.json';
import {cleanFace,highlightStyles} from '../apps/room3d/chibi/faceAppearance';
/**
 * Decode only the images used by these golden-image assertions: non-interlaced
 * 8-bit RGBA PNGs. Unlike walking node_modules/.pnpm to load an undeclared
 * native sharp package, this uses only Node built-ins and works under frozen
 * dependency installs on every supported host.
 *
 * Do not silently accept another PNG format: a fixture change must update
 * this reader deliberately so the pixel-level assertions stay meaningful.
 */
const decodeRgbaPng = (png: Buffer): { data: Buffer; info: { width: number; height: number } } => {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Not a PNG');
  }
  let width = 0, height = 0;
  const compressed: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const size = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const end = offset + 8 + size;
    if (end + 4 > png.length) throw new Error('Truncated PNG chunk');
    const chunk = png.subarray(offset + 8, end);
    if (type === 'IHDR') {
      if (chunk.length !== 13 || chunk[8] !== 8 || chunk[9] !== 6 ||
          chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) {
        throw new Error('Expected non-interlaced 8-bit RGBA PNG fixture');
      }
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
    } else if (type === 'IDAT') {
      compressed.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4; // skip CRC
  }
  if (!width || !height || width * height > 4_000_000 || !compressed.length) {
    throw new Error('Invalid PNG dimensions or missing image data');
  }
  const rowSize = width * 4;
  const raw = inflateSync(Buffer.concat(compressed));
  if (raw.length !== (rowSize + 1) * height) throw new Error('Unexpected PNG payload length');
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowSize + 1)];
    if (filter > 4) throw new Error('Unknown PNG scanline filter');
    for (let x = 0; x < rowSize; x++) {
      const idx = y * rowSize + x;
      const left = x >= 4 ? pixels[idx - 4] : 0;
      const above = y ? pixels[idx - rowSize] : 0;
      const aboveLeft = y && x >= 4 ? pixels[idx - rowSize - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const p = left + above - aboveLeft;
        const dl = Math.abs(p - left), da = Math.abs(p - above), dul = Math.abs(p - aboveLeft);
        predictor = dl <= da && dl <= dul ? left : da <= dul ? above : aboveLeft;
      }
      pixels[idx] = (raw[y * (rowSize + 1) + x + 1] + predictor) & 255;
    }
  }
  return { data: pixels, info: { width, height } };
};
describe('Original grayscale dye and white highlights',()=>{
 it('matches every Chibi palette parameter, linework threshold and both eye halves without converting via HEX',()=>{
  const html=readFileSync('public/like520/character_creator.html','utf8');
  const section=(start:string,end:string)=>html.slice(html.indexOf(start),html.indexOf(end));
  const code=section('const HUE_PALETTE =','const state =')+section('function hslToRgb(','/* 解析 tintColor')+section('function colorHsl(','/* ===== 取翻转状态')+section('function applyEyesTint(','function upscaleCanvas(');
  for(let hueIdx=0;hueIdx<HUE_PALETTE.length;hueIdx++)for(const threshold of [0,25,55])for(const light of [-50,0,50]){
   const L={hueIdx,sat:75,light},R={hueIdx:(hueIdx+7)%18,sat:25,light:-light};
   const pixels=new Uint8ClampedArray(Array.from({length:257*3},(_,i)=>[i%256,i%256,i%256,i%5===0?0:i%3===0?127:255]).flat());
   const actual=pixels.slice(),expected=pixels.slice(),ctx={getImageData:()=>({data:expected}),putImageData:()=>{}};
   runInNewContext(code+';applyEyesTint(canvas,resolveTint(L),resolveTint(R))',{state:{preserveLineart:threshold},canvas:{width:257,height:3,getContext:()=>ctx},L,R});
   tintIrisPairPixels(actual,257,{L,R},undefined,threshold);expect(actual).toEqual(expected);
  }
 });
 it('matches the legacy creator for every grayscale, including alpha and black/white preservation',()=>{
  const html=readFileSync('public/like520/character_creator.html','utf8');
  const hsl=html.slice(html.indexOf('function hslToRgb('),html.indexOf('/* 解析 tintColor'));
  const tint=html.slice(html.indexOf('function applyEyesTint('),html.indexOf('function upscaleCanvas('));
  for(const [color,h,s,lightOffset] of [['#ff0000',0,100,0],['#00ff00',120,100,0],['#0000ff',240,100,0],['#333333',0,0,-30]] as const){
   const source=new Uint8ClampedArray(256*4);
   for(let i=0;i<256;i++)source.set([i,i,i,i],i*4);
   const expected=source.slice(),actual=source.slice();
   const context={getImageData:()=>({data:expected}),putImageData:()=>{}};
   runInNewContext(`${hsl}\n${tint}\napplyEyesTint(canvas,tint,tint)`,{state:{preserveLineart:25},canvas:{width:256,height:1,getContext:()=>context},tint:{h,s,lightOffset}});
   tintIrisPixels(actual,color);
   expect(actual).toEqual(expected);
  }
 });
 it('publishes six distinct pure-white masks with traceable sources and original coordinates',async()=>{
  expect(Object.keys(highlights.assets)).toHaveLength(6);
  const hashes=new Set<string>();
  for(const id of highlightStyles){
   expect(cleanFace({highlight:id}).highlight).toBe(id);
   const asset=highlights.assets[`highlight-${id}` as keyof typeof highlights.assets];
   const bytes=readFileSync(`public/${asset.src}`);
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
   expect(createHash('sha256').update(readFileSync(`public/${asset.source}`)).digest('hex')).toBe(asset.sourceSha256);
   const {data,info}=decodeRgbaPng(bytes);
   const iris=decodeRgbaPng(readFileSync(`public/room3d/face/iris-${asset.sourceStyle}-open.png`)).data;
   expect([info.width,info.height]).toEqual([472,472]);
   const sides=[0,0];
   for(let i=0;i<data.length;i+=4)if(data[i+3]){
    expect([...data.subarray(i,i+3)]).toEqual([255,255,255]);
    expect(iris[i+3]).toBeGreaterThan(239);
    sides[(i/4)%472<236?0:1]++;
   }
   expect(Math.min(...sides)).toBeGreaterThan(8);hashes.add(asset.sha256);
  }
  expect(hashes.size).toBe(6);
 });
});
