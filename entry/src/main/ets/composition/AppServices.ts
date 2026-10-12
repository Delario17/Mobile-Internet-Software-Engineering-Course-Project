import { HuaweiCapabilities } from '../infrastructure/HuaweiCapabilities';
import { CapabilityPort } from '../domain/Capabilities';
import { ProjectStore } from '../application/ProjectStore';
import { HuaweiProjectFiles } from '../infrastructure/HuaweiProjectFiles';

export class AppServices {
  static capabilities: CapabilityPort = new HuaweiCapabilities();
  static projects: ProjectStore = new ProjectStore(new HuaweiProjectFiles(''));
  static configureFiles(filesDir: string): void {
    AppServices.projects = new ProjectStore(new HuaweiProjectFiles(`${filesDir}/projects`));
  }
}
