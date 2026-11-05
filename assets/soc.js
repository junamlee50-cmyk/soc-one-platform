window.SOC={
money:n=>new Intl.NumberFormat('ko-KR').format(n)+'원',
async get(url){const r=await fetch(url);return await r.json()},
async post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return await r.json()},
toast(msg){alert(msg)}
};
function toggleMenu(){const e=document.getElementById('mobileMenu');if(e)e.style.display=e.style.display==='block'?'none':'block'}
document.addEventListener('click',e=>{if(e.target.matches('.tab')){const p=e.target.parentElement;p.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));e.target.classList.add('active')}});