import { Project, Segment, Take, compileTimeline } from '../domain/Project';

// P1-FR-019/020: only the device adapter may access the private project directory.
export interface ProjectFiles {
  read(path: string): Promise<string | undefined>;
  write(path: string, text: string): Promise<void>;
  // Ensure destination parent exists; replace atomically within the same private filesystem.
  rename(from: string, to: string): Promise<void>;
  list(folder: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export interface ProjectStorePort {
  commit(project: Project, expectedSequence: number): Promise<Project>;
}

function validId(id: string): boolean { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id); }
function integer(value: number, minimum: number): boolean { return Number.isSafeInteger(value) && value >= minimum; }

// Explicit trust-boundary validation; never publish objects returned directly by JSON.parse.
export function decodeProject(text: string): Project {
  const raw: Project = JSON.parse(text) as Project;
  if (!raw || raw.schemaVersion !== 1 || !integer(raw.updatedAtMs, 0) ||
    !validId(raw.id) || !validId(raw.sourceAssetId) || !integer(raw.sequence, 0) ||
    !integer(raw.sourceDurationUs, 1) || !integer(raw.policyVersion, 1) || !integer(raw.dspProfileVersion, 1) ||
    !Array.isArray(raw.segments) || !Array.isArray(raw.takes)) { throw new Error('INVALID_PROJECT'); }
  const result: Project = new Project(raw.id, raw.sourceAssetId, raw.sourceDurationUs);
  result.sequence = raw.sequence; result.updatedAtMs = raw.updatedAtMs;
  result.policyVersion = raw.policyVersion; result.dspProfileVersion = raw.dspProfileVersion;
  for (const value of raw.segments) {
    if (!value || !validId(value.id) || typeof value.text !== 'string' ||
      !integer(value.textRevision, 1) || !integer(value.rangeRevision, 1) ||
      !integer(value.reviewedTextRevision, 0) || !integer(value.reviewedRangeRevision, 0) ||
      value.reviewedTextRevision > value.textRevision || value.reviewedRangeRevision > value.rangeRevision ||
      !integer(value.reviewedPolicyVersion, 0) || !integer(value.reviewedAtMs, 0) ||
      (value.reviewedBy !== '' && value.reviewedBy !== 'USER') ||
      typeof value.selectedTakeId !== 'string' || (value.selectedTakeId !== '' && !validId(value.selectedTakeId)) ||
      !Array.isArray(value.ancestorIds) || !value.ancestorIds.every((id: string) => validId(id)) ||
      result.segments.some((s: Segment) => s.id === value.id)) { throw new Error('INVALID_PROJECT'); }
    const segment: Segment = new Segment(value.id, value.text, value.startUs, value.endUs);
    segment.textRevision = value.textRevision; segment.rangeRevision = value.rangeRevision;
    segment.reviewedTextRevision = value.reviewedTextRevision; segment.reviewedRangeRevision = value.reviewedRangeRevision;
    segment.reviewedPolicyVersion = value.reviewedPolicyVersion; segment.reviewedAtMs = value.reviewedAtMs;
    segment.reviewedBy = value.reviewedBy; segment.selectedTakeId = value.selectedTakeId;
    segment.ancestorIds = value.ancestorIds.slice(); result.segments.push(segment);
  }
  for (const value of raw.takes) {
    if (!value || !validId(value.id) || !validId(value.segmentId) || !validId(value.assetId) ||
      value.assetId === raw.sourceAssetId || !integer(value.rangeRevision, 1) || !integer(value.durationUs, 1) ||
      result.takes.some((t: Take) => t.id === value.id)) { throw new Error('INVALID_PROJECT'); }
    result.takes.push(new Take(value.id, value.segmentId, value.rangeRevision, value.assetId, value.durationUs));
  }
  compileTimeline(result);
  return result;
}

export function copyProject(project: Project): Project { return decodeProject(JSON.stringify(project)); }

interface RevisionPointer { sequence: number; file: string; checksum: string; }

// Accidental corruption detection only; not a cryptographic asset/state authenticity claim.
function checksum(text: string): string {
  let value: number = 2166136261;
  for (let index: number = 0; index < text.length; index++) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return (value >>> 0).toString(16);
}

export class ProjectStore implements ProjectStorePort {
  damagedProjectIds: string[] = [];
  // ponytail: one queue per store; one app-owned store is required, cross-process writers unsupported.
  private queue: Promise<void> = Promise.resolve();
  private serial: number = 0;
  private files: ProjectFiles;
  constructor(files: ProjectFiles) { this.files = files; }

  commit(project: Project, expectedSequence: number): Promise<Project> {
    const snapshot: Project = copyProject(project);
    const operation: Promise<Project> = this.queue.then(() => this.commitLocked(snapshot, expectedSequence));
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  private async commitLocked(project: Project, expectedSequence: number): Promise<Project> {
    if (!integer(expectedSequence, 0) || expectedSequence >= Number.MAX_SAFE_INTEGER) { throw new Error('REVISION_CONFLICT'); }
    const current: Project | undefined = await this.load(project.id);
    if ((current ? current.sequence : 0) !== expectedSequence || project.sequence !== expectedSequence) {
      throw new Error('REVISION_CONFLICT');
    }
    if (current && (current.sourceAssetId !== project.sourceAssetId || current.sourceDurationUs !== project.sourceDurationUs)) {
      throw new Error('SOURCE_IMMUTABLE');
    }
    project.sequence = expectedSequence + 1;
    project.updatedAtMs = Date.now();
    const token: string = `${project.sequence}-${Date.now()}-${++this.serial}-${Math.random().toString(16).slice(2)}`;
    const serialized: string = JSON.stringify(project);
    const pointer: RevisionPointer = { sequence: project.sequence, file: `revision-${token}.json`, checksum: checksum(serialized) };
    const revision: string = `${project.id}/revisions/${pointer.file}`;
    const temporary: string = `${project.id}/staging/${token}`;
    await this.files.write(temporary, serialized);
    await this.files.rename(temporary, revision);
    const head: string = `${project.id}/staging/head-${token}`;
    await this.files.write(head, JSON.stringify(pointer));
    await this.files.rename(head, `${project.id}/HEAD`); // Commit point: never report rollback after this succeeds.
    try {
      await this.files.write(`${project.id}/staging/receipt-${token}`, JSON.stringify(pointer));
      await this.files.rename(`${project.id}/staging/receipt-${token}`, `${project.id}/receipts/${pointer.file}`);
    } catch {
      // HEAD is committed. Surface reduced fallback coverage instead of claiming the edit failed.
      project.recoveryWarning = true;
    }
    return project;
  }

  async restore(id: string): Promise<Project> {
    await this.queue;
    const project: Project | undefined = await this.load(id);
    if (!project) { throw new Error('PROJECT_NOT_FOUND'); }
    return project;
  }

  deleteProject(id: string): Promise<void> {
    if (!validId(id)) { return Promise.reject(new Error('INVALID_PROJECT')); }
    const operation: Promise<void> = this.queue.then(() => this.files.remove(id));
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  private async fromPointer(id: string, text: string | undefined): Promise<Project | undefined> {
    if (text === undefined) { return undefined; }
    let pointer: RevisionPointer;
    try { pointer = JSON.parse(text) as RevisionPointer; } catch { return undefined; }
    if (!pointer || !integer(pointer.sequence, 1) || typeof pointer.file !== 'string' ||
      !/^revision-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+\.json$/.test(pointer.file) ||
      typeof pointer.checksum !== 'string') { return undefined; }
    const revision: string | undefined = await this.files.read(`${id}/revisions/${pointer.file}`);
    if (!revision || checksum(revision) !== pointer.checksum) { return undefined; }
    let project: Project;
    try { project = decodeProject(revision); } catch { return undefined; }
    return project.id === id && project.sequence === pointer.sequence ? project : undefined;
  }

  private async load(id: string): Promise<Project | undefined> {
    if (!validId(id)) { throw new Error('INVALID_PROJECT'); }
    const rawHead: string | undefined = await this.files.read(`${id}/HEAD`);
    const head: Project | undefined = await this.fromPointer(id, rawHead);
    if (head) { return head; }
    let latest: Project | undefined = undefined;
    const receipts: string[] = await this.files.list(`${id}/receipts`);
    for (const file of receipts) {
      if (!/^revision-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+\.json$/.test(file)) { continue; }
      const committed: Project | undefined = await this.fromPointer(id, await this.files.read(`${id}/receipts/${file}`));
      if (committed && (!latest || committed.sequence > latest.sequence)) { latest = committed; }
    }
    if (!latest && (rawHead !== undefined || receipts.length > 0)) { throw new Error('INVALID_PROJECT'); }
    if (latest) { latest.recoveryWarning = true; }
    return latest;
  }

  async listProjects(): Promise<Project[]> {
    await this.queue;
    const projects: Project[] = [];
    const damaged: string[] = [];
    for (const id of await this.files.list('')) {
      if (!validId(id)) { continue; }
      try {
        const project: Project | undefined = await this.load(id);
        if (project) { projects.push(project); }
      } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_PROJECT') { damaged.push(id); }
        else { throw error; }
      }
    }
    this.damagedProjectIds = damaged;
    return projects.sort((a: Project, b: Project) => b.updatedAtMs - a.updatedAtMs);
  }
}
