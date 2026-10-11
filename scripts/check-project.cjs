const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSON5 = require('json5');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = file => JSON5.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const profile = read('build-profile.json5');
for (const product of profile.app.products) {
  assert.equal(product.compatibleSdkVersion, '6.0.0(20)', 'compatible SDK must remain API 20');
}
assert.equal(read('entry/build-profile.json5').apiType, 'stageMode');
const moduleConfig = read('entry/src/main/module.json5').module;
assert.equal(moduleConfig.mainElement, 'EntryAbility');
assert(!(moduleConfig.requestPermissions || []).some(permission => permission.name === 'ohos.permission.INTERNET'),
  'Offline application must not request Internet permission');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
assert(!tracked.some(file => /(^|\/)(local\.properties|certs)(\/|$)|\.(p12|pfx|cer|keystore)$/.test(file)),
  'Signing certificates and local SDK paths must not be tracked');
for (const page of read('entry/src/main/resources/base/profile/main_pages.json').src) {
  assert(fs.existsSync(path.join(root, 'entry/src/main/ets', `${page}.ets`)), `Missing page: ${page}`);
}
const strings = new Set(read('entry/src/main/resources/base/element/string.json').string.map(item => item.name));
function inspect(directory) {
  for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, file.name);
    if (file.isDirectory()) inspect(filename);
    else if (/\.(ets|ts)$/.test(file.name)) {
      const code = fs.readFileSync(filename, 'utf8');
      for (const match of code.matchAll(/\$r\('app\.string\.([^']+)'\)/g)) {
        assert(strings.has(match[1]), `${filename}: missing resource ${match[1]}`);
      }
    }
  }
}
inspect(path.join(root, 'entry/src/main/ets'));
console.log('Project configuration passed: API 20, Stage, pages, UI resources and offline permissions.');
