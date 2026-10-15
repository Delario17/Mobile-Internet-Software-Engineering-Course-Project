import { CapabilityPort, CapabilityRequest, CapabilityResult, Cancellation, Progress } from '../domain/Capabilities';
import { Project } from '../domain/Project';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { media } from '@kit.MediaKit';
import { abilityAccessCtrl, Context, PermissionRequestResult, Permissions } from '@kit.AbilityKit';

// P1-FR-002: AVRecorder writes the immutable source asset into application-private storage.
export class HuaweiCapabilities implements CapabilityPort {
  private context: Context | undefined;
  private filesDir: string;
  private recorder: media.AVRecorder | undefined = undefined;
  private output: fs.File | undefined = undefined;
  private projectId: string = '';
  private sourceAssetId: string = '';
  private sourcePath: string = '';
  private starting: boolean = false;

  constructor(context?: Context, filesDir: string = '') {
    this.context = context; this.filesDir = filesDir;
  }

  async execute(request: CapabilityRequest, cancellation: Cancellation,
    progress: (value: Progress) => void): Promise<CapabilityResult> {
    if (cancellation.cancelled) { return this.failure('CANCELLED', 'operation_cancelled'); }
    progress({ completed: 0, total: 1 });
    try {
      if (request.operation === 'recordStart') { return await this.startRecording(cancellation); }
      if (request.operation === 'recordPause') { return await this.pauseRecording(cancellation); }
      if (request.operation === 'recordResume') { return await this.resumeRecording(cancellation); }
      if (request.operation === 'recordStop') { return await this.stopRecording(cancellation); }
      if (request.operation === 'import') { return await this.importAudio(cancellation); }
    } catch {
      await this.releaseRecorder();
      return this.failure(request.operation === 'import' ? 'IMPORT_FAILED' : 'RECORDING_FAILED',
        request.operation === 'import' ? 'import_failed' : 'recording_failed');
    }
    // TODO(HUAWEI_API): 按 request.operation 接入官方录音、音频选择/校验、离线 ASR/时间对齐、
    // PCM 播放/编码/文档导出。项目文件调用集中在 HuaweiProjectFiles。
    // 输入：可选讲稿、本地项目及整数微秒 RenderPiece；输出：真实音频资产、带时间戳/置信度
    // 的句段或实际导出文件。auditionSource/Take 必须在完整播放结束后才成功，
    // 不得在播放器启动时返回成功；源资产不得覆盖；播放与导出共用 manifest。
    // 运行约束：HarmonyOS SDK 6.0.0(API 20)、完全离线、进度/取消/错误/资源释放。
    // 接入前确认各能力的官方包名、签名、权限、设备限制、生命周期、错误码、发布许可。
    // 官方文档：尚未确认。各独立媒体适配器需在确认官方接口后拆分实现。
    return this.failure(request.operation === 'recognize' ? 'TIMED_ALIGNMENT_NOT_AVAILABLE' :
      'CAPABILITY_NOT_INTEGRATED', 'capability_unavailable');
  }

  private async startRecording(cancellation: Cancellation): Promise<CapabilityResult> {
    if (this.recorder || this.starting || !this.context || this.filesDir === '') {
      return this.failure('RECORDING_STATE', 'recording_failed');
    }
    this.starting = true;
    try {
      const permission: Permissions = 'ohos.permission.MICROPHONE';
      const result: PermissionRequestResult = await abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context, [permission]);
      if (cancellation.cancelled) {
        return this.failure('CANCELLED', 'operation_cancelled');
      }
      if (result.authResults.length !== 1 || result.authResults[0] !== 0) {
        return this.failure('MICROPHONE_DENIED', 'microphone_denied');
      }
      const token: string = Date.now().toString();
      this.projectId = `p-${token}`;
      this.sourceAssetId = `source-${token}`;
      const assetDir: string = `${this.filesDir}/projects/${this.projectId}/assets`;
      fs.mkdirSync(assetDir, true);
      this.sourcePath = `${assetDir}/${this.sourceAssetId}.m4a`;
      this.output = fs.openSync(this.sourcePath,
        fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      const recorder: media.AVRecorder = await media.createAVRecorder();
      this.recorder = recorder;
      await recorder.prepare({
        audioSourceType: media.AudioSourceType.AUDIO_SOURCE_TYPE_MIC,
        profile: {
          audioBitrate: 64000,
          audioChannels: 1,
          audioCodec: media.CodecMimeType.AUDIO_AAC,
          audioSampleRate: 16000,
          fileFormat: media.ContainerFormatType.CFT_MPEG_4A
        },
        url: `fd://${this.output.fd}`
      });
      if (cancellation.cancelled) {
        await this.releaseRecorder();
        return this.failure('CANCELLED', 'operation_cancelled');
      }
      await recorder.start();
      if (cancellation.cancelled) {
        await this.releaseRecorder();
        return this.failure('CANCELLED', 'operation_cancelled');
      }
      return this.success('recording_started');
    } finally {
      this.starting = false;
    }
  }

  private async pauseRecording(cancellation: Cancellation): Promise<CapabilityResult> {
    if (!this.recorder || this.recorder.state !== 'started') {
      return this.failure('RECORDING_STATE', 'recording_failed');
    }
    if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
    const recorder: media.AVRecorder = this.recorder;
    await recorder.pause();
    if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
    return this.success('recording_paused');
  }

  private async resumeRecording(cancellation: Cancellation): Promise<CapabilityResult> {
    if (!this.recorder || this.recorder.state !== 'paused') {
      return this.failure('RECORDING_STATE', 'recording_failed');
    }
    if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
    const recorder: media.AVRecorder = this.recorder;
    await recorder.resume();
    if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
    return this.success('recording_resumed');
  }

  private async stopRecording(cancellation: Cancellation): Promise<CapabilityResult> {
    if (!this.recorder || !this.output || (this.recorder.state !== 'started' && this.recorder.state !== 'paused')) {
      return this.failure('RECORDING_STATE', 'recording_failed');
    }
    if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
    await this.recorder.stop();
    await this.recorder.release();
    this.recorder = undefined;
    fs.closeSync(this.output);
    this.output = undefined;
    if (cancellation.cancelled) {
      await this.releaseRecorder();
      return this.failure('CANCELLED', 'operation_cancelled');
    }
    const input: fs.File = fs.openSync(this.sourcePath, fs.OpenMode.READ_ONLY);
    let extractor: media.AVMetadataExtractor | undefined;
    let durationMs: number = 0;
    try {
      const readyExtractor: media.AVMetadataExtractor = await media.createAVMetadataExtractor();
      extractor = readyExtractor;
      readyExtractor.fdSrc = { fd: input.fd, offset: 0, length: fs.statSync(input.fd).size };
      const metadata: media.AVMetadata = await readyExtractor.fetchMetadata();
      durationMs = metadata.duration ? Number(metadata.duration) : 0;
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0) { throw new Error('INVALID_RECORDING'); }
    } finally {
      try {
        if (extractor) { await extractor.release(); }
      } finally {
        fs.closeSync(input);
      }
    }
    if (cancellation.cancelled) {
      await this.discardPendingAsset();
      return this.failure('CANCELLED', 'operation_cancelled');
    }
    const project: Project = new Project(this.projectId, this.sourceAssetId, durationMs * 1000);
    return { ok: true, errorCode: '', messageKey: 'recording_saved', recoverable: false, project: project };
  }

  private async importAudio(cancellation: Cancellation): Promise<CapabilityResult> {
    if (this.recorder || this.starting || !this.context || this.filesDir === '') {
      return this.failure('IMPORT_STATE', 'import_failed');
    }
    if (cancellation.cancelled) { return this.failure('CANCELLED', 'operation_cancelled'); }
    const audioPicker = new picker.AudioViewPicker(this.context);
    const uris: Array<string> = await audioPicker.select({ maxSelectNumber: 1 });
    if (cancellation.cancelled) { return this.failure('CANCELLED', 'operation_cancelled'); }
    if (uris.length !== 1 || typeof uris[0] !== 'string' || uris[0] === '') {
      return this.failure('IMPORT_CANCELLED', 'operation_cancelled');
    }
    const token: string = Date.now().toString();
    this.projectId = `p-${token}`;
    this.sourceAssetId = `source-${token}`;
    const assetDir: string = `${this.filesDir}/projects/${this.projectId}/assets`;
    fs.mkdirSync(assetDir, true);
    this.sourcePath = `${assetDir}/${this.sourceAssetId}.audio`;
    try {
      await fs.copyFile(uris[0], this.sourcePath);
      if (cancellation.cancelled) {
        await this.discardPendingAsset();
        return this.failure('CANCELLED', 'operation_cancelled');
      }
      const durationMs: number = await this.readDurationMs(this.sourcePath);
      const project: Project = new Project(this.projectId, this.sourceAssetId, durationMs * 1000);
      return { ok: true, errorCode: '', messageKey: 'imported', recoverable: false, project: project };
    } catch {
      await this.discardPendingAsset();
      return this.failure('IMPORT_FAILED', 'import_failed');
    }
  }

  private async readDurationMs(path: string): Promise<number> {
    const input: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
    let extractor: media.AVMetadataExtractor | undefined;
    try {
      const readyExtractor: media.AVMetadataExtractor = await media.createAVMetadataExtractor();
      extractor = readyExtractor;
      readyExtractor.fdSrc = { fd: input.fd, offset: 0, length: fs.statSync(input.fd).size };
      const metadata: media.AVMetadata = await readyExtractor.fetchMetadata();
      const durationMs: number = metadata.duration ? Number(metadata.duration) : 0;
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0) { throw new Error('INVALID_AUDIO'); }
      return durationMs;
    } finally {
      try { if (extractor) { await extractor.release(); } } finally { fs.closeSync(input); }
    }
  }

  async finalizePendingAsset(): Promise<void> { this.clearRecordingIdentity(); }

  async discardPendingAsset(): Promise<void> {
    this.discardSourceAsset();
    this.clearRecordingIdentity();
  }

  async release(): Promise<void> { await this.releaseRecorder(); }

  private async releaseRecorder(): Promise<void> {
    if (this.recorder) {
      try {
        if (this.recorder.state === 'started' || this.recorder.state === 'paused') { await this.recorder.stop(); }
      } catch { }
      try { await this.recorder.release(); } catch { }
      this.recorder = undefined;
    }
    if (this.output) {
      try { fs.closeSync(this.output); } catch { }
      this.output = undefined;
    }
    await this.discardPendingAsset();
    this.clearRecordingIdentity();
  }

  private discardSourceAsset(): void {
    if (this.sourcePath !== '') {
      try { fs.unlinkSync(this.sourcePath); } catch { }
      const assetsDir: string = this.sourcePath.substring(0, this.sourcePath.lastIndexOf('/'));
      const projectDir: string = assetsDir.substring(0, assetsDir.lastIndexOf('/'));
      try { fs.rmdirSync(assetsDir); } catch { }
      try { fs.rmdirSync(projectDir); } catch { }
    }
  }

  private clearRecordingIdentity(): void {
    this.projectId = ''; this.sourceAssetId = ''; this.sourcePath = '';
  }

  private success(key: string): CapabilityResult {
    return { ok: true, errorCode: '', messageKey: key, recoverable: false, project: undefined };
  }
  private failure(code: string, key: string): CapabilityResult {
    return { ok: false, errorCode: code, messageKey: key, recoverable: false, project: undefined };
  }
}
