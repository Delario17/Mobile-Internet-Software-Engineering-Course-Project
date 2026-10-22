import { speechRecognizer } from '@kit.CoreSpeechKit';
import { cancelDecode } from 'libaudiopcm.so';
import { decodeAudio } from './AudioDecode';
import { Cancellation, CapabilityResult, Progress } from '../domain/Capabilities';
import { Project, Segment } from '../domain/Project';
import { copyProject } from '../application/ProjectStore';
import { speechWindows, SpeechWindow } from '../domain/SpeechWindows';

// Official CoreSpeechKit API11+, offline zh-CN; native PCM decoder uses API20.
// Result has no timestamp/confidence fields: measured phrase windows remain unreviewed.
export class OfflineSpeech {
  private cancellation: Cancellation | undefined = undefined;

  cancel(): void {
    if (this.cancellation) { this.cancellation.cancel(); cancelDecode(); }
  }

  async recognize(project: Project, fd: number, size: number, cancellation: Cancellation,
    progress: (value: Progress) => void): Promise<CapabilityResult> {
    if (project.segments.length > 0 || project.takes.length > 0) {
      return this.failure('ASR_EXISTING_EDITS', 'asr_existing_edits');
    }
    if (this.cancellation) { return this.failure('BUSY', 'operation_busy'); }
    this.cancellation = cancellation;
    let engine: speechRecognizer.SpeechRecognitionEngine | undefined = undefined;
    const monitor: number = setInterval(() => { if (cancellation.cancelled) { cancelDecode(); } }, 50);
    try {
      if (cancellation.cancelled) { throw new Error('CANCELLED'); }
      progress({ completed: 0, total: 100 });
      const pcm: Int16Array = new Int16Array(await decodeAudio(fd, size));
      if (cancellation.cancelled) { throw new Error('CANCELLED'); }
      const windows: SpeechWindow[] = speechWindows(pcm);
      if (windows.length === 0) { return this.failure('ASR_NO_SPEECH', 'asr_no_speech'); }
      // createEngine may complete after cancellation; never leave that late engine alive.
      engine = await this.createEngine(cancellation);
      if (cancellation.cancelled) { throw new Error('CANCELLED'); }
      const candidate: Project = copyProject(project);
      for (let i: number = 0; i < windows.length; i++) {
        const window: SpeechWindow = windows[i];
        const text: string = await this.transcribe(engine, pcm, window, cancellation,
          (sent: number) => progress({ completed: Math.min(99,
            Math.floor(5 + 94 * (window.startSample + sent) / pcm.length)), total: 100 }));
        if (cancellation.cancelled) { throw new Error('CANCELLED'); }
        if (text.trim() !== '') {
          const startUs: number = Math.round(window.startSample * 1000000 / 16000);
          const endUs: number = Math.min(project.sourceDurationUs, Math.round(window.endSample * 1000000 / 16000));
          if (endUs > startUs) {
            candidate.segments.push(new Segment(`asr-${project.sequence + 1}-${i}`, text.trim(), startUs, endUs));
          }
        }
      }
      if (candidate.segments.length === 0) { return this.failure('ASR_NO_SPEECH', 'asr_no_speech'); }
      progress({ completed: 100, total: 100 });
      return { ok: true, errorCode: '', messageKey: 'asr_completed', recoverable: false, project: candidate };
    } catch (error) {
      const code: string = (error as Error).message;
      if (cancellation.cancelled || code === 'CANCELLED') { return this.failure('CANCELLED', 'operation_cancelled'); }
      if (code === 'ASR_DECODE_FAILED' || code === 'ASR_AUDIO_TOO_LONG') {
        return this.failure(code, code === 'ASR_AUDIO_TOO_LONG' ? 'asr_audio_too_long' : 'asr_decode_failed');
      }
      return this.failure(code.startsWith('ASR_') ? code : 'ASR_ENGINE_UNAVAILABLE', 'asr_engine_failed');
    } finally {
      clearInterval(monitor);
      if (engine) { try { engine.shutdown(); } catch { /* Release attempted even after service failure. */ } }
      this.cancellation = undefined;
    }
  }

  private createEngine(cancellation: Cancellation): Promise<speechRecognizer.SpeechRecognitionEngine> {
    return new Promise((resolve, reject) => {
      let settled: boolean = false;
      let monitor: number = 0;
      let timer: number = 0;
      const fail = (code: string): void => {
        if (settled) { return; }
        settled = true; clearInterval(monitor); clearTimeout(timer); reject(new Error(code));
      };
      monitor = setInterval(() => { if (cancellation.cancelled) { fail('CANCELLED'); } }, 20);
      timer = setTimeout(() => fail('ASR_ENGINE_TIMEOUT'), 20000);
      speechRecognizer.createEngine({ language: 'zh-CN', online: 1,
        extraParams: { 'locate': 'CN', 'recognizerMode': 'long' } }).then(
        (engine: speechRecognizer.SpeechRecognitionEngine) => {
          if (settled || cancellation.cancelled) {
            try { engine.shutdown(); } catch { }
            fail('CANCELLED'); return;
          }
          settled = true; clearInterval(monitor); clearTimeout(timer); resolve(engine);
        }, () => fail('ASR_ENGINE_UNAVAILABLE'));
    });
  }

  private transcribe(engine: speechRecognizer.SpeechRecognitionEngine, pcm: Int16Array,
    window: SpeechWindow, cancellation: Cancellation, progress: (sent: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const sessionId: string = `asr-${Date.now()}-${window.startSample}`;
      const clauses: string[] = [];
      let settled: boolean = false;
      let started: boolean = false;
      let finishSent: boolean = false;
      let timer: number = 0;
      let monitor: number = 0;
      const finish = (error: string): void => {
        if (settled) { return; }
        settled = true; clearTimeout(timer); clearInterval(monitor);
        if (error !== '') {
          try { engine.cancel(sessionId); } catch { /* Session may have already ended. */ }
          reject(new Error(error));
        } else { resolve(clauses.join('')); }
      };
      monitor = setInterval(() => { if (cancellation.cancelled) { finish('CANCELLED'); } }, 20);
      timer = setTimeout(() => finish('ASR_ENGINE_TIMEOUT'),
        15000 + Math.ceil((window.endSample - window.startSample) / 16));
      const feed = async (): Promise<void> => {
        try {
          for (let offset: number = window.startSample; offset < window.endSample; offset += 320) {
            if (settled) { return; }
            if (cancellation.cancelled) { finish('CANCELLED'); return; }
            const frame: Int16Array = new Int16Array(320);
            frame.set(pcm.subarray(offset, Math.min(offset + 320, window.endSample)));
            engine.writeAudio(sessionId, new Uint8Array(frame.buffer));
            progress(Math.min(offset + 320, window.endSample) - window.startSample);
            await new Promise<void>((done) => setTimeout(done, 20));
          }
          if (!settled) { finishSent = true; engine.finish(sessionId); }
        } catch { finish('ASR_ENGINE_WRITE_FAILED'); }
      };
      engine.setListener({
        onStart: (id: string, _message: string): void => {
          if (id === sessionId && !settled && !started) { started = true; feed(); }
        },
        onEvent: (_id: string, _code: number, _message: string): void => {},
        onResult: (id: string, result: speechRecognizer.SpeechRecognitionResult): void => {
          if (id === sessionId && !settled && result.isFinal) { clauses.push(result.result); }
        },
        onComplete: (id: string, _message: string): void => {
          if (id === sessionId) { finish(finishSent ? '' : 'ASR_ENGINE_EARLY_END'); }
        },
        onError: (id: string, code: number, _message: string): void => {
          if (id === sessionId) { finish(`ASR_ENGINE_ERROR_${code}`); }
        }
      });
      try {
        engine.startListening({ sessionId: sessionId,
          audioInfo: { audioType: 'pcm', sampleRate: 16000, soundChannel: 1, sampleBit: 16 },
          extraParams: { 'online': 1 } });
      } catch { finish('ASR_ENGINE_START_FAILED'); }
    });
  }

  private failure(code: string, key: string): CapabilityResult {
    return { ok: false, errorCode: code, messageKey: key, recoverable: true, project: undefined };
  }
}
