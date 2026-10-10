import { Project, RenderPiece } from './Project';

export class Cancellation {
  cancelled: boolean = false;
  cancel(): void { this.cancelled = true; }
}
export interface Progress { completed: number; total: number; }
export interface CapabilityRequest {
  operation: string;
  selectedSegmentId: string;
  project: Project | undefined;
  manifest: RenderPiece[];
  optionalScript: string;
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
  release(): Promise<void>;
}
