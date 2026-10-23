import { EditorSession } from '../application/EditorSession';
import { CapabilityResult, Progress } from '../domain/Capabilities';
import { Project, Segment, Take, pendingReview } from '../domain/Project';
import { AppServices } from '../composition/AppServices';

@Entry
@Component
struct Index {
  private session: EditorSession = new EditorSession();
  @State script: string = '';
  @State optionalOpen: boolean = false;
  @State busy: boolean = false;
  @State message: string = '';
  @State lastOperation: string = '';
  @State retryable: boolean = false;
  @State lastTakeId: string = '';
  @State hasProject: boolean = false;
  @State segments: Segment[] = [];
  @State takes: Take[] = [];
  @State selectedId: string = '';
  @State completed: number = 0;
  @State total: number = 1;
  @State checkedText: boolean = false;
  @State checkedRange: boolean = false;
  @State auditioned: boolean = false;
  @State advanced: boolean = false;
  @State manual: boolean = false;
  @State reviewMode: boolean = false;
  @State pendingCount: number = 0;
  @State undoAvailable: boolean = false;
  @State draftText: string = '';
  @State startSeconds: string = '';
  @State endSeconds: string = '';
  @State splitSeconds: string = '';
  @State leftText: string = '';
  @State rightText: string = '';
  @State projects: Project[] = [];
  @State projectsLoaded: boolean = false;
  @State recordingState: string = 'idle';
  @State retakeState: string = 'idle';
  @State pendingDeleteId: string = '';

  aboutToAppear(): void {
    AppServices.capabilities.setRecorderErrorHandler?.((retake: boolean) => {
      this.recordingState = 'idle'; this.retakeState = 'idle'; this.busy = false;
      this.message = retake ? 'retake_failed' : 'recording_failed';
    });
    this.loadProjects();
  }

  async loadProjects(): Promise<void> {
    if (!this.canEdit()) { return; }
    this.busy = true; this.message = ''; this.lastOperation = '';
    try {
      this.projects = await AppServices.projects.listProjects(); this.projectsLoaded = true;
      if (AppServices.projects.damagedProjectIds.length > 0) { this.message = 'damaged_projects'; }
    }
    catch { this.projectsLoaded = false; this.message = 'restore_failed'; }
    finally { this.busy = false; }
  }

  async openProject(id: string): Promise<void> {
    if (!this.canEdit()) { return; }
    this.busy = true; this.lastOperation = '';
    const result: CapabilityResult = await this.session.openProject(id);
    this.busy = false; this.message = result.messageKey; this.reviewMode = false; this.refresh();
  }

  requestDelete(id: string): void {
    if (this.canEdit()) { this.pendingDeleteId = id; this.message = ''; }
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.canEdit()) { return; }
    this.busy = true; this.message = '';
    try {
      await AppServices.projects.deleteProject(id);
      this.pendingDeleteId = '';
      this.projects = await AppServices.projects.listProjects();
      this.projectsLoaded = true;
      this.message = 'project_deleted';
    } catch {
      this.message = 'project_delete_failed';
    } finally { this.busy = false; }
  }

  aboutToDisappear(): void { this.session.close(); }

  private async returnHome(): Promise<void> {
    if (!this.canEdit()) { return; }
    this.busy = true;
    await this.session.close();
    this.session = new EditorSession();
    this.reviewMode = false; this.manual = false; this.advanced = false;
    this.checkedText = false; this.checkedRange = false;
    this.draftText = ''; this.pendingDeleteId = ''; this.retryable = false;
    this.refresh();
    this.busy = false;
    await this.loadProjects();
  }

  onBackPress(): boolean {
    if (!this.hasProject) { return false; }
    if (!this.canEdit()) { return true; }
    if (this.reviewMode) { this.reviewMode = false; }
    else { this.returnHome(); }
    return true;
  }

  private canEdit(): boolean {
    return !this.busy && this.recordingState === 'idle' && this.retakeState === 'idle';
  }

  private refresh(): void {
    this.hasProject = this.session.project !== undefined;
    this.segments = this.session.project ? this.session.project.segments.slice() : [];
    this.selectedId = this.session.selectedSegmentId;
    this.pendingCount = this.session.project ? pendingReview(this.session.project).length : 0;
    this.takes = this.session.project ? this.session.project.takes.filter((take: Take) => {
      const segment: Segment | undefined = this.segments.find((s: Segment) => s.id === this.selectedId);
      return segment !== undefined && take.segmentId === segment.id && take.rangeRevision === segment.rangeRevision;
    }) : [];
    this.auditioned = this.session.hasAuditionedSelection();
    this.undoAvailable = this.session.canUndo();
  }

  private select(segment: Segment): void {
    if (!this.canEdit()) { return; }
    this.session.selectedSegmentId = segment.id;
    this.draftText = segment.text;
    this.startSeconds = (segment.startUs / 1000000).toString();
    this.endSeconds = (segment.endUs / 1000000).toString();
    this.splitSeconds = ''; this.leftText = ''; this.rightText = '';
    this.manual = false; this.advanced = false;
    this.checkedText = false; this.checkedRange = false;
    this.refresh();
  }

  private microseconds(value: string): number {
    if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(value.trim())) { return -1; }
    const parts: string[] = value.trim().split('.');
    const fraction: string = parts.length === 2 ? parts[1] : '';
    const result: number = Number(parts[0]) * 1000000 + Number((fraction + '000000').slice(0, 6));
    return Number.isSafeInteger(result) ? result : -1;
  }

  async perform(operation: string, takeId: string = ''): Promise<void> {
    if (this.busy) { return; }
    this.lastOperation = operation; this.lastTakeId = takeId; this.retryable = false; this.busy = true; this.message = '';
    this.completed = 0; this.total = 1;
    const result: CapabilityResult = await this.session.run(operation, this.script, (value: Progress) => {
      this.completed = value.completed; this.total = value.total;
    }, takeId);
    if (result.ok && operation === 'recordStart') { this.recordingState = 'recording'; }
    else if (result.ok && operation === 'recordPause') { this.recordingState = 'paused'; }
    else if (result.ok && operation === 'recordResume') { this.recordingState = 'recording'; }
    else if (result.ok && operation === 'recordStop') { this.recordingState = 'idle'; }
    else if (result.ok && operation === 'retakeStart') { this.retakeState = 'recording'; }
    else if (result.ok && operation === 'retakePause') { this.retakeState = 'paused'; }
    else if (result.ok && operation === 'retakeResume') { this.retakeState = 'recording'; }
    else if (result.ok && operation === 'retakeStop') { this.retakeState = 'idle'; }
    else if (!result.ok && operation.startsWith('record')) { this.recordingState = 'idle'; }
    else if (!result.ok && operation.startsWith('retake')) { this.retakeState = 'idle'; }
    this.busy = false; this.message = result.messageKey; this.retryable = !result.ok && result.recoverable; this.refresh();
  }

  async edit(action: string, takeId: string = ''): Promise<void> {
    if (!this.canEdit()) { return; }
    this.busy = true; this.message = ''; this.lastOperation = '';
    let result: CapabilityResult;
    if (action === 'text') { result = await this.session.changeText(this.draftText); }
    else if (action === 'range') {
      result = await this.session.changeRange(this.microseconds(this.startSeconds), this.microseconds(this.endSeconds));
    } else if (action === 'manual') {
      result = await this.session.createManual(this.draftText, this.microseconds(this.startSeconds), this.microseconds(this.endSeconds));
    } else if (action === 'split') {
      result = await this.session.split(this.microseconds(this.splitSeconds), this.leftText, this.rightText);
    } else if (action === 'merge') { result = await this.session.mergeNext(); }
    else if (action === 'take') { result = await this.session.selectTake(takeId); }
    else if (action === 'source') { result = await this.session.restoreSource(); }
    else if (action === 'review') { result = await this.session.confirmSelected(this.checkedText, this.checkedRange); }
    else { result = await this.session.undo(); }
    this.busy = false; this.message = result.messageKey;
    if (result.ok) {
      this.checkedText = false; this.checkedRange = false; this.manual = false;
      if (action === 'undo' && this.session.project) {
        const segment: Segment | undefined = this.session.project.segments.find((s: Segment) => s.id === this.session.selectedSegmentId);
        if (segment) { this.select(segment); }
      }
    }
    this.refresh();
  }

  private exportOrReview(): void {
    if (this.pendingCount > 0) {
      this.reviewMode = true; this.message = 'review_required'; this.lastOperation = '';
      this.session.selectedSegmentId = ''; this.checkedText = false; this.checkedRange = false; this.refresh();
    } else { this.perform('export'); }
  }

  @Builder
  status() {
    if (this.busy) {
      Column({ space: 12 }) {
        Text($r('app.string.processing'))
        Progress({ value: this.completed, total: this.total, type: ProgressType.Linear })
        if (this.lastOperation !== '') { Button($r('app.string.cancel')).onClick(() => this.session.cancel()) }
      }.width('100%').padding(16)
    }
    if (this.message !== '') {
      Column({ space: 12 }) {
        if (this.message === 'capability_unavailable') { Text($r('app.string.capability_unavailable')) }
        else if (this.message === 'render_failed') { Text($r('app.string.render_failed')) }
        else if (this.message === 'export_completed') { Text($r('app.string.export_completed')) }
        else if (this.message === 'asr_existing_edits') { Text($r('app.string.asr_existing_edits')) }
        else if (this.message === 'asr_no_speech') { Text($r('app.string.asr_no_speech')) }
        else if (this.message === 'asr_engine_failed') { Text($r('app.string.asr_engine_failed')) }
        else if (this.message === 'asr_decode_failed') { Text($r('app.string.asr_decode_failed')) }
        else if (this.message === 'asr_audio_too_long') { Text($r('app.string.asr_audio_too_long')) }
        else if (this.message === 'asr_completed') { Text($r('app.string.asr_completed')) }
        else if (this.message === 'operation_busy') { Text($r('app.string.operation_busy')) }
        else if (this.message === 'operation_cancelled') { Text($r('app.string.operation_cancelled')) }
        else if (this.message === 'operation_timeout') { Text($r('app.string.operation_timeout')) }
        else if (this.message === 'review_required') { Text($r('app.string.review_required')) }
        else if (this.message === 'save_failed') { Text($r('app.string.save_failed')) }
        else if (this.message === 'restore_failed') { Text($r('app.string.restore_failed')) }
        else if (this.message === 'damaged_projects') { Text($r('app.string.damaged_projects')) }
        else if (this.message === 'invalid_edit') { Text($r('app.string.invalid_edit')) }
        else if (this.message === 'audition_required') { Text($r('app.string.audition_required')) }
        else if (this.message === 'nothing_to_undo') { Text($r('app.string.nothing_to_undo')) }
        else if (this.message === 'recovery_warning') { Text($r('app.string.recovery_warning')) }
        else if (this.message === 'saved') { Text($r('app.string.saved')) }
        else if (this.message === 'project_deleted') { Text($r('app.string.project_deleted')) }
        else if (this.message === 'project_delete_failed') { Text($r('app.string.project_delete_failed')) }
        else if (this.message === 'recording_started') { Text($r('app.string.recording_started')) }
        else if (this.message === 'recording_paused') { Text($r('app.string.recording_paused')) }
        else if (this.message === 'recording_resumed') { Text($r('app.string.recording_resumed')) }
        else if (this.message === 'microphone_denied') { Text($r('app.string.microphone_denied')) }
        else if (this.message === 'recording_failed') { Text($r('app.string.recording_failed')) }
        else if (this.message === 'import_failed') { Text($r('app.string.import_failed')) }
        else if (this.message === 'imported') { Text($r('app.string.imported')) }
        else if (this.message === 'playback_failed') { Text($r('app.string.playback_failed')) }
        else if (this.message === 'audition_completed') { Text($r('app.string.audition_completed')) }
        else if (this.message === 'retake_started') { Text($r('app.string.retake_started')) }
        else if (this.message === 'retake_paused') { Text($r('app.string.retake_paused')) }
        else if (this.message === 'retake_saved') { Text($r('app.string.saved')) }
        else if (this.message === 'retake_failed') { Text($r('app.string.retake_failed')) }
        else if (this.message === 'retake_too_short') { Text($r('app.string.retake_too_short')) }
        else { Text($r('app.string.operation_failed')) }
        if (this.retryable && this.lastOperation !== '') {
          Button($r('app.string.retry')).enabled(this.canEdit()).onClick(() => this.perform(this.lastOperation, this.lastTakeId))
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding(16)
    }
  }

  @Builder
  rangeFields() {
    Text($r('app.string.source_seconds'))
    TextInput({ placeholder: $r('app.string.start_seconds'), text: this.startSeconds })
      .enabled(this.canEdit()).onChange((value: string) => this.startSeconds = value)
    TextInput({ placeholder: $r('app.string.end_seconds'), text: this.endSeconds })
      .enabled(this.canEdit()).onChange((value: string) => this.endSeconds = value)
  }

  @Builder
  selectedEditor() {
    Text($r('app.string.text_only_notice')).fontColor('#6C746F')
    TextArea({ placeholder: $r('app.string.edit_text'), text: this.draftText }).height(100)
      .enabled(this.canEdit()).onChange((value: string) => this.draftText = value)
    Button($r('app.string.save_text')).height(48).enabled(this.canEdit()).onClick(() => this.edit('text'))
    if (this.retakeState === 'idle') {
      Button($r('app.string.retake')).height(48).enabled(this.canEdit()).onClick(() => this.perform('retakeStart'))
    } else {
      Text(this.retakeState === 'paused' ? $r('app.string.retake_paused') : $r('app.string.retake_started'))
      if (this.retakeState === 'recording') {
        Button($r('app.string.pause_retake')).height(48).enabled(!this.busy).onClick(() => this.perform('retakePause'))
      } else {
        Button($r('app.string.resume_retake')).height(48).enabled(!this.busy).onClick(() => this.perform('retakeResume'))
      }
      Button($r('app.string.finish_retake')).height(48).enabled(!this.busy).onClick(() => this.perform('retakeStop'))
    }
    Button($r('app.string.audition_source')).height(48).enabled(this.canEdit()).onClick(() => this.perform('auditionSource'))
    if (this.reviewMode) {
      Row({ space: 8 }) {
        Checkbox().select(this.checkedText).enabled(this.canEdit()).onChange((value: boolean) => this.checkedText = value)
        Text($r('app.string.confirm_text'))
      }
      Row({ space: 8 }) {
        Checkbox().select(this.checkedRange).enabled(this.auditioned && this.canEdit())
          .onChange((value: boolean) => this.checkedRange = value)
        Text($r('app.string.confirm_range'))
      }
      if (!this.auditioned) { Text($r('app.string.audition_required')) }
      Button($r('app.string.confirm_review')).height(48)
        .enabled(this.checkedText && this.checkedRange && this.auditioned && this.canEdit()).onClick(() => this.edit('review'))
    }
    Text($r('app.string.take_versions')).fontWeight(FontWeight.Medium)
    ForEach(this.takes, (take: Take, index: number) => {
      Column({ space: 8 }) {
        Text($r('app.string.take_number', (index + 1).toString()))
        Button($r('app.string.audition_take')).height(48).enabled(!this.busy)
          .onClick(() => this.perform('auditionTake', take.id))
        Button($r('app.string.adopt_take')).height(48).enabled(this.canEdit()).onClick(() => this.edit('take', take.id))
      }.width('100%').padding(12).backgroundColor('#E7EEEB')
    }, (take: Take) => take.id)
    Button($r('app.string.restore_source')).height(48).enabled(this.canEdit()).onClick(() => this.edit('source'))
    Button($r('app.string.advanced_edit')).height(48).enabled(this.canEdit()).onClick(() => this.advanced = !this.advanced)
    if (this.advanced) {
      Text($r('app.string.range_change_notice'))
      this.rangeFields()
      Button($r('app.string.save_range')).height(48).enabled(this.canEdit()).onClick(() => this.edit('range'))
      TextInput({ placeholder: $r('app.string.split_seconds'), text: this.splitSeconds })
        .enabled(this.canEdit()).onChange((value: string) => this.splitSeconds = value)
      TextInput({ placeholder: $r('app.string.left_text'), text: this.leftText })
        .enabled(this.canEdit()).onChange((value: string) => this.leftText = value)
      TextInput({ placeholder: $r('app.string.right_text'), text: this.rightText })
        .enabled(this.canEdit()).onChange((value: string) => this.rightText = value)
      Button($r('app.string.split_segment')).height(48).enabled(this.canEdit()).onClick(() => this.edit('split'))
      Button($r('app.string.merge_next')).height(48).enabled(this.canEdit()).onClick(() => this.edit('merge'))
    }
  }

  build() {
    Column() {
      if (this.hasProject) {
        Button($r('app.string.back_home')).height(48).margin({ left: 24, top: 8, bottom: 8 })
          .enabled(this.canEdit()).onClick(() => this.returnHome())
      }
    Scroll() {
      Column({ space: 20 }) {
        Text($r('app.string.app_name')).fontSize(28).fontWeight(FontWeight.Bold).fontColor('#167D65')
        if (!this.hasProject) {
          Text($r('app.string.home_title')).fontSize(24).fontWeight(FontWeight.Medium).width('100%')
          if (this.recordingState === 'idle') {
            Button($r('app.string.record_full')).width('100%').height(52).backgroundColor('#167D65')
              .enabled(this.canEdit()).onClick(() => this.perform('recordStart'))
          } else {
            Text(this.recordingState === 'paused' ? $r('app.string.recording_paused') :
              $r('app.string.recording_started')).fontWeight(FontWeight.Medium)
            if (this.recordingState === 'recording') {
              Button($r('app.string.pause_recording')).width('100%').height(52)
                .enabled(!this.busy).onClick(() => this.perform('recordPause'))
            } else {
              Button($r('app.string.resume_recording')).width('100%').height(52)
                .enabled(!this.busy).onClick(() => this.perform('recordResume'))
            }
            Button($r('app.string.finish_recording')).width('100%').height(52).backgroundColor('#B33A3A')
              .enabled(!this.busy).onClick(() => this.perform('recordStop'))
          }
          Button($r('app.string.import_audio')).width('100%').height(52).backgroundColor('#285B82')
            .enabled(this.canEdit()).onClick(() => this.perform('import'))
          Button($r('app.string.optional_inputs')).type(ButtonType.Normal).width('100%')
            .backgroundColor('#E7EEEB').fontColor('#24372E').onClick(() => this.optionalOpen = !this.optionalOpen)
          if (this.optionalOpen) {
            TextArea({ placeholder: $r('app.string.script_placeholder'), text: this.script })
              .height(150).onChange((value: string) => this.script = value)
          }
          Divider()
          Text($r('app.string.projects')).fontSize(20).fontWeight(FontWeight.Medium).width('100%')
          if (this.projectsLoaded && this.projects.length === 0) {
            Text($r('app.string.empty_projects')).fontColor('#6C746F').width('100%')
          }
          ForEach(this.projects, (project: Project) => {
            Column({ space: 8 }) {
              Button($r('app.string.open_project', new Date(project.updatedAtMs).toLocaleString(), (project.sourceDurationUs / 1000000).toFixed(2))).height(52)
                .enabled(this.canEdit()).onClick(() => this.openProject(project.id))
              if (this.pendingDeleteId === project.id) {
                Text($r('app.string.delete_project_confirm')).width('100%').fontColor('#8A2E2E')
                Row({ space: 8 }) {
                  Button($r('app.string.confirm_delete')).height(44).enabled(this.canEdit())
                    .onClick(() => this.deleteProject(project.id))
                  Button($r('app.string.cancel_delete')).height(44).enabled(this.canEdit())
                    .onClick(() => this.pendingDeleteId = '')
                }
              } else {
                Button($r('app.string.delete_project')).height(44).enabled(this.canEdit())
                  .onClick(() => this.requestDelete(project.id))
              }
            }.width('100%').padding(12).backgroundColor('#FFFFFF')
          }, (project: Project) => project.id)
          Button($r('app.string.restore')).height(48).enabled(this.canEdit()).onClick(() => this.loadProjects())
        } else {
          if (this.reviewMode) {
            Text($r('app.string.review_title')).fontSize(24)
            Text($r('app.string.pending_count', this.pendingCount.toString()))
            Button($r('app.string.back_editor')).height(48).enabled(this.canEdit()).onClick(() => this.reviewMode = false)
          } else { Text($r('app.string.editor')).fontSize(24) }
          if (this.segments.length === 0) {
            Text($r('app.string.no_segments'))
            Button($r('app.string.recognize')).height(48).enabled(this.canEdit()).onClick(() => this.perform('recognize'))
          }
          ForEach(this.segments, (segment: Segment) => {
            Column({ space: 8 }) {
              Text(segment.text).width('100%')
              Text($r('app.string.range_value', (segment.startUs / 1000000).toFixed(2), (segment.endUs / 1000000).toFixed(2))).fontSize(14)
              if (segment.id === this.selectedId) { Text($r('app.string.selected_sentence')).fontWeight(FontWeight.Medium) }
              if (segment.reviewedTextRevision !== segment.textRevision || segment.reviewedRangeRevision !== segment.rangeRevision ||
                segment.reviewedPolicyVersion !== this.session.project?.policyVersion || segment.reviewedBy !== 'USER' || segment.reviewedAtMs <= 0) {
                Text($r('app.string.pending_review')).fontSize(14)
              } else { Text($r('app.string.reviewed')).fontSize(14) }
              if (segment.selectedTakeId === '') { Text($r('app.string.using_source')).fontSize(14) }
              else { Text($r('app.string.using_take')).fontSize(14) }
            }.width('100%').padding(16).backgroundColor(this.selectedId === segment.id ? '#D8EDE4' : '#FFFFFF')
              .onClick(() => this.select(segment))
          }, (segment: Segment) => segment.id)
          if (this.selectedId === '') { Text($r('app.string.select_sentence')).fontColor('#6C746F') }
          if (this.selectedId !== '' && !this.manual) { this.selectedEditor() }
          if (!this.reviewMode) {
            Button($r('app.string.manual_segment')).height(48).enabled(this.canEdit()).onClick(() => {
              this.manual = !this.manual;
              this.draftText = ''; this.startSeconds = ''; this.endSeconds = '';
              this.session.selectedSegmentId = ''; this.refresh();
            })
            if (this.manual) {
              TextInput({ placeholder: $r('app.string.edit_text'), text: this.draftText })
                .enabled(this.canEdit()).onChange((value: string) => this.draftText = value)
              this.rangeFields()
              Button($r('app.string.create_segment')).height(48).enabled(this.canEdit()).onClick(() => this.edit('manual'))
            }
          }
          Button($r('app.string.undo')).height(48).enabled(this.undoAvailable && !this.busy).onClick(() => this.edit('undo'))
          Button($r('app.string.preview')).height(48).enabled(this.canEdit()).onClick(() => this.perform('preview'))
          Button($r('app.string.export')).height(48).enabled(this.canEdit()).onClick(() => this.exportOrReview())
        }
        this.status()
      }.width('100%').alignItems(HorizontalAlign.Start).padding(24)
    }.width('100%').layoutWeight(1)
    }.width('100%').height('100%').alignItems(HorizontalAlign.Start).backgroundColor('#F6F8F7')
  }
}
