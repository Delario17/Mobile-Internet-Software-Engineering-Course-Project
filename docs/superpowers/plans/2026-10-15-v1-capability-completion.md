# AudioPatch 首版能力补齐实施计划

> **For agentic workers:** Execute this plan task-by-task with test-first validation.

**Goal:** 按需求规格完成 AudioPatch 首版可确认能力，并为尚未公开确认的鸿蒙能力保留真实适配边界。

**Architecture:** 先完善 ProjectStore 的项目生命周期和资产清理，再接入 Core File Kit 的本地导入与 Media Kit 的播放适配。ASR、局部重录和导出只在 API 20 官方接口完成核验后接入，所有未接入能力返回明确错误并保留持久化状态。

**Tech Stack:** ArkTS、ArkUI、HarmonyOS Stage、Core File Kit、Media Kit、Node test。

## Global Constraints

- compatibleSdkVersion 和 targetSdkVersion 固定 HarmonyOS 6.0.0 (API 20)。
- 源录音不可变；编辑采用修订和编辑决策，不覆盖源资产。
- 录音、识别、文本、项目元数据留在应用私有目录；不申请 INTERNET。
- 不伪造 ASR、播放、导出或成功状态；官方 API 未确认时返回明确不可用错误。
- 所有行为变更先写失败测试，再写最小生产代码。

---

### Task 1: 项目删除与孤立资产清理

**Files:**
- Modify: `entry/src/main/ets/application/ProjectStore.ts`
- Modify: `entry/src/main/ets/infrastructure/HuaweiProjectFiles.ts`
- Modify: `entry/src/main/ets/pages/Index.ets`
- Test: `tests/store.test.cjs`

- [ ] 添加递归删除端口并测试完整项目目录删除和失败保留。
- [ ] 接通首页确认删除和刷新列表。
- [ ] 验证全部测试、ArkTS 构建和 API 20 模拟器。

### Task 2: 本地音频导入边界

**Files:**
- Modify: `entry/src/main/ets/domain/Capabilities.ts`
- Modify: `entry/src/main/ets/infrastructure/HuaweiCapabilities.ts`
- Modify: `entry/src/main/ets/pages/Index.ets`
- Test: `tests/recording-capability.test.cjs`

- [x] 先为导入取消、格式错误、无音轨和有效资产复制写失败测试。
- [x] 用 API 20 `AudioViewPicker` 和 Core File Kit 复制到私有资产目录；未确认的格式能力保留明确限制。
- [x] 保存真实时长和不可变源资产引用；提交失败回滚待提交资产。

### Task 3: 真实播放适配边界

**Files:**
- Modify: `entry/src/main/ets/domain/Capabilities.ts`
- Modify: `entry/src/main/ets/infrastructure/HuaweiCapabilities.ts`
- Modify: `entry/src/main/ets/pages/Index.ets`
- Test: `tests/session.test.cjs`

- [x] 测试播放成功必须等待完成事件，启动失败和取消不得报告成功。
- [x] 按 API 20 Media Kit 公开接口接入 `AVPlayer` 私有 FD 播放。
- [x] 播放状态与当前句段选择保持一致；播放失败不改变项目或审核状态。

### Task 4: 端侧识别适配层

**Files:**
- Modify: `entry/src/main/ets/domain/Capabilities.ts`
- Modify: `entry/src/main/ets/infrastructure/HuaweiCapabilities.ts`
- Modify: `entry/src/main/ets/application/EditorSession.ts`
- Test: `tests/session.test.cjs`

- [ ] 定义本地 ASR 请求、进度、取消、时间戳和置信度类型。
- [ ] 只有官方小艺/端侧 ASR API 20 接口核验后才实现调用。
- [ ] 将真实识别结果映射为句段并保存，失败保留源音频。

### Task 5: 局部重录、上下文试听和非破坏式替换

**Files:**
- Modify: `entry/src/main/ets/infrastructure/HuaweiCapabilities.ts`
- Modify: `entry/src/main/ets/application/EditorSession.ts`
- Modify: `entry/src/main/ets/pages/Index.ets`
- Test: `tests/editor.test.cjs`, `tests/recording-capability.test.cjs`

- [x] 复用真实 AVRecorder 写候选资产，不覆盖源文件。
- [x] 保存候选、选择/恢复源录音和候选试听状态。
- [x] 覆盖开始绑定项目/句段/范围版本、暂停/继续、完成候选、提交成功保留资产、提交失败回滚、取消和录音器错误清理。
- [x] 明确并实现过短候选规则：真实时长小于 300ms 返回 `RETAKE_TOO_SHORT`、删除候选且不创建 Take。
- [ ] API 20 模拟器/真机实际讲话验收：试听候选、采用候选、恢复源录音并重启后确认资产引用；真实系统中断和存储不足测试。

### Task 6: 本地渲染与导出

**Files:**
- Modify: `entry/src/main/ets/infrastructure/HuaweiCapabilities.ts`
- Modify: `entry/src/main/ets/application/ProjectStore.ts`
- Modify: `entry/src/main/ets/pages/Index.ets`
- Test: `tests/editor.test.cjs`, `tests/store.test.cjs`

- [ ] 复用同一 timeline manifest。
- [ ] 使用真实解码/编码 API 生成新文件，失败清理临时文件。
- [ ] 导出前执行审核门槛，保留源资产和项目。

### Task 7: 文档、设备验证和提交

- [x] 更新实现进度与 API 证据；README 的通用构建命令无需因局部重录行为改变。
- [x] 运行测试、类型检查、配置检查、原生构建并在 API 20 模拟器安装启动；实际录音设备流程仍待完成。
- [ ] 提交正文列需求、API、验证、限制并推送 main。
