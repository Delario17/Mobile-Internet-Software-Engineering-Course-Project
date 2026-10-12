const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wrapper = process.env.HARMONY_HVIGORW;
if (!wrapper || !fs.existsSync(wrapper)) {
  console.error('缺少官方构建入口。请安装支持 API 20 的 DevEco Studio，在 IDE 中同步并构建工程；');
  console.error('命令行构建时将 HARMONY_HVIGORW 设置为 DevEco 安装目录内真实存在的 hvigorw 或 hvigorw.js 路径。');
  console.error('本脚本不会下载第三方 SDK，也不会生成虚假 HAP。详见 README.md。');
  process.exit(2);
}
const args = ['--mode', 'module', '-p', 'product=default', '-p', 'module=entry@default',
  '-p', 'buildMode=debug', 'assembleHap', '--no-daemon'];
const js = /\.js$/.test(wrapper);
const node = process.env.HARMONY_NODE || process.execPath;
const nodeDirectory = path.dirname(node);
const environment = { ...process.env, PATH: `${nodeDirectory}${path.delimiter}${process.env.PATH || ''}` };
const result = spawnSync(js ? node : wrapper, js ? [wrapper, ...args] : args,
  { cwd: root, stdio: 'inherit', shell: false, env: environment });
if (result.error) console.error(result.error.message);
process.exit(result.status === null ? 1 : result.status);
