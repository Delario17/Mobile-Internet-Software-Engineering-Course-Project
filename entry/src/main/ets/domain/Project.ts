// P1-FR-009/010/013/014: source coordinates never change when a take is adopted.
export class Segment {
  id: string;
  text: string;
  startUs: number;
  endUs: number;
  textRevision: number = 1;
  rangeRevision: number = 1;
  reviewedTextRevision: number = 0;
  reviewedRangeRevision: number = 0;
  reviewedPolicyVersion: number = 0;
  reviewedAtMs: number = 0;
  reviewedBy: string = '';
  selectedTakeId: string = '';
  constructor(id: string, text: string, startUs: number, endUs: number) {
    this.id = id; this.text = text; this.startUs = startUs; this.endUs = endUs;
  }
}

export class Take {
  id: string;
  segmentId: string;
  rangeRevision: number;
  assetId: string;
  durationUs: number;
  constructor(id: string, segmentId: string, rangeRevision: number, assetId: string, durationUs: number) {
    this.id = id; this.segmentId = segmentId; this.rangeRevision = rangeRevision;
    this.assetId = assetId; this.durationUs = durationUs;
  }
}

export class Project {
  id: string;
  sourceAssetId: string;
  sourceDurationUs: number;
  policyVersion: number = 1;
  dspProfileVersion: number = 1;
  segments: Segment[] = [];
  takes: Take[] = [];
  constructor(id: string, sourceAssetId: string, sourceDurationUs: number) {
    this.id = id; this.sourceAssetId = sourceAssetId; this.sourceDurationUs = sourceDurationUs;
  }
}

export interface RenderPiece {
  assetId: string;
  startUs: number;
  endUs: number;
  outputStartUs: number;
  fadeInUs: number;
  fadeOutUs: number;
}

export function pendingReview(project: Project): Segment[] {
  return project.segments.filter((s: Segment) => s.reviewedTextRevision !== s.textRevision ||
    s.reviewedRangeRevision !== s.rangeRevision || s.reviewedPolicyVersion !== project.policyVersion ||
    s.reviewedBy !== 'USER' || s.reviewedAtMs <= 0);
}

export function confirmReview(segment: Segment, policyVersion: number, text: boolean, range: boolean): void {
  if (!text || !range) { throw new Error('REVIEW_INCOMPLETE'); }
  segment.reviewedTextRevision = segment.textRevision;
  segment.reviewedRangeRevision = segment.rangeRevision;
  segment.reviewedPolicyVersion = policyVersion;
  segment.reviewedBy = 'USER'; segment.reviewedAtMs = Date.now();
}

export function editText(segment: Segment, text: string): void {
  if (text !== segment.text) { segment.text = text; segment.textRevision++; }
}

export function editRange(project: Project, segment: Segment, startUs: number, endUs: number): void {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs) || startUs < 0 ||
    endUs <= startUs || endUs > project.sourceDurationUs) { throw new Error('INVALID_RANGE'); }
  for (const other of project.segments) {
    if (other.id !== segment.id && startUs < other.endUs && endUs > other.startUs) {
      throw new Error('OVERLAPPING_RANGE');
    }
  }
  if (startUs !== segment.startUs || endUs !== segment.endUs) {
    segment.startUs = startUs; segment.endUs = endUs; segment.rangeRevision++; segment.selectedTakeId = '';
  }
}

export function adoptTake(project: Project, segment: Segment, take: Take): void {
  if (!project.takes.includes(take) || take.segmentId !== segment.id || take.rangeRevision !== segment.rangeRevision ||
    !Number.isSafeInteger(take.durationUs) || take.durationUs <= 0 || take.assetId === '' || take.assetId === project.sourceAssetId) {
    throw new Error('INCOMPATIBLE_TAKE');
  }
  segment.selectedTakeId = take.id;
}

// P1-FR-014/016/017/018: one manifest preserves all uncovered source audio.
export function compileTimeline(project: Project): RenderPiece[] {
  if (project.sourceAssetId === '' || !Number.isSafeInteger(project.sourceDurationUs) || project.sourceDurationUs <= 0) {
    throw new Error('INVALID_SOURCE');
  }
  const result: RenderPiece[] = [];
  let cursor: number = 0;
  let output: number = 0;
  const ordered: Segment[] = project.segments.slice().sort((a: Segment, b: Segment) => a.startUs - b.startUs);
  for (const segment of ordered) {
    if (!Number.isSafeInteger(segment.startUs) || !Number.isSafeInteger(segment.endUs) ||
      segment.startUs < cursor || segment.endUs <= segment.startUs || segment.endUs > project.sourceDurationUs) {
      throw new Error('INVALID_RANGE');
    }
    if (segment.startUs > cursor) {
      result.push({ assetId: project.sourceAssetId, startUs: cursor, endUs: segment.startUs, outputStartUs: output, fadeInUs: 0, fadeOutUs: 0 });
      output += segment.startUs - cursor;
    }
    const take: Take | undefined = project.takes.find((t: Take) => t.id === segment.selectedTakeId);
    if (segment.selectedTakeId !== '' && (!take || take.segmentId !== segment.id || take.rangeRevision !== segment.rangeRevision ||
      !Number.isSafeInteger(take.durationUs) || take.durationUs <= 0 || take.assetId === '' ||
      take.assetId === project.sourceAssetId)) { throw new Error('INCOMPATIBLE_TAKE'); }
    const duration: number = take ? take.durationUs : segment.endUs - segment.startUs;
    const fade: number = take ? Math.min(10000, Math.floor(duration / 2)) : 0;
    result.push({ assetId: take ? take.assetId : project.sourceAssetId, startUs: take ? 0 : segment.startUs,
      endUs: take ? take.durationUs : segment.endUs, outputStartUs: output, fadeInUs: fade, fadeOutUs: fade });
    output += duration; cursor = segment.endUs;
  }
  if (cursor < project.sourceDurationUs) {
    result.push({ assetId: project.sourceAssetId, startUs: cursor, endUs: project.sourceDurationUs, outputStartUs: output, fadeInUs: 0, fadeOutUs: 0 });
  }
  return result;
}
