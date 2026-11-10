(()=>{
 let dialog,currentUser=null,intent='',mode='register',busy=false,returnFocus,policyId=null,policyLoaded=false,policyRequest=0;
 const allowed=u=>u?.roles?.some(r=>['STAFF','ADMIN','CEO'].includes(r));
 const $=id=>document.getElementById(id);
 const errors={email_exists:'이미 가입한 이메일입니다. 로그인해 주세요.',invalid_credentials:'이메일과 비밀번호를 다시 확인해 주세요.',consent_required:'개인정보 처리 안내에 동의해 주세요.',invalid_profile:'이름과 이메일을 확인해 주세요.',weak_password:'비밀번호를 10자 이상 입력해 주세요.',rate_limited:'요청이 많습니다. 잠시 후 다시 시도해 주세요.',transactional_database_required:'지금은 가입을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.'};
 function build(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.id='accountDialog';dialog.className='accountDialog';dialog.setAttribute('aria-labelledby','accountTitle');
  dialog.innerHTML=`<div class="accountHeading"><span class="kicker">WELCOME TO THE MAT</span><button class="accountClose" type="button" aria-label="가입·로그인 창 닫기">×</button></div><h2 id="accountTitle">SOC 회원가입</h2><p id="accountIntro">소속 도장 그대로, 나만의 SOC ID로 시작하세요.</p><div class="accountTabs"><button type="button" data-account-mode="register">회원가입</button><button type="button" data-account-mode="login">로그인</button></div><form id="accountForm"><div id="accountRegisterFields"><label for="accountName">이름</label><input id="accountName" autocomplete="name" maxlength="80"><label for="accountRole">회원 구분</label><select id="accountRole"><option value="ATHLETE">선수 · 수련생</option><option value="COACH">관장 · 코치</option></select></div><label for="accountEmail">이메일</label><input id="accountEmail" type="email" autocomplete="email" required maxlength="255"><label for="accountPassword">비밀번호</label><input id="accountPassword" type="password" minlength="10" maxlength="256" autocomplete="new-password" required><div id="accountConsentArea"><label class="consentLine"><input id="accountConsent" type="checkbox"><span><a href="/privacy-preview.html" target="_blank" rel="noopener">개인정보 처리 안내</a>를 읽고 필수정보 처리에 동의합니다.</span></label><label class="consentLine"><input id="accountTerms" type="checkbox"><span><a href="/privacy-preview.html?document=terms" target="_blank" rel="noopener">이용약관</a>에 동의합니다.</span></label><p id="accountPolicyNotice" class="small"></p></div><details id="accountMfa" hidden><summary>추가인증 코드 입력</summary><label for="accountOtp">인증 앱 코드</label><input id="accountOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><label for="accountRecovery">일회용 복구코드 (인증 앱 대신)</label><input id="accountRecovery" autocomplete="off"></details><button class="btn gold accountSubmit" id="accountSubmit" type="submit">무료로 가입하기</button><p id="accountMessage" role="status" aria-live="polite"></p><a id="accountRecoveryLink" href="/my-soc.html#accountEmailForm" hidden>비밀번호를 잊으셨나요?</a></form><div id="accountSuccess" hidden><p id="accountWelcome"></p><strong id="accountSocId"></strong><p>가입이 완료되었습니다. 대회 신청 전에 내 정보에서 이메일 인증과 선수 프로필을 확인해 주세요.</p><div class="quickActions"><a class="btn gold" id="accountProfile" href="/athlete-app.html">선수정보 입력</a><a class="btn" href="/competition.html">대회 일정 보기</a></div></div>`;
  document.body.append(dialog);SOC.mountDemoAccount(dialog,d=>{show('login');$('accountEmail').value=d.email;$('accountPassword').value=d.password;});
  dialog.querySelector('.accountClose').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dialog.addEventListener('close',()=>{for(const id of ['accountPassword','accountOtp','accountRecovery'])$(id).value='';returnFocus?.focus();});
  dialog.querySelectorAll('[data-account-mode]').forEach(b=>b.onclick=()=>{if(!busy)show(b.dataset.accountMode);});
  $('accountForm').onsubmit=submit;
 }
 function show(next){
  mode=next;$('accountTitle').textContent=intent==='admin'?'관리자 로그인':mode==='register'?'SOC 회원가입':'다시 오셨네요.';
  $('accountIntro').textContent=intent==='admin'?'운영 권한이 있는 계정으로 로그인해 주세요.':'소속 도장 그대로, 나만의 SOC ID로 시작하세요.';
  $('accountForm').hidden=false;$('accountSuccess').hidden=true;$('accountRegisterFields').hidden=mode!=='register';$('accountConsentArea').hidden=mode!=='register';$('accountName').required=mode==='register';$('accountConsent').required=mode==='register';$('accountTerms').required=mode==='register';$('accountConsent').checked=false;$('accountTerms').checked=false;loadPolicy();
  $('accountPassword').minLength=mode==='register'?10:1;$('accountPassword').autocomplete=mode==='register'?'new-password':'current-password';
  $('accountMfa').hidden=mode==='register';$('accountRecoveryLink').hidden=mode==='register';$('accountSubmit').textContent=mode==='register'?'무료로 가입하기':'로그인';$('accountMessage').textContent='';
  dialog.querySelectorAll('[data-account-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.accountMode===mode));b.hidden=intent==='admin'&&b.dataset.accountMode==='register';});
 }
 function update(user){
  currentUser=user;
  document.querySelectorAll('[data-account="register"]').forEach(b=>b.textContent=user?'내 SOC':'회원가입');
  document.querySelectorAll('[data-account="login"]').forEach(b=>b.textContent=user?'로그아웃':'로그인');
 }
 async function loadPolicy(){
  const request=++policyRequest;policyLoaded=false;policyId=null;if(mode!=='register'){$('accountSubmit').disabled=false;return;}
  $('accountSubmit').disabled=true;const d=await SOC.servicePolicy();if(request!==policyRequest||mode!=='register')return;policyLoaded=!!d.ok&&d.canRegister===true;policyId=d.policy?.id||null;$('accountPolicyNotice').textContent=!d.ok?'운영 안내를 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.':!d.canRegister?'회원가입 준비 중입니다.':d.isPreview?'검수용 화면입니다. 실제 개인정보를 입력하지 마세요.':'약관 버전: '+(d.policy?.policyVersion||'');$('accountSubmit').disabled=!policyLoaded;
 }
 async function submit(e){
  e.preventDefault();if(busy)return;if(mode==='register'&&!policyLoaded)return;busy=true;$('accountSubmit').disabled=true;dialog.querySelector('.accountClose').disabled=true;$('accountMessage').textContent='처리 중입니다.';
  try{
   const result=await SOC.post('/api/auth/'+mode,{name:$('accountName').value,email:$('accountEmail').value,password:$('accountPassword').value,role:$('accountRole').value,consent:$('accountConsent').checked,termsConsent:$('accountTerms').checked,policyId,otp:$('accountOtp').value,recoveryCode:$('accountRecovery').value});
   if(!result.ok){$('accountMessage').textContent=result.message||errors[result.error]||'처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';if(result.error==='mfa_required'){$('accountMfa').open=true;$('accountOtp').focus();}return;}
   update(result.user);await SOC.refreshAdminAccess?.(result.user);$('accountPassword').value='';$('accountOtp').value='';$('accountRecovery').value='';
   if(intent==='admin'){
    if(allowed(result.user)){dialog.close();await SOC.openAdmin();}
    else $('accountMessage').textContent='로그인은 완료됐지만 이 계정에는 관리자 권한이 없습니다. 운영 담당자에게 권한을 확인해 주세요.';
    return;
   }
   if(mode==='login'){dialog.close();return;}
   $('accountForm').hidden=true;$('accountSuccess').hidden=false;$('accountWelcome').textContent=result.user.name+' 님, SOC에 오신 것을 환영합니다.';$('accountSocId').textContent=result.user.socId;
   const coach=result.user.roles.includes('COACH');$('accountProfile').href=coach?'/academy-app.html':'/athlete-app.html';$('accountProfile').textContent=coach?'내 도장 등록':'선수정보 입력';
  }finally{busy=false;$('accountSubmit').disabled=mode==='register'&&!policyLoaded;dialog.querySelector('.accountClose').disabled=false;}
 }
 SOC.openAccount=function(next='register',purpose=''){
  build();intent=purpose;returnFocus=document.activeElement;show(next);if(!dialog.open)dialog.showModal();
  if(purpose==='admin'&&currentUser&&!allowed(currentUser))$('accountMessage').textContent='현재 계정에는 관리자 권한이 없습니다. 운영 권한이 있는 계정으로 로그인해 주세요.';
  (next==='register'?$('accountName'):$('accountEmail')).focus();
 };
 document.addEventListener('soc:session',e=>update(e.detail.user));
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-account]');if(!button)return;e.preventDefault();
  if(currentUser){
   if(button.dataset.account==='register'){location.href='/my-soc.html';return;}
   button.disabled=true;try{const r=await SOC.post('/api/auth/logout',{});if(r.ok){update(null);await SOC.refreshAdminAccess?.(null);}else SOC.toast(r.message||'로그아웃하지 못했습니다. 다시 시도해 주세요.');}finally{button.disabled=false;}
  }else SOC.openAccount(button.dataset.account);
 });
 window.addEventListener('pagehide',()=>{if(dialog?.open)dialog.close();});
})();
