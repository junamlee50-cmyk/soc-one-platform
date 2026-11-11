(()=>{
 const host=document.getElementById('homeEvents');
 if(!host)return;
 const strip=document.getElementById('homeSeasonStatus');let revision=0;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const season=(title,description)=>{if(strip)strip.replaceChildren(el('b',title),document.createTextNode(' '+description));};
 async function load(){
  const request=++revision;host.replaceChildren(el('p','대회 일정을 불러오고 있습니다.'));season('대회 일정','공개된 일정을 확인하고 있습니다.');
  const data=await SOC.get('/api/tournaments');if(request!==revision)return;host.replaceChildren();
  if(!data.ok){const box=el('div',null,'eventEmpty');box.append(el('p','대회 정보를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'));const retry=el('button','대회 일정 다시 불러오기','btn');retry.type='button';retry.onclick=load;box.append(retry);host.append(box);season('일정 확인 필요','대회 목록을 다시 불러와 주세요.');return;}
  const at=Date.now(),koreanDay=value=>new Date(value+9*60*60*1000).toISOString().slice(0,10),today=koreanDay(at);
  const upcoming=(data.tournaments||[]).filter(t=>t.status!=='COMPLETED'&&(!Number.isFinite(Date.parse(t.startAt))||koreanDay(Date.parse(t.startAt))>=today)).sort((a,b)=>(Date.parse(a.startAt)||Infinity)-(Date.parse(b.startAt)||Infinity));
  if(!upcoming.length){host.append(el('div','다음 대회를 준비하고 있습니다. 일정과 장소가 확정되면 이곳에서 안내합니다.','eventEmpty'));season('다음 대회 준비 중','일정과 접수 시작일은 확정되는 대로 안내합니다.');return;}
  const openCount=upcoming.filter(t=>SOC.registrationState(t,at).open).length;
  season(openCount?'대회 접수 중':'대회 일정 안내',openCount?'참가할 대회와 접수 마감일을 확인해 주세요.':'대회별 일정과 접수 기간을 확인해 주세요.');
  for(const t of upcoming.slice(0,3)){const card=el('article',null,'card eventCard');if(t.posterImage){const img=el('img');img.src=t.posterImage;img.alt=t.name+' 포스터';img.loading='lazy';card.append(img);}const body=el('div',null,'eventBody');body.append(el('span',SOC.registrationState(t,at).label,'pill'),el('h3',t.name),el('p',(Number.isFinite(Date.parse(t.startAt))?new Date(t.startAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'일정 미정')+' · '+(t.venueName||'장소 미정'),'eventMeta'));if(t.summary)body.append(el('p',t.summary));const a=el('a','대회 안내 보기 →','btn gold');a.href='/competition.html?tournamentId='+encodeURIComponent(t.id);body.append(a);card.append(body);host.append(card);}
 }
 document.addEventListener('soc:session',load);
 document.addEventListener('soc:public-update',load);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load();});
 load();
})();
