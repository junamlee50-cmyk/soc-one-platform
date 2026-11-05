const liveLabels={SCHEDULED:'경기 대기',CALLED:'선수 호출',IN_PROGRESS:'경기 중',COMPLETED:'경기 종료',BYE:'부전승'};
let liveRequest=0;
function liveTime(value){return value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미정';}
async function refreshLiveBoard(){
  if(!liveTournament.value)return;const serial=++liveRequest;refreshLive.disabled=true;
  const data=await SOC.get('/api/public?op=brackets&tournamentId='+encodeURIComponent(liveTournament.value));
  if(serial!==liveRequest)return;refreshLive.disabled=false;
  if(!data.ok){liveBrackets.replaceChildren();liveMsg.textContent=(data.message||'경기 정보를 갱신하지 못했습니다.')+' 현장 안내를 확인해 주세요.';return;}
  liveBrackets.replaceChildren();
  liveMsg.textContent=data.brackets.length?'마지막 확인: '+liveTime(data.updatedAt)+' · 15초마다 갱신':'아직 공개된 대진이 없습니다.';
  for(const b of data.brackets){
    const section=document.createElement('section');section.className='panel liveRound';const title=document.createElement('h2');title.textContent=b.divisionKey.replaceAll('|',' · ');section.append(title);
    for(const m of b.matches){const row=document.createElement('article');row.className='liveMatch';row.dataset.state=m.status;
      const state=document.createElement('p');state.textContent='R'+m.roundNo+' #'+m.sequenceNo+' · 매트 '+(m.matNo||'미배정')+' · '+(liveLabels[m.status]||'확인 중');
      const players=document.createElement('strong');players.textContent=(m.athleteA?.name||'진출 대기')+' vs '+(m.athleteB?.name||'진출 대기');
      const detail=document.createElement('p');detail.textContent=m.winnerSide?'승자: '+(m['athlete'+m.winnerSide]?.name||'확인 중'):'예정: '+liveTime(m.scheduledAt);
      row.append(state,players,detail);section.append(row);
    }liveBrackets.append(section);
  }
}
async function initLive(){const data=await SOC.get('/api/tournaments');if(!data.ok){liveMsg.textContent=data.message||'공개 대회를 불러오지 못했습니다.';return;}
  const rows=data.tournaments.filter(t=>['REGISTRATION_OPEN','PUBLISHED','CLOSED','COMPLETED'].includes(t.status));
  for(const t of rows){const option=document.createElement('option');option.value=t.id;option.textContent=t.name;liveTournament.append(option);}
  if(!rows.length){liveMsg.textContent='공개된 대회가 없습니다.';return;}
  const requested=new URL(location.href).searchParams.get('tournamentId');if(rows.some(t=>t.id===requested))liveTournament.value=requested;
  await refreshLiveBoard();
}
refreshLive.onclick=refreshLiveBoard;liveTournament.onchange=refreshLiveBoard;
const liveTimer=setInterval(()=>{if(!document.hidden)refreshLiveBoard();},15000);
window.addEventListener('pagehide',()=>clearInterval(liveTimer));
window.addEventListener('offline',()=>{liveBrackets.replaceChildren();liveMsg.textContent='오프라인입니다. 경기 상태를 확인할 수 없습니다. 현장 안내를 따라 주세요.';});
initLive();
