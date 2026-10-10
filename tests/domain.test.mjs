import assert from 'node:assert/strict';
import { Segment, Take, Project, compileTimeline, pendingReview, editText, editRange, adoptTake, confirmReview } from '../entry/src/main/ets/domain/Project.ts';

const project = new Project('p', 'source', 10000000);
const segment = new Segment('s', '一句', 2000000, 4000000);
project.segments.push(segment);
assert.equal(pendingReview(project).length, 1);
confirmReview(segment, project.policyVersion, true, true);
assert.equal(pendingReview(project).length, 0);
editText(segment, '修订文字');
assert.equal(pendingReview(project).length, 1);
assert.equal(segment.endUs, 4000000);
const take = new Take('t', 's', segment.rangeRevision, 'replacement', 3000000);
project.takes.push(take);
adoptTake(project, segment, take);
const manifest = compileTimeline(project);
assert.deepEqual(manifest.map(piece => [piece.assetId, piece.startUs, piece.endUs, piece.outputStartUs]), [
  ['source', 0, 2000000, 0], ['replacement', 0, 3000000, 2000000], ['source', 4000000, 10000000, 5000000]
]);
editRange(project, segment, 2000000, 5000000);
assert.equal(segment.selectedTakeId, '');
assert.throws(() => adoptTake(project, segment, take));
assert.throws(() => editRange(project, segment, -1, 4000000));
assert.equal(segment.startUs, 2000000);
assert.deepEqual(compileTimeline(new Project('empty', 'source', 100)), [{ assetId: 'source', startUs: 0, endUs: 100, outputStartUs: 0, fadeInUs: 0, fadeOutUs: 0 }]);
project.policyVersion++;
assert.equal(pendingReview(project).length, 1);
segment.selectedTakeId = take.id;
take.rangeRevision = segment.rangeRevision;
take.assetId = project.sourceAssetId;
assert.throws(() => compileTimeline(project));
console.log('Domain invariants passed: review revisions, immutable source spans, variable duration, stale takes, invalid bounds, empty transcript.');
