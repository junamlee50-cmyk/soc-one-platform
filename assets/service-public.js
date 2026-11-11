SOC.servicePolicy=async()=>SOC.get('/api/public?op=service-settings');
SOC.policyConsent=async()=>{const d=await SOC.servicePolicy();if(!d.ok)return {error:'운영 안내를 불러오지 못했습니다. 다시 시도해 주세요.'};if(!d.canRegister)return {error:'회원가입 준비 중입니다. 운영 안내를 확인해 주세요.'};return {policyId:d.policy?.id||null};};
(async()=>{
 const host=document.getElementById('policyContent');if(!host)return;
 const d=await SOC.servicePolicy();host.replaceChildren();const add=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;e.style.whiteSpace='pre-wrap';host.append(e);};
 if(!d.ok){add('p','운영 안내를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');return;}
 if(!d.policy){add('h1','운영 안내 준비 중');add('p','운영 주체와 이용약관, 개인정보처리방침을 확정한 뒤 공개합니다. 현재 검수용 화면에서는 실제 개인정보를 입력하지 마세요.');return;}
 const p=d.policy,doc=new URLSearchParams(location.search).get('document')||'privacy';const titles={privacy:['개인정보처리방침','privacyText'],terms:['이용약관','termsText'],refund:['취소·환불 안내','refundText']};const [title,key]=titles[doc]||titles.privacy;
 document.title=title+' | SOC';add('h1',title);add('p','버전: '+p.policyVersion+' · 시행일: '+p.effectiveDate);add('p',p.operatorName+' · 대표자 '+p.representative);add('p',p.address);add('p','문의: '+p.contactPhone+' · '+p.contactEmail);add('p','개인정보 보호 담당자: '+p.privacyOfficer);add('p',p[key]);
})();
