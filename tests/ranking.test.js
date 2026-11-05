import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonRanking } from '../lib/ranking.js';

test('only best six tournaments in the requested season count',()=>{
  const tournaments=Array.from({length:8},(_,i)=>({id:'t'+i,startAt:i===7?'2026-01-01':'2027-01-01',status:'COMPLETED'}));
  const events=tournaments.map((t,i)=>({id:'e'+i,tournamentId:t.id,athleteUserId:'a',type:'GOLD',matchId:'m'+i,finalPoints:(i+1)*10}));
  const [r]=seasonRanking(events,tournaments,'2027');
  assert.equal(r.points,270);assert.equal(r.countedTournaments,6);assert.equal(r.totalTournaments,7);
});
test('duplicates and participation farming cannot inflate the score',()=>{
  const tournaments=[{id:'t',startAt:'2027-01-01'}];
  const events=[{id:'1',athleteUserId:'a',tournamentId:'t',type:'PARTICIPATION',finalPoints:100},{id:'2',athleteUserId:'a',tournamentId:'t',type:'PARTICIPATION',finalPoints:5},...Array.from({length:2},(_,i)=>({id:'w'+i,athleteUserId:'a',tournamentId:'t',type:'WIN',matchId:'m',finalPoints:10}))];
  const [r]=seasonRanking(events,tournaments);assert.equal(r.points,15);assert.equal(r.wins,1);
});
test('equal points share rank; canceled and voided results are excluded',()=>{
  const tournaments=[{id:'t',startAt:'2027-01-01'},{id:'c',startAt:'2027-01-01',status:'CANCELED'}];
  const events=['a','b','c'].map((id,i)=>({id,athleteUserId:id,tournamentId:'t',type:'WIN',matchId:'m',finalPoints:i===2?5:10}));
  events.push({id:'bad',athleteUserId:'a',tournamentId:'c',type:'WIN',finalPoints:100});
  events.push({id:'void',athleteUserId:'a',tournamentId:'t',type:'WIN',matchId:'v',finalPoints:100,voidedAt:'2027-01-01'});
  assert.deepEqual(seasonRanking(events,tournaments).map(r=>r.rank),[1,1,3]);
});
