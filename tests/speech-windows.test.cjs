require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { speechWindows } = require('../entry/src/main/ets/domain/SpeechWindows.ts');
function pcm(parts) {
  return Int16Array.from(parts.flatMap(([ms, amplitude]) => Array.from({ length: ms * 16 }, (_, i) => i % 2 ? amplitude : -amplitude)));
}
test('silence creates no invented transcript range', () => assert.deepEqual(speechWindows(pcm([[1000, 0]])), []));
test('speech windows follow measured pauses with bounded context', () => {
  const ranges = speechWindows(pcm([[500,0],[1000,2000],[800,0],[1000,2000],[500,0]]));
  assert.equal(ranges.length, 2);
  assert.ok(ranges[0].startSample <= 8000 && ranges[0].startSample >= 4800);
  assert.ok(ranges[0].endSample < ranges[1].startSample);
  assert.ok(ranges[1].endSample <= 60800);
});
test('continuous speech is bounded below official 60 second limit, never overlaps', () => {
  const ranges = speechWindows(pcm([[32000, 2000]]));
  assert.ok(ranges.length >= 3);
  ranges.forEach((r,i) => { assert.ok(r.endSample > r.startSample); assert.ok(r.endSample-r.startSample <= 240000); if(i) assert.ok(r.startSample >= ranges[i-1].endSample); });
});
