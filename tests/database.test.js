import {TEST_BANK} from './helpers/bank.js';
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
process.env.SOC_TICKET_SIGNING_KEY='postgres-test-signing-key-not-for-deployment';
const { query, inTransaction, closePool }=await import('../lib/database.js');
const { putJson, getJson, listJson, hash }=await import('../lib/blobdb.js');
const member=(await import('../api/member.js')).default;
const ops=(await import('../api/ops.js')).default;
const auth=(await import('../api/auth.js')).default;
const admin=(await import('../api/admin.js')).default;
const {totp,decryptSecret}=await import('../lib/mfa.js');
await query(await readFile(new URL('../db/migrations/001_operational_records.sql',import.meta.url),'utf8'));
await query(await readFile(new URL('../db/migrations/002_manual_payments.sql',import.meta.url),'utf8'));
const seed=(path,value)=>putJson(path,value);
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},end(){return this}});
async function call(handler,op,userId,body={},method='POST'){
 const res=response();await handler({method,query:{op},body,headers:{host:'soc.test',origin:'https://soc.test','content-type':'application/json',cookie:'__Host-soc_session='+userId}},res);return res;
}
async function person(id,roles=['ATHLETE']){
 if(roles.includes('ATHLETE'))await seed('athletes/'+id+'.json',{userId:id,birthDate:'2000-01-01',belt:'WHITE',gender:'MALE',defaultWeightKg:69});
 await seed('users/'+id+'.json',{id,socId:'SOC-'+id,name:id,email:id+'@example.test',emailVerifiedAt:new Date().toISOString(),roles,status:'ACTIVE'});
 await seed('sessions/'+hash(id)+'.json',{userId:id,expiresAt:new Date(Date.now()+3600000).toISOString()});
}
async function fixture(capacity=10){
 await seed('system/bank-transfer.json',TEST_BANK);
 await seed('rules/TEST-RULES.json',TEST_RULES);
 await person('a');await person('b');await person('staff',['STAFF']);
 await seed('tournaments/t.json',{id:'t',rulesId:'TEST-RULES',name:'SQL Test',status:'REGISTRATION_OPEN',startAt:'2027-02-01',fees:{regular:59000},rankingMultiplier:1});
 await seed('divisions/d.json',{id:'d',tournamentId:'t',gender:'MALE',ageMin:18,ageMax:40,key:'GI|ADULT|MALE|WHITE|70|WEIGHT',discipline:'GI',ageGroup:'ADULT',belt:'WHITE',weightClass:'70',capacity,weightLimitKg:70});
}
beforeEach(async()=>{await query('TRUNCATE soc_records');await query('DELETE FROM soc_auth_attempts');failPath=null;});
after(async()=>{await closePool();if(local)await local.close();});

async function manualFixture(){await fixture();return (await call(member,'registrations','a',{tournamentId:'t',divisionId:'d'})).body.registration;}

async function approveRefund(r){
 await person('reviewer',['ADMIN']);
 const reviewed=await call(admin,'refund-review','reviewer',{registrationId:r.id,revision:r.paymentRevision||0,action:'APPROVE',amount:r.amount,policyReference:'TEST-POLICY',recipientReference:'TEST-RECIPIENT',reason:'Synthetic review'});
 assert.equal(reviewed.statusCode,200,JSON.stringify(reviewed.body));return reviewed.body.registration;
}
const receipt=(r,overrides={})=>({registrationId:r.id,paymentStatus:'PAID',revision:r.paymentRevision||0,amount:r.amount,occurredAt:new Date().toISOString(),reference:'BANK-TEST-'+r.id,reason:'Isolated bank reconciliation',...overrides});
test('deposit report does not issue a ticket; staff receipt and full refund reconcile the ledger',async()=>{
 const r=await manualFixture();
 assert.equal((await call(member,'payment','b',{registrationId:r.id,revision:0,action:'REPORT_DEPOSIT'})).statusCode,404);
 const report={registrationId:r.id,revision:0,action:'REPORT_DEPOSIT',amount:r.amount,depositorName:'Synthetic payer',occurredAt:new Date().toISOString(),paymentStatus:'PAID'};
 assert.equal((await call(member,'payment','a',report)).body.registration.paymentStatus,'PENDING');
 assert.equal((await call(member,'payment','a',report)).statusCode,409);
 const pending=await getJson('registrations/'+r.id+'.json');
 assert.equal((await call(admin,'payment-status','a',receipt(pending))).statusCode,403);
 assert.equal((await call(admin,'payment-status','staff',receipt(pending,{amount:1}))).statusCode,400);
 assert.equal((await listJson('payment-ledger/')).length,0);
 const paid=await call(admin,'payment-status','staff',receipt(pending));assert.equal(paid.statusCode,200);assert.equal(paid.body.registration.paymentStatus,'PAID');
 const request=await call(member,'payment','a',{registrationId:r.id,revision:2,action:'REQUEST_REFUND',reason:'Synthetic withdrawal'});assert.equal(request.statusCode,200);
 const beforeRefund=(await call(admin,'overview','staff',{},'GET')).body.overview;
 assert.equal(beforeRefund.netReceived,r.amount,'refund request is not a cash outflow');
 assert.equal(beforeRefund.refunded,0);
 const refunded=await call(admin,'payment-status','staff',receipt(await approveRefund(request.body.registration),{paymentStatus:'REFUNDED',reference:'REFUND-TEST'}));assert.equal(refunded.statusCode,200);
 assert.equal(refunded.body.registration.status,'REFUNDED');
 const summary=(await call(admin,'payment-ledger','staff',{},'GET')).body.summary;
 assert.equal(summary.received,r.amount);assert.equal(summary.refunded,r.amount);assert.equal(summary.netReceived,0);
 assert.equal((await call(admin,'overview','staff',{},'GET')).body.overview.netReceived,0);
 assert.equal((await listJson('audit/')).filter(a=>a.action==='MANUAL_PAYMENT_REFUNDED').length,1);
});
test('discounted additional entry cannot outlive or be paid before its base entry',async()=>{
 const base=await manualFixture(),event=await getJson('tournaments/t.json');
 event.fees.additionalDiscipline=29000;event.fees.absolute=25000;await seed('tournaments/t.json',event);
 const division=await getJson('divisions/d.json');await seed('divisions/extra.json',{...division,id:'extra',discipline:'NO-GI',key:'NO-GI|ADULT|MALE|WHITE|70|WEIGHT'});
 const extra=(await call(member,'registrations','a',{tournamentId:'t',divisionId:'extra'})).body.registration;
 assert.equal(extra.amount,29000);assert.equal(extra.priceSnapshot.baseRegistrationId,base.id);
 assert.equal((await call(admin,'payment-status','staff',receipt(extra))).body.error,'base_payment_required');
 assert.equal((await call(member,'payment','a',{registrationId:base.id,revision:0,action:'CANCEL',reason:'Withdrawal'})).body.error,'dependent_registrations_active');
 const paidBase=(await call(admin,'payment-status','staff',receipt(base))).body.registration;
 const paidExtra=(await call(admin,'payment-status','staff',receipt(extra))).body.registration;
 assert.equal(paidExtra.paymentStatus,'PAID');
 assert.equal((await call(member,'payment','a',{registrationId:base.id,revision:1,action:'REQUEST_REFUND',reason:'Withdrawal'})).body.error,'dependent_registrations_active');
 assert.equal((await call(admin,'payment-status','staff',receipt(paidBase,{paymentStatus:'REFUNDED',reference:'BASE-REFUND'}))).body.error,'dependent_registrations_active');
 assert.equal((await call(admin,'payment-status','staff',receipt(await approveRefund(paidExtra),{paymentStatus:'REFUNDED',reference:'EXTRA-REFUND'}))).statusCode,200);
 assert.equal((await call(admin,'payment-status','staff',receipt(await approveRefund(paidBase),{paymentStatus:'REFUNDED',reference:'BASE-REFUND'}))).statusCode,200);
 assert.equal((await call(admin,'payment-ledger','staff',{},'GET')).body.summary.netReceived,0);
});
test('same bank evidence cannot pay two registrations concurrently or rewrite the ledger',async()=>{
 const a=await manualFixture(),b=(await call(member,'registrations','b',{tournamentId:'t',divisionId:'d'})).body.registration;
 const responses=await Promise.all([a,b].map(r=>call(admin,'payment-status','staff',receipt(r,{reference:'SHARED-REFERENCE'}))));
 assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
 const entries=await listJson('payment-ledger/');assert.equal(entries.length,1);
 await assert.rejects(query("UPDATE soc_records SET value=value||'{\"amount\":1}' WHERE collection='payment-ledger'"),{code:'23514'});
 await assert.rejects(query("DELETE FROM soc_records WHERE collection='payment-ledger'"),{code:'23514'});
 assert.equal((await listJson('payment-ledger/'))[0].amount,a.amount);
});
test('receipt transaction rolls back on audit failure and retries consistently',async()=>{
 const r=await manualFixture();
 await query("ALTER TABLE soc_records ADD CONSTRAINT test_fail_payment CHECK (collection <> 'audit' OR value->>'action' <> 'MANUAL_PAYMENT_PAID')");
 try{assert.equal((await call(admin,'payment-status','staff',receipt(r))).statusCode,503);}
 finally{await query('ALTER TABLE soc_records DROP CONSTRAINT test_fail_payment');}
 assert.equal((await listJson('payment-ledger/')).length,0);assert.equal((await getJson('registrations/'+r.id+'.json')).paymentStatus,'UNPAID');
 assert.equal((await call(admin,'payment-status','staff',receipt(r))).statusCode,200);assert.equal((await listJson('payment-ledger/')).length,1);
});
test('account instructions are versioned, privileged, and preserved on existing registrations',async()=>{
 const r=await manualFixture();await person('admin',['ADMIN']);
 const body={...TEST_BANK,accountHolder:'Changed test holder',expectedVersion:1,reason:'Isolated change'};
 assert.equal((await call(admin,'payment-settings','staff',body)).statusCode,403);
 assert.equal((await call(admin,'payment-settings','admin',body)).statusCode,200);
 assert.equal((await call(admin,'payment-settings','admin',body)).statusCode,409);
 assert.equal((await getJson('registrations/'+r.id+'.json')).bankTransfer.accountHolder,TEST_BANK.accountHolder);
 assert.equal((await call(member,'payment','a',{registrationId:r.id,revision:0,action:'CANCEL',reason:'No transfer made'})).statusCode,200);
 assert.equal((await call(admin,'payment-status','staff',receipt(r,{revision:1}))).statusCode,409);
});
test('MFA enrollment, replay protection, single-use recovery, and session revocation work end to end',async()=>{
 process.env.SOC_MFA_ENCRYPTION_KEY='cd'.repeat(32);
 try{
 const password='isolated-secure-password',registered=await call(auth,'register','',{name:'Security fixture',email:'security@example.test',password,consent:true});
 const token=registered.headers['Set-Cookie'].split(';')[0].split('=')[1],userId=registered.body.user.id;
 const start=await call(auth,'mfa-start',token,{currentPassword:password});assert.equal(start.statusCode,200);assert.match(start.body.qr,/^data:image\/png/);
 const pending=await getJson('mfa-pending/'+userId+'.json'),secret=decryptSecret(pending.secret,userId),code=totp(secret);
 const confirm=await call(auth,'mfa-confirm',token,{otp:code});assert.equal(confirm.statusCode,200);assert.equal(confirm.body.recoveryCodes.length,8);
 assert.equal((await call(auth,'me',token,{},'GET')).statusCode,401);
 assert.equal((await call(auth,'login','',{email:'security@example.test',password,otp:code})).statusCode,401);
 const login=await call(auth,'login','',{email:'security@example.test',password,recoveryCode:confirm.body.recoveryCodes[0]});assert.equal(login.statusCode,200);
 assert.equal((await call(auth,'login','',{email:'security@example.test',password,recoveryCode:confirm.body.recoveryCodes[0]})).statusCode,401);
 const active=login.headers['Set-Cookie'].split(';')[0].split('=')[1];
 const changed=await call(auth,'change-password',active,{currentPassword:password,newPassword:'changed-secure-password',recoveryCode:confirm.body.recoveryCodes[1]});assert.equal(changed.statusCode,200);
 assert.equal((await call(auth,'me',active,{},'GET')).statusCode,401);
 const latest=changed.headers['Set-Cookie'].split(';')[0].split('=')[1];assert.equal((await call(auth,'logout-all',latest)).statusCode,200);
 assert.equal((await call(auth,'me',latest,{},'GET')).statusCode,401);
 const stored=JSON.stringify(await listJson('mfa/'));for(const c of confirm.body.recoveryCodes)assert(!stored.includes(c));assert(!stored.includes(start.body.secret));
 }finally{delete process.env.SOC_MFA_ENCRYPTION_KEY;}
});
test('production privileged access requires MFA setup before management requests',async()=>{
 await fixture();process.env.VERCEL_ENV='production';
 try{const r=await call(admin,'overview','staff',{},'GET');assert.equal(r.statusCode,403);assert.equal(r.body.error,'mfa_setup_required');assert.equal((await call(auth,'me','staff',{},'GET')).statusCode,200);}
 finally{delete process.env.VERCEL_ENV;}
});
test('role changes require CEO reason and revoke the target previous sessions',async()=>{
 await fixture();await person('ceo',['CEO']);
 const body={userId:'a',role:'REFEREE',action:'GRANT',reason:'Verified isolated referee appointment'};
 assert.equal((await call(admin,'role','staff',body)).statusCode,403);
 assert.equal((await call(admin,'role','ceo',{...body,reason:''})).statusCode,400);
 assert.equal((await call(admin,'role','ceo',body)).statusCode,200);
 assert.equal((await call(auth,'me','a',{},'GET')).body.error,'session_revoked');
 const audit=(await listJson('audit/')).find(a=>a.action==='ROLE_GRANT');assert.equal(audit.reason,body.reason);assert(audit.after.roles.includes('REFEREE'));
});
test('unconfigured training settlement cannot mark arbitrary amounts as paid',async()=>{
 await fixture();await seed('training-requests/legacy.json',{id:'legacy',settlementStatus:'PENDING'});
 const r=await call(admin,'training-settlement','staff',{requestId:'legacy',amount:-1000,status:'PAID'});
 assert.equal(r.statusCode,409);assert.equal((await getJson('training-requests/legacy.json')).settlementStatus,'PENDING');
});

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

test('concurrent calls for a single mat commit only one active match',async()=>{
 await resultFixture();const match=await getJson('matches/m.json');match.matNo=1;await seed('matches/m.json',match);
 await seed('matches/other.json',{...match,id:'other',athleteA:{userId:'c'},athleteB:{userId:'d'}});
 const result=await Promise.all(['m','other'].map(matchId=>call(ops,'match-state','staff',{matchId,action:'CALL'})));
 assert.deepEqual(result.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal((await listJson('matches/')).filter(m=>m.status==='CALLED').length,1);
 assert.equal((await listJson('audit/')).filter(a=>a.action==='MATCH_CALL').length,1);
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
 await query('TRUNCATE soc_records');
 await assert.rejects(restoreSnapshot({...snapshot,records:[...snapshot.records,{path:'bad/path/invalid.json',value:{id:'invalid'}}]}));
 assert.equal((await listJson('users/')).length,0);
});


test('concurrent account registration preserves one email index and SOC identity',async()=>{
 const body={name:'Concurrent Test',email:'duplicate@example.test',password:'isolated-test-password',consent:true};
 const result=await Promise.all([call(auth,'register','',body),call(auth,'register','',body)]);
 assert.deepEqual(result.map(r=>r.statusCode).sort(),[201,409]);
 assert.equal((await listJson('users/')).length,1);assert.equal((await listJson('user-email/')).length,1);assert.equal((await listJson('sessions/')).length,1);
});

test('result correction retracts downstream results and certificates, then permits consistent replay',async()=>{
 await fixture();await person('admin',['ADMIN']);await person('c');await person('d');
 const divisionKey='GI|ADULT|MALE|WHITE|70|WEIGHT';
 await seed('brackets/br.json',{id:'br',rankingPolicy:TEST_RULES,tournamentId:'t',divisionKey,athleteCount:4,roundCount:2,status:'PUBLISHED'});
 const athlete=id=>({userId:id,socId:'SOC-'+id,name:id});
 await seed('matches/semi1.json',{id:'semi1',bracketId:'br',tournamentId:'t',divisionKey,roundNo:1,status:'SCHEDULED',athleteA:athlete('a'),athleteB:athlete('b'),nextMatchId:'final',nextSlot:'A'});
 await seed('matches/semi2.json',{id:'semi2',bracketId:'br',tournamentId:'t',divisionKey,roundNo:1,status:'SCHEDULED',athleteA:athlete('c'),athleteB:athlete('d'),nextMatchId:'final',nextSlot:'B'});
 await seed('matches/final.json',{id:'final',bracketId:'br',tournamentId:'t',divisionKey,roundNo:2,status:'SCHEDULED',sourceMatchA:'semi1',sourceMatchB:'semi2'});
 for(const [matchId,winnerUserId]of [['semi1','a'],['semi2','c'],['final','a']])assert.equal((await call(ops,'result','staff',{matchId,winnerUserId})).statusCode,200);
 const cert=await call(member,'certificate','a',{tournamentId:'t'});assert.equal(cert.statusCode,200);
 const body={matchId:'semi1',reason:'Isolated correction test',acknowledgeDownstreamReset:true};
 assert.equal((await call(ops,'correct-result','staff',body)).statusCode,403);
 const corrected=await call(ops,'correct-result','admin',body);assert.equal(corrected.statusCode,200);
 assert.deepEqual(corrected.body.correction.matchIds,['semi1','final']);
 assert.equal((await getJson('matches/final.json')).athleteA,null);assert.equal((await getJson('matches/final.json')).athleteB.userId,'c');
 assert.equal((await listJson('medals/')).length,1);assert((await getJson('certificates/'+cert.body.certificate.code+'.json')).revokedAt);
 assert.equal((await listJson('ranking-events/')).filter(e=>e.type==='WIN').length,1);
 for(const [matchId,winnerUserId]of [['semi1','b'],['final','b']])assert.equal((await call(ops,'result','staff',{matchId,winnerUserId})).statusCode,200);
 const medals=await listJson('medals/');assert.equal(medals.length,4);assert.equal(medals.find(m=>m.medal==='GOLD').athleteUserId,'b');
 assert.equal((await listJson('ranking-events/')).filter(e=>e.type==='PARTICIPATION').length,4);
 assert.equal((await listJson('ranking-events/')).filter(e=>e.type==='WIN').length,3);
 const reissued=await call(member,'certificate','a',{tournamentId:'t'});assert.equal(reissued.statusCode,200);assert.notEqual(reissued.body.certificate.code,cert.body.certificate.code);
});


test('failed logins retain the shared attempt counter despite API rollback',async()=>{
 for(let i=0;i<10;i++)assert.equal((await call(auth,'login','',{email:'missing@example.test',password:'wrong'})).statusCode,401);
 const limited=await call(auth,'login','',{email:'MISSING@example.test',password:'wrong'});assert.equal(limited.statusCode,429);
 const counter=(await query('SELECT bucket,attempts FROM soc_auth_attempts')).rows[0];assert.equal(counter.attempts,11);assert.equal(counter.bucket.length,64);
 await query("UPDATE soc_auth_attempts SET reset_at=now()-interval '1 second'");
 assert.equal((await call(auth,'login','',{email:'missing@example.test',password:'wrong'})).statusCode,401);
});

test('refund approval requires independent reviewer and executor and preserves cash until actual transfer',async()=>{
 const r=await manualFixture();const paid=(await call(admin,'payment-status','staff',receipt(r))).body.registration;
 assert.equal((await call(admin,'payment-status','staff',receipt(paid,{paymentStatus:'REFUNDED'}))).body.error,'refund_approval_required');
 const approved=await approveRefund(paid);
 assert.equal((await call(admin,'payment-ledger','staff',{},'GET')).body.summary.netReceived,r.amount);
 assert.equal((await call(admin,'payment-status','reviewer',receipt(approved,{paymentStatus:'REFUNDED'}))).body.error,'independent_refund_executor_required');
 const results=await Promise.all([1,2].map(()=>call(admin,'payment-status','staff',receipt(approved,{paymentStatus:'REFUNDED',reference:'ONE-REFUND'}))));
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
});
test('workflow requires evidence, independent approval, assigned executor and revision; audits atomically',async()=>{
 await person('worker',['STAFF']);await person('boss',['CEO']);await person('other',['STAFF']);
 const created=await call(admin,'workflows','worker',{action:'CREATE',processId:'P08',title:'Support review',target:'SOC-TEST',ownerId:'worker',dueAt:'2027-01-01',reason:'Test'});
 assert.equal(created.statusCode,201);let r=created.body.task;
 assert.equal((await call(admin,'workflows','other',{},'GET')).body.tasks.length,0);
 assert.equal((await call(admin,'workflows','boss',{},'GET')).body.processes.length,12);
 const change=(actor,action,extra={})=>call(admin,'workflows',actor,{id:r.id,revision:r.revision,action,reason:'Test review',...extra});
 assert.equal((await change('worker','SUBMIT',{evidence:['','','']})).statusCode,400);
 r=(await change('worker','SUBMIT',{evidence:['budget-1','assessment-2','contract-3']})).body.task;
 assert.equal((await change('worker','COMPLETE',{completionReference:'bad'})).statusCode,409);
 assert.equal((await change('worker','APPROVE')).statusCode,403);
 const beforeAudit=(await listJson('audit/')).length;
 if(!realPostgres){failPath='audit/';assert.equal((await change('boss','APPROVE')).statusCode,503);assert.equal((await getJson('workflows/'+r.id+'.json')).status,'IN_REVIEW');assert.equal((await listJson('audit/')).length,beforeAudit);}
 const approvals=await Promise.all([change('boss','APPROVE'),change('boss','APPROVE')]);assert.deepEqual(approvals.map(x=>x.statusCode).sort(),[200,409]);r=approvals.find(x=>x.statusCode===200).body.task;
 assert.equal((await change('boss','COMPLETE',{completionReference:'done'})).statusCode,403);
 assert.equal((await change('worker','COMPLETE')).statusCode,400);
 r=(await change('worker','COMPLETE',{completionReference:'actual-result-4'})).body.task;assert.equal(r.status,'COMPLETED');
 r=(await change('boss','REOPEN')).body.task;assert.equal(r.status,'RETURNED');assert.equal(r.completionReference,undefined);assert.equal(r.history.length,5);
});
test('workflow creator cannot approve own delegated request',async()=>{
 await person('boss',['CEO']);await person('worker',['STAFF']);await seed('tournaments/T1.json',{id:'T1',name:'Test'});
 let r=(await call(admin,'workflows','boss',{action:'CREATE',processId:'P03',title:'Event',target:'T1',ownerId:'worker',dueAt:'2027-01-01',reason:'Test'})).body.task;
 r=(await call(admin,'workflows','worker',{id:r.id,revision:0,action:'SUBMIT',evidence:['a','b','c'],reason:'Test'})).body.task;
 assert.equal((await call(admin,'workflows','boss',{id:r.id,revision:r.revision,action:'APPROVE',reason:'Test'})).body.error,'independent_approver_required');
});

test('batch deposit reconciles two registrations atomically and rejects reuse and mismatch',async()=>{
 await fixture();const a=(await call(member,'registrations','a',{tournamentId:'t',divisionId:'d'})).body.registration;
 const b=(await call(member,'registrations','b',{tournamentId:'t',divisionId:'d'})).body.registration;
 const body={amount:a.amount+b.amount,reference:'GROUP-1',occurredAt:new Date().toISOString(),reason:'Synthetic bank statement',allocations:[a,b].map(r=>({registrationId:r.id,revision:0,amount:r.amount}))};
 assert.equal((await call(admin,'batch-deposit','staff',{...body,amount:1})).statusCode,400);
 // Second allocation fails after the first write: transaction must roll all writes back.
 b.paymentDueAt='2020-01-01';await seed('registrations/'+b.id+'.json',b);
 assert.equal((await call(admin,'batch-deposit','staff',body)).statusCode,409);
 assert.equal((await listJson('payment-ledger/')).length,0);assert.equal((await getJson('registrations/'+a.id+'.json')).paymentStatus,'UNPAID');
 b.paymentDueAt=new Date(Date.now()+3600000).toISOString();await seed('registrations/'+b.id+'.json',b);
 assert.equal((await call(admin,'batch-deposit','staff',body)).statusCode,200);
 assert.equal((await listJson('payment-ledger/')).reduce((s,e)=>s+e.amount,0),body.amount);
 assert.equal((await call(admin,'batch-deposit','staff',body)).statusCode,409);
});
test('partial cancellation refunds only approved amount and closes entry without granting ticket',async()=>{
 let r=await manualFixture();r=(await call(admin,'payment-status','staff',receipt(r))).body.registration;
 await person('reviewer',['ADMIN']);
 const review={registrationId:r.id,revision:r.paymentRevision,action:'APPROVE',amount:40000,policyReference:'Cancellation policy',recipientReference:'Verified recipient',reason:'Partial cancellation'};
 assert.equal((await call(admin,'refund-review','reviewer',{...review,amount:r.amount+1})).statusCode,400);
 r=(await call(admin,'refund-review','reviewer',review)).body.registration;
 assert.equal((await call(admin,'payment-status','staff',receipt(r,{paymentStatus:'REFUNDED',amount:r.amount}))).statusCode,400);
 r=(await call(admin,'payment-status','staff',receipt(r,{paymentStatus:'REFUNDED',amount:40000,reference:'PARTIAL-1'}))).body.registration;
 assert.equal(r.status,'REFUNDED');assert.equal(r.retainedAmount,19000);assert.equal(r.refundedAmount,40000);
 const summary=(await call(admin,'payment-ledger','staff',{},'GET')).body.summary;assert.equal(summary.netReceived,19000);
 assert.equal((await call(admin,'payment-status','staff',receipt(r,{paymentStatus:'REFUNDED',amount:40000}))).statusCode,409);
});
test('workflow reassignment invalidates approval, enforces reviewer and supports withdrawal/cancellation',async()=>{
 for(const [id,roles]of [['worker',['STAFF']],['replacement',['STAFF']],['boss',['CEO']],['reviewer',['ADMIN']]])await person(id,roles);
 let r=(await call(admin,'workflows','worker',{action:'CREATE',processId:'P04',title:'Deposit',target:'BANK-1',ownerId:'worker',dueAt:'2027-01-01',reason:'Test'})).body.task;
 const act=async(user,action,extra={})=>call(admin,'workflows',user,{id:r.id,revision:r.revision,action,reason:'Test change',...extra});
 r=(await act('boss','UPDATE',{ownerId:'replacement',reviewerId:'reviewer',dueAt:'2027-02-01'})).body.task;
 assert.equal((await act('worker','SUBMIT',{evidence:['a','b','c']})).statusCode,403);
 r=(await act('replacement','SUBMIT',{evidence:['a','b','c']})).body.task;
 assert.equal((await act('boss','APPROVE')).statusCode,403);
 r=(await act('replacement','WITHDRAW')).body.task;assert.equal(r.status,'DRAFT');
 r=(await act('replacement','SUBMIT',{evidence:['a','b','c']})).body.task;
 r=(await act('reviewer','APPROVE')).body.task;assert.equal(r.status,'APPROVED');
 r=(await act('boss','UPDATE',{ownerId:'replacement',reviewerId:'reviewer',dueAt:'2027-03-01'})).body.task;assert.equal(r.status,'RETURNED');assert.equal(r.reviewedBy,undefined);
 r=(await act('boss','CANCEL')).body.task;assert.equal(r.status,'CANCELED');assert.equal((await act('replacement','SUBMIT',{evidence:['a','b','c']})).statusCode,409);
});
test('event opening requires independent approval of current settings and valid prerequisites',async()=>{
 await fixture();await person('boss',['CEO']);process.env.RESEND_API_KEY='isolated-config';process.env.SOC_EMAIL_FROM='test@example.test';
 let t=await getJson('tournaments/t.json');t.status='DRAFT';t.venueName='Test venue';t.registrationOpenAt=new Date(Date.now()-1000).toISOString();t.registrationCloseAt=new Date(Date.now()+86400000).toISOString();await seed('tournaments/t.json',t);
 assert.equal((await call(admin,'event-release','boss',{tournamentId:'t',reason:'Open'})).statusCode,409);
 let r=(await call(admin,'workflows','staff',{action:'CREATE',processId:'P03',title:'Event approval',target:'t',ownerId:'staff',dueAt:'2027-01-01',reason:'Test'})).body.task;
 r=(await call(admin,'workflows','staff',{id:r.id,revision:r.revision,action:'SUBMIT',evidence:['budget','policy','medical'],reason:'Review'})).body.task;
 t.fees.regular=60000;await seed('tournaments/t.json',t);
 assert.equal((await call(admin,'workflows','boss',{id:r.id,revision:r.revision,action:'APPROVE',reason:'Review'})).body.error,'workflow_target_changed');
 t.fees.regular=59000;await seed('tournaments/t.json',t);
 assert.equal((await call(admin,'workflows','boss',{id:r.id,revision:r.revision,action:'APPROVE',reason:'Review'})).statusCode,200);
 assert.equal((await call(admin,'event-release','boss',{tournamentId:'t',reason:'Open approved event'})).statusCode,200);
 assert.equal((await getJson('tournaments/t.json')).status,'REGISTRATION_OPEN');delete process.env.RESEND_API_KEY;delete process.env.SOC_EMAIL_FROM;
});
test('guardian review requires independent evidence, handles revocation and prevents stale updates',async()=>{
 await fixture();await person('reviewer',['ADMIN']);
 const body={athleteUserId:'a',revision:0,action:'VERIFY',relationshipReference:'REL-1',consentReference:'SIGNED-1',policyVersion:'TEST-CONSENT',verifiedInPerson:true,reason:'Original reviewed'};
 assert.equal((await call(admin,'guardian-review','staff',body)).statusCode,403);
 assert.equal((await call(admin,'guardian-review','reviewer',{...body,verifiedInPerson:false})).statusCode,400);
 assert.equal((await call(admin,'guardian-review','reviewer',body)).body.consent.status,'VERIFIED');
 assert.equal((await call(admin,'guardian-review','reviewer',body)).statusCode,409);
 assert.equal((await call(admin,'guardian-review','reviewer',{...body,revision:1,action:'REVOKE'})).body.consent.status,'REVOKED');
 assert.equal((await listJson('audit/')).filter(x=>x.action.startsWith('GUARDIAN_')).length,2);
});
test('financial staff cannot confirm their own participant payment',async()=>{
 let r=await manualFixture();const u=await getJson('users/a.json');u.roles.push('STAFF');await seed('users/a.json',u);
 assert.equal((await call(admin,'payment-status','a',receipt(r))).body.error,'independent_payment_operator_required');
 assert.equal((await listJson('payment-ledger/')).length,0);
});
test('email verification and password recovery use expiring one-time codes and revoke sessions',async()=>{
 await person('a');await seed('user-email/'+hash('a@example.test')+'.json',{userId:'a'});
 process.env.RESEND_API_KEY='isolated-mail-provider';process.env.SOC_EMAIL_FROM='test@example.test';
 const unverified=await getJson('users/a.json');delete unverified.emailVerifiedAt;await seed('users/a.json',unverified);
 let code;const transport=mock.method(globalThis,'fetch',async(_url,options)=>{code=JSON.parse(options.body).text.match(/코드: (\d{8})/)[1];return {ok:true};});
 try{
  assert.equal((await call(auth,'email-request','a')).statusCode,200);const verification=code;
  assert.equal((await call(auth,'email-confirm','a',{code:'wrong'})).statusCode,400);
  assert.equal((await call(auth,'email-confirm','a',{code:verification})).statusCode,200);
  assert.ok((await getJson('users/a.json')).emailVerifiedAt);
  assert.equal((await call(auth,'email-confirm','a',{code:verification})).statusCode,400);
  assert.equal((await call(auth,'reset-request','none',{email:'missing@example.test'})).statusCode,200);
  assert.equal((await call(auth,'reset-request','none',{email:'a@example.test'})).statusCode,200);
  assert.equal((await call(auth,'reset-confirm','none',{email:'a@example.test',code,newPassword:'new-isolated-password'})).statusCode,200);
  assert.equal((await call(auth,'me','a',{},'GET')).body.error,'session_revoked');
  assert.equal((await call(auth,'reset-confirm','none',{email:'a@example.test',code,newPassword:'another-password'})).statusCode,400);
  assert.equal((await call(auth,'login','none',{email:'a@example.test',password:'new-isolated-password'})).statusCode,200);
 }finally{transport.mock.restore();delete process.env.RESEND_API_KEY;delete process.env.SOC_EMAIL_FROM;}
});
test('email delivery failure rolls back challenges and reset code guesses remain rate limited',async()=>{
 await person('a');await seed('user-email/'+hash('a@example.test')+'.json',{userId:'a'});
 process.env.RESEND_API_KEY='isolated-mail-provider';process.env.SOC_EMAIL_FROM='test@example.test';
 const transport=mock.method(globalThis,'fetch',async()=>({ok:false}));
 try{
  assert.equal((await call(auth,'reset-request','none',{email:'a@example.test'})).statusCode,503);
  assert.equal((await listJson('email-challenges/')).length,0);
  for(let i=0;i<5;i++)assert.equal((await call(auth,'reset-confirm','none',{email:'a@example.test',code:'00000000',newPassword:'new-password-long'})).statusCode,400);
  assert.equal((await call(auth,'reset-confirm','none',{email:'a@example.test',code:'00000000',newPassword:'new-password-long'})).statusCode,429);
 }finally{transport.mock.restore();delete process.env.RESEND_API_KEY;delete process.env.SOC_EMAIL_FROM;}
});
test('unverified email cannot register for a tournament',async()=>{
 await fixture();const user=await getJson('users/a.json');delete user.emailVerifiedAt;await seed('users/a.json',user);
 assert.equal((await call(member,'registrations','a',{tournamentId:'t',divisionId:'d'})).body.error,'email_verification_required');
 assert.equal((await listJson('registrations/')).length,0);
});
test('event archive preserves history, blocks registrations and restores only to draft',async()=>{
 await fixture();await person('boss',['CEO']);let t=await getJson('tournaments/t.json');t.status='DRAFT';t.updatedAt='2026-11-09T00:00:00Z';await seed('tournaments/t.json',t);
 const body={tournamentId:'t',updatedAt:t.updatedAt,action:'ARCHIVE',reason:'Duplicate draft'};
 assert.equal((await call(admin,'event-archive','staff',body)).statusCode,403);
 assert.equal((await call(admin,'event-archive','boss',{...body,updatedAt:'stale'})).statusCode,409);
 let result=await call(admin,'event-archive','boss',body);assert.equal(result.statusCode,200);assert.ok(result.body.tournament.deletedAt);
 result=await call(admin,'event-archive','boss',{...body,updatedAt:result.body.tournament.updatedAt,action:'RESTORE'});assert.equal(result.statusCode,200);assert.equal(result.body.tournament.status,'DRAFT');
 await seed('registrations/history.json',{id:'history',userId:'a',tournamentId:'t',divisionId:'d',status:'CANCELED',amount:59000});
 assert.equal((await call(admin,'event-archive','boss',{...body,updatedAt:result.body.tournament.updatedAt})).body.error,'event_has_records');
 assert.equal((await listJson('audit/')).filter(e=>e.action.startsWith('EVENT_')).length,2);
});

const serviceDraft={operatorName:'Synthetic SOC Operator',representative:'Test owner',contactEmail:'help@example.test',contactPhone:'010-0000-0000',address:'Synthetic test address',privacyOfficer:'Test privacy officer',policyVersion:'TEST-1',effectiveDate:'2026-01-01',privacyText:'Synthetic privacy disclosure for isolated testing. '.repeat(4),termsText:'Synthetic service terms for isolated testing. '.repeat(4),refundText:'Synthetic refund policy for isolated testing. '.repeat(4)};
const saveService=(revision,settings=serviceDraft,id='owner')=>call(admin,'service-settings',id,{action:'SAVE',revision,settings,reason:'Isolated test'});
const publishService=(revision,id='owner')=>call(admin,'service-settings',id,{action:'PUBLISH',revision,confirmReviewed:true,reason:'Isolated test'});
test('service policies separate drafts from publication, reject stale saves and restrict publication to CEO',async()=>{
 await person('owner',['CEO']);await person('editor',['ADMIN']);await person('member');
 assert.equal((await call(admin,'service-settings','member',{},'GET')).statusCode,403);
 assert.equal((await saveService(0,serviceDraft,'editor')).statusCode,200);
 assert.equal((await saveService(0)).statusCode,409);
 assert.equal((await publishService(1,'editor')).statusCode,403);
 const published=await publishService(1);assert.equal(published.statusCode,200);
 const first=published.body.state.published;
 await saveService(2,{...serviceDraft,operatorName:'Unpublished change',policyVersion:'TEST-2'});
 assert.equal((await getJson('system/service-settings.json')).published.operatorName,serviceDraft.operatorName);
 const second=await publishService(3);assert.equal(second.statusCode,200);
 assert.notEqual(first.id,second.body.state.published.id);
 assert.equal((await getJson('service-policies/'+first.id+'.json')).operatorName,serviceDraft.operatorName);
 assert.equal((await listJson('audit/')).filter(r=>r.action==='SERVICE_PUBLISH').length,2);
});
test('published policy requires both consents and exact version; failed registration creates no account',async()=>{
 await person('owner',['CEO']);await saveService(0);const published=await publishService(1);const policy=published.body.state.published;
 const b={name:'Consent test',email:'consent@example.test',password:'long-test-password',consent:true};
 assert.equal((await call(auth,'register','',{...b,termsConsent:true,policyId:'old-policy'})).body.error,'current_policy_consent_required');
 assert.equal((await call(auth,'register','',{...b,policyId:policy.id})).body.error,'current_policy_consent_required');
 assert.equal(await getJson('user-email/'+hash(b.email)+'.json'),null);
 const result=await call(auth,'register','',{...b,termsConsent:true,policyId:policy.id});assert.equal(result.statusCode,201);
 const user=await getJson('users/'+result.body.user.id+'.json');assert.equal(user.policyConsent.policyId,policy.id);assert.equal(user.policyConsent.termsConsent,true);
});
test('production signup fails closed before service settings and email are ready',async()=>{
 const old=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';
 try{const result=await call(auth,'register','',{name:'Blocked',email:'blocked-ready@example.test',password:'long-test-password',consent:true,termsConsent:true});assert.equal(result.statusCode,409);assert.equal(result.body.error,'registration_not_ready');assert.equal((await listJson('users/')).length,0);}finally{if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;}
});
test('service settings rollback policy publication when audit storage fails',async()=>{
 if(realPostgres)return;
 await person('owner',['CEO']);await saveService(0);failPath='audit/';
 const result=await publishService(1);assert.equal(result.statusCode,503);
 assert.equal((await getJson('system/service-settings.json')).published,null);assert.equal((await listJson('service-policies/')).length,0);
});
test('inquiries preserve ownership, restrict replies, reject stale versions and record answers',async()=>{
 await fixture();await person('admin',['ADMIN']);
 const made=await call(member,'inquiries','a',{category:'REFUND',subject:'Refund question',message:'Synthetic question'});assert.equal(made.statusCode,201);const q=made.body.inquiry;
 assert.equal((await call(member,'inquiries','b',{},'GET')).body.inquiries.length,0);
 assert.equal((await call(admin,'inquiries','b',{id:q.id,revision:1,reply:'forged',status:'CLOSED'})).statusCode,403);
 assert.equal((await call(admin,'inquiries','admin',{id:q.id,revision:0,reply:'Answer',status:'ANSWERED'})).statusCode,409);
 const answer=await call(admin,'inquiries','admin',{id:q.id,revision:1,reply:'Synthetic answer',status:'ANSWERED'});assert.equal(answer.statusCode,200);
 const own=(await call(member,'inquiries','a',{},'GET')).body.inquiries;assert.equal(own[0].replies[0].message,'Synthetic answer');assert.equal(own[0].status,'ANSWERED');
 await seed('registrations/other.json',{id:'other',userId:'b',tournamentId:'t',divisionId:'d',status:'REGISTERED',amount:100});
 assert.equal((await call(member,'inquiries','a',{category:'REFUND',subject:'Wrong owner',message:'Synthetic question',registrationId:'other'})).statusCode,404);
 assert.equal((await listJson('audit/')).filter(r=>r.action==='INQUIRY_REPLIED').length,1);
});
test('inquiry answer rolls back on audit failure and open-setting requires email and MFA',async()=>{
 if(realPostgres)return;
 await person('a');await person('owner',['CEO']);
 const made=await call(member,'inquiries','a',{category:'ACCOUNT',subject:'Account issue',message:'Synthetic account issue'});failPath='audit/';
 assert.equal((await call(admin,'inquiries','owner',{id:made.body.inquiry.id,revision:1,reply:'Answer',status:'ANSWERED'})).statusCode,503);
 assert.equal((await getJson('inquiries/'+made.body.inquiry.id+'.json')).replies.length,0);
 await saveService(0);await publishService(1);
 assert.equal((await call(admin,'service-settings','owner',{action:'OPEN',revision:2,reason:'Test missing config'})).statusCode,409);
});
test('registration preserves the accepted refund policy after later policy changes',async()=>{
 await fixture();await person('owner',['CEO']);await saveService(0);const published=await publishService(1),policy=published.body.state.published;
 const request={tournamentId:'t',divisionId:'d'};
 assert.equal((await call(member,'registrations','a',request)).body.error,'refund_policy_consent_required');
 const created=await call(member,'registrations','a',{...request,policyId:policy.id,refundConsent:true});assert.equal(created.statusCode,201);
 await saveService(2,{...serviceDraft,policyVersion:'TEST-2',refundText:'Changed synthetic refund policy. '.repeat(5)});await publishService(3);
 const record=await getJson('registrations/'+created.body.registration.id+'.json');assert.equal(record.policySnapshot.policyId,policy.id);assert.equal(record.policySnapshot.refundText,policy.refundText);
});
