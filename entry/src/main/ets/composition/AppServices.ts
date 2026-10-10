import { HuaweiCapabilities } from '../infrastructure/HuaweiCapabilities';
import { CapabilityPort } from '../domain/Capabilities';

export class AppServices {
  static capabilities: CapabilityPort = new HuaweiCapabilities();
}
