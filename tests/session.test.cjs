const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/node_modules/typescript/lib/typescript.js');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, filename);
};
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
  console.log('Session checks passed: export gate, target validation, cancellation, stale result, timeout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
