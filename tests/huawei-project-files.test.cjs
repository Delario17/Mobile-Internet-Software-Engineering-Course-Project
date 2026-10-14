require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');

test('project transaction reuses existing parent directories', async () => {
  const directories = new Set(['/private/projects', '/private/projects/p']);
  let nextFd = 1;
  global.__arktsTestKits = { coreFileKit: { fileIo: {
    OpenMode: { WRITE_ONLY: 1, CREATE: 64, TRUNC: 512 },
    mkdirSync(path) {
      if (directories.has(path)) { throw { code: 13900015 }; }
      directories.add(path);
    },
    openSync() { return { fd: nextFd++ }; },
    writeSync(_fd, text) { return text.length; },
    fdatasyncSync() {},
    closeSync() {},
    renameSync() {}
  } } };

  const { HuaweiProjectFiles } = require('../entry/src/main/ets/infrastructure/HuaweiProjectFiles.ts');
  const files = new HuaweiProjectFiles('/private/projects');

  await files.write('p/staging/revision', '{}');
  await files.rename('p/staging/revision', 'p/revisions/revision.json');
  await files.write('p/staging/head', '{}');
  await files.rename('p/staging/head', 'p/HEAD');

  assert.equal(nextFd, 3);
});
