# 官方能力核验记录

核验日期：2026-10-13。compatible 与 target SDK 保持 HarmonyOS 6.0.0（API 20）。本记录区分 SDK 声明/官方说明、已编译调用与已完成运行验证。

| 项目 | 官方资料 | 结论 |
| --- | --- | --- |
| hvigor CLI | [Using hvigorw](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-hvigor-commandline) | 官方资料确认模块构建参数。已通过 DevEco 配套 Node、JBR、ohpm、SDK 和 hvigor 6.26.8 执行 `assembleHap`；输出 unsigned HAP。 |
| 工程开发态配置 | [hvigor-config.json5](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-hmos-hvigor-set-options) | `modelVersion` 属于开发态版本，不能高于配套 IDE；与最低兼容 SDK 分开。本机 DevEco 26.0.0 配置为 `26.0.0`，最低兼容仍为 API 20。保留 IDE 配套插件来源，不下载第三方 SDK。 |
| 文件操作 | [Core File Kit 文件接口](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-fs) | 本机 DevEco API 26 SDK 声明确认 `@kit.CoreFileKit` 的 `readTextSync`、`openSync`、`writeSync`、`fdatasyncSync`、`mkdirSync`、`renameSync`、`listFileSync` 均有 API 9/11 起始版本，兼容 API 20；代码已通过 ArkTS 构建。真实设备上的断电持久性、覆盖行为和错误恢复仍待验证。 |
| 文件基本写入示例 | [官方上传下载示例](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/app-file-upload-download-V5) | 可确认示例包含 open/write/close；不能以此推定所有事务语义已核验。本应用未接入上传/下载，也不申请网络权限。 |
| 麦克风授权 | [Ability Kit abilityAccessCtrl](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-abilityaccessctrl) | `AtManager.requestPermissionsFromUser(UIAbility Context, Permissions[])` 自 API 9 可用；`module.json5` 声明 `ohos.permission.MICROPHONE`、用途说明和 `inuse` 场景。用户点击“完整录制”时才请求；拒绝时返回明确状态并引导前往系统设置。权限弹窗与拒绝后的设置流程尚待模拟器手动验证。 |
| 完整录音 | [Media Kit AVRecorder](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-media-avrecorder) | `media.createAVRecorder` 与 `AVRecorder.prepare/start/pause/resume/stop/release` 起始版本不高于 API 12，兼容 API 20；音频录制要求 `ohos.permission.MICROPHONE`。当前配置为 MIC、AAC、M4A、16 kHz、单声道、64 kbps，URL 使用应用私有输出 FD。已通过 API 20 目标 ArkTS 构建；实际麦克风输入、状态回调、音频中断与声音质量尚待运行验证。 |
| 录音时长读取 | [Media Kit AVMetadataExtractor](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-media-avmetadataextractor) | `createAVMetadataExtractor`、`fdSrc`、`fetchMetadata` 和 `release` 自 API 11 可用；FD 只交给一个提取器，提取器释放后关闭。只有安全正整数毫秒时长才创建项目。已通过 ArkTS 构建；模拟器真实 M4A 元数据尚待运行验证。 |
| 系统选择器 | [File picker](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-picker) | 尚未完整核验选择器、URI 复制、格式探测及取消语义，未调用。 |
| PCM 播放、编解码、导出 | 待完成具体 API 核验 | 包名、签名、起始版本、权限、设备、生命周期、错误码与许可未全部确认，当前明确未接入。 |
| 小艺端侧 ASR 与时间对齐 | 待确认公开调用资料 | 词/短语时间戳、置信度、离线支持、取消、设备与发布许可未核验，返回 TIMED_ALIGNMENT_NOT_AVAILABLE。 |

设备文件适配器已经实现上述边界：根目录绑定应用私有 projects；只访问经过校验的相对路径；创建父目录；写入完整 UTF-8 数据后 fdatasync/关闭；同盘重命名 HEAD；读取不存在与权限错误分开；列举仅返回直接子项。多字节文本、部分写入、磁盘满、目录同步和崩溃恢复仍须在参考设备验证。Core File Kit 的 `AtomicFile` 虽在 SDK 中标为 API 15 起始版本，本轮沿用事务层已有 staging + HEAD 设计，未额外依赖该类。

当前 Node 临时文件测试只验证应用事务算法和录音适配器的取消/清理状态，不能证明鸿蒙文件系统上的断电持久性或媒体服务行为。32 位修订校验和只用于发现意外损坏，不能代替详细设计要求的密码学 stateHash 与音频资产哈希。尚未实现资产内容校验、两阶段资产提交和跨进程写锁；项目提交失败可能留下未引用录音资产，需在后续资产事务中处理。

本机现已安装 DevEco Studio 26.0.0、Hvigor 6.26.8、Node 24.14.1、开发 SDK 和 HarmonyOS 6.0.0（API 20）官方模拟器。工程已迁至纯英文路径 `/Users/skh/Projects/AudioPatch`；`assembleHap` 已通过，输出为 unsigned HAP，并已安装到 `AudioPatch_API20`。HDC 确认 `com.audiopatch.editor:entry:EntryAbility` 在前台，首页截图和 UI tree 已确认。产品正式签名尚未配置。

本轮新增的 AVRecorder、AVMetadataExtractor、运行时麦克风授权和 Core File Kit 资产 FD 调用已经通过 SDK 声明核验和原生 ArkTS 构建。运行级录音验证还缺用户在模拟器中同意麦克风权限并完成一段录音，因此不能把“编译和启动成功”描述为“录音成功”。未接入调用仍保留明确 TODO；正式路径没有测试端口、静态识别结果或云端回退，也没有 INTERNET 权限。
