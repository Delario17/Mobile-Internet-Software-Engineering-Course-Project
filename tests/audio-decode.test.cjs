const test=require('node:test'),assert=require('node:assert/strict');
let input,position=0,nativeCalls=0;
global.__arktsTestKits={coreFileKit:{fileIo:{readSync(fd,out,options){position=options.offset;const n=Math.min(out.byteLength,input.byteLength-position);new Uint8Array(out).set(new Uint8Array(input,position,Math.max(n,0)));return n;}}},audioPcm:{async decode(){nativeCalls++;return new ArrayBuffer(2);}}};
require('./register.cjs');
const {decodeAudio}=require('../entry/src/main/ets/infrastructure/AudioDecode.ts');
const {renderWave}=require('../entry/src/main/ets/domain/PcmRender.ts');
const {Cancellation}=require('../entry/src/main/ets/domain/Capabilities.ts');
test('exported WAV decode reads actual PCM and compressed input delegates to native decoder',async()=>{
 input=await renderWave([{assetId:'s',startUs:0,endUs:1000,outputStartUs:0,fadeInUs:0,fadeOutUs:0}],async()=>new Int16Array(16).fill(321),new Cancellation(),()=>{});
 assert.deepEqual(new Int16Array(await decodeAudio(1,input.byteLength)),new Int16Array(16).fill(321));assert.equal(nativeCalls,0);
 input=new ArrayBuffer(12);await decodeAudio(1,12);assert.equal(nativeCalls,1);
});

test('large noncanonical WAV delegates instead of applying normalized output byte limit to source',async()=>{
 input=new ArrayBuffer(64);const v=new DataView(input);v.setUint32(0,0x52494646);v.setUint32(8,0x57415645);
 v.setUint32(12,0x666d7420);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,48000,true);v.setUint16(34,16,true);
 const before=nativeCalls;await decodeAudio(1,115200044);assert.equal(nativeCalls,before+1);
});
