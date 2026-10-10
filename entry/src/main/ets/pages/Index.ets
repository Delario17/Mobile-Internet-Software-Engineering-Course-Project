import { EditorSession } from '../application/EditorSession';
import { CapabilityResult, Progress } from '../domain/Capabilities';
import { Segment, confirmReview } from '../domain/Project';

@Entry
@Component
struct Index {
  private session: EditorSession = new EditorSession();
  @State script: string = '';
  @State optionalOpen: boolean = false;
  @State busy: boolean = false;
  @State message: string = '';
  @State lastOperation: string = '';
  @State hasProject: boolean = false;
  @State segments: Segment[] = [];
  @State selectedId: string = '';
  @State completed: number = 0;
  @State total: number = 1;
  @State checkedText: boolean = false;
  @State checkedRange: boolean = false;

  confirmSelected(): void {
    if (!this.session.project) { return; }
    const segment: Segment | undefined = this.session.project.segments.find((item: Segment) => item.id === this.selectedId);
    if (!segment) { return; }
    confirmReview(segment, this.session.project.policyVersion, this.checkedText, this.checkedRange);
    this.message = 'unsaved_review';
    this.checkedText = false; this.checkedRange = false;
  }

  aboutToDisappear(): void { this.session.close(); }

  async perform(operation: string): Promise<void> {
    this.lastOperation = operation;
    this.busy = true;
    this.message = '';
    const result: CapabilityResult = await this.session.run(operation, this.script, (value: Progress) => {
      this.completed = value.completed; this.total = value.total;
    });
    this.busy = false;
    if (!result.ok) { this.message = result.messageKey; }
    this.hasProject = this.session.project !== undefined;
    this.segments = this.session.project ? this.session.project.segments.slice() : [];
  }

  @Builder
  status() {
    if (this.busy) {
      Column({ space: 12 }) {
        Text($r('app.string.processing')).fontSize(16)
        Progress({ value: this.completed, total: this.total, type: ProgressType.Linear })
        Button($r('app.string.cancel')).onClick(() => this.session.cancel())
      }.width('100%').padding(16)
    }
    if (this.message !== '') {
      Column({ space: 12 }) {
        if (this.message === 'capability_unavailable') {
          Text($r('app.string.capability_unavailable')).fontColor('#A33B35')
        } else if (this.message === 'operation_cancelled') {
          Text($r('app.string.operation_cancelled'))
        } else if (this.message === 'review_required') {
          Text($r('app.string.review_required'))
        } else if (this.message === 'unsaved_review') {
          Text($r('app.string.unsaved_review'))
        } else if (this.message === 'operation_timeout') {
          Text($r('app.string.operation_timeout'))
        } else {
          Text($r('app.string.operation_failed'))
        }
        if (this.message !== 'unsaved_review') {
          Button($r('app.string.retry')).enabled(!this.busy).onClick(() => this.perform(this.lastOperation))
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding(16)
    }
  }

  build() {
    Scroll() {
      Column({ space: 24 }) {
        Text($r('app.string.app_name')).fontSize(28).fontWeight(FontWeight.Bold).fontColor('#167D65')
        if (!this.hasProject) {
          Text($r('app.string.home_title')).fontSize(24).fontWeight(FontWeight.Medium).width('100%')
          Column({ space: 12 }) {
            Button($r('app.string.record_full')).width('100%').height(52).backgroundColor('#167D65')
              .enabled(!this.busy).onClick(() => this.perform('record'))
            Button($r('app.string.import_audio')).width('100%').height(52).backgroundColor('#285B82')
              .enabled(!this.busy).onClick(() => this.perform('import'))
          }.width('100%')
          Button($r('app.string.optional_inputs')).type(ButtonType.Normal).width('100%')
            .backgroundColor('#E7EEEB').fontColor('#24372E').onClick(() => this.optionalOpen = !this.optionalOpen)
          if (this.optionalOpen) {
            TextArea({ placeholder: $r('app.string.script_placeholder'), text: this.script })
              .height(150).onChange((value: string) => this.script = value)
          }
          Divider()
          Text($r('app.string.projects')).fontSize(20).fontWeight(FontWeight.Medium).width('100%')
          Text($r('app.string.empty_projects')).fontColor('#6C746F').width('100%')
          Button($r('app.string.restore')).enabled(!this.busy).onClick(() => this.perform('restore'))
        } else {
          Text($r('app.string.editor')).fontSize(24).width('100%')
          if (this.segments.length === 0) {
            Text($r('app.string.no_segments'))
            Button($r('app.string.recognize')).enabled(!this.busy).onClick(() => this.perform('recognize'))
          }
          ForEach(this.segments, (segment: Segment) => {
            Text(segment.text).width('100%').padding(16)
              .backgroundColor(this.selectedId === segment.id ? '#D8EDE4' : '#FFFFFF')
              .onClick(() => {
                this.selectedId = segment.id; this.session.selectedSegmentId = segment.id;
                this.checkedText = false; this.checkedRange = false;
              })
          }, (segment: Segment) => segment.id)
          if (this.selectedId === '') { Text($r('app.string.select_sentence')).fontColor('#6C746F') }
          if (this.selectedId !== '') {
            Row({ space: 8 }) {
              Checkbox().select(this.checkedText).onChange((value: boolean) => this.checkedText = value)
              Text($r('app.string.confirm_text'))
            }
            Row({ space: 8 }) {
              Checkbox().select(this.checkedRange).onChange((value: boolean) => this.checkedRange = value)
              Text($r('app.string.confirm_range'))
            }
            Button($r('app.string.confirm_review')).enabled(this.checkedText && this.checkedRange && !this.busy)
              .onClick(() => this.confirmSelected())
          }
          Button($r('app.string.retake')).enabled(this.selectedId !== '' && !this.busy)
            .onClick(() => this.perform('retake'))
          Button($r('app.string.preview')).enabled(!this.busy).onClick(() => this.perform('preview'))
          Button($r('app.string.export')).enabled(!this.busy).onClick(() => this.perform('export'))
        }
        this.status()
      }.width('100%').alignItems(HorizontalAlign.Start).padding(24)
    }.width('100%').height('100%').backgroundColor('#F6F8F7')
  }
}
