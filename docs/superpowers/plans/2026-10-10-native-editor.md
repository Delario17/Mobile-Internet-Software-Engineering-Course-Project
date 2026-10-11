# Native editor and project persistence implementation plan

**Goal:** 补齐原生工程的开发配置，并把现有时间轴内核接到可保存、可恢复、可撤销的编辑用例。

**Architecture:** 沿用详细设计第 14/21 节。领域编辑始终在项目副本上执行，追加修订提交成功后才发布到会话。设备文件适配器只负责私有目录操作，未核验的媒体能力继续返回明确失败。

**Tech Stack:** ArkTS/ArkUI Stage；compatible SDK `6.0.0(20)`；Node 24、TypeScript 和 JSON5 仅用于开发检查。

## Constraints

- 原始素材不可变；无网络运行权限；无生产路径演示数据。
- 拆分、合并与边界变化使旧补录失效；审核与修订版本绑定。
- 撤销新增修订，不后退 HEAD；写入失败保留上次有效状态。
- 官方设备接口必须有签名/版本/权限/生命周期证据；签名证书留在本机。
- 不将 TypeScript 检查或工程配置检查称为 ArkTS 构建。

## Task 1: Portable development configuration

Files: `package.json`, `scripts/check-project.cjs`, `tests/typecheck.cjs`, `tests/register.cjs`, `tests/session.test.cjs`, `README.md`, `entry/build-profile.json5`.

- [x] 固定开发依赖版本，提供 `npm test`/`npm run check`/`npm run build:harmony`，移除 VS Code 绝对路径。
- [x] 检查 API 20、Stage 模型、页面/资源引用、无网络权限和未提交签名；错误时非零退出。
- [x] 原生构建入口仅调用 DevEco 的官方 hvigorw；缺少工具链时给出具体安装配置路径，不下载不明 SDK。

## Task 2: Revision store and edit transactions

Files: `domain/Project.ts`, `application/ProjectStore.ts`, `application/EditorSession.ts`, `infrastructure/HarmonyProjectFiles.ets`, `tests/store.test.cjs`, `tests/editor.test.cjs`.

Interface: `ProjectStore.commit(project, expectedSequence): Promise<Project>` and `ProjectStore.restore(projectId): Promise<Project>`; files port supports read/write/rename/list, all paths are relative to private project storage.

- [x] 先写保存/恢复失败测试：`assert.equal(restored.sequence, previous.sequence)`；损坏 HEAD 从最近提交标记恢复；未提交修订不能恢复为当前结果。
- [x] 串行写入 immutable revision；按详细设计 §14.2 以 HEAD 替换为提交点，再写凭据。凭据失败返回恢复风险；预期 sequence 拒绝冲突，校验 JSON 和时间轴。
- [x] 编辑副本；`await commit` 成功才替换 session.project；提交点之前失败时内存项目和 HEAD 保持原值。
- [x] 先写拆分/合并/手动建段/撤销测试：时间范围不丢失，旧 take 保留历史但不自动采用，撤销 sequence 单调递增。
- [ ] 实现 editing methods，核验设备文件 API 后接入私有存储；启动恢复最近项目。

## Task 3: Native editor flow

Files: `pages/Index.ets`, `presentation/components/SegmentEditor.ets`, resources, implementation status.

- [x] 接入改字、边界、手动建段、拆分、合并、候选试听/采用/恢复原音及撤销；重要操作通过事务用例（设备端口仍明确失败）。
- [x] 字段显示源音频秒数；非法数字/重叠明确失败。修改文字说明只影响显示文字。
- [x] 导出入口先进入审核；确认前要求试听成功。未接入播放不能假称已核对声音。
- [x] 更新 API 证据、测试结果、未完成媒体能力及本机工具链限制。
- [x] 运行 `pnpm test`（18 项通过）、`pnpm run check`（通过）、原生构建入口（缺工具链退出 2）和独立代码复核；提交说明列出完成需求、API 与验证限制。

## Deferred integration

设备文件适配器未核验全部语义，故 Task 2 最后一项保留未完成。已实现启动项目列表/选择恢复，但生产端口返回明确失败。未创建 `HarmonyProjectFiles.ets` 的推测调用，实际边界为 `HuaweiProjectFiles.ts`。原生构建环境和签名不在本机，不能将框架交付标为设备验收完成。更多边界见 `docs/implementation-status.md`。
