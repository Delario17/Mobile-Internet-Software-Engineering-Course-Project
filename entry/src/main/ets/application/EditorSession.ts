import { Cancellation, CapabilityResult, Progress } from '../domain/Capabilities';
import { Project, Segment, Take, RenderPiece, compileTimeline, pendingReview, editText, editRange, splitSegment,
  mergeSegments, addManualSegment, adoptTake, confirmReview } from '../domain/Project';
import { ProjectStorePort, copyProject } from './ProjectStore';
import { AppServices } from '../composition/AppServices';

export class EditorSession {
  project: Project | undefined = undefined;
  selectedSegmentId: string = '';
  busy: boolean = false;
  store: ProjectStorePort = AppServices.projects;
  private history: Project[] = [];
  private auditionedRevision: number = -1;
  private auditionedSegmentId: string = '';
  private idSerial: number = 0;
  private committing: boolean = false;

  async openProject(id: string): Promise<CapabilityResult> {
    if (this.busy) { return this.failure('BUSY', 'operation_busy'); }
    this.busy = true;
    try {
      const restored: Project = await AppServices.projects.restore(id);
      this.project = restored; this.history = []; this.selectedSegmentId = ''; this.invalidateAudition();
      return { ok: true, errorCode: '', messageKey: restored.recoveryWarning ? 'recovery_warning' : '', recoverable: false, project: restored };
    } catch { return this.failure('RESTORE_FAILED', 'restore_failed'); }
    finally { this.busy = false; }
  }
  private generation: number = 0;
  private cancellation: Cancellation = new Cancellation();
  private abort: (() => void) | undefined = undefined;

  async run(operation: string, script: string, progress: (value: Progress) => void,
    auditionTakeId: string = ''): Promise<CapabilityResult> {
    if (this.busy) { return this.failure('BUSY', 'operation_busy'); }
    if (operation === 'export' && this.project && pendingReview(this.project).length > 0) {
      return this.failure('REVIEW_REQUIRED', 'review_required');
    }
    if (!['record', 'recordStart', 'recordPause', 'recordResume', 'recordStop', 'import'].includes(operation) && !this.project) {
      return this.failure('PROJECT_REQUIRED', 'project_required');
    }
    if (['retake', 'auditionSource', 'auditionTake'].includes(operation) && (!this.project || !this.project.segments.some((segment) =>
      segment.id === this.selectedSegmentId))) { return this.failure('SEGMENT_REQUIRED', 'segment_required'); }
    this.busy = true;
    this.cancellation = new Cancellation();
    const generation: number = ++this.generation;
    const targetId: string = this.selectedSegmentId;
    let timer: number = 0;
    let commitSucceeded: boolean = false;
    try {
      const interrupted: Promise<CapabilityResult> = new Promise((resolve) => {
        this.abort = () => resolve(this.failure('CANCELLED', 'operation_cancelled'));
        timer = setTimeout(() => {
          this.cancellation.cancel();
          resolve(this.failure('TIMEOUT', 'operation_timeout'));
        }, 30000);
      });
      const snapshot: Project | undefined = this.project ? copyProject(this.project) : undefined;
      let manifest: RenderPiece[] = snapshot ? compileTimeline(snapshot) : [];
      if (snapshot && operation === 'auditionSource') {
        const segment: Segment = this.segment(snapshot);
        manifest = [{ assetId: snapshot.sourceAssetId, startUs: segment.startUs, endUs: segment.endUs,
          outputStartUs: 0, fadeInUs: 0, fadeOutUs: 0 }];
      }
      if (snapshot && operation === 'auditionTake') {
        const segment: Segment = this.segment(snapshot);
        const take: Take | undefined = snapshot.takes.find((t: Take) => t.id === auditionTakeId);
        if (!take) { return this.failure('INCOMPATIBLE_TAKE', 'invalid_edit'); }
        adoptTake(snapshot, segment, take); // Validates only the detached request, never the current selection.
        manifest = [{ assetId: take.assetId, startUs: 0, endUs: take.durationUs, outputStartUs: 0, fadeInUs: 0, fadeOutUs: 0 }];
      }
      const execution: Promise<CapabilityResult> = AppServices.capabilities.execute({ operation: operation,
        selectedSegmentId: targetId, auditionTakeId: auditionTakeId,
        project: snapshot, manifest: manifest, optionalScript: script },
        this.cancellation, (value: Progress) => {
          if (generation === this.generation && !this.cancellation.cancelled) { progress(value); }
        });
      const result: CapabilityResult = await Promise.race([execution, interrupted]);
      if (result.errorCode === 'TIMEOUT') { return result; }
      if (generation !== this.generation || this.cancellation.cancelled) {
        return this.failure('CANCELLED', 'operation_cancelled');
      }
      if (result.ok && result.project) {
        if (!['record', 'recordStop', 'import', 'recognize', 'retake'].includes(operation)) {
          return this.failure('UNEXPECTED_PROJECT_RESULT', 'operation_failed');
        }
        const candidate: Project = copyProject(result.project);
        const previous: Project | undefined = this.project;
        const createsAsset: boolean = ['record', 'recordStop', 'import', 'retake'].includes(operation);
        clearTimeout(timer); this.abort = undefined; this.committing = true;
        const saved: Project = await this.store.commit(candidate, this.project ? this.project.sequence : 0);
        commitSucceeded = true;
        // The HEAD commit is durable. Never discard an asset after this point.
        this.project = saved;
        let finalizeWarning: boolean = false;
        if (createsAsset && AppServices.capabilities.finalizePendingAsset) {
          try { await AppServices.capabilities.finalizePendingAsset(); } catch { finalizeWarning = true; }
        }
        if (previous && ['recognize', 'retake'].includes(operation)) { this.history.push(copyProject(previous)); }
        else { this.history = []; }
        if (finalizeWarning) { saved.recoveryWarning = true; }
        if (!saved.segments.some((s: Segment) => s.id === targetId)) { this.selectedSegmentId = ''; }
        this.invalidateAudition();
        return { ok: true, errorCode: '', messageKey: saved.recoveryWarning ? 'recovery_warning' : 'saved',
          recoverable: false, project: saved };
      }
      if (result.ok && operation === 'auditionSource' && snapshot) {
        this.auditionedRevision = snapshot.sequence; this.auditionedSegmentId = targetId;
      }
      return result;
    } catch {
      if (this.committing && !commitSucceeded && ['record', 'recordStop', 'import', 'retake'].includes(operation) &&
        AppServices.capabilities.discardPendingAsset) {
        try { await AppServices.capabilities.discardPendingAsset(); } catch { }
      }
      return this.failure(this.committing ? 'SAVE_FAILED' : 'OPERATION_FAILED', this.committing ? 'save_failed' : 'operation_failed');
    } finally {
      clearTimeout(timer);
      this.abort = undefined;
      this.committing = false;
      this.busy = false;
    }
  }
  hasAuditionedSelection(): boolean {
    return this.project !== undefined && this.auditionedRevision === this.project.sequence &&
      this.auditionedSegmentId === this.selectedSegmentId && this.selectedSegmentId !== '';
  }
  private invalidateAudition(): void { this.auditionedRevision = -1; this.auditionedSegmentId = ''; }
  private segment(project: Project): Segment {
    const segment: Segment | undefined = project.segments.find((s: Segment) => s.id === this.selectedSegmentId);
    if (!segment) { throw new Error('SEGMENT_REQUIRED'); }
    return segment;
  }
  private nextId(): string { return `s-${Date.now()}-${++this.idSerial}`; }
  private async edit(change: (candidate: Project) => void, recordHistory: boolean = true): Promise<CapabilityResult> {
    if (this.busy) { return this.failure('BUSY', 'operation_busy'); }
    if (!this.project) { return this.failure('PROJECT_REQUIRED', 'project_required'); }
    this.busy = true;
    const previous: Project = this.project;
    try {
      const candidate: Project = copyProject(previous);
      change(candidate);
      const saved: Project = await this.store.commit(candidate, previous.sequence);
      if (recordHistory) { this.history.push(copyProject(previous)); }
      this.project = saved; this.invalidateAudition();
      if (!saved.segments.some((s: Segment) => s.id === this.selectedSegmentId)) { this.selectedSegmentId = ''; }
      return { ok: true, errorCode: '', messageKey: saved.recoveryWarning ? 'recovery_warning' : 'saved', recoverable: false, project: saved };
    } catch (error) {
      const code: string = error instanceof Error ? error.message : 'SAVE_FAILED';
      const validation: boolean = ['INVALID_RANGE', 'OVERLAPPING_RANGE', 'INVALID_SPLIT', 'INVALID_MERGE',
        'INVALID_SEGMENT_ID', 'INCOMPATIBLE_TAKE', 'SEGMENT_REQUIRED', 'REVIEW_INCOMPLETE'].includes(code);
      return this.failure(code, validation ? 'invalid_edit' : 'save_failed');
    } finally { this.busy = false; }
  }
  changeText(text: string): Promise<CapabilityResult> {
    return this.edit((p: Project) => editText(this.segment(p), text));
  }
  changeRange(startUs: number, endUs: number): Promise<CapabilityResult> {
    return this.edit((p: Project) => editRange(p, this.segment(p), startUs, endUs));
  }
  split(atUs: number, leftText: string, rightText: string): Promise<CapabilityResult> {
    return this.edit((p: Project) => splitSegment(p, this.selectedSegmentId, atUs, this.nextId(), this.nextId(), leftText, rightText));
  }
  mergeNext(): Promise<CapabilityResult> {
    return this.edit((p: Project) => {
      const ordered: Segment[] = p.segments.slice().sort((a: Segment, b: Segment) => a.startUs - b.startUs);
      const index: number = ordered.findIndex((s: Segment) => s.id === this.selectedSegmentId);
      if (index < 0 || index + 1 >= ordered.length) { throw new Error('INVALID_MERGE'); }
      mergeSegments(p, this.selectedSegmentId, ordered[index + 1].id, this.nextId());
    });
  }
  createManual(text: string, startUs: number, endUs: number): Promise<CapabilityResult> {
    return this.edit((p: Project) => addManualSegment(p, this.nextId(), text, startUs, endUs));
  }
  selectTake(id: string): Promise<CapabilityResult> {
    return this.edit((p: Project) => {
      const take: Take | undefined = p.takes.find((t: Take) => t.id === id);
      if (!take) { throw new Error('INCOMPATIBLE_TAKE'); }
      adoptTake(p, this.segment(p), take);
    });
  }
  restoreSource(): Promise<CapabilityResult> {
    return this.edit((p: Project) => { this.segment(p).selectedTakeId = ''; });
  }
  confirmSelected(text: boolean, range: boolean): Promise<CapabilityResult> {
    if (!this.hasAuditionedSelection()) { return Promise.resolve(this.failure('AUDITION_REQUIRED', 'audition_required')); }
    return this.edit((p: Project) => confirmReview(this.segment(p), p.policyVersion, text, range));
  }
  canUndo(): boolean { return this.history.length > 0; }
  async undo(): Promise<CapabilityResult> {
    if (this.history.length === 0) { return this.failure('NOTHING_TO_UNDO', 'nothing_to_undo'); }
    const target: Project = this.history[this.history.length - 1];
    const result: CapabilityResult = await this.edit((p: Project) => {
      const restored: Project = copyProject(target);
      p.segments = restored.segments; p.takes = restored.takes;
    }, false);
    if (result.ok) { this.history.pop(); }
    return result;
  }
  cancel(): void {
    if (this.committing) { return; }
    this.cancellation.cancel(); this.generation++; if (this.abort) { this.abort(); }
  }
  async close(): Promise<void> { this.cancel(); await AppServices.capabilities.release(); }
  private failure(code: string, key: string): CapabilityResult {
    return { ok: false, errorCode: code, messageKey: key, recoverable: true, project: undefined };
  }
}
