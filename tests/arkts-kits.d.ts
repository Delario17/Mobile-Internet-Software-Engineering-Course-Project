declare module '@kit.CoreFileKit' {
  namespace fileIo { interface File { fd: number; } }
  export const fileIo: {
    OpenMode: { READ_ONLY: number; WRITE_ONLY: number; CREATE: number; TRUNC: number };
    readTextSync(path: string): string;
    mkdirSync(path: string, recursion: boolean): void;
    openSync(path: string, mode: number): fileIo.File;
    readSync(fd: number, bytes: ArrayBuffer, options: {offset: number; length: number}): number;
    writeSync(fd: number, text: string | ArrayBuffer): number;
    fdatasyncSync(fd: number): void;
    closeSync(file: { fd: number }): void;
    renameSync(from: string, to: string): void;
    listFileSync(path: string): string[];
    statSync(file: number): { size: number };
    unlinkSync(path: string): void;
    rmdirSync(path: string): void;
    copyFile(src: string | number, dest: string | number): Promise<void>;
  };
  export const picker: {
    DocumentViewPicker: new (context: object) => { save(options: {newFileNames: string[]; fileSuffixChoices: string[]}): Promise<string[]> };
    AudioViewPicker: new (context: object) => { select(options?: object): Promise<string[]> };
  };
}
declare module '@kit.MediaKit' {
  namespace media {
    interface AVRecorder {
      state: string;
      on(type: string, callback: (...args: any[]) => void): void;
      prepare(config: object): Promise<void>;
      start(): Promise<void>;
      pause(): Promise<void>;
      resume(): Promise<void>;
      stop(): Promise<void>;
      release(): Promise<void>;
    }
    interface AVMetadataExtractor {
      fdSrc?: object;
      fetchMetadata(): Promise<AVMetadata>;
      release(): Promise<void>;
    }
    interface AVMetadata { duration?: string; }
    interface AVPlayer {
      state: string;
      fdSrc?: object;
      on(type: string, callback: (...args: any[]) => void): void;
      off(type?: string, callback?: (...args: any[]) => void): void;
      prepare(): Promise<void>;
      play(): Promise<void>;
      seek(timeMs: number): void;
      stop(): Promise<void>;
      release(): Promise<void>;
    }
  }
  export const media: any;
}
declare module '@kit.AbilityKit' {
  export interface Context {}
  export type Permissions = string;
  export interface PermissionRequestResult { authResults: number[]; }
  export const abilityAccessCtrl: any;
}
declare module '@kit.BasicServicesKit' {
  export class BusinessError extends Error { code: number; }
}
declare module 'libaudiopcm.so' {
  export function decode(fd: number, size: number): Promise<ArrayBuffer>;
  export function cancelDecode(): void;
}
declare module '@kit.CoreSpeechKit' {
  export namespace speechRecognizer {
    interface SpeechRecognitionResult { isFinal: boolean; isLast: boolean; result: string; }
    interface RecognitionListener {
      onStart(id: string, message: string): void;
      onEvent(id: string, code: number, message: string): void;
      onResult(id: string, result: SpeechRecognitionResult): void;
      onComplete(id: string, message: string): void;
      onError(id: string, code: number, message: string): void;
    }
    interface SpeechRecognitionEngine {
      setListener(listener: RecognitionListener): void;
      startListening(params: { sessionId: string; audioInfo: { audioType: string; sampleRate: number; soundChannel: number; sampleBit: number }; extraParams?: Record<string, Object> }): void;
      writeAudio(id: string, frame: Uint8Array): void;
      finish(id: string): void;
      cancel(id: string): void;
      shutdown(): void;
    }
    function createEngine(params: { language: string; online: number; extraParams?: Record<string, Object> }): Promise<SpeechRecognitionEngine>;
  }
}
