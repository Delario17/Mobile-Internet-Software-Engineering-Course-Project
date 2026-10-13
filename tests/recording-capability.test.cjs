const assert = require('node:assert/strict');
const { test } = require('node:test');

let permissionCalls = 0;
let finishPermission;
let recorderCreates = 0;
const closed = [];
const unlinked = [];
let nextFd = 1;

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
  openSync() { return { fd: nextFd++ }; },
  closeSync(file) { closed.push(file.fd); },
  statSync() { return { size: 12 }; },
  unlinkSync(path) { unlinked.push(path); },
  rmdirSync() {}
};

global.__arktsTestKits = {
  coreFileKit: { fileIo },
  mediaKit: { media: {
    AudioSourceType: { AUDIO_SOURCE_TYPE_MIC: 1 },
    CodecMimeType: { AUDIO_AAC: 'aac' },
    ContainerFormatType: { CFT_MPEG_4A: 'm4a' },
    async createAVRecorder() { recorderCreates++; return recorder(); },
    async createAVMetadataExtractor() { throw new Error('METADATA_CREATE_FAILED'); }
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
