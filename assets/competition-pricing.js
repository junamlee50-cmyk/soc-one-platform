function appendFeeSchedule(parent,t){
 const wrap=document.createElement('div');wrap.className='feeSchedule';
 const fmt=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'미정';
 for(const fee of t.feeSchedule||[]){
  const row=document.createElement('div'),title=document.createElement('strong'),amount=document.createElement('span'),period=document.createElement('small');row.className='feeScheduleRow';
  title.textContent=fee.label;amount.textContent=Number.isSafeInteger(fee.amount)?SOC.money(fee.amount):'금액 미정';period.textContent=fmt(fee.startsAt)+'부터 '+fmt(fee.endsAt)+' 이전';row.append(title,amount,period);wrap.append(row);
 }
 for(const [key,label]of [['additionalDiscipline','추가 GI·NO-GI'],['absolute','앱솔루트']])if(Number.isSafeInteger(t.fees?.[key])){const p=document.createElement('p');p.textContent=label+' '+SOC.money(t.fees[key])+' (등록 기간 공통)';wrap.append(p);}
 const note=document.createElement('small');note.textContent='한국시간 기준 · 신청 완료 시점의 요금 적용';wrap.append(note);parent.append(wrap);
}
let registrationQuote=null,quoteRequest=0;
async function refreshRegistrationQuote(){
 const request=++quoteRequest;registrationQuote=null;regSubmit.disabled=true;
 const tournamentId=regTournament.value,divisionId=regDivision.value,discountCode=regDiscountCode.value.trim().toUpperCase();
 if(!tournamentId||!divisionId){regPrice.textContent='대회와 참가 부문을 선택해 주세요.';return;}
 regPrice.textContent='신청금액을 확인하고 있습니다.';
 const d=await SOC.get('/api/member?op=registration-quote&'+new URLSearchParams({tournamentId,divisionId,discountCode}));
 if(request!==quoteRequest)return;
 if(!d.ok){regPrice.textContent=({fee_not_configured:'이 부문의 참가비가 아직 설정되지 않았습니다.',base_discipline_required:'앱솔루트는 같은 종목의 체급 부문을 먼저 신청해야 합니다.',invalid_discount:'사용할 수 없는 할인코드입니다.',discount_expired:'할인코드 적용 기간이 아닙니다.',discount_not_applicable:'선택한 부문에 적용할 수 없는 할인코드입니다.'}[d.error]||'신청금액을 확인하지 못했습니다. 로그인 상태와 참가 부문을 확인해 주세요.');return;}
 registrationQuote={...d,tournamentId,divisionId,discountCode};
 const phase={EARLY:'사전등록',REGULAR:'일반등록'}[d.price.phase],kind={BASE:'',ADDITIONAL_DISCIPLINE:' · 추가 GI·NO-GI',ABSOLUTE:' · 앱솔루트'}[d.price.kind];
 regPrice.textContent=phase+kind+' · 신청금액 '+SOC.money(d.price.amount)+(d.price.discountAmount?' (할인 '+SOC.money(d.price.discountAmount)+')':'');regSubmit.disabled=false;
}
