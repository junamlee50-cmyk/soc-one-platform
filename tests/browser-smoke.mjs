import {TEST_BANK} from './helpers/bank.js';
// Isolated HTTPS browser test. Never connects to operational Blob or PostgreSQL.
import {mock} from 'node:test';
import {TEST_RULES} from './helpers/rules.js';
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
process.env.SOC_MFA_ENCRYPTION_KEY='ef'.repeat(32);process.env.SOC_DATA_BACKEND='postgres';process.env.DATABASE_URL='postgresql://isolated-browser-only';process.env.SOC_TICKET_SIGNING_KEY='isolated-browser-key-never-for-deployment';delete process.env.VERCEL_ENV;
const {query}=await import('../lib/database.js');
await query(await readFile('db/migrations/001_operational_records.sql','utf8'));
await query(await readFile(new URL('../db/migrations/002_manual_payments.sql',import.meta.url),'utf8'));
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
 // Match fixtures stay inside the isolated test DB; exercise real UI buttons.
 const seed=async(path,value)=>query('INSERT INTO soc_records(path,value) VALUES ($1,$2::jsonb) ON CONFLICT(path) DO UPDATE SET value=excluded.value',[path,JSON.stringify(value)]);
 const event=(await query("SELECT value FROM soc_records WHERE collection='tournaments'")).rows[0].value;
 await seed('tournaments/'+event.id+'.json',{...event,status:'REGISTRATION_OPEN',rulesId:TEST_RULES.id});
 await seed('rules/'+TEST_RULES.id+'.json',TEST_RULES);
 // Bank transfer: configure via admin UI, claim as athlete, confirm/refund as staff.
 await desktop.goto(base+'/payments.html');await desktop.locator('#bankName').fill(TEST_BANK.bankName);await desktop.locator('#bankNumber').fill(TEST_BANK.accountNumber);await desktop.locator('#bankHolder').fill(TEST_BANK.accountHolder);await desktop.locator('#bankEnabled').check();await desktop.locator('#bankReason').fill('격리 시험 계좌');await desktop.getByRole('button',{name:'입금계좌 설정 저장',exact:true}).click();await desktop.waitForFunction(()=>paymentMsg.textContent==='입금계좌 설정을 저장했습니다.');
 await page.goto(base+'/my-soc.html');await page.locator('#regName').fill('입금 시험 선수');await page.locator('#regEmail').fill('bank-browser@example.test');await page.locator('#regPassword').fill('isolated-bank-password');await page.locator('#regConsent').check();await page.getByRole('button',{name:'가입하고 SOC ID 발급'}).click();await page.locator('#memberArea').waitFor({state:'visible'});await page.getByRole('link',{name:'선수 APP',exact:true}).click();await page.locator('#pBirth').fill('2000-01-01');await page.locator('#pWeight').fill('69');await page.locator('#pGender').selectOption('MALE');await page.getByRole('button',{name:'프로필 저장'}).click();await page.waitForFunction(()=>profileMsg.textContent==='저장 완료');
 await query("UPDATE soc_records SET value=jsonb_set(value,'{emailVerifiedAt}',to_jsonb(now()::text)) WHERE collection='users' AND value->>'email'='bank-browser@example.test'");
 await page.goto(base+'/competition.html');await page.locator('#regDivision option').first().waitFor({state:'attached'});await page.getByRole('button',{name:'참가신청',exact:true}).click();await page.waitForURL('**/payments.html?registrationId=*');await page.waitForFunction(()=>paymentDetails.textContent.includes('TEST ONLY BANK'));
 const transferAt=new Date(Date.now()+9*3600000).toISOString().slice(0,16);
 await page.locator('#claimName').fill('입금 시험 선수');await page.locator('#claimAt').fill(transferAt);await page.getByRole('button',{name:'입금했습니다 — 확인 요청',exact:true}).click();await page.waitForFunction(()=>paymentDetails.textContent.includes('운영자 확인 중'));assert(await page.locator('#paymentTicket').isHidden());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'payments mobile overflow');
 await desktop.getByRole('button',{name:'새로고침',exact:true}).click();await desktop.locator('#receiptAt').fill(transferAt);await desktop.locator('#receiptReference').fill('BROWSER-RECEIPT-001');await desktop.locator('#receiptReason').fill('격리 시험 입금 대조');await desktop.getByRole('button',{name:'대조한 거래 기록 저장',exact:true}).click();await desktop.waitForFunction(()=>paymentDetails.textContent.includes('입금 확인 완료'));
 await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.locator('#paymentTicket').waitFor({state:'visible'});
 page.once('dialog',dialog=>dialog.accept('격리 시험 환불'));await page.getByRole('button',{name:'환불 요청',exact:true}).click();await page.waitForFunction(()=>paymentDetails.textContent.includes('환불 검토 중'));
 await desktop.getByRole('button',{name:'새로고침',exact:true}).click();await desktop.waitForFunction(()=>paymentDetails.textContent.includes('환불 검토 중'));// Separate approval fixture: UI reviewer is a different authenticated user.
 await seed('users/browser-reviewer.json',{id:'browser-reviewer',socId:'SOC-REVIEWER',name:'Review',roles:['ADMIN'],status:'ACTIVE'});
 const {hash}=await import('../lib/blobdb.js');await seed('sessions/'+hash('browser-reviewer')+'.json',{userId:'browser-reviewer',expiresAt:new Date(Date.now()+3600000).toISOString()});
 const reviewContext=await browser.newContext({ignoreHTTPSErrors:true});await reviewContext.addCookies([{name:'__Host-soc_session',value:'browser-reviewer',url:base,secure:true}]);const reviewPage=await reviewContext.newPage();
 await reviewPage.goto(base+'/payments.html');await reviewPage.locator('#refundPolicy').fill('TEST-POLICY');await reviewPage.locator('#refundRecipient').fill('TEST-RECIPIENT');await reviewPage.locator('#refundReason').fill('Independent test review');await reviewPage.getByRole('button',{name:'환불 검토 저장',exact:true}).click();await reviewPage.waitForFunction(()=>paymentDetails.textContent.includes('승인 · 실제 지급 대기'));
 await desktop.getByRole('button',{name:'새로고침',exact:true}).click();await desktop.waitForFunction(()=>paymentDetails.textContent.includes('승인 · 실제 지급 대기'));await reviewContext.close();
 await desktop.locator('#receiptAction').selectOption('REFUNDED');await desktop.locator('#receiptReference').fill('BROWSER-REFUND-001');await desktop.getByRole('button',{name:'대조한 거래 기록 저장',exact:true}).click();await desktop.waitForFunction(()=>paymentDetails.textContent.includes('환불 기록 완료'));assert((await desktop.locator('#ledgerSummary').innerText()).includes('순입금 0원'));
 // Operating center: create, persist evidence, submit, and independently approve.
 await desktop.goto(base+'/operations.html');await desktop.locator('.processCard').nth(11).waitFor();await desktop.getByRole('button',{name:'새 업무 등록',exact:true}).click();await desktop.locator('#workProcess').selectOption('P08');await desktop.locator('#workTitle').fill('브라우저 지원 검토');await desktop.locator('#workTarget').fill('SOC-BROWSER');await desktop.locator('#workDue').fill('2027-02-01T10:00');await desktop.locator('#workReason').fill('격리 시험');await desktop.getByRole('button',{name:'업무 등록',exact:true}).click();await desktop.locator('#evidence-0').fill('BUDGET-1');await desktop.locator('#evidence-1').fill('ASSESSMENT-2');await desktop.locator('#evidence-2').fill('CONTRACT-3');await desktop.locator('#actionReason').fill('검토 요청');await desktop.getByRole('button',{name:'승인 요청',exact:true}).click();await desktop.getByText('등록자·담당자와 다른 관리자 또는 대표가 검토합니다.',{exact:true}).waitFor();
 assert.equal(await desktop.getByRole('button',{name:'검토 승인',exact:true}).count(),0);
 await desktop.setViewportSize({width:390,height:844});assert(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'operations mobile overflow');await desktop.setViewportSize({width:1365,height:900});
 // Enroll an authenticator, revoke sessions, and sign in with a single-use recovery code.
 await desktop.goto(base+'/security.html');await desktop.locator('#mfaPassword').fill('isolated-browser-password');await desktop.getByRole('button',{name:'추가인증 등록 시작',exact:true}).click();await desktop.locator('#mfaEnrollment').waitFor({state:'visible'});
 const {decryptSecret,totp}=await import('../lib/mfa.js');const pending=(await query("SELECT value FROM soc_records WHERE collection='mfa-pending'")).rows[0].value;
 await desktop.locator('#mfaCode').fill(totp(decryptSecret(pending.secret,pending.userId)));await desktop.getByRole('button',{name:'추가인증 등록 완료',exact:true}).click();await desktop.waitForFunction(()=>recoveryCodes.textContent.includes('각 코드'));const recovery=(await desktop.locator('#recoveryCodes').innerText()).split('\n')[1];
 await desktop.getByRole('button',{name:'현재 기기를 포함해 모두 로그아웃',exact:true}).click();await desktop.locator('#loginEmail').fill('browser@example.test');await desktop.locator('#loginPassword').fill('isolated-browser-password');await desktop.locator('#loginRecovery').fill(recovery);await desktop.getByRole('button',{name:'로그인',exact:true}).click();await desktop.locator('#memberArea').waitFor({state:'visible'});

 const divisionKey='GI|ADULT|MALE|WHITE|70|WEIGHT';
 await seed('brackets/browser-bracket.json',{id:'browser-bracket',tournamentId:event.id,status:'PUBLISHED',rankingPolicy:TEST_RULES,divisionKey,athleteCount:2,roundCount:1});
 await seed('athletes/browser-a.json',{userId:'browser-a',displayName:'브라우저 공개 선수',publicProfile:true});
 await seed('athletes/browser-b.json',{userId:'browser-b',displayName:'노출금지 이름',publicProfile:false});
 await seed('matches/browser-match.json',{id:'browser-match',bracketId:'browser-bracket',tournamentId:event.id,divisionKey,roundNo:1,sequenceNo:1,matNo:1,status:'SCHEDULED',athleteA:{userId:'browser-a',socId:'SOC-browser-a',name:'브라우저 공개 선수'},athleteB:{userId:'browser-b',socId:'SOC-browser-b',name:'노출금지 이름'}});
 await desktop.goto(base+'/tournament-ops.html');await desktop.getByRole('button',{name:'선수 호출',exact:true}).click();await desktop.getByRole('button',{name:'경기 시작',exact:true}).click();await desktop.waitForFunction(()=>document.getElementById('opsMatches').textContent.includes('경기 중'));
 desktop.once('dialog',dialog=>dialog.accept('격리 시험 대진 공개'));await desktop.getByRole('button',{name:'대진 공개',exact:true}).click();await desktop.getByRole('button',{name:'공개 중단',exact:true}).waitFor();
 await page.goto(base+'/live.html');await page.getByText('브라우저 공개 선수 vs 비공개 선수',{exact:true}).waitFor();assert(!(await page.locator('body').innerText()).includes('노출금지 이름'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'live mobile horizontal overflow');
 await desktop.locator('#winnerSelect').selectOption('browser-a');await desktop.getByRole('button',{name:'결과 저장',exact:true}).click();await desktop.waitForFunction(()=>document.getElementById('resultMsg').textContent==='결과 저장 완료');
 await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByText('승자: 브라우저 공개 선수',{exact:true}).waitFor();
 await desktop.goto(base+'/live.html');await desktop.getByText('승자: 브라우저 공개 선수',{exact:true}).waitFor();assert(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'live desktop horizontal overflow');
 await context.setOffline(true);await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.waitForFunction(()=>document.getElementById('liveBrackets').childElementCount===0);await context.setOffline(false);
 // Install SW, inspect sensitive cache exclusion and offline save feedback.
 await page.goto(base+'/athlete-app.html'); // logged out, route redirects to login
 await page.goto(base+'/ranking.html');await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 const paths=await page.evaluate(async()=>{const names=await caches.keys();const keys=(await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).map(r=>new URL(r.url).pathname)))).flat();return keys});
 assert(!paths.some(p=>p.startsWith('/api/')||/admin|athlete-app|my-soc|certificate|setup|payments|security/.test(p)));
 await context.setOffline(true);const offline=await page.evaluate(()=>SOC.post('/api/auth/login',{email:'none@example.test',password:'none'}));assert.equal(offline.ok,false);assert.equal(offline.error,'network_error');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,browser:'Chromium',views:['390x844','1365x900'],checks:['signup/login/logout','second-browser profile and SOC ID persistence','role denial','admin tournament and division creation','draft rules','bank account setup and deposit claim','staff receipt and refund ledger','MFA enrollment recovery and logout all','match call/start/result UI','explicit bracket publication and privacy','live board mobile and desktop','offline board clears stale status','no horizontal overflow on athlete page','operations work creation, evidence, submission and self approval denial','refund independent review','no sensitive SW cache','offline mutation failure'],productionDataUsed:false}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await local.close();}
