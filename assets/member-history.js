SOC.loadMemberHistory=async function(target){
 const token=String(Date.now())+Math.random();target.dataset.request=token;target.textContent='내 정보를 불러오고 있습니다.';
 const d=await SOC.get('/api/member?op=history');if(target.dataset.request!==token)return;target.replaceChildren();
 const add=(parent,tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
 if(!d.ok){add(target,'p',d.message||'내 정보를 불러오지 못했습니다. 다시 로그인해 주세요.');return;}
 const p=d.athlete||{},status={APPROVED:'등록 승인',PENDING:'등록 승인 대기',REJECTED:'등록 반려',SUSPENDED:'등록 중지',SELF_REPORTED:'직접 입력',NONE:'미입력'};
 const profile=add(target,'article','','panel');add(profile,'h3','내 선수정보');
 for(const [label,value]of [['이름',p.displayName],['생년월일',p.birthDate],['벨트',SOC.beltLabel(p.belt)],['체중',p.defaultWeightKg?p.defaultWeightKg+'kg':'미입력'],['소속 도장',p.academyName?(p.academyName+' · '+(status[p.academyStatus]||p.academyStatus)):'미입력']]){const row=add(profile,'div','','dataRow');add(row,'span',label);add(row,'b',value||'미입력');}
 if(d.managedAcademies?.length){add(profile,'h4','내가 등록한 도장');for(const a of d.managedAcademies)add(profile,'p',a.name+' · '+a.region+' · '+(status[a.status]||a.status));}
 const edit=add(profile,'a','선수정보 수정','btn gold');edit.href='/athlete-app.html';
 const stats=add(target,'div','','kpiGrid');for(const [key,label]of [['tournaments','대회 기록'],['wins','경기 승리'],['gold','우승'],['medals','입상']]){const card=add(stats,'div','','kpi');add(card,'strong',d.summary[key]);add(card,'small',label);}
 const videos=add(target,'section','','panel');videos.id='myVideos';videos.style.marginTop='16px';add(videos,'h3','내 경기 영상');
 const available=d.history.flatMap(event=>event.matches.filter(match=>match.videoUrl).map(match=>({event,match})));
 if(!available.length)add(videos,'p','등록된 경기 영상이 없습니다. 경기별 유튜브 주소가 등록되면 이곳에서 바로 볼 수 있습니다.');
 for(const {event,match}of available){const row=add(videos,'div','','dataRow');add(row,'span',event.name+' · '+match.opponent+' 선수와 경기');const link=add(row,'a','유튜브에서 보기','btn gold');link.href=match.videoUrl;link.target='_blank';link.rel='noopener noreferrer';}
 if(location.hash==='#myVideos')videos.scrollIntoView({block:'start'});
 add(target,'h3','대회별 참가·입상 기록');
 if(!d.history.length){add(target,'p','아직 참가한 대회와 경기 기록이 없습니다. 대회 신청과 경기 결과가 등록되면 이곳에 표시됩니다.');return;}
 const medal={GOLD:'우승 · 금메달',SILVER:'준우승 · 은메달',BRONZE:'3위 · 동메달'},results={WIN:'승리',LOSS:'패배',BYE:'부전승',PENDING:'경기 예정'},pay={PAID:'입금 확인',UNPAID:'미입금',PENDING:'입금 확인 요청',REFUND_REQUESTED:'환불 검토 중',REFUNDED:'환불 완료'};
 for(const event of d.history){const card=add(target,'article','','panel');card.style.marginTop='16px';add(card,'h3',event.name);add(card,'p',[event.date?new Date(event.date).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}):'일정 미등록',event.venue].filter(Boolean).join(' · '));
  for(const a of event.awards)add(card,'p',(medal[a.medal]||a.medal)+' · '+String(a.divisionKey||'').replaceAll('|',' · '),'notice');
  for(const r of event.registrations){const row=add(card,'div','','dataRow');add(row,'span',[r.discipline,r.ageGroup,SOC.beltLabel(r.belt),r.weightClass,r.absolute?'앱솔루트':''].filter(Boolean).join(' · '));add(row,'b',(r.status==='CANCELED'?'신청 취소':pay[r.paymentStatus]||r.paymentStatus)+' · '+SOC.money(r.amount));const link=add(row,'a','신청·입금 내역','btn');link.href='/payments.html?registrationId='+encodeURIComponent(r.id);}
  if(!event.matches.length)add(card,'p','아직 등록된 경기 결과가 없습니다.');
  for(const m of event.matches){const row=add(card,'div','','dataRow');add(row,'span','R'+m.roundNo+' · '+m.opponent+' 선수와 경기');add(row,'b',results[m.result]);if(m.videoUrl){const video=add(row,'a','유튜브 경기 영상 보기','btn');video.href=m.videoUrl;video.target='_blank';video.rel='noopener noreferrer';}else add(row,'small','경기 영상 미등록');}
 }
};
