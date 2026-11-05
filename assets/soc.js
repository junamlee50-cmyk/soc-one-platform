window.SOC={
money:n=>new Intl.NumberFormat('ko-KR').format(n)+'원',
async get(url){const r=await fetch(url);return await r.json()},
async post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return await r.json()},
toast(msg){alert(msg)}
};
function toggleMenu(){const e=document.getElementById('mobileMenu');if(e)e.style.display=e.style.display==='block'?'none':'block'}
document.addEventListener('click',e=>{if(e.target.matches('.tab')){const p=e.target.parentElement;p.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));e.target.classList.add('active')}});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));}
SOC.me=async function(){try{const r=await fetch('/api/auth/me',{credentials:'include'});if(!r.ok)return null;const d=await r.json();return d.user||null}catch{return null}};
SOC.requireRoles=async function(roles){const u=await SOC.me();if(!u){location.href='/my-soc.html?next='+encodeURIComponent(location.pathname);return null}if(roles&&roles.length&&!roles.some(r=>(u.roles||[]).includes(r))){document.body.innerHTML='<div style="max-width:560px;margin:80px auto;padding:24px;color:white;font-family:Arial"><h1 style="color:#e7c86f">접근 권한이 없습니다.</h1><p>현재 계정의 역할로는 이 화면을 사용할 수 없습니다.</p><a style="color:#e7c86f" href="/my-soc.html">MY SOC로 돌아가기</a></div>';return null}return u};
SOC.logout=async function(){await fetch('/api/auth/logout',{method:'POST',credentials:'include'});location.href='/my-soc.html'};
