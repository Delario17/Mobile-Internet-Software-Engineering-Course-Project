import { Cancellation, CapabilityResult, Progress } from '../domain/Capabilities';
import { Project, compileTimeline, pendingReview } from '../domain/Project';
import { AppServices } from '../composition/AppServices';

export class EditorSession {
  project: Project | undefined = undefined;
  selectedSegmentId: string = '';
  busy: boolean = false;
  private generation: number = 0;
  private cancellation: Cancellation = new Cancellation();
  private abort: (() => void) | undefined = undefined;

  async run(operation: string, script: string, progress: (value: Progress) => void): Promise<CapabilityResult> {
    if (this.busy) { return this.failure('BUSY', 'operation_busy'); }
    if (operation === 'export' && this.project && pendingReview(this.project).length > 0) {
      return this.failure('REVIEW_REQUIRED', 'review_required');
    }
    if (operation !== 'record' && operation !== 'import' && operation !== 'restore' && !this.project) {
      return this.failure('PROJECT_REQUIRED', 'project_required');
    }
    if (operation === 'retake' && (!this.project || !this.project.segments.some((segment) =>
      segment.id === this.selectedSegmentId))) { return this.failure('SEGMENT_REQUIRED', 'segment_required'); }
    this.busy = true;
    this.cancellation = new Cancellation();
    const generation: number = ++this.generation;
    let timer: number = 0;
    try {
      const interrupted: Promise<CapabilityResult> = new Promise((resolve) => {
        this.abort = () => resolve(this.failure('CANCELLED', 'operation_cancelled'));
        timer = setTimeout(() => {
          this.cancellation.cancel();
          resolve(this.failure('TIMEOUT', 'operation_timeout'));
        }, 30000);
      });
      const execution: Promise<CapabilityResult> = AppServices.capabilities.execute({ operation: operation,
        selectedSegmentId: this.selectedSegmentId,
        project: this.project, manifest: this.project ? compileTimeline(this.project) : [], optionalScript: script },
        this.cancellation, (value: Progress) => {
          if (generation === this.generation && !this.cancellation.cancelled) { progress(value); }
        });
      const result: CapabilityResult = await Promise.race([execution, interrupted]);
      if (result.errorCode === 'TIMEOUT') { return result; }
      if (generation !== this.generation || this.cancellation.cancelled) {
        return this.failure('CANCELLED', 'operation_cancelled');
      }
      if (result.ok && result.project) { this.project = result.project; }
      return result;
    } catch {
      return this.failure('OPERATION_FAILED', 'operation_failed');
    } finally {
      clearTimeout(timer);
      this.abort = undefined;
      this.busy = false;
    }
  }
  cancel(): void { this.cancellation.cancel(); this.generation++; if (this.abort) { this.abort(); } }
  async close(): Promise<void> { this.cancel(); await AppServices.capabilities.release(); }
  private failure(code: string, key: string): CapabilityResult {
    return { ok: false, errorCode: code, messageKey: key, recoverable: true, project: undefined };
  }
}
