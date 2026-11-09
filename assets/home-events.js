(async()=>{
 const host=document.getElementById('homeEvents');
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const data=await SOC.get('/api/tournaments');host.replaceChildren();
 if(!data.ok||!data.tournaments?.length){host.append(el('div',data.ok?'다음 대회를 준비하고 있습니다. 일정과 장소가 확정되면 이곳에서 안내합니다.':'대회 정보를 불러오지 못했습니다. 대회 안내에서 다시 확인해 주세요.','eventEmpty'));return;}
 const labels={COMING_SOON:'공개 예정',REGISTRATION_OPEN:'접수 안내',PUBLISHED:'대회 안내',CLOSED:'접수 마감',COMPLETED:'대회 종료'};
 for(const t of data.tournaments.slice(0,3)){const card=el('article',null,'card eventCard');if(t.posterImage){const img=el('img');img.src=t.posterImage;img.alt=t.name+' 포스터';img.loading='lazy';card.append(img);}const body=el('div',null,'eventBody');body.append(el('span',labels[t.status]||'대회 안내','pill'),el('h3',t.name),el('p',(t.startAt?new Date(t.startAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'일정 미정')+' · '+(t.venueName||'장소 미정'),'eventMeta'));if(t.summary)body.append(el('p',t.summary));const a=el('a','대회 안내 보기 →','btn gold');a.href='/competition.html?tournamentId='+encodeURIComponent(t.id);body.append(a);card.append(body);host.append(card);}
})();
