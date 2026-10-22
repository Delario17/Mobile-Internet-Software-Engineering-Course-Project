import { cancelDecode } from 'libaudiopcm.so';
import { decodeAudio } from './AudioDecode';
import { renderWave } from '../domain/PcmRender';
import { OfflineSpeech } from './OfflineSpeech';
import { CapabilityPort, CapabilityRequest, CapabilityResult, Cancellation, Progress } from '../domain/Capabilities';
import { Project, Segment, Take } from '../domain/Project';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { media } from '@kit.MediaKit';
import { abilityAccessCtrl, Context, PermissionRequestResult, Permissions } from '@kit.AbilityKit';

// P1-FR-002: AVRecorder writes the immutable source asset into application-private storage.
export class HuaweiCapabilities implements CapabilityPort {
  private speech: OfflineSpeech = new OfflineSpeech();
  private context: Context | undefined;
  private filesDir: string;
  private recorder: media.AVRecorder | undefined = undefined;
  private output: fs.File | undefined = undefined;
  private projectId: string = '';
  private sourceAssetId: string = '';
  private sourcePath: string = '';
  private starting: boolean = false;
  private retakeProjectId: string = '';
  private retakeSegmentId: string = '';
  private retakeAssetId: string = '';
  private retakePath: string = '';
  private retakeRangeRevision: number = 0;
  private player: media.AVPlayer | undefined = undefined;
  private playerInput: fs.File | undefined = undefined;
  private recorderErrorHandler: ((retake: boolean) => void) | undefined = undefined;

  constructor(context?: Context, filesDir: string = '') {
    this.context = context; this.filesDir = filesDir;
  }

  async execute(request: CapabilityRequest, cancellation: Cancellation,
    progress: (value: Progress) => void): Promise<CapabilityResult> {
    if (cancellation.cancelled) { return this.failure('CANCELLED', 'operation_cancelled'); }
    if (this.recorder && !['recordPause', 'recordResume', 'recordStop',
      'retakePause', 'retakeResume', 'retakeStop'].includes(request.operation)) {
      return this.failure('BUSY', 'operation_busy');
    }
    progress({ completed: 0, total: 1 });
    try {
      if (request.operation === 'preview' || request.operation === 'export') {
        return await this.renderAudio(request, cancellation, progress);
      }
      if (request.operation === 'recordStart') { return await this.startRecording(cancellation); }
      if (request.operation === 'recordPause') { return await this.pauseRecording(cancellation); }
      if (request.operation === 'recordResume') { return await this.resumeRecording(cancellation); }
      if (request.operation === 'recordStop') { return await this.stopRecording(cancellation); }
      if (request.operation === 'retakeStart') { return await this.startRetake(request, cancellation); }
      if (request.operation === 'retakePause') { return await this.pauseRecording(cancellation); }
      if (request.operation === 'retakeResume') { return await this.resumeRecording(cancellation); }
      if (request.operation === 'retakeStop') { return await this.stopRetake(request, cancellation); }
      if (request.operation === 'recognize') {
        if (!request.project) { return this.failure('PROJECT_REQUIRED', 'project_required'); }
        const path: string | undefined = this.assetPath(request.project.id, request.project.sourceAssetId);
        if (!path) { return this.failure('ASR_DECODE_FAILED', 'asr_decode_failed'); }
        const input: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
        try { return await this.speech.recognize(request.project, input.fd, fs.statSync(input.fd).size, cancellation, progress); }
        finally { fs.closeSync(input); }
      }
      if (request.operation === 'import') { return await this.importAudio(cancellation); }
      if (request.operation === 'auditionSource' || request.operation === 'auditionTake') {
        return await this.audition(request, cancellation);
      }
    } catch {
      await this.releaseRecorder();
      await this.releasePlayback();
      if (request.operation === 'preview' || request.operation === 'export') { return this.failure('RENDER_FAILED', 'render_failed'); }
      if (request.operation === 'recognize') { return this.failure('ASR_DECODE_FAILED', 'asr_decode_failed'); }
      if (request.operation === 'import') { return this.failure('IMPORT_FAILED', 'import_failed'); }
      if (request.operation.startsWith('retake')) { return this.failure('RETAKE_FAILED', 'retake_failed'); }
      if (request.operation === 'auditionSource' || request.operation === 'auditionTake') {
        return this.failure('PLAYBACK_FAILED', 'playback_failed');
      }
      return this.failure('RECORDING_FAILED', 'recording_failed');
    }
    return this.failure('CAPABILITY_NOT_INTEGRATED', 'capability_unavailable');
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
      this.ensureDirectory(assetDir);
      this.sourcePath = `${assetDir}/${this.sourceAssetId}.m4a`;
      this.output = fs.openSync(this.sourcePath,
        fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      const recorder: media.AVRecorder = await media.createAVRecorder();
      this.recorder = recorder;
      this.observeRecorderFailure(recorder, false);
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

  private async startRetake(request: CapabilityRequest, cancellation: Cancellation): Promise<CapabilityResult> {
    if (!request.project || !request.selectedSegmentId || this.recorder || this.starting || !this.context || this.filesDir === '') {
      return this.failure('RETAKE_STATE', 'retake_failed');
    }
    const segment: Segment | undefined = request.project.segments.find((value: Segment) => value.id === request.selectedSegmentId);
    if (!segment || cancellation.cancelled) { return this.failure(cancellation.cancelled ? 'CANCELLED' : 'SEGMENT_REQUIRED', cancellation.cancelled ? 'operation_cancelled' : 'retake_failed'); }
    this.starting = true;
    try {
      const permission: Permissions = 'ohos.permission.MICROPHONE';
      const permissionResult: PermissionRequestResult = await abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context, [permission]);
      if (cancellation.cancelled) { return this.failure('CANCELLED', 'operation_cancelled'); }
      if (permissionResult.authResults.length !== 1 || permissionResult.authResults[0] !== 0) {
        return this.failure('MICROPHONE_DENIED', 'microphone_denied');
      }
      const token: string = Date.now().toString();
      this.retakeProjectId = request.project.id;
      this.retakeSegmentId = segment.id;
      this.retakeRangeRevision = segment.rangeRevision;
      this.retakeAssetId = `take-${token}`;
      const assetDir: string = `${this.filesDir}/projects/${this.retakeProjectId}/assets`;
      this.ensureDirectory(assetDir);
      this.retakePath = `${assetDir}/${this.retakeAssetId}.m4a`;
      this.output = fs.openSync(this.retakePath, fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      const recorder: media.AVRecorder = await media.createAVRecorder();
      this.recorder = recorder;
      this.observeRecorderFailure(recorder, true);
      await recorder.prepare({ audioSourceType: media.AudioSourceType.AUDIO_SOURCE_TYPE_MIC,
        profile: { audioBitrate: 64000, audioChannels: 1, audioCodec: media.CodecMimeType.AUDIO_AAC,
          audioSampleRate: 16000, fileFormat: media.ContainerFormatType.CFT_MPEG_4A }, url: `fd://${this.output.fd}` });
      if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
      await recorder.start();
      if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
      return this.success('retake_started');
    } finally { this.starting = false; }
  }

  private async stopRetake(request: CapabilityRequest, cancellation: Cancellation): Promise<CapabilityResult> {
    if (!this.recorder || !this.output || this.retakePath === '' || this.recorder.state !== 'started' && this.recorder.state !== 'paused') {
      return this.failure('RETAKE_STATE', 'retake_failed');
    }
    if (cancellation.cancelled) { await this.releaseRecorder(); return this.failure('CANCELLED', 'operation_cancelled'); }
    await this.recorder.stop(); await this.recorder.release(); this.recorder = undefined;
    fs.closeSync(this.output); this.output = undefined;
    try {
      const durationMs: number = await this.readDurationMs(this.retakePath);
      if (cancellation.cancelled) { await this.discardRetakeAsset(); return this.failure('CANCELLED', 'operation_cancelled'); }
      if (durationMs < 300) {
        await this.discardRetakeAsset();
        return this.failure('RETAKE_TOO_SHORT', 'retake_too_short');
      }
      const sourceProject: Project | undefined = request.project;
      if (!sourceProject || sourceProject.id !== this.retakeProjectId) { throw new Error('PROJECT_REQUIRED'); }
      const project: Project = new Project(sourceProject.id, sourceProject.sourceAssetId, sourceProject.sourceDurationUs);
      project.sequence = sourceProject.sequence;
      project.updatedAtMs = sourceProject.updatedAtMs;
      project.policyVersion = sourceProject.policyVersion;
      project.dspProfileVersion = sourceProject.dspProfileVersion;
      project.segments = sourceProject.segments.slice(); project.takes = sourceProject.takes.slice();
      const segment: Segment | undefined = project.segments.find((value: Segment) => value.id === this.retakeSegmentId);
      if (!segment || segment.rangeRevision !== this.retakeRangeRevision) { throw new Error('SEGMENT_REQUIRED'); }
      project.takes.push(new Take(this.retakeAssetId, segment.id, segment.rangeRevision, this.retakeAssetId, durationMs * 1000));
      return { ok: true, errorCode: '', messageKey: 'retake_saved', recoverable: false, project };
    } catch {
      await this.discardRetakeAsset();
      return this.failure('RETAKE_FAILED', 'retake_failed');
    }
  }

  private async discardRetakeAsset(): Promise<void> {
    if (this.retakePath !== '') { try { fs.unlinkSync(this.retakePath); } catch { } }
    this.clearRetakeIdentity();
  }

  setRecorderErrorHandler(handler: (retake: boolean) => void): void { this.recorderErrorHandler = handler; }

  private observeRecorderFailure(recorder: media.AVRecorder, retake: boolean): void {
    recorder.on('error', () => {
      if (this.recorder !== recorder) { return; }
      void this.releaseRecorder().then(() => {
        if (this.recorderErrorHandler) { this.recorderErrorHandler(retake); }
      });
    });
  }

  private clearRetakeIdentity(): void {
    this.retakeProjectId = ''; this.retakeSegmentId = ''; this.retakeAssetId = ''; this.retakePath = '';
    this.retakeRangeRevision = 0;
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
    this.ensureDirectory(assetDir);
    this.sourcePath = `${assetDir}/${this.sourceAssetId}.audio`;
    try {
      const input: fs.File = fs.openSync(uris[0], fs.OpenMode.READ_ONLY);
      try {
        const output: fs.File = fs.openSync(this.sourcePath, fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
        try { await fs.copyFile(input.fd, output.fd); fs.fdatasyncSync(output.fd); }
        finally { fs.closeSync(output); }
      } finally { fs.closeSync(input); }
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

  private assetPath(projectId: string, assetId: string): string | undefined {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !/^[A-Za-z0-9_-]{1,128}$/.test(assetId)) {
      return undefined;
    }
    const folder: string = `${this.filesDir}/projects/${projectId}/assets`;
    const name: string | undefined = fs.listFileSync(folder).find((value: string) => value.startsWith(`${assetId}.`));
    return name ? `${folder}/${name}` : undefined;
  }

  /** Core File Kit API20 reports EEXIST when a recursive mkdir reaches an existing directory. */
  private ensureDirectory(path: string): void {
    try { fs.mkdirSync(path, true); }
    catch (error) {
      const code: number = (error as { code?: number }).code ?? -1;
      if (code !== 13900015) { throw error; }
    }
  }

  private async audition(request: CapabilityRequest, cancellation: Cancellation): Promise<CapabilityResult> {
    if (!request.project || request.manifest.length !== 1 || this.player || this.playerInput) {
      return this.failure('PLAYBACK_STATE', 'playback_failed');
    }
    const piece = request.manifest[0];
    if (!Number.isSafeInteger(piece.startUs) || !Number.isSafeInteger(piece.endUs) ||
      piece.startUs < 0 || piece.endUs <= piece.startUs) {
      return this.failure('PLAYBACK_RANGE', 'playback_failed');
    }
    const path: string | undefined = this.assetPath(request.project.id, piece.assetId);
    if (!path || cancellation.cancelled) { return this.failure(cancellation.cancelled ? 'CANCELLED' : 'PLAYBACK_ASSET_NOT_FOUND',
      cancellation.cancelled ? 'operation_cancelled' : 'playback_failed'); }
    return await this.playFile(path, piece.startUs, piece.endUs, cancellation);
  }

  private async playFile(path: string, startUs: number, endUs: number,
    cancellation: Cancellation): Promise<CapabilityResult> {
    const input: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
    this.playerInput = input;
    const player: media.AVPlayer = await media.createAVPlayer();
    this.player = player;
    const startMs: number = Math.floor(startUs / 1000);
    const endMs: number = Math.ceil(endUs / 1000);
    return await new Promise<CapabilityResult>((resolve) => {
      let settled: boolean = false;
      let cancelTimer: number = 0;
      let preparing: boolean = false;
      let playbackStarted: boolean = false;
      const finish = async (result: CapabilityResult): Promise<void> => {
        if (settled) { return; }
        settled = true;
        if (cancelTimer !== 0) { clearTimeout(cancelTimer); }
        await this.releasePlayback();
        resolve(result);
      };
      const onState = (state: string): void => {
        if (settled) { return; }
        if (state === 'initialized' && !preparing) {
          preparing = true;
          void player.prepare().catch(() => finish(this.failure('PLAYBACK_FAILED', 'playback_failed')));
        } else if (state === 'prepared') {
          if (startMs > 0) { player.seek(startMs); }
          else { startPlayback(); }
        } else if (state === 'error') { finish(this.failure('PLAYBACK_FAILED', 'playback_failed')); }
        else if (state === 'completed') { finish(this.success('audition_completed')); }
      };
      const startPlayback = (): void => {
        if (settled || playbackStarted) { return; }
        playbackStarted = true;
        void player.play().catch(() => finish(this.failure('PLAYBACK_FAILED', 'playback_failed')));
      };
      const onError = (): void => { finish(this.failure('PLAYBACK_FAILED', 'playback_failed')); };
      const onTime = (timeMs: number): void => {
        if (timeMs >= endMs) {
          finish(this.success('audition_completed'));
        }
      };
      player.on('stateChange', onState);
      player.on('error', onError);
      player.on('timeUpdate', onTime);
      player.on('seekDone', (_position: number): void => { startPlayback(); });
      const watchCancellation = (): void => {
        if (settled) { return; }
        if (cancellation.cancelled) {
          finish(this.failure('CANCELLED', 'operation_cancelled'));
          return;
        }
        cancelTimer = setTimeout(watchCancellation, 50);
      };
      cancelTimer = setTimeout(watchCancellation, 50);
      player.fdSrc = { fd: input.fd, offset: 0, length: fs.statSync(input.fd).size };

    });
  }

  private async renderAudio(request: CapabilityRequest, cancellation: Cancellation,
    progress: (value: Progress) => void): Promise<CapabilityResult> {
    const project: Project | undefined = request.project;
    if (!project || request.manifest.length === 0 || this.player || !this.context) {
      return this.failure('RENDER_STATE', 'render_failed');
    }
    const sourcePath: string | undefined = this.assetPath(project.id, project.sourceAssetId);
    if (!sourcePath) { return this.failure('RENDER_ASSET', 'render_failed'); }
    let source: Int16Array | undefined = undefined;
    const monitor: number = setInterval(() => { if (cancellation.cancelled) { cancelDecode(); } }, 50);
    const folder: string = `${this.filesDir}/projects/${project.id}/renders`;
    const path: string = `${folder}/render-${project.sequence}-${Date.now()}.wav`;
    try {
      const wave: ArrayBuffer = await renderWave(request.manifest, async (id: string): Promise<Int16Array | undefined> => {
        if (id === project.sourceAssetId && source) { return source; }
        const asset: string | undefined = this.assetPath(project.id, id);
        if (!asset || cancellation.cancelled) { throw new Error(cancellation.cancelled ? 'CANCELLED' : 'RENDER_ASSET'); }
        const file: fs.File = fs.openSync(asset, fs.OpenMode.READ_ONLY);
        let pcm: Int16Array;
        try { pcm = new Int16Array(await decodeAudio(file.fd, fs.statSync(file.fd).size)); }
        finally { fs.closeSync(file); }
        if (id === project.sourceAssetId) { source = pcm; }
        return pcm;
      }, cancellation, progress);
      clearInterval(monitor); // No native decode remains; never cancel a later operation while picker waits.
      if (cancellation.cancelled) { return this.failure('CANCELLED', 'operation_cancelled'); }
      this.ensureDirectory(folder);
      const output: fs.File = fs.openSync(path, fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      try {
        for (let cursor: number = 0; cursor < wave.byteLength;) {
          if (cancellation.cancelled) { throw new Error('CANCELLED'); }
          const written: number = fs.writeSync(output.fd, wave.slice(cursor, Math.min(cursor + 1048576, wave.byteLength)));
          if (written <= 0) { throw new Error('RENDER_WRITE'); }
          cursor += written;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        fs.fdatasyncSync(output.fd);
      } finally { fs.closeSync(output); }
      if (cancellation.cancelled) { throw new Error('CANCELLED'); }
      if (request.operation === 'preview') {
        return await this.playFile(path, 0, (wave.byteLength - 44) / 2 * 1000000 / 16000, cancellation);
      }
      const pickerView = new picker.DocumentViewPicker(this.context);
      const uris: string[] = await pickerView.save({ newFileNames: [`AudioPatch-r${project.sequence}-${Date.now()}.wav`],
        fileSuffixChoices: ['WAV|.wav'] });
      if (uris.length !== 1 || cancellation.cancelled) { throw new Error('CANCELLED'); }
      const destination: fs.File = fs.openSync(uris[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      let copied: boolean = false;
      try {
        const input: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
        try { await fs.copyFile(input.fd, destination.fd); }
        finally { fs.closeSync(input); }
        fs.fdatasyncSync(destination.fd); copied = !cancellation.cancelled;
      } finally {
        fs.closeSync(destination);
        if (!copied) { try { fs.unlinkSync(uris[0]); } catch { } }
      }
      if (!copied) { try { fs.unlinkSync(uris[0]); } catch { } throw new Error('CANCELLED'); }
      return this.success('export_completed');
    } catch (error) {
      return this.failure(cancellation.cancelled || (error as Error).message === 'CANCELLED' ? 'CANCELLED' : 'RENDER_FAILED',
        cancellation.cancelled || (error as Error).message === 'CANCELLED' ? 'operation_cancelled' : 'render_failed');
    } finally {
      clearInterval(monitor);
      try { fs.unlinkSync(path); } catch { }
    }
  }

  private async releasePlayback(): Promise<void> {
    if (this.player) {
      try {
        if (this.player.state === 'playing' || this.player.state === 'paused' || this.player.state === 'prepared') {
          await this.player.stop();
        }
      } catch { }
      try { await this.player.release(); } catch { }
      this.player = undefined;
    }
    if (this.playerInput) {
      try { fs.closeSync(this.playerInput); } catch { }
      this.playerInput = undefined;
    }
  }

  async finalizePendingAsset(): Promise<void> {
    this.clearRecordingIdentity();
    this.clearRetakeIdentity();
  }

  async discardPendingAsset(): Promise<void> {
    this.discardSourceAsset();
    this.clearRecordingIdentity();
    await this.discardRetakeAsset();
  }

  async release(): Promise<void> { this.speech.cancel(); await this.releaseRecorder(); await this.releasePlayback(); }

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
