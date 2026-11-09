(()=>{
 const el=id=>document.getElementById(id);
 const filter=el('registrationTournament'),payment=el('registrationPayment'),search=el('registrationSearch');
 const list=el('registrationList'),summary=el('registrationSummary'),message=el('registrationMessage');
 let records=[],events=[],requestId=0;
 const labels={PAID:'입금 확인',UNPAID:'미입금',PENDING:'입금 확인 요청',REFUND_REQUESTED:'환불 요청',REFUNDED:'환불 완료',CANCELED:'취소'};
 const state=r=>['CANCELED','REFUNDED'].includes(r.status)?r.status:r.paymentStatus;
 function render(){
  const term=search.value.trim().toLocaleLowerCase();
  const shown=records.filter(r=>(!payment.value||state(r)===payment.value)&&(!term||[r.athleteName,r.socId,r.id].some(v=>String(v||'').toLocaleLowerCase().includes(term))));
  list.replaceChildren();el('registrationCount').textContent='목록 '+shown.length+'건 / 선택한 대회 전체 '+records.length+'건';
  for(const r of shown){
   const row=document.createElement('div');row.className='dataRow registrationRow';
   const info=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('p'),reference=document.createElement('small');
   name.textContent=(r.athleteName||'이름 미등록')+' · '+(r.socId||'SOC ID 확인 필요');
   details.textContent=(events.find(t=>t.id===r.tournamentId)?.name||'대회 정보 확인 필요')+' · '+[r.discipline,r.ageGroup,r.belt,r.weightClass,r.absolute?'앱솔루트':''].filter(Boolean).join(' / ');
   reference.textContent=r.id+' · 신청금액 '+SOC.money(r.amount||0);info.append(name,details,reference);
   const action=document.createElement('div'),status=document.createElement('span'),link=document.createElement('a');action.className='registrationAction';status.className='badge';status.textContent=labels[state(r)]||state(r)||'상태 확인 필요';link.className='btn';link.href='/payments?registrationId='+encodeURIComponent(r.id);link.textContent='입금·환불 상세';action.append(status,link);row.append(info,action);list.append(row);
  }
  if(!shown.length){const empty=document.createElement('p');empty.textContent='조건에 맞는 신청 내역이 없습니다.';list.append(empty);}
 }
 SOC.loadAdminRegistrations=async function(){
  const current=++requestId,selected=filter.value;records=[];summary.replaceChildren();list.replaceChildren();el('registrationCount').textContent='';message.textContent='신청 현황을 불러오고 있습니다.';
  const result=await SOC.get('/api/admin/registrations'+(selected?'?tournamentId='+encodeURIComponent(selected):''));
  if(current!==requestId)return;
  if(!result.ok){message.textContent=result.message||'신청 현황을 불러오지 못했습니다. 다시 로그인하거나 새로고침해 주세요.';return;}
  records=result.registrations;events=result.tournaments;filter.replaceChildren(new Option('전체 대회',''));
  for(const t of events)filter.append(new Option(t.name+(t.archived?' (보관)':'')+' · '+t.summary.activeParticipants+'명 / '+t.summary.activeEntries+'건',t.id));
  filter.value=selected;const s=result.summary;
  for(const [key,label,unit]of [['activeParticipants','신청 선수','명'],['activeEntries','종목별 신청','건'],['confirmedParticipants','입금 확인 선수','명'],['pendingEntries','입금 대기','건'],['refundRequestedEntries','환불 요청','건'],['canceledEntries','취소','건'],['refundedEntries','환불 완료','건']]){
   const card=document.createElement('div'),value=document.createElement('strong'),caption=document.createElement('small');card.className='kpi';card.dataset.metric=key;value.textContent=s[key]+unit;caption.textContent=label;card.append(value,caption);summary.append(card);
  }
  message.textContent='선수 인원은 계정별 중복을 제외합니다. 취소·환불 완료는 신청 선수와 종목별 신청에서 제외하며, 환불 요청은 처리 전까지 포함합니다. 아래 검색은 목록에만 적용됩니다.'+(s.unknownIdentityEntries?' 계정 식별정보가 없는 '+s.unknownIdentityEntries+'건은 인원수에서 제외되어 확인이 필요합니다.':'');
  render();
 };
 filter.addEventListener('change',()=>SOC.loadAdminRegistrations());payment.addEventListener('change',render);search.addEventListener('input',render);el('registrationReload').onclick=()=>SOC.loadAdminRegistrations();
})();
