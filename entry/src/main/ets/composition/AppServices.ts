import { HuaweiCapabilities } from '../infrastructure/HuaweiCapabilities';
import { CapabilityPort } from '../domain/Capabilities';
import { ProjectStore } from '../application/ProjectStore';
import { HuaweiProjectFiles } from '../infrastructure/HuaweiProjectFiles';
import { Context } from '@kit.AbilityKit';

export class AppServices {
  static capabilities: CapabilityPort = new HuaweiCapabilities();
  static projects: ProjectStore = new ProjectStore(new HuaweiProjectFiles(''));
  static configureDevice(context: Context, filesDir: string): void {
    AppServices.capabilities = new HuaweiCapabilities(context, filesDir);
    AppServices.projects = new ProjectStore(new HuaweiProjectFiles(`${filesDir}/projects`));
  }
}
