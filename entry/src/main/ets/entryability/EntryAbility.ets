import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { AppServices } from '../composition/AppServices';

export default class EntryAbility extends UIAbility {
  onCreate(): void {
    AppServices.configureFiles(this.context.filesDir);
  }
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.loadContent('pages/Index', () => { });
  }
}
