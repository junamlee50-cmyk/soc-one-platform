import {test,beforeEach,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const real=Boolean(process.env.TEST_DATABASE_URL);let mainLocal,demoLocal,adminPool;
let mainUrl='postgresql://isolated-test/main',demoUrl='postgresql://isolated-test/soc_demo';
if(real){
 const {default:pg}=await import('pg');adminPool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 for(const name of ['soc_demo_test_main','soc_demo'])await adminPool.query('CREATE DATABASE '+name);
 const uri=new URL(process.env.TEST_DATABASE_URL);uri.pathname='/soc_demo_test_main';mainUrl=uri.href;uri.pathname='/soc_demo';demoUrl=uri.href;
}else{
 const {PGlite}=await import('@electric-sql/pglite');mainLocal=new PGlite();demoLocal=new PGlite();let tail=Promise.resolve();
 class Pool{
  constructor(options){this.demo=options.connectionString===demoUrl;this.db=this.demo?demoLocal:mainLocal;}
  async connect(){const previous=tail;let unlock;tail=new Promise(r=>unlock=r);await previous;const db=this.db,demo=this.demo;return {async query(sql,args){
   // PGlite uses a fixed database name. CI runs the actual database guard on PostgreSQL.
   if(String(sql).startsWith('SELECT current_database() AS name,'))sql=sql.replace('current_database()',demo?"'soc_demo'":"'soc_demo_test_main'");
   return !args?.length&&String(sql).includes(';')?(await db.exec(sql)).at(-1):db.query(sql,args);
  },release:unlock};}
  async query(sql,args){const c=await this.connect();try{return await c.query(sql,args)}finally{c.release()}}async end(){}
 }
 mock.module('pg',{defaultExport:{Pool}});
}
Object.assign(process.env,{DATABASE_URL:mainUrl,SOC_DEMO_DATABASE_URL:demoUrl,SOC_DATA_BACKEND:'postgres',SOC_DEMO_ENABLED:'true',SOC_PREVIEW_ISOLATED:'true',VERCEL_ENV:'preview'});
const {getPool,inTransaction,closePool}=await import('../lib/database.js');
const {putJson,getJson,hash,passwordHash}=await import('../lib/blobdb.js');
const {DEMO_EMAIL,DEMO_PASSWORD}=await import('../lib/demo-account.js');
const auth=(await import('../api/auth.js')).default,member=(await import('../api/member.js')).default,admin=(await import('../api/admin.js')).default;
for(const demo of [false,true])for(const migration of ['001_operational_records.sql','002_manual_payments.sql','003_business_ledger.sql'])await getPool({demo}).query(await readFile(new URL('../db/migrations/'+migration,import.meta.url),'utf8'));
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},end(){return this}});
async function call(handler,op,{body={},cookie='',method='POST'}={}){const res=response();await handler({method,query:{op},body,headers:{host:'soc.test',origin:'https://soc.test','content-type':'application/json',cookie}},res);return res;}
const cookieOf=res=>[].concat(res.headers['Set-Cookie']||[]).map(c=>c.split(';')[0]).join('; ');
beforeEach(async()=>{
 Object.assign(process.env,{VERCEL_ENV:'preview',SOC_DEMO_ENABLED:'true',SOC_DEMO_DATABASE_URL:demoUrl});
 for(const demo of [false,true]){await getPool({demo}).query('TRUNCATE soc_records');await getPool({demo}).query('DELETE FROM soc_auth_attempts');}
 await inTransaction(()=>putJson('system/demo-environment.json',{isolated:true}),{demo:false}); // A copied marker alone must not change routing.
 await getPool({demo:true}).query("INSERT INTO soc_records(path,value) VALUES('system/demo-environment.json','{\"isolated\":true}')");
 const ph=passwordHash('private-regular-password');await putJson('users/private-member.json',{id:'private-member',name:'Private member',email:'private@example.test',emailKey:hash('private@example.test'),roles:['ATHLETE'],status:'ACTIVE',passwordHash:ph.hash,passwordSalt:ph.salt});await putJson('user-email/'+hash('private@example.test')+'.json',{userId:'private-member'});
 await putJson('tournaments/private-event.json',{id:'private-event',name:'Private existing event'});
});
after(async()=>{await closePool();if(adminPool)await adminPool.end();if(mainLocal)await mainLocal.close();if(demoLocal)await demoLocal.close();});
const login=()=>call(auth,'login',{body:{email:DEMO_EMAIL,password:DEMO_PASSWORD}});
test('public demo login and all following reads and writes stay in the demo database',async()=>{
 const info=(await call(auth,'demo-access',{method:'GET'})).body;assert.equal(info.enabled,true);assert.equal(info.password,DEMO_PASSWORD);
 const logged=await login();assert.equal(logged.statusCode,200,JSON.stringify(logged.body));const cookie=cookieOf(logged);assert(cookie.includes('__Host-soc_demo=1'));
 assert.equal(await getJson('users/demo-admin.json'),null);assert.equal((await getPool({demo:true}).query("SELECT count(*)::int n FROM soc_records WHERE collection='users'")).rows[0].n,1);
 const overview=await call(admin,'tournaments',{cookie,method:'GET'});assert.equal(overview.statusCode,200);assert(!JSON.stringify(overview.body).includes('private-event'));
 const changed=await call(member,'athlete',{cookie,method:'PUT',body:{birthDate:'19780405',academyName:'Demo only'}});assert.equal(changed.statusCode,200);assert.equal(await getJson('athletes/demo-admin.json'),null);
 const me=(await call(auth,'me',{cookie,method:'GET'})).body;assert.equal(me.user.id,'demo-admin');assert.equal(me.user.demoAccount,true);
 const withoutMarker=cookie.split('; ').filter(c=>!c.startsWith('__Host-soc_demo')).join('; ');assert.equal((await call(auth,'me',{cookie:withoutMarker,method:'GET'})).statusCode,401);
 assert.equal((await call(auth,'email-request',{cookie})).body.error,'demo_action_unavailable');assert.equal((await call(admin,'role',{cookie,body:{userId:'demo-admin',role:'ADMIN',action:'REVOKE',reason:'Synthetic removal'}})).body.error,'demo_account_fixed');assert.equal((await call(auth,'change-password',{cookie,body:{currentPassword:DEMO_PASSWORD,newPassword:'some-new-password'}})).body.error,'demo_account_fixed');
});
test('demo is unavailable in production or with an invalid database, and cannot fall back to member data',async()=>{
 const logged=await login(),cookie=cookieOf(logged);
 process.env.VERCEL_ENV='production';assert.equal((await call(auth,'demo-access',{method:'GET'})).body.enabled,false);assert.equal((await login()).statusCode,401);assert.equal((await call(auth,'me',{cookie,method:'GET'})).statusCode,401);
 process.env.VERCEL_ENV='preview';process.env.SOC_DEMO_DATABASE_URL=mainUrl;assert.equal((await call(auth,'demo-access',{method:'GET'})).body.enabled,false);assert.equal((await login()).statusCode,401);
 process.env.SOC_DEMO_DATABASE_URL=demoUrl;await getPool({demo:true}).query("DELETE FROM soc_records WHERE path='system/demo-environment.json'");assert.equal((await login()).statusCode,503);assert.equal(await getJson('users/demo-admin.json'),null);
});
test('regular login clears demo routing and logout clears both cookies',async()=>{
 const demo=await login();const regular=await call(auth,'login',{cookie:cookieOf(demo),body:{email:'private@example.test',password:'private-regular-password'}});assert.equal(regular.statusCode,200);assert([].concat(regular.headers['Set-Cookie']).some(c=>c.startsWith('__Host-soc_demo=;')&&c.includes('Max-Age=0')));
 const cookie=cookieOf(regular);assert.equal((await call(auth,'me',{cookie,method:'GET'})).body.user.id,'private-member');
 const ended=await call(auth,'logout',{cookie:cookieOf(demo)});assert.equal(ended.statusCode,200);assert.equal(ended.headers['Set-Cookie'].length,2);assert(ended.headers['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
});
test('bad demo passwords are rate limited in the demo database only',async()=>{
 assert.equal((await call(auth,'login',{body:{email:DEMO_EMAIL,password:'wrong'}})).statusCode,401);
 assert.equal((await getPool().query('SELECT count(*)::int n FROM soc_auth_attempts')).rows[0].n,0);assert((await getPool({demo:true}).query('SELECT count(*)::int n FROM soc_auth_attempts')).rows[0].n>0);
 assert.equal((await getPool({demo:true}).query("SELECT count(*)::int n FROM soc_records WHERE collection='users'")).rows[0].n,0);
});
test('copied demo records and sessions cannot authenticate outside the isolated transaction',async()=>{
 const logged=await login(),cookie=cookieOf(logged);
 const records=await getPool({demo:true}).query("SELECT path,value FROM soc_records WHERE collection IN ('users','user-email','sessions')");for(const row of records.rows)await putJson(row.path,row.value);
 process.env.VERCEL_ENV='production';assert.equal((await login()).statusCode,401);
 const forged=cookie.split('; ').filter(c=>!c.startsWith('__Host-soc_demo')).join('; ');assert.equal((await call(auth,'me',{cookie:forged,method:'GET'})).body.error,'invalid_session');
});
test('test personas keep distinct permissions and are unavailable outside the isolated database',async()=>{
 const {DEMO_PERSONAS}=await import('../lib/demo-account.js');
 for(const p of DEMO_PERSONAS){const result=await call(auth,'login',{body:{email:p.email,password:DEMO_PASSWORD}});assert.equal(result.statusCode,200,JSON.stringify(result.body));const cookie=cookieOf(result);assert.deepEqual(result.body.user.roles,p.roles);assert.equal(await getJson('users/'+p.id+'.json'),null);if(!p.roles.includes('ADMIN'))assert.equal((await call(admin,'tournaments',{cookie,method:'GET'})).statusCode,403);}
 process.env.VERCEL_ENV='production';for(const p of DEMO_PERSONAS)assert.equal((await call(auth,'login',{body:{email:p.email,password:DEMO_PASSWORD}})).statusCode,401);
});
