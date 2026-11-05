import { TEST_RULES } from './helpers/rules.js';
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const records = new Map(), reads = [];
let readFailure = null;
class BlobNotFoundError extends Error {}
class BlobPreconditionFailedError extends Error { constructor(){super('conflict');this.name='BlobPreconditionFailedError';} }
mock.module('@vercel/blob',{namedExports:{
  BlobNotFoundError,
  async get(path,options){reads.push(options);if(readFailure)throw readFailure;const value=records.get(path);return value===undefined?null:{statusCode:200,stream:new Response(JSON.stringify(value)).body};},
  async put(path,text,options){if(options.allowOverwrite===false&&records.has(path))throw new BlobPreconditionFailedError();records.set(path,JSON.parse(text));return {pathname:path};},
  async list({prefix,limit=1000,cursor}){const all=[...records.keys()].filter(p=>p.startsWith(prefix));const start=Number(cursor)||0;return {blobs:all.slice(start,start+limit).map(pathname=>({pathname})),cursor:start+limit<all.length?String(start+limit):undefined};},
  async del(path){records.delete(path);}
}});

const handlers = Object.fromEntries(await Promise.all(['auth','public','member','admin','ops','auth/bootstrap'].map(async name=>[name,(await import('../api/'+name+'.js')).default])));
const { hash } = await import('../lib/blobdb.js');
const { ticketSign } = await import('../lib/tickets.js');
const copy=value=>structuredClone(value);
const rows=prefix=>[...records.entries()].filter(([key])=>key.startsWith(prefix)).map(([,value])=>copy(value));
const put=(path,value)=>records.set(path,copy(value));
function member(id='athlete',roles=['ATHLETE','MEMBER']) {
  const user={id,socId:'SOC-'+id,name:id,email:id+'@example.test',roles,status:'ACTIVE'};
  put('users/'+id+'.json',user);
  if(roles.includes('ATHLETE'))put('athletes/'+id+'.json',{userId:id,birthDate:'2000-01-01',belt:'WHITE',gender:'MALE',defaultWeightKg:69});
  put('sessions/'+hash(id)+'.json',{userId:id,expiresAt:new Date(Date.now()+3600000).toISOString()});
  return {cookie:'__Host-soc_session='+id};
}
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(){return this;}};}
async function call(name,op,{method='GET',body={},headers={},query={}}={}){
  const req={method,body,query:{op,...query},headers:{host:'soc.example.test',origin:'https://soc.example.test','content-type':'application/json',...headers}};
  const res=response();await handlers[name](req,res);return res;
}
beforeEach(()=>{records.clear();reads.length=0;readFailure=null;process.env.SOC_TICKET_SIGNING_KEY=crypto.randomBytes(32).toString('hex');delete process.env.SOC_BOOTSTRAP_TOKEN;delete process.env.SOC_ADMIN_SETUP_KEY;});

for (const [name,op] of [['auth','register'],['auth','logout'],['auth/bootstrap',''],['admin','role'],['member','registrations'],['public','tournaments'],['ops','result']]) {
  test(`${name}/${op}: rejects foreign-origin writes before storage`, async()=>{
    const result=await call(name,op,{method:'POST',headers:{origin:'https://unrelated.example','sec-fetch-site':'cross-site'}});
    assert.equal(result.statusCode,403);assert.equal(records.size,0);assert.equal(reads.length,0);
  });
}
test('rejects same-site sibling requests, opaque origin, missing origin, and HTML form bodies',async()=>{
  for(const headers of [{origin:'https://sibling.example.test','sec-fetch-site':'same-site'},{origin:'null'},{origin:undefined}])assert.equal((await call('auth','logout',{method:'POST',headers})).statusCode,403);
  assert.equal((await call('auth','register',{method:'POST',headers:{'content-type':'text/plain'}})).statusCode,415);
});
test('read endpoints reject POST and auth mutations reject GET',async()=>{
  assert.equal((await call('public','ranking',{method:'POST'})).statusCode,405);
  assert.equal((await call('auth','register')).statusCode,405);
});
test('registration, login, session, and logout preserve password privacy',async()=>{
  const registered=await call('auth','register',{method:'POST',body:{name:'테스트 선수',email:'test@example.test',password:'test-password-long',consent:true}});
  assert.equal(registered.statusCode,201);
  assert.match(registered.headers['set-cookie'],/^__Host-soc_session=/);
  assert.match(registered.headers['set-cookie'],/HttpOnly; Secure; SameSite=Lax/);
  assert(!JSON.stringify(registered.body).includes('password'));
  const cookie=registered.headers['set-cookie'].split(';')[0];
  assert.equal((await call('auth','me',{headers:{cookie}})).body.user.name,'테스트 선수');
  assert.equal((await call('auth','login',{method:'POST',body:{email:'test@example.test',password:'wrong'}})).statusCode,401);
  assert.equal((await call('auth','login',{method:'POST',body:{email:'test@example.test',password:'test-password-long'}})).statusCode,200);
  assert.equal((await call('auth','logout',{method:'POST',headers:{cookie}})).body.ok,true);
  assert.equal((await call('auth','me',{headers:{cookie}})).statusCode,401);
  assert(reads.every(x=>x.useCache===false));
});
test('consent must be boolean true; oversized passwords are rejected',async()=>{
  const body={name:'test',email:'test@example.test',password:'test-password-long',consent:'false'};
  assert.equal((await call('auth','register',{method:'POST',body})).statusCode,400);
  assert.equal((await call('auth','register',{method:'POST',body:{...body,consent:true,password:'x'.repeat(257)}})).statusCode,400);
  assert.equal(records.size,0);
});
test('malformed cookies and invalid session expiration fail closed',async()=>{
  assert.equal((await call('auth','me',{headers:{cookie:'__Host-soc_session=%GG'}})).statusCode,401);
  const headers=member();put('sessions/'+hash('athlete')+'.json',{userId:'athlete',expiresAt:'invalid'});
  assert.equal((await call('auth','me',{headers})).statusCode,401);
});
test('storage failure cannot be mistaken for a missing account',async()=>{
  readFailure=new Error('provider secret must not appear in response');
  const r=await call('auth','register',{method:'POST',body:{name:'test',email:'test@example.test',password:'test-password-long',consent:true}});
  assert.equal(r.statusCode,503);assert.equal(records.size,0);assert(!JSON.stringify(r.body).includes('provider secret'));
});
test('both bootstrap routes respect an existing initialization marker',async()=>{
  process.env.SOC_BOOTSTRAP_TOKEN='test-setup-key-long-enough';process.env.SOC_ADMIN_SETUP_KEY='legacy-test-key';
  put('system/admin-bootstrap.json',{userId:'owner'});
  assert.equal((await call('auth/bootstrap','',{method:'POST',body:{token:process.env.SOC_BOOTSTRAP_TOKEN}})).statusCode,409);
  records.clear();put('system/bootstrap.json',{initialized:true});
  assert.equal((await call('admin','bootstrap',{method:'POST',body:{setupKey:process.env.SOC_ADMIN_SETUP_KEY}})).statusCode,409);
});
test('unauthenticated users and athletes cannot use management APIs',async()=>{
  assert.equal((await call('admin','overview')).statusCode,401);
  assert.equal((await call('admin','overview',{headers:member()})).statusCode,403);
});

function tournament(overrides={}) {
  put('rules/TEST-RULES.json',TEST_RULES);
  put('tournaments/t1.json',{id:'t1',rulesId:'TEST-RULES',name:'Test Open',status:'REGISTRATION_OPEN',startAt:'2027-03-01T09:00:00+09:00',rankingMultiplier:1,fees:{early:0,regular:50000,late:60000,extra:10000},...overrides});
  put('divisions/d1.json',{id:'d1',tournamentId:'t1',gender:'MALE',ageMin:18,ageMax:40,key:'GI|ADULT|MALE|WHITE|70|WEIGHT',discipline:'GI',ageGroup:'ADULT',belt:'WHITE',weightClass:'70',weightLimitKg:70,active:true});
}
test('registration rejects unpublished, future, closed, and malformed schedules',async()=>{
  const headers=member();
  for(const props of [{status:'DRAFT'},{registrationOpenAt:new Date(Date.now()+86400000).toISOString()},{registrationCloseAt:new Date(Date.now()-1000).toISOString()},{earlyUntil:'not-a-date'}]) {
    tournament(props);const r=await call('member','registrations',{method:'POST',headers,body:{tournamentId:'t1',divisionId:'d1'}});assert.equal(r.statusCode,409);
  }
  assert.equal(rows('registrations/').length,0);
});
test('zero early fee is preserved and negative fees are rejected',async()=>{
  const headers=member();tournament({earlyUntil:new Date(Date.now()+86400000).toISOString()});
  const r=await call('member','registrations',{method:'POST',headers,body:{tournamentId:'t1',divisionId:'d1'}});
  assert.equal(r.body.registration.amount,0);assert.equal(r.body.registration.paymentStatus,'UNPAID');
  records.delete('registrations/'+r.body.registration.id+'.json');
  tournament({fees:{regular:-1}});assert.equal((await call('member','registrations',{method:'POST',headers,body:{tournamentId:'t1',divisionId:'d1'}})).statusCode,409);
});
test('referees only see assigned tournaments and cannot edit another event',async()=>{
  const headers=member('ref',['REFEREE']);tournament();
  put('tournaments/t2.json',{id:'t2',name:'Other event'});
  put('referee-assignments/a.json',{refereeUserId:'ref',tournamentId:'t1',status:'ASSIGNED'});
  put('registrations/other.json',{id:'other',tournamentId:'t2',status:'REGISTERED',paymentStatus:'PAID',checkInStatus:'CHECKED_IN'});
  put('matches/other.json',{id:'other',tournamentId:'t2'});
  assert.deepEqual((await call('ops','tournaments',{headers})).body.tournaments.map(t=>t.id),['t1']);
  assert.equal((await call('ops','registrations',{headers})).body.registrations.length,0);
  assert.equal((await call('ops','weighin',{method:'POST',headers,body:{registrationId:'other',weightKg:65}})).statusCode,403);
  assert.equal((await call('ops','result',{method:'POST',headers,body:{matchId:'other',winnerUserId:'a'}})).statusCode,403);
});
test('ticket generation fails without a signing key; forged check-in is rejected',async()=>{
  tournament();const headers=member();put('registrations/r.json',{id:'r',userId:'athlete',tournamentId:'t1',status:'REGISTERED',paymentStatus:'PAID',checkInStatus:'CHECKED_IN'});delete process.env.SOC_TICKET_SIGNING_KEY;
  assert.equal((await call('member','ticket',{headers,query:{registrationId:'r'}})).statusCode,503);
  process.env.SOC_TICKET_SIGNING_KEY='x'.repeat(32);
  assert.equal((await call('ops','checkin',{method:'POST',headers:member('staff',['STAFF']),body:{payload:'SOC:r:forged'}})).statusCode,400);
});
test('two-athlete flow: register, verify payment, check in, weigh, bracket, result, ranking',async()=>{
  tournament();const staff=member('staff',['STAFF']);
  const registrations=[];
  for(const id of ['athleteA','athleteB']) {
    const headers=member(id);
    put('athletes/'+id+'.json',{userId:id,birthDate:'2000-01-01',gender:'MALE',defaultWeightKg:69,publicProfile:true,displayName:id,belt:'WHITE'});
    const r=await call('member','registrations',{method:'POST',headers,body:{tournamentId:'t1',divisionId:'d1'}});
    assert.equal(r.statusCode,201);const registration=r.body.registration;registrations.push(registration);
    assert.equal((await call('member','registrations',{method:'POST',headers,body:{tournamentId:'t1',divisionId:'d1'}})).statusCode,409);
    assert.equal((await call('member','ticket',{headers,query:{registrationId:registration.id}})).statusCode,409);
    let ticket={payload:'SOC:'+registration.id+':'+ticketSign(registration.id)};
    assert.equal((await call('ops','checkin',{method:'POST',headers:staff,body:{payload:ticket.payload}})).statusCode,409);
    assert.equal((await call('admin','payment-status',{method:'POST',headers:staff,body:{registrationId:registration.id,paymentStatus:'PAID',reference:'TEST',reason:'Isolated automated verification'}})).statusCode,200);
    ticket=(await call('member','ticket',{headers,query:{registrationId:registration.id}})).body.ticket;
    assert.equal((await call('ops','checkin',{method:'POST',headers:staff,body:{payload:ticket.payload}})).statusCode,200);
    assert.equal((await call('ops','checkin',{method:'POST',headers:staff,body:{payload:ticket.payload}})).statusCode,409);
    assert.equal((await call('ops','weighin',{method:'POST',headers:staff,body:{registrationId:registration.id,weightKg:69}})).body.weighIn.passed,true);
  }
  const bracket=await call('ops','bracket',{method:'POST',headers:staff,body:{tournamentId:'t1',divisionKey:registrations[0].divisionKey}});
  assert.equal(bracket.statusCode,201);assert.equal(bracket.body.matches.length,1);
  const match=bracket.body.matches[0];const body={matchId:match.id,winnerUserId:match.athleteA.userId,winMethod:'POINTS'};
  assert.equal((await call('ops','result',{method:'POST',headers:staff,body})).statusCode,200);
  const eventCount=rows('ranking-events/').length;
  assert.equal((await call('ops','result',{method:'POST',headers:staff,body})).statusCode,409);
  assert.equal(rows('ranking-events/').length,eventCount);
  const ranking=(await call('public','ranking',{query:{category:'GI|ADULT|MALE|WHITE|70|WEIGHT'}})).body.ranking;
  assert.deepEqual(ranking.map(x=>x.points),[85,47]);assert.equal(ranking[0].athleteUserId,body.winnerUserId);
  const dashboard=await call('member','dashboard',{headers:member(body.winnerUserId),query:{role:'athlete'}});
  assert.equal(dashboard.body.data.points,85);
  assert.equal(rows('medals/').length,2);assert(rows('audit/').some(x=>x.action==='MATCH_RESULT'));
  const cert=await call('member','certificate',{method:'POST',headers:member(body.winnerUserId),body:{tournamentId:'t1'}});
  assert.equal(cert.statusCode,200);assert.equal(cert.body.certificate.points,85);
  const verified=await call('public','verify-cert',{query:{code:cert.body.certificate.code}});
  assert.equal(verified.body.valid,true);assert.equal(verified.body.certificate.wins,1);
  assert.match(verified.headers['cache-control'],/no-store/);
});
test('support evaluation rejects negative and infinite component scores',async()=>{
  const headers=member('staff',['STAFF']);put('support-applications/s.json',{id:'s',status:'SUBMITTED'});
  for(const score of [-1,Infinity])assert.equal((await call('admin','support',{method:'POST',headers,body:{applicationId:'s',competition:score}})).statusCode,400);
});

test('weigh-in uses stored division limit and records its audit history',async()=>{
  tournament();const headers=member('staff',['STAFF']);
  put('registrations/r.json',{id:'r',divisionId:'d1',tournamentId:'t1',status:'REGISTERED',paymentStatus:'PAID',checkInStatus:'CHECKED_IN'});
  const result=await call('ops','weighin',{method:'POST',headers,body:{registrationId:'r',weightKg:75,limitKg:200,passed:true}});
  assert.equal(result.body.weighIn.passed,false);assert.equal(result.body.weighIn.limitKg,70);
  assert(rows('audit/').some(x=>x.action==='WEIGH_IN'));
  records.delete('divisions/d1.json');
  assert.equal((await call('ops','weighin',{method:'POST',headers,body:{registrationId:'r',weightKg:65,limitKg:200}})).statusCode,409);
});
for(const count of [3,5,8,16])test(`${count}-athlete bracket completes through byes without awarding bye wins`,async()=>{
  tournament();const headers=member('staff',['STAFF']),divisionKey=records.get('divisions/d1.json').key;
  for(let i=0;i<count;i++)put('registrations/r'+i+'.json',{id:'r'+i,userId:'a'+i,socId:'SOC-'+i,athleteName:'a'+i,tournamentId:'t1',divisionId:'d1',divisionKey,status:'REGISTERED',paymentStatus:'PAID',checkInStatus:'CHECKED_IN',weighInStatus:'PASSED'});
  const created=await call('ops','bracket',{method:'POST',headers,body:{tournamentId:'t1',divisionKey}});
  assert.equal(created.statusCode,201);
  let played=0;
  while(true){
    const next=rows('matches/').find(x=>x.status==='SCHEDULED'&&x.athleteA&&x.athleteB);
    if(!next)break;
    const r=await call('ops','result',{method:'POST',headers,body:{matchId:next.id,winnerUserId:next.athleteA.userId,winMethod:'POINTS'}});
    assert.equal(r.statusCode,200);played++;
    assert(played<count);
  }
  assert.equal(played,count-1);
  assert.equal(rows('ranking-events/').filter(x=>x.type==='WIN').length,count-1);
  assert.equal(rows('matches/').filter(x=>x.status==='SCHEDULED').length,0);
  assert.equal(rows('medals/').filter(x=>x.medal==='GOLD').length,1);
});


test('referee match access is restricted to the assigned mat',async()=>{
 const headers=member('ref',['REFEREE']);tournament();
 put('referee-assignments/a.json',{refereeUserId:'ref',tournamentId:'t1',matNo:1,status:'ASSIGNED'});
 for(const matNo of [1,2])put('matches/m'+matNo+'.json',{id:'m'+matNo,tournamentId:'t1',matNo,roundNo:1,status:'SCHEDULED'});
 assert.deepEqual((await call('ops','matches',{headers})).body.matches.map(m=>m.matNo),[1]);
 assert.equal((await call('ops','result',{method:'POST',headers,body:{matchId:'m2',winnerUserId:'a'}})).statusCode,403);
});

test('single-athlete division stops without inventing a match or medal',async()=>{
 tournament();const headers=member('staff',['STAFF']),divisionKey=records.get('divisions/d1.json').key;
 put('registrations/only.json',{id:'only',userId:'a',tournamentId:'t1',divisionKey,status:'REGISTERED',paymentStatus:'PAID',checkInStatus:'CHECKED_IN',weighInStatus:'PASSED'});
 const r=await call('ops','bracket',{method:'POST',headers,body:{tournamentId:'t1',divisionKey}});
 assert.equal(r.body.error,'not_enough_eligible_athletes');assert.equal(rows('matches/').length,0);assert.equal(rows('medals/').length,0);
});
test('registration cannot request elevated roles and coaches cannot read another academy',async()=>{
 const r=await call('auth','register',{method:'POST',body:{name:'test',email:'role@example.test',password:'test-password-long',consent:true,role:'CEO',roles:['CEO','ADMIN']}});
 assert.equal(r.statusCode,201);assert(!r.body.user.roles.includes('CEO'));assert(!r.body.user.roles.includes('ADMIN'));
 const headers=member('coach',['COACH']);put('academies/other.json',{id:'other',coachUserId:'someone-else',status:'APPROVED'});
 assert.equal((await call('member','academy-athletes',{headers,query:{academyId:'other'}})).statusCode,403);
});

test('academy application requires approval, then only its coach can manage members',async()=>{
 const coach=member('coach',['COACH']),admin=member('admin',['ADMIN']);
 const created=await call('public','academies',{method:'POST',headers:coach,body:{name:'격리 시험 도장',region:'TEST-REGION'}});
 assert.equal(created.statusCode,201);const academyId=created.body.academy.id;assert.equal(created.body.academy.status,'PENDING');
 const athlete=member('new-athlete');
 assert.equal((await call('member','athlete',{method:'PUT',headers:athlete,body:{academyId}})).statusCode,400);
 assert.equal((await call('admin','academy-status',{method:'POST',headers:admin,body:{academyId,status:'APPROVED'}})).statusCode,200);
 assert.equal((await call('member','athlete',{method:'PUT',headers:athlete,body:{academyId}})).statusCode,200);
 assert.equal((await call('member','academy-athletes',{headers:coach,query:{academyId}})).body.athletes.length,1);
 assert.equal((await call('member','academy-athletes',{headers:member('other-coach',['COACH']),query:{academyId}})).statusCode,403);
});
test('storage paths cannot escape a record collection',async()=>{
 const {getJson,putJson,deletePath}=await import('../lib/blobdb.js');
 for(const operation of [()=>getJson('certificates/../users/private.json'),()=>putJson('users/../../system/bootstrap.json',{}),()=>deletePath('users/../sessions/secret.json')])await assert.rejects(operation,/invalid_record_path/);
 assert.equal(reads.length,0);assert.equal(records.size,0);
});


test('canceled tournaments and refunded tickets cannot be checked in',async()=>{
 tournament({status:'CANCELED'});const headers=member('staff',['STAFF']);
 put('registrations/cancel.json',{id:'cancel',userId:'athlete',tournamentId:'t1',status:'REGISTERED',paymentStatus:'PAID'});
 const body={payload:'SOC:cancel:'+ticketSign('cancel')};assert.equal((await call('ops','checkin',{method:'POST',headers,body})).statusCode,409);
 tournament();put('registrations/cancel.json',{id:'cancel',userId:'athlete',tournamentId:'t1',status:'REFUNDED',paymentStatus:'REFUNDED'});
 assert.equal((await call('ops','checkin',{method:'POST',headers,body})).statusCode,409);
});
