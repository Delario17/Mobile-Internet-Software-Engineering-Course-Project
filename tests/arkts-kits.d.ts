declare module '@kit.CoreFileKit' {
  export const fileIo: {
    OpenMode: { WRITE_ONLY: number; CREATE: number; TRUNC: number };
    readTextSync(path: string): string;
    mkdirSync(path: string, recursion: boolean): void;
    openSync(path: string, mode: number): { fd: number };
    writeSync(fd: number, text: string): number;
    fdatasyncSync(fd: number): void;
    closeSync(file: { fd: number }): void;
    renameSync(from: string, to: string): void;
    listFileSync(path: string): string[];
  };
}
declare module '@kit.BasicServicesKit' {
  export class BusinessError extends Error { code: number; }
}
