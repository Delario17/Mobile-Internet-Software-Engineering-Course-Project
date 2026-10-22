require('./register.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {renderWave}=require('../entry/src/main/ets/domain/PcmRender.ts');
const {Cancellation}=require('../entry/src/main/ets/domain/Capabilities.ts');
const piece=(id,start,end,out,fade=0)=>({assetId:id,startUs:start,endUs:end,outputStartUs:out,fadeInUs:fade,fadeOutUs:fade});
test('WAV renders source gaps and selected take in manifest order with identical deterministic bytes',async()=>{
 const assets={source:Int16Array.from({length:160},(_,i)=>i+1000),take:new Int16Array(32).fill(-2000)};
 const m=[piece('source',0,2000,0),piece('take',0,2000,2000,500),piece('source',5000,10000,4000)];
 const render=()=>renderWave(m,async id=>assets[id],new Cancellation(),()=>{});
 const a=await render(),b=await render();assert.deepEqual(a,b);
 const header=new DataView(a);assert.equal(header.getUint32(24,true),16000);assert.equal(header.getUint16(22,true),1);
 assert.equal(header.getUint32(40,true),144*2);assert.equal(a.byteLength,44+288);
 const pcm=new Int16Array(a,44);assert.equal(pcm[0],1000);assert.equal(pcm[31],1031);
 assert.equal(pcm[32],0);assert.equal(pcm[40],-2000);assert.equal(pcm[63],0);assert.equal(pcm[64],1080);
 assert.equal(assets.take[0],-2000);
});
test('renderer rejects missing/short assets, invalid output ordering, excessive duration and cancellation',async()=>{
 await assert.rejects(renderWave([piece('missing',0,1000000,0)],async()=>undefined,new Cancellation(),()=>{}),/RENDER_ASSET/);
 await assert.rejects(renderWave([piece('source',0,1000000,1)],async()=>new Int16Array(16000),new Cancellation(),()=>{}),/RENDER_RANGE/);
 await assert.rejects(renderWave([piece('source',0,1000000,0)],async()=>new Int16Array(2),new Cancellation(),()=>{}),/RENDER_ASSET/);
 await assert.rejects(renderWave([piece('source',0,1801000000,0)],async()=>new Int16Array(2),new Cancellation(),()=>{}),/RENDER_TOO_LONG/);
 const c=new Cancellation();c.cancel();await assert.rejects(renderWave([piece('source',0,1000,0)],async()=>new Int16Array(16),c,()=>{}),/CANCELLED/);
});

test('exported standard WAV is directly readable and malformed WAV fails',async()=>{
 const {decodePcmWave}=require('../entry/src/main/ets/domain/PcmRender.ts');
 const bytes=await renderWave([piece('s',0,1000,0)],async()=>new Int16Array(16).fill(1234),new Cancellation(),()=>{});
 assert.deepEqual(decodePcmWave(bytes),new Int16Array(16).fill(1234));
 const bad=bytes.slice(0);new DataView(bad).setUint32(40,100000,true);assert.throws(()=>decodePcmWave(bad),/WAV_INVALID/);
 assert.equal(decodePcmWave(new ArrayBuffer(10)),undefined);
});
