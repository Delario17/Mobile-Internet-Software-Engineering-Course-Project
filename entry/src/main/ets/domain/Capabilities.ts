import { Project, RenderPiece } from './Project';

export class Cancellation {
  cancelled: boolean = false;
  cancel(): void { this.cancelled = true; }
}
export interface Progress { completed: number; total: number; }
export interface CapabilityRequest {
  operation: string;
  selectedSegmentId: string;
  auditionTakeId: string;
  project: Project | undefined;
  manifest: RenderPiece[];
  optionalScript: string;
  importUri?: string;
}
export interface CapabilityResult {
  ok: boolean;
  errorCode: string;
  messageKey: string;
  recoverable: boolean;
  project: Project | undefined;
}
export interface CapabilityPort {
  execute(request: CapabilityRequest, cancellation: Cancellation,
    progress: (value: Progress) => void): Promise<CapabilityResult>;
  /** Finalize an asset only after its owning project has been durably committed. */
  finalizePendingAsset?(): Promise<void>;
  /** Remove an asset created by a failed project commit. */
  discardPendingAsset?(): Promise<void>;
  setRecorderErrorHandler?(handler: (retake: boolean) => void): void;
  release(): Promise<void>;
}
