(async()=>{
 const host=document.getElementById('academyDirectory'),result=await SOC.get('/api/academies');host.replaceChildren();
 if(!result.ok||!result.academies?.length){const note=document.createElement('div');note.className='eventEmpty';note.textContent=result.ok?'첫 참여 도장을 모집하고 있습니다. 확인이 끝난 도장부터 이곳에 소개합니다.':'도장 목록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';host.append(note);return;}
 for(const academy of result.academies){const card=document.createElement('article');card.className='card';const name=document.createElement('h3'),region=document.createElement('p');name.textContent=academy.name;region.textContent=academy.region||'지역 안내 준비 중';card.append(name,region);host.append(card);}
})();
