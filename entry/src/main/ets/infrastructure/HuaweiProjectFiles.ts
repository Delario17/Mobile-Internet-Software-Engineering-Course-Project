import { fileIo as fs } from '@kit.CoreFileKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ProjectFiles } from '../application/ProjectStore';

// P1-FR-019/020: project metadata stays under the application-private filesDir.
export class HuaweiProjectFiles implements ProjectFiles {
  private root: string;
  constructor(root: string) { this.root = root; }

  private path(relative: string): string {
    if (this.root === '' || relative.startsWith('/') || relative.includes('..') || relative.includes('\\')) {
      throw new Error('INVALID_PROJECT_PATH');
    }
    return relative === '' ? this.root : `${this.root}/${relative}`;
  }

  private parent(path: string): string {
    const separator: number = path.lastIndexOf('/');
    return separator <= 0 ? this.root : path.slice(0, separator);
  }

  private ensureParent(path: string): void {
    try { fs.mkdirSync(this.parent(path), true); }
    catch (error) {
      const failure: BusinessError = error as BusinessError;
      if (failure.code !== 13900015) { throw error; }
    }
  }

  async read(relative: string): Promise<string | undefined> {
    try { return fs.readTextSync(this.path(relative)); }
    catch (error) {
      const failure: BusinessError = error as BusinessError;
      if (failure.code === 13900002) { return undefined; }
      throw error;
    }
  }

  async write(relative: string, text: string): Promise<void> {
    const path: string = this.path(relative);
    this.ensureParent(path);
    const file = fs.openSync(path, fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      const bytes: number = fs.writeSync(file.fd, text);
      if (bytes <= 0 && text.length > 0) { throw new Error('PARTIAL_WRITE'); }
      fs.fdatasyncSync(file.fd);
    } finally { fs.closeSync(file); }
  }

  async rename(from: string, to: string): Promise<void> {
    const source: string = this.path(from);
    const destination: string = this.path(to);
    this.ensureParent(destination);
    fs.renameSync(source, destination);
  }

  async list(relative: string): Promise<string[]> {
    try { return fs.listFileSync(this.path(relative)); }
    catch (error) {
      const failure: BusinessError = error as BusinessError;
      if (failure.code === 13900002) { return []; }
      throw error;
    }
  }
}
