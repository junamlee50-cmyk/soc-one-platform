import { TEST_RULES } from './helpers/rules.js';
import { test, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const realPostgres=Boolean(process.env.TEST_DATABASE_URL);
let local,tail=Promise.resolve(),failPath=null;
if(!realPostgres){
  const { PGlite }=await import('@electric-sql/pglite');local=new PGlite();
  class Pool {
    async connect(){
      const previous=tail;let unlock;tail=new Promise(r=>unlock=r);await previous;
      return {async query(sql,args){if(failPath&&String(sql).startsWith('INSERT INTO soc_records')&&args?.[0]?.startsWith(failPath)){failPath=null;throw new Error('injected-storage-failure');}return !args?.length&&String(sql).includes(';')?(await local.exec(sql)).at(-1):local.query(sql,args);},release:unlock};
    }
    async query(sql,args){const c=await this.connect();try{return await c.query(sql,args)}finally{c.release()}}
    async end(){}
  }
  mock.module('pg',{defaultExport:{Pool}});
}
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL||'postgresql://unused-local-test';
process.env.SOC_DATA_BACKEND='postgres';
const { query, inTransaction, closePool }=await import('../lib/database.js');
const { putJson, getJson, listJson, hash }=await import('../lib/blobdb.js');
const member=(await import('../api/member.js')).default;
const ops=(await import('../api/ops.js')).default;
await query(await readFile(new URL('../db/migrations/001_operational_records.sql',import.meta.url),'utf8'));
const seed=(path,value)=>putJson(path,value);
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},end(){return this}});
async function call(handler,op,userId,body={},method='POST'){
 const res=response();await handler({method,query:{op},body,headers:{host:'soc.test',origin:'https://soc.test','content-type':'application/json',cookie:'__Host-soc_session='+userId}},res);return res;
}
async function person(id,roles=['ATHLETE']){
 if(roles.includes('ATHLETE'))await seed('athletes/'+id+'.json',{userId:id,birthDate:'2000-01-01',belt:'WHITE',gender:'MALE',defaultWeightKg:69});
 await seed('users/'+id+'.json',{id,socId:'SOC-'+id,name:id,email:id+'@example.test',roles,status:'ACTIVE'});
 await seed('sessions/'+hash(id)+'.json',{userId:id,expiresAt:new Date(Date.now()+3600000).toISOString()});
}
async function fixture(capacity=10){
 await seed('rules/TEST-RULES.json',TEST_RULES);
 await person('a');await person('b');await person('staff',['STAFF']);
 await seed('tournaments/t.json',{id:'t',rulesId:'TEST-RULES',name:'SQL Test',status:'REGISTRATION_OPEN',startAt:'2027-02-01',fees:{regular:59000},rankingMultiplier:1});
 await seed('divisions/d.json',{id:'d',tournamentId:'t',gender:'MALE',ageMin:18,ageMax:40,key:'GI|ADULT|MALE|WHITE|70|WEIGHT',discipline:'GI',ageGroup:'ADULT',belt:'WHITE',weightClass:'70',capacity,weightLimitKg:70});
}
beforeEach(async()=>{await query('DELETE FROM soc_records');failPath=null;});
after(async()=>{await closePool();if(local)await local.close();});

test('SQL rollback removes all writes after mid-operation failure',async()=>{
 await assert.rejects(inTransaction(async()=>{await seed('audit/a.json',{action:'TEST'});await seed('audit/b.json',{action:'TEST'});throw new Error('fail');}));
 assert.equal((await listJson('audit/')).length,0);
});
test('unique email and SOC ID are enforced by PostgreSQL',async()=>{
 await person('a');
 await assert.rejects(seed('users/b.json',{id:'b',email:'A@example.test',socId:'SOC-b'}),{code:'23505'});
 await assert.rejects(seed('users/c.json',{id:'c',email:'c@example.test',socId:'SOC-a'}),{code:'23505'});
});
test('simultaneous duplicate registrations commit exactly once',async()=>{
 await fixture();const body={tournamentId:'t',divisionId:'d'};
 const result=await Promise.all([call(member,'registrations','a',body),call(member,'registrations','a',body)]);
 assert.deepEqual(result.map(r=>r.statusCode).sort(),[201,409]);assert.equal((await listJson('registrations/')).length,1);
});
test('two applicants for the final place cannot overbook',async()=>{
 await fixture(1);const body={tournamentId:'t',divisionId:'d'};
 const result=await Promise.all([call(member,'registrations','a',body),call(member,'registrations','b',body)]);
 assert.deepEqual(result.map(r=>r.statusCode).sort(),[201,409]);assert.equal((await listJson('registrations/')).length,1);
});
test('listing has no legacy 1,000-record cutoff',async()=>{
 await query("INSERT INTO soc_records(path,value) SELECT 'audit/a'||n||'.json', jsonb_build_object('id',n) FROM generate_series(1,1201) n");
 assert.equal((await listJson('audit/',10)).length,1201);
});
async function resultFixture(){
 await fixture();await seed('brackets/br.json',{id:'br',rankingPolicy:TEST_RULES,tournamentId:'t',divisionKey:'GI|ADULT|MALE|WHITE|70|WEIGHT',athleteCount:2,roundCount:1,status:'PUBLISHED'});
 await seed('matches/m.json',{id:'m',bracketId:'br',tournamentId:'t',divisionKey:'GI|ADULT|MALE|WHITE|70|WEIGHT',roundNo:1,status:'SCHEDULED',athleteA:{userId:'a',socId:'SOC-a',name:'a'},athleteB:{userId:'b',socId:'SOC-b',name:'b'}});
}
test('simultaneous match results create one winner and two medals',async()=>{
 await resultFixture();const body={matchId:'m',winnerUserId:'a',winMethod:'POINTS'};
 const result=await Promise.all([call(ops,'result','staff',body),call(ops,'result','staff',body)]);
 assert.deepEqual(result.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal((await listJson('medals/')).length,2);assert.equal((await listJson('ranking-events/')).filter(x=>x.type==='WIN').length,1);
});
test('partial result failure rolls back winner, points, medals, and audit; retry succeeds',async()=>{
 await resultFixture();
 if(realPostgres){
  await query("CREATE OR REPLACE FUNCTION soc_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF split_part(NEW.path,'/',1)='ranking-events' THEN RAISE EXCEPTION 'injected test failure'; END IF; RETURN NEW; END $$");
  await query('CREATE TRIGGER soc_test_failure BEFORE INSERT ON soc_records FOR EACH ROW EXECUTE FUNCTION soc_test_failure()');
 }else failPath='ranking-events/';
 try{
  const r=await call(ops,'result','staff',{matchId:'m',winnerUserId:'a',winMethod:'POINTS'});assert.equal(r.statusCode,503);
  assert.equal((await getJson('matches/m.json')).status,'SCHEDULED');
  assert.equal((await listJson('medals/')).length,0);assert.equal((await listJson('ranking-events/')).length,0);
 }finally{if(realPostgres){await query('DROP TRIGGER soc_test_failure ON soc_records');await query('DROP FUNCTION soc_test_failure()');}}
 assert.equal((await call(ops,'result','staff',{matchId:'m',winnerUserId:'a',winMethod:'POINTS'})).statusCode,200);
 assert.equal((await listJson('medals/')).length,2);
});

test('backup restore preserves SOC IDs and refuses nonempty or corrupt targets atomically',async()=>{
 const {restoreSnapshot}=await import('../lib/restore.js');
 const snapshot={format:'soc-blob-backup-v1',records:[{path:'users/restored.json',value:{id:'restored',socId:'SOC-ORIGINAL',email:'restore@example.test'}}]};
 assert.equal((await restoreSnapshot(snapshot)).count,1);
 assert.equal((await getJson('users/restored.json')).socId,'SOC-ORIGINAL');
 await assert.rejects(restoreSnapshot(snapshot),/restore_target_not_empty/);
 await query('DELETE FROM soc_records');
 await assert.rejects(restoreSnapshot({...snapshot,records:[...snapshot.records,{path:'bad/path/invalid.json',value:{id:'invalid'}}]}));
 assert.equal((await listJson('users/')).length,0);
});
