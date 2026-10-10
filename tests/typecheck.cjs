const ts = require('/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/node_modules/typescript/lib/typescript.js');
const path = require('node:path');
const root = path.resolve(__dirname, '../entry/src/main/ets');
const files = ['domain/Project.ts', 'domain/Capabilities.ts', 'infrastructure/HuaweiCapabilities.ts',
  'application/EditorSession.ts', 'composition/AppServices.ts'].map(file => path.join(root, file));
const program = ts.createProgram(files, { noEmit: true, strict: true, target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ES2020 });
const diagnostics = ts.getPreEmitDiagnostics(program);
for (const diagnostic of diagnostics) {
  console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}
if (diagnostics.length) process.exit(1);
console.log('Strict TypeScript checks passed for platform-independent layers (not an ArkTS build).');
