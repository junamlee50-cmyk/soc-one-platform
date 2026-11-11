import assert from 'node:assert/strict';

export async function inspectHome({browser,base,demoLocal,errors}){
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const at=Date.now(),day=86400000,iso=offset=>new Date(at+offset).toISOString();
 const event={id:'home-session-fixture',name:'홈 갱신 시험 대회',status:'REGISTRATION_OPEN',startAt:iso(day*20),registrationOpenAt:iso(-day),registrationCloseAt:iso(day*10),fees:{regular:59000,additionalDiscipline:29000,absolute:25000},venueName:'가상 검수 경기장'};
 await demoLocal.query('INSERT INTO soc_records(path,value) VALUES($1,$2::jsonb)', ['tournaments/'+event.id+'.json',JSON.stringify(event)]);
 const login=async()=>{
  const footer=page.locator('footer');await footer.getByRole('combobox',{name:'시험 계정 선택'}).selectOption({label:'테스트 관장'});
  await footer.getByRole('button',{name:'테스트 관장 자동입력',exact:true}).click();await page.locator('#accountSubmit').click();await page.locator('#accountDialog').waitFor({state:'hidden'});
 };
 try{
  await page.goto(base+'/');await page.locator('#homeEvents .eventCard').first().waitFor();
  assert(!(await page.locator('#homeEvents').innerText()).includes(event.name));
  await login();await page.locator('#homeEvents').getByRole('heading',{name:event.name,exact:true}).waitFor();
  assert.match(await page.locator('#homeSeasonStatus').innerText(),/대회 접수 중/);
  await page.goto(base+'/competition.html');await page.locator('#eventGrid').getByRole('heading',{name:event.name,exact:true}).waitFor();
  await page.getByRole('banner').getByRole('button',{name:'로그아웃',exact:true}).click();
  await page.locator('#eventGrid').getByRole('heading',{name:event.name,exact:true}).waitFor({state:'detached'});
  await page.locator('#eventGrid .eventCard').first().waitFor();
  assert(!(await page.locator('#eventGrid').innerText()).includes(event.name));
  await login();await page.locator('#eventGrid').getByRole('heading',{name:event.name,exact:true}).waitFor();
  assert((await page.locator('#regTournament option').allTextContents()).includes(event.name));
  await page.goto(base+'/');await page.locator('#homeEvents').getByRole('heading',{name:event.name,exact:true}).waitFor();
  await page.getByRole('banner').getByRole('button',{name:'로그아웃',exact:true}).click();
  await page.locator('#homeEvents').getByRole('heading',{name:event.name,exact:true}).waitFor({state:'detached'});
  await page.locator('#homeEvents .eventCard').first().waitFor();
  assert(!(await page.locator('#homeEvents').innerText()).includes(event.name));

  const events=[0,1,2].map(n=>({...event,id:'past-'+n,name:'지난 대회 '+n,startAt:iso(-day*(n+1)),status:n===0?'COMPLETED':'REGISTRATION_OPEN'}));
  events.push({...event,id:'opens-later',name:'접수 시작 전 대회',registrationOpenAt:iso(day)}, {...event,id:'deadline',name:'접수 마감 대회',registrationCloseAt:iso(-day)},event);
  let fail=false;
  await page.route(/\/api\/tournaments(?:\/index)?$/,route=>route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{ok:false}:{ok:true,tournaments:events})}));
  await page.reload();await page.locator('#homeEvents .eventCard').nth(2).waitFor();
  assert.equal(await page.locator('#homeEvents .eventCard').count(),3);
  assert(!(await page.locator('#homeEvents').innerText()).includes('지난 대회'));
  const card=name=>page.locator('#homeEvents .eventCard').filter({hasText:name});
  assert.equal(await card('접수 시작 전 대회').locator('.pill').innerText(),'접수 예정');
  assert.equal(await card('접수 마감 대회').locator('.pill').innerText(),'접수 마감');
  assert.equal(await card(event.name).locator('.pill').innerText(),'접수 중');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(base+'/competition.html');await page.locator('#eventGrid .eventCard').nth(5).waitFor();
  const registrationCard=name=>page.locator('#eventGrid .eventCard').filter({hasText:name});
  assert.equal(await registrationCard('접수 시작 전 대회').locator('.pill').innerText(),'접수 예정');
  assert.equal(await registrationCard('접수 마감 대회').locator('.pill').innerText(),'접수 마감');
  assert.equal(await registrationCard('접수 마감 대회').getByRole('link',{name:'이 대회 참가신청'}).count(),0);
  fail=true;await page.goto(base+'/');await page.getByRole('button',{name:'대회 일정 다시 불러오기',exact:true}).waitFor();
  assert.match(await page.locator('#homeSeasonStatus').innerText(),/일정 확인 필요/);
  fail=false;await page.getByRole('button',{name:'대회 일정 다시 불러오기',exact:true}).click();await page.locator('#homeEvents .eventCard').nth(2).waitFor();
  assert.match(await page.locator('#homeSeasonStatus').innerText(),/대회 접수 중/);
  console.log(JSON.stringify({homeReview:true,checks:['real demo login/logout refresh on home and competition','actual registration-window badges','upcoming events exclude past events','failed load and retry','mobile overflow'],testDataOnly:true}));
 }finally{await context.close();}
}
