const releaseEventList=document.getElementById('releaseEvents');
let workUser,workData={tasks:[],processes:[],assignees:[]},workSelected=null,processSelected='',workLoading=0,workBusy=false;
const labels={CANCELED:'취소',DRAFT:'작성 중',RETURNED:'보완 요청',IN_REVIEW:'승인 대기',APPROVED:'승인 · 실행 대기',COMPLETED:'실행 확인 완료'};
const actions={UPDATE:'담당·기한 변경',WITHDRAW:'승인 요청 철회',CANCEL:'취소',CREATE:'등록',SAVE:'작성 저장',SUBMIT:'승인 요청',APPROVE:'승인',RETURN:'보완 요청',COMPLETE:'실행 확인',REOPEN:'재검토'};
const errors={workflow_event_required:'대상에 실제 대회 ID를 입력해 주세요.',workflow_target_changed:'승인 요청 후 대회 설정이 바뀌었습니다. 보완 요청 후 다시 검토해 주세요.',reviewer_unavailable:'등록자·담당자와 다른 활성 관리자·대표를 승인자로 지정해 주세요.',designated_reviewer_required:'지정된 승인자만 검토할 수 있습니다.',change_reason_required:'변경 사유를 입력해 주세요.',workflow_revision_conflict:'다른 변경이 먼저 저장되었습니다. 새로고침 후 검토해 주세요.',independent_approver_required:'등록자·담당자는 자신의 업무를 승인할 수 없습니다. 다른 관리자에게 검토를 요청해 주세요.',workflow_evidence_required:'모든 확인 항목에 근거 또는 증빙 관리번호를 적어 주세요.',completion_evidence_required:'실제 실행 결과의 증빙 관리번호를 적어 주세요.',workflow_transition_invalid:'현재 상태에서는 이 처리를 할 수 없습니다.',workflow_owner_required:'지정된 담당자만 작성·실행 확인할 수 있습니다.',transactional_database_required:'운영 데이터베이스 연결 전에는 저장할 수 없습니다.',mfa_setup_required:'계정 보안에서 추가인증을 등록해 주세요.',invalid_workflow:'프로세스·담당자·제목·대상·기한을 확인해 주세요.'};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const date=v=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
const late=r=>!['COMPLETED','CANCELED'].includes(r.status)&&Date.parse(r.dueAt)<Date.now();
function renderWork(){
 workKpis.replaceChildren();for(const [title,value]of [['열린 업무',workData.tasks.filter(r=>!['COMPLETED','CANCELED'].includes(r.status)).length],['승인 대기',workData.tasks.filter(r=>r.status==='IN_REVIEW').length],['기한 경과',workData.tasks.filter(late).length],['실행 확인',workData.tasks.filter(r=>r.status==='COMPLETED').length]]){const n=el('div',undefined,'kpi');n.append(el('strong',value),el('small',title));workKpis.append(n);}
 processGrid.replaceChildren();for(const p of workData.processes){const b=el('button',undefined,'processCard'+(processSelected===p.id?' active':''));b.type='button';b.setAttribute('aria-pressed',String(processSelected===p.id));b.append(el('b',p.id+' '+p.title),el('span',p.description),el('span',workData.tasks.filter(r=>r.processId===p.id&&!['COMPLETED','CANCELED'].includes(r.status)).length+'건 진행 중'));b.onclick=()=>{processSelected=processSelected===p.id?'':p.id;renderWork();};processGrid.append(b);}
 workListHeading.textContent=processSelected?workData.processes.find(p=>p.id===processSelected).title:'전체 업무';
 const search=workSearch.value.trim().toLowerCase();const rows=workData.tasks.filter(r=>(!processSelected||r.processId===processSelected)&&(!statusFilter.value||(statusFilter.value==='OVERDUE'?late(r):r.status===statusFilter.value))&&[r.title,r.target,r.ownerName].join(' ').toLowerCase().includes(search));
 workList.replaceChildren();for(const r of rows){const b=el('button',undefined,'taskButton'+(r.id===workSelected?' active':''));b.append(el('b',r.title),el('small',r.processId+' · '+labels[r.status]+' · '+r.ownerName),el('small',r.target+' · '+date(r.dueAt)));if(late(r))b.append(el('span','기한 경과','overdue'));b.onclick=()=>{workSelected=r.id;renderWork();};workList.append(b);}if(!rows.length)workList.append(el('p','해당 조건의 업무가 없습니다.'));
 renderDetail();
}
function renderDetail(){
 workDetail.replaceChildren();const r=workData.tasks.find(x=>x.id===workSelected);if(!r){workDetail.append(el('h2','업무를 선택해 주세요'));return;}
 const p=workData.processes.find(p=>p.id===r.processId);workDetail.append(el('h2',r.title),el('p',labels[r.status]+' · '+r.ownerName+' · '+date(r.dueAt)),el('p','대상: '+r.target));
 const link=el('a','관련 업무 화면 열기','btn');link.href=p.href;workDetail.append(link);
 const editable=r.ownerId===workUser.id&&['DRAFT','RETURNED'].includes(r.status);
 const inputs=[];r.evidence.forEach((e,i)=>{const field=el('div',undefined,'field'),label=el('label',e.label),input=el('textarea');input.id='evidence-'+i;label.htmlFor=input.id;input.value=e.reference;input.maxLength=500;input.disabled=!editable;input.placeholder='근거·증빙 관리번호 (비밀번호·주민번호·전체 계좌번호 입력 금지)';field.append(label,input);inputs.push(input);workDetail.append(field);});
 const reasonLabel=el('label','처리 사유'),reason=el('textarea');reason.id='actionReason';reasonLabel.htmlFor=reason.id;reason.maxLength=500;workDetail.append(reasonLabel,reason);
 const completionLabel=el('label','실행 완료 증빙'),completion=el('input');completion.id='completionReference';completionLabel.htmlFor=completion.id;completion.value=r.completionReference||'';completion.maxLength=500;if(r.status==='APPROVED'||r.status==='COMPLETED')workDetail.append(completionLabel,completion);
 const controls=el('div',undefined,'quickActions');const canReview=workData.canApprove&&(!r.reviewerId||r.reviewerId===workUser.id)&&r.ownerId!==workUser.id&&r.createdBy!==workUser.id;
 function button(action,text){const b=el('button',text,'btn');b.disabled=workBusy;b.onclick=()=>{if(!reason.value.trim()){workStatus.textContent='처리 사유를 입력해 주세요.';reason.focus();return;}submitWork({id:r.id,revision:r.revision,action,reason:reason.value,evidence:inputs.map(x=>x.value),completionReference:completion.value});};controls.append(b);}
 if(r.status==='IN_REVIEW'&&r.ownerId===workUser.id)button('WITHDRAW','승인 요청 철회');
 if(workData.canApprove&&['DRAFT','RETURNED','IN_REVIEW'].includes(r.status))button('CANCEL','업무 취소');
 if(editable){button('SAVE','작성 저장');button('SUBMIT','승인 요청');}
 if(r.status==='IN_REVIEW'&&canReview){button('APPROVE','검토 승인');button('RETURN','보완 요청');}
 if(r.status==='IN_REVIEW'&&!canReview)workDetail.append(el('p','등록자·담당자와 다른 관리자 또는 대표가 검토합니다.'));
 if(r.status==='APPROVED'&&r.ownerId===workUser.id)button('COMPLETE','실행 증빙으로 완료');
 if(['APPROVED','COMPLETED'].includes(r.status)&&workData.canApprove)button('REOPEN','재검토로 되돌리기');
 workDetail.append(controls);
 if(workData.canApprove&&!['COMPLETED','CANCELED'].includes(r.status)){
  const panel=el('fieldset'),legend=el('legend','담당자·승인자·기한 변경'),owner=el('select'),reviewer=el('select'),due=el('input'),save=el('button','변경 후 재검토','btn');
  owner.id='editOwner';reviewer.id='editReviewer';due.id='editDue';due.type='text';due.dataset.socDate='datetime';due.required=true;due.value=SOCDate.toInput(r.dueAt);
  for(const u of workData.assignees){const o=el('option',u.name);o.value=u.id;owner.append(o);if(u.roles.some(x=>['ADMIN','CEO'].includes(x))&&u.id!==r.createdBy){const a=el('option',u.name);a.value=u.id;reviewer.append(a);}}
  owner.value=r.ownerId;reviewer.value=r.reviewerId||'';
  for(const [text,input]of [['담당자',owner],['승인자 (등록자·담당자 제외)',reviewer],['기한 (한국시간)',due]]){const label=el('label',text);label.htmlFor=input.id;panel.append(label,input);}
  save.onclick=()=>{if(!SOCDate.validate([due]))return;submitWork({id:r.id,revision:r.revision,action:'UPDATE',ownerId:owner.value,reviewerId:reviewer.value,dueAt:SOCDate.iso(due.value),reason:reason.value});};panel.prepend(legend);panel.append(save);workDetail.append(panel);
 }
 workDetail.append(el('h3','처리 이력'));const history=el('ol');history.id='workHistory';for(const e of r.history){const name=workData.assignees.find(u=>u.id===e.actorId)?.name||e.actorId;history.append(el('li',date(e.at)+' · '+name+' · '+actions[e.action]+' — '+e.reason));}workDetail.append(history);
}
async function loadWork(){const seq=++workLoading;const d=await SOC.get('/api/admin?op=workflows');if(seq!==workLoading)return;if(!d.ok){workData.tasks=[];renderWork();workStatus.textContent=d.message||errors[d.error]||'업무를 불러올 수 없습니다. 새로고침해 주세요.';return;}workData=d;await loadRelease();await loadGuardians();workProcess.replaceChildren();for(const p of d.processes){const o=el('option',p.id+' '+p.title);o.value=p.id;workProcess.append(o);}workOwner.replaceChildren();for(const u of d.assignees.filter(u=>d.canApprove||u.id===workUser.id)){const o=el('option',u.name);o.value=u.id;workOwner.append(o);}workOwner.value=workUser.id;renderWork();}
async function submitWork(body){if(workBusy)return;workBusy=true;workDetail.querySelectorAll('button').forEach(b=>b.disabled=true);createWork.querySelector('button').disabled=true;try{const d=await SOC.post('/api/admin?op=workflows',body);workStatus.textContent=d.ok?'업무 기록을 저장했습니다.':d.message||errors[d.error]||'저장하지 못했습니다. 입력과 현재 상태를 확인해 주세요.';if(d.ok){workSelected=d.task.id;createPanel.hidden=true;await loadWork();}}finally{workBusy=false;createWork.querySelector('button').disabled=false;workDetail.querySelectorAll('button').forEach(b=>b.disabled=false);}}
createWork.onsubmit=e=>{e.preventDefault();submitWork({action:'CREATE',processId:workProcess.value,ownerId:workOwner.value,title:workTitle.value,target:workTarget.value,dueAt:SOCDate.iso(workDue.value),reason:workReason.value});};
workNew.onclick=()=>{createPanel.hidden=!createPanel.hidden;if(!createPanel.hidden){if(processSelected)workProcess.value=processSelected;workTitle.focus();}};
workReload.onclick=loadWork;statusFilter.onchange=renderWork;workSearch.oninput=renderWork;
(async()=>{workUser=await SOC.requireRoles(['STAFF','FINANCE','ADMIN','CEO']);if(workUser)await loadWork();})();

async function loadRelease(){
 if(!workUser.roles.some(r=>['STAFF','ADMIN','CEO'].includes(r))){releaseEventList.textContent='관리자·대회 운영 담당자가 확인합니다.';return;}
 const d=await SOC.get('/api/admin?op=event-release');releaseEventList.replaceChildren();if(!d.ok){releaseEventList.textContent='점검 내역을 불러오지 못했습니다.';return;}
 for(const e of d.events){const box=el('div',undefined,'panel');box.append(el('h3',e.name),el('p','대회 ID: '+e.tournamentId),el('p',e.ready?'설정·독립 검토 승인 확인 완료':e.blockers.join(' / ')));
  if(e.ready&&['DRAFT','COMING_SOON','CLOSED'].includes(e.status)&&workData.canApprove){const reason=el('input');reason.placeholder='접수 개시 사유';reason.setAttribute('aria-label','접수 개시 사유');const b=el('button','대회 접수 개시','btn gold');b.onclick=async()=>{b.disabled=true;try{const result=await SOC.post('/api/admin?op=event-release',{tournamentId:e.tournamentId,reason:reason.value});workStatus.textContent=result.ok?'접수를 개시했습니다.':(result.blockers||[result.error]).join(' / ');await loadRelease();}finally{b.disabled=false;}};box.append(reason,b);}
  releaseEventList.append(box);
 }
}

let guardianData=[];
async function loadGuardians(){
 guardianPanel.hidden=!workData.canApprove;if(guardianPanel.hidden)return;
 const selected=guardianAthlete.value,d=await SOC.get('/api/admin?op=guardian-review');if(!d.ok){guardianState.textContent='보호자 검증 목록 조회 실패';return;}
 guardianData=d.consents;guardianAthlete.replaceChildren();for(const a of d.athletes){const o=el('option',a.name+' · '+a.socId);o.value=a.id;guardianAthlete.append(o);}if(d.athletes.some(a=>a.id===selected))guardianAthlete.value=selected;showGuardian();
}
function showGuardian(){const c=guardianData.find(c=>c.athleteUserId===guardianAthlete.value);guardianState.textContent=!c?'검증 기록 없음':c.status==='VERIFIED'?'보호자 동의 검증 기록 있음':'동의 철회 상태';}
guardianAthlete.onchange=showGuardian;
guardianForm.onsubmit=async e=>{e.preventDefault();const c=guardianData.find(c=>c.athleteUserId===guardianAthlete.value);e.submitter.disabled=true;try{const d=await SOC.post('/api/admin?op=guardian-review',{athleteUserId:guardianAthlete.value,revision:c?.revision||0,action:guardianAction.value,relationshipReference:guardianRelationship.value,consentReference:guardianEvidence.value,policyVersion:guardianPolicy.value,verifiedInPerson:guardianVerified.checked,reason:guardianReason.value});workStatus.textContent=d.ok?'보호자 검증 기록을 저장했습니다.':d.error;await loadGuardians();}finally{e.submitter.disabled=false;}};
