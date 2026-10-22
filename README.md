# AudioPatch

基于转写文本的本地音频局部重录应用。原生 ArkTS / ArkUI，HarmonyOS Stage 模型，最低兼容版本固定为 HarmonyOS 6.0.0（API 20）。产品设计见 [需求规格](项目一需求规格说明.md)、[架构](项目一架构设计.md) 和 [详细设计](详细设计.md)。

## 原生构建

1. 安装支持 HarmonyOS 6.0.0 API 20 的 DevEco Studio 和相应 SDK。
2. 将工程放在只含英文字母、数字、连字符、下划线、英文括号、空格、句点或 `@` 的路径中；Hvigor 6.26 会拒绝当前含“赛道三”的路径。再用 DevEco 26.0.0 打开工程根目录，同步 hvigor 和 ohpm 依赖。`hvigor/hvigor-config.json5` 的 `modelVersion` 为 IDE 开发态版本 `26.0.0`，最低兼容版本仍由 `build-profile.json5` 固定为 `6.0.0(20)`；仅使用 IDE 配套的官方构建插件。
3. 在工程结构的 Signing Configs 中配置本机调试签名，关联 `default` 产品。证书、密码、设备 UDID、签名配置和 `local.properties` 属于本机配置，不应提交仓库。
4. 在 API 20 及以上的官方模拟器或鸿蒙手机上选择 `entry` 运行。第一次点击“完整录制”时由系统请求麦克风权限；允许后可暂停、继续并结束保存。模拟器录音依赖宿主机麦克风输入。正式验收仍需参考手机、飞行模式和异常恢复测试。

命令行构建：设置 `HARMONY_HVIGORW` 为本机 DevEco 中真实存在的官方 `hvigorw`/`hvigorw.js`，运行 `npm run build:harmony`。使用 JS 包装器时，可设置 `HARMONY_NODE` 为 DevEco 配套的 Node 可执行文件。SDK、JDK、ohpm 和签名由 DevEco 配置；此脚本不替代 SDK 安装。缺少工具时退出码为 2。`modelVersion` 是工程开发态版本，不等于 `compatibleSdkVersion`，使用更新 IDE 时按官方同步提示处理开发态配置，最低兼容 API 20 不变。

## 开发检查

Node 24 或更高版本；推荐 pnpm 11.19.0，仓库已提交锁文件。运行 `pnpm install --frozen-lockfile --ignore-scripts`，然后：

```sh
pnpm test
pnpm run check
```

也可运行 `npm install --ignore-scripts`、`npm test`、`npm run check`。TypeScript 5.9.3（Apache-2.0）用于开发层类型检查及测试转译，JSON5 2.2.3（MIT）用于工程配置检查，两者不进入鸿蒙应用。测试不依赖 VS Code 安装路径。

`npm run check` 检查平台无关代码、API 20 配置、Stage、页面与字符串资源、离线权限；不等价于 ArkTS 编译。CI 同样只执行这些可移植检查。

## 当前交付范围

以 [实现进度](docs/implementation-status.md) 为准。完整录音、导入、源音频/候选试听、局部重录和中文离线自动识别已接入官方系统能力。识别使用 CoreSpeechKit offline 模式，真实 PCM 经停顿分窗后生成待确认句段；不提供词级精确时间戳或数值置信度。全文预览与本地WAV导出已接入共享PCM渲染管线；逐功能实测状态及未验项见[功能测试矩阵](docs/functional-test-matrix.md)。没有生产演示转写或云端回退。操作与验收见 [离线识别案例](docs/offline-asr-acceptance.md)。正式签名仍需开发者账号/设备授权。
