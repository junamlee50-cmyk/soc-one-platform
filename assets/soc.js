window.SOC={
escape:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
money:n=>new Intl.NumberFormat('ko-KR').format(n)+'원',
async request(url,options={}){try{const r=await fetch(url,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});if(!(r.headers.get('content-type')||'').includes('application/json'))return {ok:false,error:'service_unavailable',message:'서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'};return await r.json()}catch{return {ok:false,error:'network_error',message:'인터넷 연결을 확인한 뒤 다시 시도해 주세요.'}}},
async get(url){return this.request(url)},
async post(url,data){return this.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})},
toast(msg){alert(msg)}
};
function toggleMenu(){const e=document.getElementById('mobileMenu');if(e){const open=e.style.display!=='block';e.style.display=open?'block':'none';document.querySelector('[aria-controls="mobileMenu"]')?.setAttribute('aria-expanded',String(open));}}
document.addEventListener('click',e=>{if(e.target.matches('.tab')){const p=e.target.parentElement;p.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));e.target.classList.add('active')}});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));}
SOC.me=async function(){try{const r=await fetch('/api/auth/me',{credentials:'include'});if(!r.ok)return null;const d=await r.json();return d.user||null}catch{return null}};
SOC.requireRoles=async function(roles){const u=await SOC.me();if(!u){location.href='/my-soc.html?next='+encodeURIComponent(location.pathname);return null}if(roles&&roles.length&&!roles.some(r=>(u.roles||[]).includes(r))){document.body.innerHTML='<div style="max-width:560px;margin:80px auto;padding:24px;color:white;font-family:Arial"><h1 style="color:#e7c86f">접근 권한이 없습니다.</h1><p>현재 회원 구분으로는 이 화면을 사용할 수 없습니다.</p><a style="color:#e7c86f" href="/my-soc.html">MY SOC로 돌아가기</a></div>';return null}return u};
SOC.logout=async function(){const result=await SOC.post('/api/auth/logout',{});if(result.ok)location.href='/my-soc.html';else SOC.toast(result.message||'로그아웃에 실패했습니다. 다시 시도해 주세요.')};

// Public and management views share the current page and authenticated session.
// Authorization is also enforced independently by every management API.
(()=>{
 if(window.top!==window.self)return;
 const allowed=u=>u?.roles?.some(r=>['STAFF','ADMIN','CEO'].includes(r));
 const views=[['tournaments','대회 일정','/admin?tab=tournaments'],['registrations','신청자·인원','/admin?tab=registrations'],['payments','입금·환불','/payments'],['operations','운영센터','/operations'],['field','현장 운영','/tournament-ops'],['settings','운영 설정','/service-settings'],['inquiries','문의 관리','/inquiries?view=admin']];
 let dialog,frame,opener,accessRevision=0;
 function close(){if(!dialog)return;if(dialog.open)dialog.close();frame?.remove();frame=null;document.documentElement.classList.remove('socAdminOpen');}
 function selectView(key){
  const view=views.find(v=>v[0]===key)||views[0];
  dialog.querySelectorAll('[data-admin-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.adminView===view[0])));
  if(!frame){frame=document.createElement('iframe');frame.id='socAdminFrame';frame.addEventListener('load',()=>SOC.refreshAdminAccess());dialog.append(frame);}
  frame.title='SOC 관리자 · '+view[1];frame.src=view[2];
 }
 SOC.refreshAdminAccess=async function(user){
  const revision=++accessRevision,u=user===undefined?await SOC.me():user;if(revision!==accessRevision)return;
  let button=document.getElementById('socAdminButton');
  if(!button&&allowed(u)){const actions=document.querySelector('header .actions');if(actions){button=document.createElement('button');button.id='socAdminButton';button.type='button';button.className='btn gold';button.textContent='관리자';button.dataset.socAdmin='tournaments';button.setAttribute('aria-haspopup','dialog');actions.prepend(button);}}
  if(button)button.hidden=button.hasAttribute('data-public-admin')?false:!allowed(u);
  document.dispatchEvent(new CustomEvent('soc:session',{detail:{user:u}}));
  if(!allowed(u))close();
  return allowed(u);
 };
 SOC.openAdmin=async function(view='tournaments'){
  if(!await SOC.refreshAdminAccess()){if(SOC.openAccount)SOC.openAccount('login','admin');else SOC.toast('관리자 권한으로 로그인한 후 이용해 주세요.');return;}
  opener=document.activeElement;
  if(!dialog){
   dialog=document.createElement('dialog');dialog.id='socAdminPanel';dialog.className='socAdminPanel';dialog.setAttribute('aria-labelledby','socAdminTitle');
   const heading=document.createElement('div');heading.className='socAdminHeading';
   const title=document.createElement('strong');title.id='socAdminTitle';title.textContent='SOC 관리자';
   const back=document.createElement('button');back.type='button';back.className='btn';back.textContent='사이트로 돌아가기';back.onclick=close;heading.append(title,back);
   const nav=document.createElement('nav');nav.className='socAdminNav';nav.setAttribute('aria-label','관리자 메뉴');
   for(const [key,label]of views){const button=document.createElement('button');button.type='button';button.className='btn';button.dataset.adminView=key;button.textContent=label;button.onclick=()=>selectView(key);nav.append(button);}
   dialog.append(heading,nav);document.body.append(dialog);
   dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
   dialog.addEventListener('close',()=>{frame?.remove();frame=null;document.documentElement.classList.remove('socAdminOpen');opener?.focus();});
  }
  selectView(view);if(!dialog.open)dialog.showModal();document.documentElement.classList.add('socAdminOpen');
 };
 document.addEventListener('click',e=>{const button=e.target.closest('[data-soc-admin]');if(button){e.preventDefault();SOC.openAdmin(button.dataset.socAdmin);}});
 window.addEventListener('pagehide',close);
 window.addEventListener('pageshow',()=>SOC.refreshAdminAccess());
})();

SOC.servicePolicy=async()=>SOC.get('/api/public?op=service-settings');
(()=>{const footer=document.querySelector('footer .legal');if(footer){const nav=document.createElement('nav');nav.className='quickActions';for(const [title,url] of [['문의하기','/inquiries.html'],['이용약관','/privacy-preview.html?document=terms'],['취소·환불 안내','/privacy-preview.html?document=refund']]){const a=document.createElement('a');a.textContent=title;a.href=url;nav.append(a);}footer.append(nav);}})();

SOC.memberLabel=roles=>(roles||[]).filter(r=>r!=='MEMBER'||roles.length===1).map(r=>({ATHLETE:'선수·수련생',COACH:'관장·코치',ACADEMY_ADMIN:'도장 관리자',STAFF:'운영진',ADMIN:'관리자',CEO:'대표 관리자',FINANCE:'입금·정산 담당',REFEREE:'심판',COMMITTEE:'지역위원',MEMBER:'일반회원'}[r]||'회원')).join(' · ');
SOC.beltLabel=value=>({WHITE:'화이트',BLUE:'블루',PURPLE:'퍼플',BROWN:'브라운',BLACK:'블랙',GREY:'그레이',YELLOW:'옐로',ORANGE:'오렌지',GREEN:'그린'}[value]||value||'미입력');

SOC.demoReady=SOC.get('/api/auth?op=demo-access');
SOC.mountDemoAccount=async function(container,fill){
 const d=await SOC.demoReady;if(!d.enabled||!container||container.querySelector('[data-demo-access]'))return;
 const card=document.createElement('div');card.className='notice';card.dataset.demoAccess='true';card.style.marginTop='20px';
 const title=document.createElement('strong');title.textContent='테스트 관리자';const details=document.createElement('p');details.style.whiteSpace='pre-wrap';details.style.overflowWrap='anywhere';details.textContent='아이디: '+d.email+'\n비밀번호: '+d.password;
 const note=document.createElement('p');note.textContent='별도 테스트 데이터로 작동합니다. 실제 회원정보와 연결되지 않습니다.';
 const button=document.createElement('button');button.type='button';button.className='btn gold';button.textContent='테스트 관리자 자동입력';button.onclick=()=>fill(d);card.append(title,details,note,button);container.append(card);
};
SOC.demoReady.then(d=>{
 if(d.active){const main=document.querySelector('main')||document.body,notice=document.createElement('div');notice.id='socDemoNotice';notice.className='notice';notice.style.margin='16px';notice.textContent='테스트 관리자 모드 · 실제 회원정보와 분리된 공용 테스트 공간입니다. ';const exit=document.createElement('button');exit.className='btn';exit.textContent='테스트 종료';exit.onclick=()=>SOC.logout();notice.append(exit);main.prepend(notice);}
 if(document.querySelector('[data-public-admin]'))SOC.mountDemoAccount(document.querySelector('footer')||document.querySelector('main'),d=>{SOC.openAccount('login','admin');document.getElementById('accountEmail').value=d.email;document.getElementById('accountPassword').value=d.password;});
});
