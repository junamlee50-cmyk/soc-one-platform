import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleError} from '../lib/scheduling.js';
const first={id:'first',tournamentId:'t',matNo:1,scheduledAt:'2027-01-01T01:00:00Z',scheduledEndAt:'2027-01-01T01:10:00Z',athleteA:{userId:'a'},athleteB:{userId:'b'}};
test('mat overlaps and cross-mat athlete overlaps are rejected; adjacent slots work',()=>{
 const candidate={...first,id:'second',athleteA:{userId:'c'},athleteB:{userId:'d'}};
 assert.equal(scheduleError(candidate,[first]),'mat_schedule_conflict');
 assert.equal(scheduleError({...candidate,matNo:2,athleteA:{userId:'a'}},[first]),'athlete_schedule_conflict');
 assert.equal(scheduleError({...candidate,scheduledAt:first.scheduledEndAt,scheduledEndAt:'2027-01-01T01:20:00Z'},[first]),null);
});
test('later rounds cannot start before feeders or hide possible-player conflicts',()=>{
 const final={...first,id:'final',matNo:2,athleteA:null,athleteB:null,sourceMatchA:'first'};
 assert.equal(scheduleError(final,[first]),'previous_round_schedule_required');
 const later={...final,scheduledAt:first.scheduledEndAt,scheduledEndAt:'2027-01-01T01:20:00Z'};
 const another={...first,id:'other',tournamentId:'other-event',scheduledAt:later.scheduledAt,scheduledEndAt:later.scheduledEndAt};
 assert.equal(scheduleError(later,[first,another]),'athlete_schedule_conflict');
});
