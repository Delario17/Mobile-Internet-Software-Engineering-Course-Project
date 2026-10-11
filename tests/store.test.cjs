require('./register.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Project, Segment } = require('../entry/src/main/ets/domain/Project.ts');
const { ProjectStore } = require('../entry/src/main/ets/application/ProjectStore.ts');
const { decodeProject } = require('../entry/src/main/ets/application/ProjectStore.ts');

// Test-only OS port: transactions execute against actual temporary files, not fake persistence.
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audiopatch-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = {
    async read(file) { try { return await fs.readFile(path.join(directory, file), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } },
    async write(file, text) { const filename = path.join(directory, file);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const handle = await fs.open(filename, 'w');
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); } },
    async rename(from, to) { await fs.mkdir(path.dirname(path.join(directory, to)), { recursive: true });
      await fs.rename(path.join(directory, from), path.join(directory, to)); },
    async list(folder) { try { return await fs.readdir(path.join(directory, folder)); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
  };
  return { directory, files, store: new ProjectStore(files) };
}

test('revisions append, conflict fails, restart restores last committed edits', async t => {
  const { store, files } = await fixture(t);
  const project = new Project('p', 'source', 10000);
  project.segments.push(new Segment('s', 'first', 0, 10000));
  const first = await store.commit(project, 0);
  assert.equal(first.sequence, 1);
  first.segments[0].text = 'changed';
  const second = await store.commit(first, 1);
  assert.equal(second.sequence, 2);
  assert.equal((await new ProjectStore(files).restore('p')).segments[0].text, 'changed');
  await assert.rejects(store.commit(first, 1), /REVISION_CONFLICT/);
  assert.equal((await store.restore('p')).sequence, 2);
});

test('failed HEAD replacement keeps prior committed state and ignores orphan revision', async t => {
  const { store, files } = await fixture(t);
  const first = await store.commit(new Project('p', 'source', 10000), 0);
  const rename = files.rename;
  files.rename = async (from, to) => { if (to.endsWith('/HEAD')) throw new Error('DISK_FULL');
    return rename(from, to); };
  first.segments.push(new Segment('s', 'not committed', 0, 10000));
  await assert.rejects(store.commit(first, 1), /DISK_FULL/);
  assert.equal((await store.restore('p')).sequence, 1);
  files.rename = rename;
  await files.write('p/HEAD', 'corrupt');
  assert.equal((await new ProjectStore(files).restore('p')).sequence, 1);
});

test('invalid JSON, overlapping ranges and source replacement cannot become current', async t => {
  const { store, files } = await fixture(t);
  const first = await store.commit(new Project('p', 'source', 10000), 0);
  first.sourceAssetId = 'another-source';
  await assert.rejects(store.commit(first, 1), /SOURCE_IMMUTABLE/);
  await assert.rejects(store.restore('../escape'), /INVALID_PROJECT/);
  await files.write('p/HEAD', JSON.stringify({ sequence: 0 }));
  assert.equal((await store.restore('p')).sourceAssetId, 'source');
});

test('concurrent writes serialize and only one expected revision wins', async t => {
  const { store } = await fixture(t);
  const first = await store.commit(new Project('p', 'source', 10000), 0);
  const attempts = await Promise.allSettled([store.commit(first, 1), store.commit(first, 1)]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal((await store.restore('p')).sequence, 2);
});

test('receipt failure is reported as committed with warning, retry does not duplicate revision', async t => {
  const { store, files } = await fixture(t);
  const originalWrite = files.write;
  files.write = async (file, text) => {
    if (file.includes('/staging/receipt-')) throw new Error('DISK_FULL');
    return originalWrite(file, text);
  };
  const saved = await store.commit(new Project('p', 'source', 10000), 0);
  assert.equal(saved.recoveryWarning, true);
  assert.equal((await store.restore('p')).sequence, 1);
  await assert.rejects(store.commit(new Project('p', 'source', 10000), 0), /REVISION_CONFLICT/);
  await files.write('p/HEAD', 'corrupt');
  await assert.rejects(store.restore('p'), /INVALID_PROJECT/);
});

test('restore rejects malformed state and overlapping range rather than trusting JSON', async t => {
  const { store } = await fixture(t);
  const project = new Project('p', 'source', 10000);
  project.segments.push(new Segment('s', 'first', 0, 7000), new Segment('other', 'second', 6000, 10000));
  assert.throws(() => decodeProject(JSON.stringify(project)), /INVALID_RANGE/);
  project.segments.pop();
  project.segments[0].textRevision = '1';
  assert.throws(() => decodeProject(JSON.stringify(project)), /INVALID_PROJECT/);
  project.segments[0].textRevision = 1;
  project.segments[0].ancestorIds = ['../escape'];
  assert.throws(() => decodeProject(JSON.stringify(project)), /INVALID_PROJECT/);
  project.segments[0].ancestorIds = [];
  await store.commit(project, 0);
});

test('valid JSON corruption fails checksum and falls back only to committed revision', async t => {
  const { store, files } = await fixture(t);
  const first = await store.commit(new Project('p', 'source', 10000), 0);
  first.segments.push(new Segment('s', 'saved', 0, 10000));
  await store.commit(first, 1);
  const head = JSON.parse(await files.read('p/HEAD'));
  const changed = JSON.parse(await files.read(`p/revisions/${head.file}`));
  changed.segments[0].text = 'corrupt but syntactically valid';
  await files.write(`p/revisions/${head.file}`, JSON.stringify(changed));
  assert.equal((await store.restore('p')).sequence, 1);
});

test('missing HEAD and corrupt receipts cannot be mistaken for a new project', async t => {
  const { store, files, directory } = await fixture(t);
  await store.commit(new Project('p', 'source', 10000), 0);
  await fs.unlink(path.join(directory, 'p/HEAD'));
  for (const receipt of await files.list('p/receipts')) await files.write(`p/receipts/${receipt}`, 'corrupt');
  await assert.rejects(store.restore('p'), /INVALID_PROJECT/);
  await assert.rejects(store.commit(new Project('p', 'different-source', 10000), 0), /INVALID_PROJECT/);
});

test('project list and reopening use persisted data without creating a new revision', async t => {
  const { store } = await fixture(t);
  await store.commit(new Project('p', 'source', 10000), 0);
  assert.deepEqual((await store.listProjects()).map(project => project.id), ['p']);
  assert.equal((await store.restore('p')).sequence, 1);
});

test('a damaged project cannot hide healthy projects; device IO errors still fail', async t => {
  const { store, files } = await fixture(t);
  await store.commit(new Project('healthy', 'source', 10000), 0);
  await store.commit(new Project('damaged', 'source2', 10000), 0);
  await files.write('damaged/HEAD', 'corrupt');
  for (const receipt of await files.list('damaged/receipts')) await files.write(`damaged/receipts/${receipt}`, 'corrupt');
  assert.deepEqual((await store.listProjects()).map(project => project.id), ['healthy']);
  assert.deepEqual(store.damagedProjectIds, ['damaged']);
  files.list = async () => { throw new Error('PERMISSION_DENIED'); };
  await assert.rejects(store.listProjects(), /PERMISSION_DENIED/);
});
