# 官方能力核验记录

核验日期：2026-10-20。compatible 与 target SDK 保持 HarmonyOS 6.0.0（API 20）。本记录区分 SDK 声明/官方说明、已编译调用与已完成运行验证。

| 项目 | 官方资料 | 结论 |
| --- | --- | --- |
| hvigor CLI | [Using hvigorw](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-hvigor-commandline) | 官方资料确认模块构建参数。已通过 DevEco 配套 Node、JBR、ohpm、SDK 和 hvigor 6.26.8 执行 `assembleHap`；输出 unsigned HAP。 |
| 工程开发态配置 | [hvigor-config.json5](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-hmos-hvigor-set-options) | `modelVersion` 属于开发态版本，不能高于配套 IDE；与最低兼容 SDK 分开。本机 DevEco 26.0.0 配置为 `26.0.0`，最低兼容仍为 API 20。保留 IDE 配套插件来源，不下载第三方 SDK。 |
| 文件操作 | [Core File Kit 文件接口](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-fs) | 本机 DevEco SDK 声明确认 `readTextSync`、`openSync`、`writeSync`、`fdatasyncSync`、`mkdirSync`、`renameSync`、`listFileSync`、`rmdirSync` 兼容 API 20；代码已通过 ArkTS 构建。`mkdirSync` 声明列出 `13900015 (File exists)`，目录删除使用 `rmdirSync` 递归清理项目及其资产。其他错误继续抛出。断电持久性仍待验证。 |
| 文件基本写入示例 | [官方上传下载示例](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/app-file-upload-download-V5) | 可确认示例包含 open/write/close；不能以此推定所有事务语义已核验。本应用未接入上传/下载，也不申请网络权限。 |
| 麦克风授权 | [Ability Kit abilityAccessCtrl](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-abilityaccessctrl) | `AtManager.requestPermissionsFromUser(UIAbility Context, Permissions[])` 自 API 9 可用；`module.json5` 声明 `ohos.permission.MICROPHONE`、用途说明和 `inuse` 场景。用户点击“完整录制”时才请求；拒绝时返回明确状态并引导前往系统设置。权限弹窗与拒绝后的设置流程尚待模拟器手动验证。 |
| 完整录音与局部重录 | [Media Kit AVRecorder](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-media-avrecorder) | `media.createAVRecorder` 与 `AVRecorder.prepare/start/pause/resume/stop/release` 起始版本不高于 API 12，兼容 API 20；音频录制要求 `ohos.permission.MICROPHONE`。完整录音与局部重录均使用 MIC、AAC、M4A、16 kHz、单声道、64 kbps 和应用私有输出 FD。API 20 模拟器已完成完整录音；本轮局部重录错误事件和资源释放通过 ArkTS 构建及模拟测试，尚无真实讲话重录的设备证据。 |
| 录音时长读取 | [Media Kit AVMetadataExtractor](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-media-avmetadataextractor) | `createAVMetadataExtractor`、`fdSrc`、`fetchMetadata` 和 `release` 自 API 11 可用；FD 只交给一个提取器，提取器释放后关闭。完整录音只接受安全正整数毫秒时长；局部候选还要求至少 300ms，较短时返回 `RETAKE_TOO_SHORT`、删除候选且不提交 Take。API 20 模拟器此前已读取真实完整录音 M4A；局部重录门槛目前由 Node 自动化测试覆盖，待设备实录。 |
| 系统选择器 | [File picker](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-picker) | 尚未完整核验选择器、URI 复制、格式探测及取消语义，未调用。 |
| PCM 播放、编解码、导出 | 待完成具体 API 核验 | 包名、签名、起始版本、权限、设备、生命周期、错误码与许可未全部确认，当前明确未接入。 |
| 中文端侧 ASR | [CoreSpeechKit speechRecognizer](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/hms-ai-speechrecognizer) | API11+，createEngine zh-CN / online:1（离线），真实 PCM 输入。已在 API20 模拟器识别实际讲话。SDK结果不含时间戳/置信度，使用实测 PCM 短语窗口并要求复核。 |

设备文件适配器已经实现上述边界：根目录绑定应用私有 projects；只访问经过校验的相对路径；创建父目录时接受 `13900015` 表示目录已经存在；写入完整 UTF-8 数据后 fdatasync/关闭；同盘重命名 HEAD；读取不存在与权限错误分开；列举仅返回直接子项；项目删除使用同一私有根目录下的 `rmdirSync` 递归清理。多字节文本、部分写入、磁盘满、目录同步和崩溃恢复仍须在参考设备验证。Core File Kit 的 `AtomicFile` 虽在 SDK 中标为 API 15 起始版本，本轮沿用事务层已有 staging + HEAD 设计，未额外依赖该类。

当前 Node 临时文件测试验证应用事务算法和录音适配器的取消/清理状态，包括提交失败时移除候选、提交成功后保留候选、重载项目后 Take 仍能解析到候选资产，以及错误事件清理未提交候选；它们不能证明鸿蒙文件系统上的断电持久性或真实媒体服务中断行为。32 位修订校验和只用于发现意外损坏，不能代替详细设计要求的密码学 stateHash 与音频资产哈希。尚未实现资产内容校验、两阶段资产提交和跨进程写锁。

本机现已安装 DevEco Studio 26.0.0、Hvigor 6.26.8、Node 24.14.1、开发 SDK 和 HarmonyOS 6.0.0（API 20）官方模拟器。工程已迁至纯英文路径 `/Users/skh/Projects/AudioPatch`；`assembleHap` 已通过，输出为 unsigned HAP，并已安装到 `AudioPatch_API20`。HDC 确认 `com.audiopatch.editor:entry:EntryAbility` 在前台，首页截图和 UI tree 已确认。产品正式签名尚未配置。

本轮通过当前源代码完成 ArkTS/C++ assembleHap 并安装运行。构建 SDK 来自 DevEco 默认 SDK 根目录；兼容与目标仍为 6.0.0(20)，API20 模拟器实际运行成功。此前“缺少 API20 开发 SDK 因而无法构建”的结论已纠正。

## 2026-10-20 离线语音接入依据

- 已安装官方 SDK `hms/ets/api/@hms.ai.speechRecognizer.d.ts` 确认 createEngine、setListener、startListening、writeAudio、finish、cancel、shutdown；识别 API11+。online:1 为离线。zh-CN、locate:CN、recognizerMode:long。音频为16kHz/单声道/S16LE，每20ms发送640字节。
- `SpeechRecognitionResult` 只有 isFinal/isLast/result，无词级时间戳和置信度。PCM能量/停顿窗口提供源时间范围，默认全部待确认，不伪造置信度或强制对齐结果。此实现不能被描述为完成词级精确对齐。
- [同步音频解码](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/synchronous-audio-decoding)：OH_AVSource/OH_AVDemuxer、OH_AudioCodec_QueryInputBuffer/QueryOutputBuffer（API20），设置 OH_MD_KEY_ENABLE_SYNC_MODE=1。异步N-API工作线程解码，PTS映射到源范围；最多30分钟，解码超时90秒，可取消。
- 不新增 INTERNET 权限；现有本地音频识别不申请麦克风，录制时才申请麦克风。引擎不可用/模型缺失/区域不支持/超时均显式失败，不转用网络。
- 模型由系统引擎管理，本项目未捆绑/分发模型权重；没有新增第三方运行库。官方网页正文未能完整读取，具体设备白名单、区域供给和上架许可条款仍需发布前在目标设备及华为开发者平台复核；不能据一个模拟器推断所有设备可用。
- 运行证据及测试边界见 [离线识别验收](offline-asr-acceptance.md)。
