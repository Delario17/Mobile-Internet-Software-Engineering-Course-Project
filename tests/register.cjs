const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const originalLoad = Module._load;
// Test-only stubs: ArkTS kit modules exist only inside DevEco/HarmonyOS runtime.
Module._load = function(request, parent, isMain) {
  if (request === '@kit.CoreSpeechKit') { return global.__arktsTestKits?.coreSpeechKit || { speechRecognizer: { createEngine() { throw new Error('TEST_SPEECH_PORT'); } } }; }
  if (request === 'libaudiopcm.so') { return global.__arktsTestKits?.audioPcm || { decode() { throw new Error('TEST_PCM_PORT'); }, cancelDecode() {} }; }
  if (request === '@kit.CoreFileKit') {
    if (global.__arktsTestKits?.coreFileKit) { return global.__arktsTestKits.coreFileKit; }
    return { fileIo: {
      OpenMode: { READ_ONLY: 0, WRITE_ONLY: 1, CREATE: 64, TRUNC: 512 },
      readTextSync() { throw { code: 13900002 }; },
      mkdirSync() {}, openSync() { throw new Error('TEST_DEVICE_FILE_PORT'); },
      writeSync() { throw new Error('TEST_DEVICE_FILE_PORT'); }, fdatasyncSync() {}, closeSync() {},
      renameSync() {}, listFileSync() { return []; }, statSync() { return { size: 0 }; },
      unlinkSync() {}, rmdirSync() {}, copyFile() { return Promise.resolve(); },
      picker: { AudioViewPicker: class { async select() { return []; } } },
    } };
  }
  if (request === '@kit.MediaKit') {
    if (global.__arktsTestKits?.mediaKit) { return global.__arktsTestKits.mediaKit; }
    return { media: { createAVRecorder() { throw new Error('TEST_MEDIA_PORT'); } } };
  }
  if (request === '@kit.AbilityKit') {
    if (global.__arktsTestKits?.abilityKit) { return global.__arktsTestKits.abilityKit; }
    return { abilityAccessCtrl: { createAtManager() { throw new Error('TEST_PERMISSION_PORT'); } } };
  }
  if (request === '@kit.BasicServicesKit') { return { BusinessError: class BusinessError extends Error {} }; }
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, filename);
};
