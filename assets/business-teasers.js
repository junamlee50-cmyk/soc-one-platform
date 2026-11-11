(()=>{
 const target=document.getElementById('businessTeasers');if(!target)return;let revision=0;
 async function load(){
  const request=++revision;target.textContent='공개된 공고·상품을 불러오고 있습니다.';
  const d=await SOC.get('/api/public?op=business&kind='+encodeURIComponent(target.dataset.kind));if(request!==revision)return;target.replaceChildren();
  if(!d.ok){target.textContent=d.message||'목록을 불러오지 못했습니다. 아래 버튼에서 다시 확인해 주세요.';return;}
  if(!d.programs?.length){target.textContent='현재 공개된 공고·상품이 없습니다.';return;}
  for(const p of d.programs){const a=document.createElement('a');a.className='card';a.href='/business.html?kind='+p.kind;a.textContent=p.title+' · '+(['product','training'].includes(p.kind)?SOC.money(p.price):'모집공고 확인');target.append(a);}
 }
 document.addEventListener('soc:session',load);document.addEventListener('soc:public-update',load);load();
})();
