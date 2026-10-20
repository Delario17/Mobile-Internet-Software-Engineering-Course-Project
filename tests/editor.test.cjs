require('./register.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { Project, Segment, Take, splitSegment, mergeSegments, addManualSegment, pendingReview } = require('../entry/src/main/ets/domain/Project.ts');
const { EditorSession } = require('../entry/src/main/ets/application/EditorSession.ts');
const { AppServices } = require('../entry/src/main/ets/composition/AppServices.ts');

test('split and merge preserve source coverage and history without adopting old takes', () => {
  const project = new Project('p', 'source', 10000);
  const original = new Segment('s', 'one two', 1000, 9000);
  original.selectedTakeId = 't';
  project.segments.push(original);
  project.takes.push(new Take('t', 's', 1, 'take', 12000));
  splitSegment(project, 's', 5000, 'left', 'right', 'one', 'two');
  assert.deepEqual(project.segments.map(s => [s.startUs, s.endUs, s.selectedTakeId]), [[1000, 5000, ''], [5000, 9000, '']]);
  assert.equal(project.takes.length, 1);
  assert.equal(pendingReview(project).length, 2);
  mergeSegments(project, 'left', 'right', 'merged');
  assert.equal(project.segments[0].startUs, 1000);
  assert.equal(project.segments[0].endUs, 9000);
  assert.equal(project.segments[0].text, 'one two');
  assert.equal(project.segments[0].selectedTakeId, '');
  assert.throws(() => addManualSegment(project, 'overlap', 'bad', 0, 2000));
  assert.equal(project.segments.length, 1);
});

test('range changes clear adoption, failed undo keeps both project and undo history', async () => {
  const session = new EditorSession();
  session.project = new Project('p', 'source', 10000);
  session.project.segments.push(new Segment('s', 'old', 0, 10000));
  session.project.takes.push(new Take('t', 's', 1, 'take', 5000));
  session.project.segments[0].selectedTakeId = 't';
  session.selectedSegmentId = 's';
  session.store = { async commit(candidate) { candidate.sequence++; return candidate; } };
  assert.equal((await session.changeRange(1000, 9000)).ok, true);
  assert.equal(session.project.segments[0].selectedTakeId, '');
  assert.equal((await session.selectTake('t')).ok, false);
  session.store = { async commit() { throw new Error('DISK_FULL'); } };
  assert.equal((await session.undo()).ok, false);
  assert.equal(session.project.segments[0].startUs, 1000);
  assert.equal(session.canUndo(), true);
});

test('review requires successful source audition of current revision; candidate audition never adopts', async () => {
  const session = new EditorSession();
  session.project = new Project('p', 'source', 10000);
  session.project.segments.push(new Segment('s', 'old', 1000, 9000));
  session.project.takes.push(new Take('t', 's', 1, 'take', 5000));
  session.selectedSegmentId = 's';
  session.store = { async commit(candidate) { candidate.sequence++; return candidate; } };
  assert.equal((await session.confirmSelected(true, true)).errorCode, 'AUDITION_REQUIRED');
  AppServices.capabilities = { async execute(request) {
    assert.equal(request.manifest.length, 1);
    if (request.operation === 'auditionSource') {
      assert.deepEqual([request.manifest[0].assetId, request.manifest[0].startUs, request.manifest[0].endUs], ['source', 1000, 9000]);
    } else { assert.equal(request.manifest[0].assetId, 'take'); }
    return { ok: true, errorCode: '', messageKey: '', recoverable: false };
  }, async release() {} };
  assert.equal((await session.run('auditionTake', '', () => {}, 't')).ok, true);
  assert.equal(session.project.segments[0].selectedTakeId, '');
  assert.equal(session.hasAuditionedSelection(), false);
  assert.equal((await session.run('auditionSource', '', () => {})).ok, true);
  assert.equal(session.hasAuditionedSelection(), true);
  assert.equal((await session.changeText('new')).ok, true);
  assert.equal(session.hasAuditionedSelection(), false);
  assert.equal((await session.confirmSelected(true, true)).ok, false);
  await session.run('auditionSource', '', () => {});
  assert.equal((await session.confirmSelected(true, true)).ok, true);
  assert.equal(pendingReview(session.project).length, 0);
});

test('capability adapter cannot mutate the published project on failure', async () => {
  const session = new EditorSession();
  session.project = new Project('p', 'source', 10000);
  session.project.segments.push(new Segment('s', 'original', 0, 10000));
  AppServices.capabilities = { async execute(request) {
    request.project.segments[0].text = 'changed despite failure';
    return { ok: false, errorCode: 'FAILED', messageKey: 'operation_failed', recoverable: true };
  }, async release() {} };
  await session.run('recognize', '', () => {});
  assert.equal(session.project.segments[0].text, 'original');
});

test('retake commits join undo history; failed media commit preserves history and content', async () => {
  const session = new EditorSession();
  session.project = new Project('p', 'source', 10000);
  session.project.segments.push(new Segment('s', 'original', 0, 10000));
  session.selectedSegmentId = 's';
  const commit = async candidate => { candidate.sequence++; return candidate; };
  session.store = { commit };
  await session.changeText('corrected');
  AppServices.capabilities = { async execute(request) {
    request.project.takes.push(new Take('new-take', 's', 1, 'take-asset', 8000));
    return { ok: true, errorCode: '', messageKey: '', recoverable: false, project: request.project };
  }, async release() {} };
  session.store = { async commit() { throw new Error('DISK_FULL'); } };
  assert.equal((await session.run('retake', '', () => {})).messageKey, 'save_failed');
  assert.equal(session.project.takes.length, 0);
  assert.equal(session.canUndo(), true);
  session.store = { commit };
  assert.equal((await session.run('retake', '', () => {})).ok, true);
  const sequence = session.project.sequence;
  await session.undo();
  assert.equal(session.project.takes.length, 0);
  assert.equal(session.project.segments[0].text, 'corrected');
  await session.undo();
  assert.equal(session.project.segments[0].text, 'original');
  assert.equal(session.project.sequence, sequence + 2);
});

test('retake lifecycle publishes a range-bound take only after its project commit', async () => {
  const session = new EditorSession();
  session.project = new Project('p-retake-session', 'source-fixed', 2000000);
  session.project.segments.push(new Segment('sentence', 'spoken text', 200000, 1100000));
  session.selectedSegmentId = 'sentence';
  const originalRange = [session.project.segments[0].startUs, session.project.segments[0].endUs];
  const calls = [];
  session.store = { async commit(candidate, expected) {
    assert.equal(expected, 0);
    candidate.sequence = 1;
    return candidate;
  } };
  AppServices.capabilities = {
    async execute(request) {
      calls.push(request.operation);
      if (request.operation === 'retakeStop') {
        request.project.takes.push(new Take('take-new', 'sentence', 1, 'take-new', 720000));
        return { ok: true, errorCode: '', messageKey: 'retake_saved', recoverable: false, project: request.project };
      }
      return { ok: true, errorCode: '', messageKey: 'retake_started', recoverable: false };
    },
    async finalizePendingAsset() {},
    async discardPendingAsset() { assert.fail('successful candidate must not be discarded'); },
    async release() {}
  };
  assert.equal((await session.run('retakeStart', '', () => {})).ok, true);
  assert.equal(session.project.takes.length, 0);
  await session.run('retakePause', '', () => {});
  await session.run('retakeResume', '', () => {});
  const saved = await session.run('retakeStop', '', () => {});
  assert.equal(saved.ok, true);
  assert.deepEqual(calls, ['retakeStart', 'retakePause', 'retakeResume', 'retakeStop']);
  assert.equal(session.project.sourceAssetId, 'source-fixed');
  assert.deepEqual([session.project.segments[0].startUs, session.project.segments[0].endUs], originalRange);
  assert.deepEqual(session.project.takes.map(take => [take.segmentId, take.rangeRevision, take.assetId]),
    [['sentence', 1, 'take-new']]);
});

test('retake commit failure discards pending candidate and leaves the source project published', async () => {
  const session = new EditorSession();
  session.project = new Project('p-retake-failure', 'source-fixed', 1000000);
  session.project.segments.push(new Segment('sentence', 'spoken text', 0, 900000));
  session.selectedSegmentId = 'sentence';
  session.store = { async commit() { throw new Error('DISK_FULL'); } };
  let discarded = 0;
  AppServices.capabilities = {
    async execute(request) {
      const candidate = request.project;
      candidate.takes.push(new Take('take-fail', 'sentence', 1, 'take-fail', 650000));
      return { ok: true, errorCode: '', messageKey: 'retake_saved', recoverable: false, project: candidate };
    },
    async discardPendingAsset() { discarded++; }, async release() {}
  };
  const result = await session.run('retakeStop', '', () => {});
  assert.equal(result.messageKey, 'save_failed');
  assert.equal(discarded, 1);
  assert.equal(session.project.sourceAssetId, 'source-fixed');
  assert.equal(session.project.takes.length, 0);
});

test('edits are committed before publication; save failure preserves current project', async () => {
  const session = new EditorSession();
  session.project = new Project('p', 'source', 10000);
  session.project.segments.push(new Segment('s', 'old', 0, 10000));
  session.selectedSegmentId = 's';
  session.store = { async commit() { throw new Error('DISK_FULL'); } };
  assert.equal((await session.changeText('new')).ok, false);
  assert.equal(session.project.segments[0].text, 'old');
  session.store = { async commit(candidate) { candidate.sequence++; return candidate; } };
  assert.equal((await session.changeText('new')).ok, true);
  const sequence = session.project.sequence;
  assert.equal(session.project.segments[0].text, 'new');
  assert.equal((await session.undo()).ok, true);
  assert.equal(session.project.segments[0].text, 'old');
  assert.equal(session.project.sequence, sequence + 1);
});
