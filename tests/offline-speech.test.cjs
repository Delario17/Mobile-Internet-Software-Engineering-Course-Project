require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
let engine, listener, writes, shutdown, cancelled, creates;
global.__arktsTestKits = {
 coreSpeechKit: { speechRecognizer: { async createEngine(params) {
  assert.equal(params.online, 1); creates++;
  engine = { setListener(v) { listener=v; }, startListening(p) { queueMicrotask(()=>listener.onStart(p.sessionId, '')); },
   writeAudio(id, bytes) { assert.equal(bytes.length,640); writes++; }, finish(id) { listener.onResult(id,{isFinal:true,isLast:true,result:'实际识别'}); listener.onComplete(id,''); },
   cancel() { cancelled++; }, shutdown() { shutdown++; } };
  return engine;
 } } },
 audioPcm: { async decode() { return Int16Array.from({length:6400},(_,i)=>i%2?2000:-2000).buffer; }, cancelDecode() {} }
};
const { OfflineSpeech } = require('../entry/src/main/ets/infrastructure/OfflineSpeech.ts');
const { Project } = require('../entry/src/main/ets/domain/Project.ts');
const { Cancellation } = require('../entry/src/main/ets/domain/Capabilities.ts');
function reset() { writes=shutdown=cancelled=creates=0; }
test('real PCM is streamed, only final text becomes an unreviewed bounded segment', async () => {
 reset(); const p=new Project('p','source',400000); const cancel=new Cancellation();
 const result=await new OfflineSpeech().recognize(p, 1, 10, cancel, ()=>{});
 assert.equal(result.ok,true); assert.equal(writes,20); assert.equal(shutdown,1);
 assert.equal(p.segments.length,0); assert.equal(result.project.sourceAssetId,'source');
 assert.equal(result.project.segments[0].text,'实际识别'); assert.equal(result.project.segments[0].reviewedAtMs,0);
 assert.equal(result.project.segments[0].startUs,0); assert.equal(result.project.segments[0].endUs,400000);
});
test('rerun cannot erase edited segments or take history', async () => {
 reset(); const p=new Project('p','source',400000); p.takes.push({id:'take'});
 const result=await new OfflineSpeech().recognize(p,1,10,new Cancellation(),()=>{});
 assert.equal(result.errorCode,'ASR_EXISTING_EDITS'); assert.equal(creates,0);
});
test('cancellation while feeding releases engine and publishes nothing', async () => {
 reset(); const cancel=new Cancellation();
 const promise=new OfflineSpeech().recognize(new Project('p','source',400000),1,10,cancel,()=>{});
 setTimeout(()=>cancel.cancel(),50);
 const result=await promise; assert.equal(result.errorCode,'CANCELLED'); assert.equal(result.project,undefined);
 assert.equal(shutdown,1); assert.equal(cancelled,1);
});
test('silence reports no speech and never starts engine', async () => {
 reset(); global.__arktsTestKits.audioPcm.decode=async()=>new ArrayBuffer(6400);
 const result=await new OfflineSpeech().recognize(new Project('p','source',400000),1,10,new Cancellation(),()=>{});
 assert.equal(result.errorCode,'ASR_NO_SPEECH'); assert.equal(creates,0);
});

test('unavailable engine and decoder failures remain explicit without publishing phrases', async () => {
 reset(); const kits=global.__arktsTestKits;
 const decode=kits.audioPcm.decode, create=kits.coreSpeechKit.speechRecognizer.createEngine;
 try {
  kits.audioPcm.decode=async()=>Int16Array.from({length:6400},()=>2000).buffer;
  kits.coreSpeechKit.speechRecognizer.createEngine=async()=>{throw new Error('unavailable');};
  const result=await new OfflineSpeech().recognize(new Project('p','source',400000),1,10,new Cancellation(),()=>{});
  assert.equal(result.errorCode,'ASR_ENGINE_UNAVAILABLE'); assert.equal(result.project,undefined);
  kits.audioPcm.decode=async()=>{throw new Error('ASR_DECODE_FAILED');};
  assert.equal((await new OfflineSpeech().recognize(new Project('p','source',400000),1,10,new Cancellation(),()=>{})).errorCode,'ASR_DECODE_FAILED');
 } finally {kits.audioPcm.decode=decode;kits.coreSpeechKit.speechRecognizer.createEngine=create;}
});

test('engine that arrives after cancellation is shut down', async () => {
 reset(); const kits=global.__arktsTestKits;
 const decode=kits.audioPcm.decode, create=kits.coreSpeechKit.speechRecognizer.createEngine;
 let deliver;
 try {
  kits.audioPcm.decode=async()=>Int16Array.from({length:6400},()=>2000).buffer;
  kits.coreSpeechKit.speechRecognizer.createEngine=()=>new Promise(resolve=>deliver=resolve);
  const cancel=new Cancellation();
  const pending=new OfflineSpeech().recognize(new Project('p','source',400000),1,10,cancel,()=>{});
  await new Promise(resolve=>setImmediate(resolve));cancel.cancel();
  assert.equal((await pending).errorCode,'CANCELLED');
  deliver({shutdown(){shutdown++;}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(shutdown,1);
 } finally {kits.audioPcm.decode=decode;kits.coreSpeechKit.speechRecognizer.createEngine=create;}
});
