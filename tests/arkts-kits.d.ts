declare module '@kit.CoreFileKit' {
  namespace fileIo { interface File { fd: number; } }
  export const fileIo: {
    OpenMode: { READ_ONLY: number; WRITE_ONLY: number; CREATE: number; TRUNC: number };
    readTextSync(path: string): string;
    mkdirSync(path: string, recursion: boolean): void;
    openSync(path: string, mode: number): fileIo.File;
    writeSync(fd: number, text: string): number;
    fdatasyncSync(fd: number): void;
    closeSync(file: { fd: number }): void;
    renameSync(from: string, to: string): void;
    listFileSync(path: string): string[];
    statSync(file: number): { size: number };
    unlinkSync(path: string): void;
    rmdirSync(path: string): void;
  };
}
declare module '@kit.MediaKit' {
  namespace media {
    interface AVRecorder {
      state: string;
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
