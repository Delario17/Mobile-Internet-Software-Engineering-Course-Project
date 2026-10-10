import { CapabilityPort, CapabilityRequest, CapabilityResult, Cancellation, Progress } from '../domain/Capabilities';

// All unverified OS calls stop here; never synthesize assets, transcript or persisted success.
export class HuaweiCapabilities implements CapabilityPort {
  async execute(request: CapabilityRequest, cancellation: Cancellation,
    progress: (value: Progress) => void): Promise<CapabilityResult> {
    if (cancellation.cancelled) { return this.failure('CANCELLED', 'operation_cancelled'); }
    progress({ completed: 0, total: 1 });
    // TODO(HUAWEI_API): 按 request.operation 接入官方录音、音频选择/校验、离线 ASR/时间对齐、
    // PCM 播放/编码/文档导出，以及项目私有文件的临时写入、原子提交和恢复读取。
    // 输入：可选讲稿、本地项目及整数微秒 RenderPiece；输出：真实音频资产、带时间戳/置信度
    // 的句段、持久化项目或实际导出文件。源资产不得覆盖；播放与导出共用 manifest。
    // 运行约束：HarmonyOS SDK 6.0.0(API 20)、完全离线、进度/取消/错误/资源释放。
    // 接入前确认各能力的官方包名、签名、权限、设备限制、生命周期、错误码、发布许可。
    // 官方文档：尚未确认。各独立适配器及事务写入需在确认官方接口后拆分实现。
    return this.failure(request.operation === 'recognize' ? 'TIMED_ALIGNMENT_NOT_AVAILABLE' :
      'CAPABILITY_NOT_INTEGRATED', 'capability_unavailable');
  }
  async release(): Promise<void> { }
  private failure(code: string, key: string): CapabilityResult {
    return { ok: false, errorCode: code, messageKey: key, recoverable: false, project: undefined };
  }
}
