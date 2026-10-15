const assert = require('node:assert/strict');
require('./register.cjs');
const { EditorSession } = require('../entry/src/main/ets/application/EditorSession.ts');
const { AppServices } = require('../entry/src/main/ets/composition/AppServices.ts');
const { Project, Segment } = require('../entry/src/main/ets/domain/Project.ts');

(async () => {
  const session = new EditorSession();
  session.project = new Project('p', 'source', 10000);
  session.project.segments.push(new Segment('sentence', 'test', 0, 10000));
  let calls = 0;
  AppServices.capabilities = {
    async execute(request) {
      calls++;
      assert.equal(request.selectedSegmentId, 'sentence');
      return { ok: false, errorCode: 'NOT_CONNECTED', messageKey: 'capability_unavailable', recoverable: false };
    }, async release() {}
  };
  assert.equal((await session.run('export', '', () => {})).errorCode, 'REVIEW_REQUIRED');
  assert.equal(calls, 0);
  assert.equal((await session.run('retake', '', () => {})).errorCode, 'SEGMENT_REQUIRED');
  session.selectedSegmentId = 'sentence';
  await session.run('retake', '', () => {});
  assert.equal(calls, 1);
  let finish;
  AppServices.capabilities = { execute() { return new Promise(resolve => finish = resolve); }, async release() {} };
  const waiting = session.run('preview', '', () => {});
  session.cancel();
  assert.equal((await waiting).errorCode, 'CANCELLED');
  assert.equal(session.busy, false);
  finish({ ok: true, project: new Project('late', 'late-source', 1000) });
  await Promise.resolve();
  assert.equal(session.project.id, 'p');
  // Accelerate the watchdog without waiting 30 seconds.
  const originalTimeout = global.setTimeout;
  global.setTimeout = callback => originalTimeout(callback, 1);
  AppServices.capabilities = { execute() { return new Promise(() => {}); }, async release() {} };
  assert.equal((await session.run('preview', '', () => {})).errorCode, 'TIMEOUT');
  global.setTimeout = originalTimeout;
  assert.equal(session.busy, false);
  const recording = new EditorSession();
  let recordingOperation = '';
  recording.store = { async commit(candidate) { candidate.sequence++; return candidate; } };
  AppServices.capabilities = {
    async execute(request) {
      recordingOperation = request.operation;
      if (request.operation === 'recordStop') {
        return { ok: true, errorCode: '', messageKey: 'recording_saved', recoverable: false,
          project: new Project('recorded', 'recorded-source', 1000000) };
      }
      return { ok: true, errorCode: '', messageKey: `recording_${request.operation}`, recoverable: false };
    }, async release() {}
  };
  assert.equal((await recording.run('recordStart', '', () => {})).ok, true);
  assert.equal(recordingOperation, 'recordStart');
  assert.equal((await recording.run('recordPause', '', () => {})).ok, true);
  assert.equal((await recording.run('recordResume', '', () => {})).ok, true);
  assert.equal((await recording.run('recordStop', '', () => {})).ok, true);
  assert.equal(recording.project.sourceDurationUs, 1000000);
  assert.equal(recording.project.sequence, 1);
  const failedRecording = new EditorSession();
  let discarded = 0;
  failedRecording.store = { async commit() { throw new Error('DISK_FULL'); } };
  AppServices.capabilities = {
    async execute(request) {
      if (request.operation === 'recordStop') {
        return { ok: true, errorCode: '', messageKey: 'recording_saved', recoverable: false,
          project: new Project('orphaned', 'orphaned-source', 1000000) };
      }
      return { ok: true, errorCode: '', messageKey: 'recording_started', recoverable: false };
    },
    async discardPendingAsset() { discarded++; },
    async finalizePendingAsset() {},
    async release() {}
  };
  const failedSave = await failedRecording.run('recordStop', '', () => {});
  assert.equal(failedSave.errorCode, 'SAVE_FAILED');
  assert.equal(discarded, 1);
  assert.equal(failedRecording.project, undefined);
  console.log('Session checks passed: export gate, target validation, cancellation, stale result, timeout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
