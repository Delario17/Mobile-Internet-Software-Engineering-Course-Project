const assert = require('node:assert/strict');
const { test } = require('node:test');

let permissionCalls = 0;
let finishPermission;
let recorderCreates = 0;
const closed = [];
const unlinked = [];
let nextFd = 1;
let pickerUris = ['file://media/audio.m4a'];
let copied = [];
let openedPaths = [];
let playerInstance;

function recorder() {
  return {
    state: 'idle',
    async prepare() { this.state = 'prepared'; },
    async start() { this.state = 'started'; },
    async pause() { this.state = 'paused'; },
    async resume() { this.state = 'started'; },
    async stop() { this.state = 'stopped'; },
    async release() { this.state = 'released'; }
  };
}

const fileIo = {
  OpenMode: { READ_ONLY: 0, WRITE_ONLY: 1, CREATE: 64, TRUNC: 512 },
  mkdirSync() {},
  openSync(path) { openedPaths.push(path); return { fd: nextFd++ }; },
  closeSync(file) { closed.push(file.fd); },
  statSync() { return { size: 12 }; },
  listFileSync() { return ['source-play.m4a']; },
  unlinkSync(path) { unlinked.push(path); },
  async copyFile(src, dest) { copied.push({ src, dest }); },
  rmdirSync() {}
};

global.__arktsTestKits = {
  coreFileKit: { fileIo, picker: { AudioViewPicker: class {
    constructor() {}
    async select() { return pickerUris; }
  } } },
  mediaKit: { media: {
    AudioSourceType: { AUDIO_SOURCE_TYPE_MIC: 1 },
    CodecMimeType: { AUDIO_AAC: 'aac' },
    ContainerFormatType: { CFT_MPEG_4A: 'm4a' },
    async createAVRecorder() { recorderCreates++; return recorder(); },
    async createAVMetadataExtractor() { throw new Error('METADATA_CREATE_FAILED'); },
    async createAVPlayer() {
      playerInstance = {
        state: 'idle',
        callbacks: {},
        on(type, callback) { this.callbacks[type] = callback; },
        off() {},
        async prepare() { this.state = 'prepared'; },
        async play() { this.state = 'playing'; },
        async stop() { this.state = 'stopped'; },
        async release() { this.state = 'released'; }
      };
      return playerInstance;
    }
  } },
  abilityKit: { abilityAccessCtrl: { createAtManager() { return {
    requestPermissionsFromUser() {
      permissionCalls++;
      if (permissionCalls === 1) { return new Promise(resolve => { finishPermission = resolve; }); }
      return Promise.resolve({ authResults: [0] });
    }
  }; } } }
};

require('./register.cjs');
const { HuaweiCapabilities } = require('../entry/src/main/ets/infrastructure/HuaweiCapabilities.ts');
const { Cancellation } = require('../entry/src/main/ets/domain/Capabilities.ts');

function request(operation) {
  return { operation, selectedSegmentId: '', auditionTakeId: '', project: undefined, manifest: [], optionalScript: '' };
}

test('a cancelled permission request cannot start recording or overlap a retry', async () => {
  const capabilities = new HuaweiCapabilities({}, '/private');
  const cancellation = new Cancellation();
  const pending = capabilities.execute(request('recordStart'), cancellation, () => {});
  await Promise.resolve();

  const overlapping = await capabilities.execute(request('recordStart'), new Cancellation(), () => {});
  assert.equal(overlapping.errorCode, 'RECORDING_STATE');
  assert.equal(permissionCalls, 1);

  cancellation.cancel();
  finishPermission({ authResults: [0] });
  const cancelled = await pending;
  assert.equal(cancelled.errorCode, 'CANCELLED');
  assert.equal(recorderCreates, 0);
});

test('metadata setup failure closes every descriptor and removes the uncommitted source', async () => {
  permissionCalls = 1; // Subsequent permission requests resolve immediately in the test adapter.
  const capabilities = new HuaweiCapabilities({}, '/private');
  assert.equal((await capabilities.execute(request('recordStart'), new Cancellation(), () => {})).ok, true);
  const outputFd = nextFd - 1;

  const stopped = await capabilities.execute(request('recordStop'), new Cancellation(), () => {});
  const inputFd = nextFd - 1;
  assert.equal(stopped.errorCode, 'RECORDING_FAILED');
  assert(closed.includes(outputFd));
  assert(closed.includes(inputFd));
  assert.equal(unlinked.length, 1);
  assert.match(unlinked[0], /\/projects\/p-[0-9]+\/assets\/source-[0-9]+\.m4a$/);
});

test('import cancellation does not copy an asset or publish a project', async () => {
  const capabilities = new HuaweiCapabilities({}, '/private');
  const cancellation = new Cancellation(); cancellation.cancel();
  const result = await capabilities.execute(request('import'), cancellation, () => {});
  assert.equal(result.errorCode, 'CANCELLED');
  assert.equal(copied.length, 0);
});

test('import copies the selected URI and requires a real positive duration', async () => {
  global.__arktsTestKits.mediaKit.media.createAVMetadataExtractor = async () => ({
    fdSrc: undefined,
    async fetchMetadata() { return { duration: '2400' }; },
    async release() {}
  });
  const capabilities = new HuaweiCapabilities({}, '/private');
  const result = await capabilities.execute(request('import'), new Cancellation(), () => {});
  assert.equal(result.ok, true);
  assert.equal(result.project.sourceDurationUs, 2400000);
  assert.equal(copied.length, 1);
  assert.match(copied[0].src, /^file:\/\//);
  assert.match(copied[0].dest, /\/projects\/p-[0-9]+\/assets\/source-[0-9]+\.audio$/);
});

test('source audition waits for AVPlayer completed state before succeeding', async () => {
  const capabilities = new HuaweiCapabilities({}, '/private');
  const project = new (require('../entry/src/main/ets/domain/Project.ts').Project)('p', 'source-play', 2400000);
  const pending = capabilities.execute({ operation: 'auditionSource', selectedSegmentId: 's', auditionTakeId: '',
    project, manifest: [{ assetId: 'source-play', startUs: 0, endUs: 1000000, outputStartUs: 0, fadeInUs: 0, fadeOutUs: 0 }], optionalScript: '' }, new Cancellation(), () => {});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(playerInstance.state, 'playing');
  let finished = false;
  pending.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  playerInstance.callbacks.timeUpdate(1000);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.messageKey, 'audition_completed');
  assert.equal(playerInstance.state, 'released');
});

test('source audition reports player errors instead of success', async () => {
  const capabilities = new HuaweiCapabilities({}, '/private');
  const project = new (require('../entry/src/main/ets/domain/Project.ts').Project)('p', 'source-play', 2400000);
  const pending = capabilities.execute({ operation: 'auditionSource', selectedSegmentId: 's', auditionTakeId: '',
    project, manifest: [{ assetId: 'source-play', startUs: 0, endUs: 1000000, outputStartUs: 0, fadeInUs: 0, fadeOutUs: 0 }], optionalScript: '' }, new Cancellation(), () => {});
  await Promise.resolve();
  playerInstance.callbacks.error(new Error('DECODER_FAILED'));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'PLAYBACK_FAILED');
  assert.equal(playerInstance.state, 'released');
});

test('missing audition asset reports playback failure instead of recording failure', async () => {
  const capabilities = new HuaweiCapabilities({}, '/private');
  const project = new (require('../entry/src/main/ets/domain/Project.ts').Project)('p', 'missing', 2400000);
  const result = await capabilities.execute({ operation: 'auditionSource', selectedSegmentId: 's', auditionTakeId: '',
    project, manifest: [{ assetId: 'missing', startUs: 0, endUs: 1000000, outputStartUs: 0, fadeInUs: 0, fadeOutUs: 0 }], optionalScript: '' }, new Cancellation(), () => {});
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'PLAYBACK_ASSET_NOT_FOUND');
  assert.equal(result.messageKey, 'playback_failed');
});

test('retake records an independent candidate and never replaces the source asset', async () => {
  global.__arktsTestKits.mediaKit.media.createAVMetadataExtractor = async () => ({
    fdSrc: undefined,
    async fetchMetadata() { return { duration: '900' }; },
    async release() {}
  });
  const capabilities = new HuaweiCapabilities({}, '/private');
  const Project = require('../entry/src/main/ets/domain/Project.ts').Project;
  const project = new Project('p-retake', 'source-original', 2400000);
  project.segments.push(new (require('../entry/src/main/ets/domain/Project.ts').Segment)('s', 'hello', 0, 1000000));
  const req = operation => ({ operation, selectedSegmentId: 's', auditionTakeId: '', project,
    manifest: [], optionalScript: '' });
  assert.equal((await capabilities.execute(req('retakeStart'), new Cancellation(), () => {})).ok, true);
  assert.equal((await capabilities.execute(req('retakePause'), new Cancellation(), () => {})).ok, true);
  assert.equal((await capabilities.execute(req('retakeResume'), new Cancellation(), () => {})).ok, true);
  const stopped = await capabilities.execute(req('retakeStop'), new Cancellation(), () => {});
  assert.equal(stopped.ok, true);
  assert.equal(stopped.project.sourceAssetId, 'source-original');
  assert.equal(stopped.project.takes.length, 1);
  assert.equal(stopped.project.takes[0].segmentId, 's');
  assert.equal(stopped.project.takes[0].durationUs, 900000);
  assert(openedPaths.some(path => /\/projects\/p-retake\/assets\/take-[0-9]+\.m4a$/.test(path)));
});
