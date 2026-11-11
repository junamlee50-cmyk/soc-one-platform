import {readdir,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function inspectPages({page,base,query}){
 const u=(await page.request.get(base+'/api/auth/me')).ok()?await (await page.request.get(base+'/api/auth/me')).json():null;
 assert(u?.user);const original=(await query("SELECT value FROM soc_records WHERE path=$1",['users/'+u.user.id+'.json'])).rows[0].value;
 await query("UPDATE soc_records SET value=jsonb_set(value,'{roles}',$2::jsonb) WHERE path=$1",['users/'+u.user.id+'.json',JSON.stringify(['CEO','ADMIN','STAFF','FINANCE','COACH','ATHLETE','REFEREE','COMMITTEE'])]);
 const pages=(await readdir('.')).filter(f=>f.endsWith('.html')),results=[];
 try{for(const file of pages){
  await page.setViewportSize({width:1365,height:900});await page.goto(base+'/'+file);await page.waitForLoadState('networkidle');
  const desktop=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,title:document.title,controls:[...document.querySelectorAll('button,a,input,select,textarea,summary')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName.toLowerCase(),id:e.id,label:(e.labels?.[0]?.textContent||e.getAttribute('aria-label')||e.textContent||e.placeholder||'').trim().slice(0,150),href:e.getAttribute('href'),type:e.getAttribute('type'),disabled:!!e.disabled}))}));
  await page.setViewportSize({width:360,height:800});const mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,wide:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getClientRects().length).slice(0,7).map(e=>({tag:e.tagName,id:e.id,class:e.className}))}));
  results.push({page:file,...desktop,mobile});
 }
 await mkdir('docs/qa',{recursive:true});await writeFile('docs/qa/ui-control-inventory.json',JSON.stringify({generatedAt:new Date().toISOString(),source:'isolated Chromium; populated synthetic accounts; visible controls only; not proof of all mutations',results},null,2)+'\n');
 const bad=results.filter(r=>r.overflow||r.mobile.overflow);assert.deepEqual(bad.map(r=>({page:r.page,desktop:r.overflow,mobile:r.mobile})),[],'page overflow');console.log(JSON.stringify({pageInventory:true,pages:results.length,viewports:[1365,360],visibleControls:results.reduce((n,r)=>n+r.controls.length,0)}));
 }finally{await query('UPDATE soc_records SET value=$2::jsonb WHERE path=$1',['users/'+u.user.id+'.json',JSON.stringify(original)]);}
}
