require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EditorSession } = require('../entry/src/main/ets/application/EditorSession.ts');
const { AppServices } = require('../entry/src/main/ets/composition/AppServices.ts');
const { Project, Segment, Take } = require('../entry/src/main/ets/domain/Project.ts');
test('playback deadlines cover actual duration; picker allows user selection beyond 30s', async () => {
 const session=new EditorSession();session.project=new Project('p','source',90000000);
 session.project.segments.push(new Segment('s','long sentence',1000000,81000000));session.selectedSegmentId='s';
 session.project.takes.push(new Take('t','s',1,'take',65000000));
 AppServices.capabilities={async execute(){return {ok:true,messageKey:'audition_completed'};},async release(){}};
 const original=global.setTimeout;let limit;
 global.setTimeout=(fn,ms)=>{limit=ms;return original(fn,ms)};
 try {
  await session.run('auditionSource','',()=>{});assert(limit>=95000);
  await session.run('auditionTake','',()=>{},'t');assert(limit>=80000);
  await session.run('import','',()=>{});assert(limit>=600000);
 } finally {global.setTimeout=original;}
});
