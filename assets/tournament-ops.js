let regs=[],matches=[],brackets=[],stream=null,scanTimer=null,isStaff=false,canCorrect=false,refreshId=0;
const esc=SOC.escape;
const states={SCHEDULED:'대기',CALLED:'선수 호출',IN_PROGRESS:'경기 중',COMPLETED:'종료',BYE:'부전승'};
const showError=d=>d.message||({mat_busy:'해당 매트에 호출·진행 중인 경기가 있습니다.',athlete_busy:'선수가 다른 경기에 호출되었거나 경기 중입니다.',match_not_started:'경기 시작 후 결과를 입력해 주세요.',mat_not_assigned:'배정된 매트·시간의 권한이 없습니다.',assignment_schedule_conflict:'심판 또는 매트의 배정 시간이 겹칩니다.'}[d.error])||d.error||'처리에 실패했습니다.';
async function boot(){
  const u=await SOC.requireRoles(['REFEREE','STAFF','ADMIN','CEO']);if(!u)return;
  canCorrect=u.roles.some(r=>['ADMIN','CEO'].includes(r));isStaff=u.roles.some(r=>['STAFF','ADMIN','CEO'].includes(r));
  if(!isStaff){for(const id of ['qrPayload','weighReg','bracketDivision','opsRegs'])document.getElementById(id).closest('.panel').hidden=true;document.querySelector('[onclick="startScanner()"]').hidden=true;}
  const t=await SOC.get('/api/operations/tournaments');
  if(!t.ok){opsMsg.textContent=showError(t);return;}
  opTournament.innerHTML=t.tournaments.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
  if(!t.tournaments.length)opsMsg.textContent='현재 운영 가능한 대회 또는 유효한 심판 배정이 없습니다.';
  opTournament.addEventListener('change',refreshAll);await refreshAll();
}
async function refreshAll(){
  if(!opTournament.value)return;const request=++refreshId,id=encodeURIComponent(opTournament.value);
  const [r,m,d,b]=await Promise.all([isStaff?SOC.get('/api/operations/registrations?tournamentId='+id):{ok:true,registrations:[]},SOC.get('/api/operations/matches?tournamentId='+id),isStaff?SOC.get('/api/divisions/index?tournamentId='+id):{ok:true,divisions:[]},isStaff?SOC.get('/api/operations/brackets?tournamentId='+id):{ok:true,brackets:[]}]);
  if(request!==refreshId)return;
  const failure=[r,m,d,b].find(x=>!x.ok);if(failure){opsMsg.textContent=showError(failure)+' · 표시 자료를 갱신하지 못했습니다.';return;}
  regs=r.registrations;matches=m.matches;brackets=b.brackets;renderRegs();renderMatches();renderBrackets();
  bracketDivision.innerHTML=d.divisions.map(x=>'<option value="'+esc(x.key)+'">'+esc([x.discipline,x.ageGroup,x.belt,x.weightClass,x.absolute?'앱솔루트':''].filter(Boolean).join(' · '))+'</option>').join('');
}
function renderRegs(){
  weighReg.innerHTML=regs.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.athleteName+' · '+x.weightClass+' · '+x.paymentStatus)+'</option>').join('');
  opsRegs.innerHTML=regs.map(x=>'<div class="dataRow"><span>'+esc(x.athleteName+' · '+x.discipline+' '+x.weightClass)+'<br><small>'+esc(x.paymentStatus+' · '+(x.checkInStatus||'NOT_CHECKED_IN'))+'</small></span><b>'+esc(x.weighInStatus||'NOT_WEIGHED')+'</b></div>').join('')||'<p>참가자가 없습니다.</p>';
}
function actionButton(label,action){const button=document.createElement('button');button.className='btn';button.textContent=label;button.onclick=async()=>{button.disabled=true;try{await action();}finally{button.disabled=false;}};return button;}
function renderMatches(){
  matchSelect.innerHTML=matches.filter(x=>['SCHEDULED','CALLED','IN_PROGRESS'].includes(x.status)&&x.athleteA&&x.athleteB&&(isStaff||x.status==='IN_PROGRESS')).map(x=>'<option value="'+esc(x.id)+'">'+esc('R'+x.roundNo+' #'+x.sequenceNo+' · '+x.athleteA.name+' vs '+x.athleteB.name)+'</option>').join('');
  opsMatches.replaceChildren();
  for(const x of matches){
    const row=document.createElement('div');row.className='panel';row.style.marginBottom='12px';const label=document.createElement('p');
    label.textContent='R'+x.roundNo+' #'+x.sequenceNo+' · '+(x.athleteA?.name||'진출 대기')+' vs '+(x.athleteB?.name||'진출 대기')+' · '+(states[x.status]||x.status)+' · 매트 '+(x.matNo||'미배정');row.append(label);
    const buttons=document.createElement('div');buttons.className='quickActions';
    if(isStaff&&x.status==='SCHEDULED')buttons.append(actionButton('매트·시간 배정',()=>scheduleMatch(x.id)));
    if(x.status==='SCHEDULED'&&x.athleteA&&x.athleteB)buttons.append(actionButton('선수 호출',()=>changeState(x.id,'CALL')));
    if(x.status==='CALLED')buttons.append(actionButton('경기 시작',()=>changeState(x.id,'START')));
    if(isStaff&&['CALLED','IN_PROGRESS'].includes(x.status))buttons.append(actionButton('호출·시작 취소',()=>changeState(x.id,'RESET')));
    if(canCorrect&&x.status==='COMPLETED')buttons.append(actionButton('결과 정정',()=>correctResult(x.id)));
    if(isStaff){
      const form=document.createElement('form'),videoLabel=document.createElement('label'),video=document.createElement('input'),reasonLabel=document.createElement('label'),reason=document.createElement('input'),save=document.createElement('button');
      video.id='matchVideo_'+x.id;video.type='url';video.value=x.videoUrl||'';video.placeholder='https://www.youtube.com/watch?v=...';videoLabel.htmlFor=video.id;videoLabel.textContent='유튜브 경기 영상';reason.id='videoReason_'+x.id;reason.required=true;reason.maxLength=500;reasonLabel.htmlFor=reason.id;reasonLabel.textContent='영상 등록·변경 사유';save.type='submit';save.className='btn';save.textContent='영상 저장';form.append(videoLabel,video,reasonLabel,reason,save);form.style.marginTop='16px';
      form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const d=await SOC.post('/api/operations/match-video',{matchId:x.id,revision:x.videoRevision||0,videoUrl:video.value,reason:reason.value});opsMsg.textContent=d.ok?'경기 영상을 저장했습니다.':showError(d);if(d.ok)await refreshAll();}finally{save.disabled=false;}};row.append(form);
    }
    row.append(buttons);opsMatches.append(row);
  }
  if(!matches.length)opsMatches.textContent='대진이 없습니다.';updateWinner();
}
function renderBrackets(){
  opsBrackets.replaceChildren();for(const b of brackets){const row=document.createElement('div');row.className='panel';const text=document.createElement('p');text.textContent=b.divisionKey+' · '+(b.publicVisible?'공개 중':'비공개');row.append(text,actionButton(b.publicVisible?'공개 중단':'대진 공개',async()=>{const reason=prompt('공개 설정 변경 사유');if(!reason)return;const d=await SOC.post('/api/operations/bracket-visibility',{bracketId:b.id,visible:!b.publicVisible,reason});opsMsg.textContent=d.ok?'공개 설정을 저장했습니다.':showError(d);if(d.ok)await refreshAll();}));opsBrackets.append(row);}
}
matchSelect.addEventListener('change',updateWinner);
function updateWinner(){const m=matches.find(x=>x.id===matchSelect.value);winnerSelect.innerHTML=m?[m.athleteA,m.athleteB].filter(Boolean).map(x=>'<option value="'+esc(x.userId)+'">'+esc(x.name)+'</option>').join(''):'';}
async function changeState(matchId,action){const reason=action==='RESET'?prompt('호출·시작 취소 사유'):undefined;if(action==='RESET'&&!reason)return;const d=await SOC.post('/api/operations/match-state',{matchId,action,reason});opsMsg.textContent=d.ok?'경기 상태를 저장했습니다.':showError(d);if(d.ok)await refreshAll();}
async function checkIn(){const d=await SOC.post('/api/operations/checkin',{payload:qrPayload.value});checkMsg.textContent=d.ok?'체크인 완료: '+d.registration.athleteName:showError(d);if(d.ok)await refreshAll();}
async function weighIn(){const d=await SOC.post('/api/operations/weighin',{registrationId:weighReg.value,weightKg:weighKg.value});weighMsg.textContent=d.ok?(d.weighIn.passed?'계체 통과':'계체 실패'):showError(d);if(d.ok)await refreshAll();}
async function createBracket(){const d=await SOC.post('/api/operations/bracket',{tournamentId:opTournament.value,divisionKey:bracketDivision.value});bracketMsg.textContent=d.ok?'대진 생성 완료 · '+d.matches.length+'경기':showError(d);if(d.ok)await refreshAll();}
async function saveResult(){const d=await SOC.post('/api/operations/result',{matchId:matchSelect.value,winnerUserId:winnerSelect.value,winMethod:winMethod.value});resultMsg.textContent=d.ok?'결과 저장 완료':showError(d);if(d.ok)await refreshAll();}
async function scheduleMatch(id){const matNo=Number(prompt('매트 번호'));if(!Number.isInteger(matNo)||matNo<1)return;const start=prompt('시작 일시 (한국시간 예: 2027-03-01T10:00:00+09:00)');if(!start||!Number.isFinite(Date.parse(start)))return;const minutes=Number(prompt('예정 경기·정리 시간 (분)','10'));if(!Number.isFinite(minutes)||minutes<=0)return;const reason=prompt('배정·변경 사유');if(!reason)return;const d=await SOC.post('/api/operations/schedule',{matchId:id,matNo,scheduledAt:new Date(start).toISOString(),scheduledEndAt:new Date(Date.parse(start)+minutes*60000).toISOString(),reason});opsMsg.textContent=d.ok?'매트·시간 배정 완료':showError(d);if(d.ok)await refreshAll();}
async function correctResult(id){const reason=prompt('결과 정정 사유');if(!reason||!confirm('이 경기와 후속 결과를 무효로 하고 다시 입력합니다. 메달·점수와 증명서도 정정됩니다. 진행할까요?'))return;const d=await SOC.post('/api/operations/correct-result',{matchId:id,reason,acknowledgeDownstreamReset:true});opsMsg.textContent=d.ok?'정정 준비 완료: '+d.correction.matchIds.length+'경기를 다시 입력해 주세요.':showError(d);if(d.ok)await refreshAll();}
async function startScanner(){stopScanner();if(!('BarcodeDetector' in window)){checkMsg.textContent='이 브라우저에서는 QR 문자열 직접입력 또는 외부 스캐너를 사용해 주세요.';return;}try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});scanVideo.srcObject=stream;scanVideo.style.display='block';const detector=new BarcodeDetector({formats:['qr_code']});scanTimer=setInterval(async()=>{try{const codes=await detector.detect(scanVideo);if(codes.length){qrPayload.value=codes[0].rawValue;checkMsg.textContent='QR 인식 완료';stopScanner();}}catch{}},400);}catch{stopScanner();checkMsg.textContent='카메라 권한 또는 사용 가능 상태를 확인해 주세요.';}}
function stopScanner(){if(scanTimer)clearInterval(scanTimer);scanTimer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;scanVideo.srcObject=null;scanVideo.style.display='none';}
window.addEventListener('pagehide',stopScanner);
boot();
