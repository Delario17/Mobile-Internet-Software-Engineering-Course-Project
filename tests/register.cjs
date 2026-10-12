const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const originalLoad = Module._load;
// Test-only stubs: ArkTS kit modules exist only inside DevEco/HarmonyOS runtime.
Module._load = function(request, parent, isMain) {
  if (request === '@kit.CoreFileKit') {
    return { fileIo: {
      OpenMode: { WRITE_ONLY: 1, CREATE: 64, TRUNC: 512 },
      readTextSync() { throw { code: 13900002 }; },
      mkdirSync() {}, openSync() { throw new Error('TEST_DEVICE_FILE_PORT'); },
      writeSync() { throw new Error('TEST_DEVICE_FILE_PORT'); }, fdatasyncSync() {}, closeSync() {},
      renameSync() {}, listFileSync() { return []; }
    } };
  }
  if (request === '@kit.BasicServicesKit') { return { BusinessError: class BusinessError extends Error {} }; }
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, filename);
};
