(async()=>{
 const data=await SOC.get('/assets/support-plan.json');
 const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 const home=document.getElementById('homeSupport'),plans=document.getElementById('supportPlans'),pro=document.getElementById('proSupportAmounts');
 if(!data.tiers){for(const host of [home,plans])if(host)host.textContent='지원안을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';return;}
 for(const tier of data.tiers){
  const amount='연 최대 '+tier.annualCap/10000+'만원';
  if(home){if(!home.dataset.ready){home.replaceChildren();home.dataset.ready='true';}const item=make('a',null,'supportTeaser');item.href='/support.html';item.append(make('span',tier.name),make('strong',amount),make('small',tier.places+'명 선발 계획 · 세부 항목 보기 →'));home.append(item);}
  if(plans){if(!plans.dataset.ready){plans.replaceChildren();plans.dataset.ready='true';}const card=make('article',null,'supportPlan');card.append(make('span',tier.places+'명 선발 계획','pill'),make('h3',tier.name),make('p',tier.audience,'planAudience'),make('strong',amount,'planAmount'));const list=make('dl');for(const item of tier.items){const row=make('div');row.append(make('dt',item.label),make('dd',SOC.money(item.amount)));list.append(row);}const link=make('a','이 등급 사전등록','btn');link.href='#supportInterest';link.onclick=()=>{document.getElementById('supTier').value=tier.id;};card.append(list,link);plans.append(card);}
 }
 if(pro){const p=data.pro;for(const [name,value]of [['경기당 출전료',p.showMin/10000+'–'+p.showMax/10000+'만원'],['승리수당',p.winBonus/10000+'만원'],['선정 경기 보너스',p.performanceBonus/10000+'만원']]){const row=make('div',null,'proAmount');row.append(make('span',name),make('strong',value));pro.append(row);}}
})();
