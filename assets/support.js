(()=>{
 const $=id=>document.getElementById(id);let revision=0;
 const tiers={DEVELOPMENT:'육성선수',SUPPORTED:'지원선수',ELITE:'엘리트선수',PRO:'프로 초청매치'};
 async function load(){
  const request=++revision;$('supList').replaceChildren();const user=await SOC.me();if(request!==revision)return;
  if(!user){$('supList').textContent='로그인하면 내 사전등록 내역을 확인할 수 있습니다.';return;}
  if(!user.roles.includes('ATHLETE')){$('supList').textContent='선수 계정으로 사전등록할 수 있습니다.';return;}
  const result=await SOC.get('/api/support/index');if(request!==revision)return;
  if(!result.ok){$('supList').textContent='내역을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';return;}
  for(const row of result.applications){const item=document.createElement('div');item.className='dataRow';const title=document.createElement('span'),status=document.createElement('b');title.textContent=row.season+' · '+(tiers[row.tier]||row.tier);status.textContent=row.status==='DRAFT_SCORED'?'검토 중 · 선발 확정 전':row.status==='WITHDRAWN'?'철회':row.applicationKind==='INTEREST'?'사전등록 완료':'접수 기록 · 선발 확정 전';item.append(title,status);$('supList').append(item);}
  if(!result.applications.length)$('supList').textContent='아직 사전등록 내역이 없습니다.';
 }
 $('supportInterestForm').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  try{const user=await SOC.me();if(!user){SOC.openAccount('login');return;}if(!user.roles.includes('ATHLETE')){$('supMsg').textContent='선수 계정으로 사전등록할 수 있습니다.';return;}
   const result=await SOC.post('/api/support/index',{season:$('supSeason').value,tier:$('supTier').value});
   $('supMsg').textContent=result.ok?'사전등록했습니다. 정식 모집 일정은 이 페이지에서 확인해 주세요.':result.error==='already_applied'?'이미 이 등급에 등록하셨습니다. 아래 내역을 확인해 주세요.':result.message||'사전등록하지 못했습니다. 잠시 후 다시 시도해 주세요.';if(result.ok)await load();
  }finally{button.disabled=false;}
 };
 document.addEventListener('soc:session',load);load();
})();
