# 官方能力核验记录

核验日期：2026-10-11。compatible SDK 保持 HarmonyOS 6.0.0（API 20）。本记录区分检索到的官方说明与已完成设备验证。

| 项目 | 官方资料 | 结论 |
| --- | --- | --- |
| hvigor CLI | [Using hvigorw](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-hvigor-commandline) | 官方资料确认模块构建的 `--mode module`、`product`、`module=entry@default`、`buildMode` 和 `--no-daemon`。已实现调用官方包装器的入口；本机缺工具链，未执行编译任务。 |
| 工程开发态配置 | [hvigor-config.json5](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-hmos-hvigor-set-options) | `modelVersion` 属于开发态版本，不能高于配套 IDE；与最低兼容 SDK 分开。保留 IDE 配套插件来源，不下载第三方 SDK。实际 IDE 同步仍待完成。 |
| 文件操作 | [Core File Kit 文件接口](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-fs) | 检索可定位官方页面，但正文、API20 的 fsync/原子替换和目录持久性、错误码等未完整确认。设备适配器 `HuaweiProjectFiles` 明确返回 STORAGE_NOT_INTEGRATED。 |
| 文件基本写入示例 | [官方上传下载示例](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/app-file-upload-download-V5) | 可确认示例包含 open/write/close；不能以此推定所有事务语义已核验。本应用未接入上传/下载，也不申请网络权限。 |
| 系统选择器 | [File picker](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-picker) | 尚未完整核验选择器、URI 复制、格式探测及取消语义，未调用。 |
| 录音、PCM 播放、编解码、导出 | 待完成具体 API 核验 | 包名、签名、起始版本、权限、设备、生命周期、错误码与许可未全部确认，当前明确未接入。 |
| 小艺端侧 ASR 与时间对齐 | 待确认公开调用资料 | 词/短语时间戳、置信度、离线支持、取消、设备与发布许可未核验，返回 TIMED_ALIGNMENT_NOT_AVAILABLE。 |

设备文件适配器必须满足 `ProjectFiles` 的真实语义：根目录绑定应用私有 projects；只访问经过校验的相对路径；创建父目录；写入完整 UTF-8 数据后 flush/关闭；同盘原子替换 HEAD；读取不存在与权限错误分开；列举仅返回直接子项。多字节文本、部分写入、磁盘满、目录同步和崩溃恢复均须在参考设备验证。

当前 Node 临时文件测试只验证应用事务算法，不能证明鸿蒙文件系统上的断电持久性。32 位修订校验和只用于发现意外损坏，不能代替详细设计要求的密码学 stateHash 与音频资产哈希。尚未实现资产内容校验、两阶段资产提交和跨进程写锁；正式媒体接入前必须完成。

本轮没有新增已核验的设备 API 调用。未接入调用位置仅为 `HuaweiCapabilities`（媒体/模型）和 `HuaweiProjectFiles`（文件）；正式路径没有测试端口、静态识别结果或云端回退。
