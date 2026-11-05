// Isolated HTTPS browser test. Never connects to operational Blob or PostgreSQL.
import {mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const chromiumBinary=(await import('@sparticuz/chromium')).default;
const local=new PGlite();let tail=Promise.resolve();
class Pool{async connect(){let unlock;const previous=tail;tail=new Promise(r=>unlock=r);await previous;return {query:(sql,args)=>!args?.length&&String(sql).includes(';')?local.exec(sql).then(r=>r.at(-1)):local.query(sql,args),release:unlock}}async query(sql,args){const c=await this.connect();try{return await c.query(sql,args)}finally{c.release()}}async end(){}}
mock.module('pg',{defaultExport:{Pool}});
process.env.SOC_DATA_BACKEND='postgres';process.env.DATABASE_URL='postgresql://isolated-browser-only';process.env.SOC_TICKET_SIGNING_KEY='isolated-browser-key-never-for-deployment';delete process.env.VERCEL_ENV;
const {query}=await import('../lib/database.js');
await query(await readFile('db/migrations/001_operational_records.sql','utf8'));
const handlers=Object.fromEntries(await Promise.all(['auth','auth/bootstrap','public','admin','member','ops'].map(async f=>[f,(await import('../api/'+f+'.js')).default])));
const config=JSON.parse(await readFile('vercel.json','utf8'));
const server=https.createServer({key:await readFile(process.env.SOC_TEST_TLS_KEY),cert:await readFile(process.env.SOC_TEST_TLS_CERT)},async(req,res)=>{
 try{
 const url=new URL(req.url,'https://localhost');let route=url.pathname;
 if(route.startsWith('/api/')){
  for(const rule of config.rewrites){const p=rule.source.replace(':op','([^/]+)');const match=new RegExp('^'+p+'$').exec(route);if(match){const target=new URL(rule.destination.replace(':op',match[1]||''),'https://localhost');route=target.pathname;for(const [k,v]of target.searchParams)url.searchParams.set(k,v);break}}
  const handler=handlers[route.replace('/api/','')];if(!handler){res.writeHead(404).end();return}
  let body='';for await(const chunk of req)body+=chunk;req.body=body?JSON.parse(body):{};req.query=Object.fromEntries(url.searchParams);req.headers['x-forwarded-proto']='https';
  res.status=n=>{res.statusCode=n;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res};res.send=data=>{res.end(data);return res};await handler(req,res);return;
 }
 if(route==='/')route='/index.html';if(!path.extname(route))route+='.html';
 const root=path.resolve('.'),file=path.resolve('.'+route);if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return}
 const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
 res.setHeader('Content-Type',type);res.end(await readFile(file));
 }catch{res.writeHead(500).end('isolated test server error')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='https://localhost:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote','--ignore-certificate-errors'],executablePath:process.env.SOC_BROWSER_EXECUTABLE||await chromiumBinary.executablePath()});
 const errors=[];const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/offline.html');await page.evaluate(async()=>{const cache=await caches.open('soc-one-public-v1');await cache.put('/admin.html',new Response('private-fixture'));await cache.put('/api/auth/me',new Response('private-fixture'));});
 await page.goto(base+'/my-soc.html');
 await page.locator('#regName').fill('브라우저 시험 선수');await page.locator('#regEmail').fill('browser@example.test');await page.locator('#regPassword').fill('isolated-browser-password');await page.locator('#regConsent').check();
 await page.getByRole('button',{name:'가입하고 SOC ID 발급'}).click();await page.locator('#memberArea').waitFor({state:'visible'});
 const socId=await page.locator('#memberSoc').innerText();assert.match(socId,/^SOC-/);
 const cookies=await context.cookies();const session=cookies.find(c=>c.name==='__Host-soc_session');assert(session?.secure&&session.httpOnly);
 await page.getByRole('link',{name:'선수 APP'}).click();await page.locator('#pName').fill('유지 확인 선수');await page.locator('#pBirth').fill('2000-01-01');await page.locator('#pWeight').fill('69');await page.locator('#pGender').selectOption('MALE');await page.getByRole('button',{name:'프로필 저장'}).click();await page.waitForFunction(()=>document.getElementById('profileMsg').textContent==='저장 완료');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile horizontal overflow');
 await page.getByRole('button',{name:'로그아웃'}).click();await page.locator('#guestArea').waitFor({state:'visible'});
 const second=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1365,height:900}});const desktop=await second.newPage();desktop.on('pageerror',e=>errors.push(e.message));await desktop.goto(base+'/my-soc.html');await desktop.locator('#loginEmail').fill('browser@example.test');await desktop.locator('#loginPassword').fill('isolated-browser-password');await desktop.getByRole('button',{name:'로그인',exact:true}).click();await desktop.locator('#memberArea').waitFor({state:'visible'});assert.equal(await desktop.locator('#memberSoc').innerText(),socId);await desktop.getByRole('link',{name:'선수 APP'}).click();await desktop.waitForFunction(()=>document.getElementById('pName').value==='유지 확인 선수');
 await desktop.goto(base+'/admin.html');await desktop.getByRole('heading',{name:'접근 권한이 없습니다.'}).waitFor();
 // Give only the isolated fixture account admin roles, never through a public API.
 await query("UPDATE soc_records SET value=jsonb_set(value,'{roles}','[\"ATHLETE\",\"ADMIN\",\"CEO\"]'::jsonb) WHERE collection='users'");
 await desktop.goto(base+'/admin.html');await desktop.locator('#tName').fill('격리 브라우저 대회');await desktop.locator('#tStart').fill('2027-03-01T10:00');await desktop.locator('#tOpen').fill('2026-11-01T00:00');await desktop.locator('#tClose').fill('2027-02-28T00:00');await desktop.getByRole('button',{name:'대회 저장'}).click();await desktop.waitForFunction(()=>document.getElementById('tMsg').textContent==='저장 완료');
 await desktop.locator('#dWeight').fill('-70kg');await desktop.locator('#dLimit').fill('70');await desktop.locator('#dAge').selectOption('ADULT');await desktop.getByRole('button',{name:'디비전 생성'}).click();await desktop.waitForFunction(()=>document.getElementById('dMsg').textContent==='생성 완료');
 await desktop.getByRole('link',{name:'경기 규정 검토·승인'}).click();await desktop.locator('#version').waitFor();await desktop.locator('#reason').fill('격리 시험 검토안');await desktop.getByRole('button',{name:'검토안 저장'}).click();await desktop.waitForFunction(()=>document.getElementById('msg').textContent==='검토안을 저장했습니다.');
 // Install SW, inspect sensitive cache exclusion and offline save feedback.
 await page.goto(base+'/athlete-app.html'); // logged out, route redirects to login
 await page.goto(base+'/ranking.html');await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 const paths=await page.evaluate(async()=>{const names=await caches.keys();const keys=(await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).map(r=>new URL(r.url).pathname)))).flat();return keys});
 assert(!paths.some(p=>p.startsWith('/api/')||/admin|athlete-app|my-soc|certificate|setup/.test(p)));
 await context.setOffline(true);const offline=await page.evaluate(()=>SOC.post('/api/auth/login',{email:'none@example.test',password:'none'}));assert.equal(offline.ok,false);assert.equal(offline.error,'network_error');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,browser:'Chromium',views:['390x844','1365x900'],checks:['signup/login/logout','second-browser profile and SOC ID persistence','role denial','admin tournament and division creation','draft rules','no horizontal overflow on athlete page','no sensitive SW cache','offline mutation failure'],productionDataUsed:false}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await local.close();}
