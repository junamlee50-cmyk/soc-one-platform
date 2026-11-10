// One text field accepts a full Korean calendar date/time without segmented cursors.
(()=>{
 const parse=(value,kind='date')=>{
  if(typeof value!=='string'||!value.trim())return null;
  const text=value.trim();let digits;
  if(/^\d+$/.test(text))digits=text;
  else if(/^\d{4}[-./]\d{2}[-./]\d{2}(?:[Tt ]\d{2}:\d{2})?$/.test(text))digits=text.replace(/\D/g,'');
  else return null;
  if(digits.length!==(kind==='datetime'?12:8))return null;
  const date=digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6,8),stamp=Date.parse(date+'T00:00:00Z');
  if(Number(digits.slice(0,4))<1900||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)return null;
  if(kind!=='datetime')return date;
  const h=digits.slice(8,10),m=digits.slice(10,12);if(Number(h)>23||Number(m)>59)return null;
  return date+'T'+h+':'+m;
 };
 const iso=value=>{if(!value?.trim())return '';const local=parse(value,'datetime');return local?new Date(local+':00+09:00').toISOString():null;};
 const toInput=value=>{const n=Date.parse(value);return Number.isFinite(n)?new Date(n+9*3600000).toISOString().slice(0,16).replace('T',' '):'';};
 const display=(value,kind)=>parse(value,kind)?.replace('T',' ')||value;
 const hint=kind=>kind==='datetime'?'연월일·시·분 12자리를 이어서 입력하세요. 예: 202611101430 → 2026-11-10 14:30 (한국시간)':'연월일 8자리를 이어서 입력하세요. 예: 20261110 → 2026-11-10';
 function validateField(input,normalize=false){
  const kind=input.dataset.socDate,value=input.value.trim(),parsed=parse(value,kind);
  let message=value&&!parsed?(kind==='datetime'?'날짜와 시간을 12자리로 입력해 주세요. 예: 202611101430':'올바른 날짜를 8자리로 입력해 주세요. 예: 20261110'):!value&&input.required?'날짜'+(kind==='datetime'?'와 시간':'')+'을 입력해 주세요.':'';
  if(parsed&&input.min&&parsed<input.min)message='입력 가능한 날짜보다 이전입니다.';
  if(parsed&&input.max&&parsed>input.max)message='입력 가능한 날짜보다 이후입니다.';
  input.setCustomValidity(message);input.setAttribute('aria-invalid',String(!!message));if(normalize&&parsed)input.value=display(value,kind);
  return !message;
 }
 function enhance(input,kind){
  if(!input||input.dataset.socDateReady)return;
  kind=kind||input.dataset.socDate||(input.type==='date'?'date':'datetime');const saved=input.value;
  input.type='text';input.dataset.socDate=kind;input.dataset.socDateReady='true';input.inputMode='numeric';input.maxLength=kind==='datetime'?16:10;input.placeholder=kind==='datetime'?'예: 202611101430':'예: 20261110';input.value=display(saved,kind);
  if(input.autocomplete!=='bday')input.autocomplete='off';
  const help=document.createElement('small');help.className='dateInputHint';help.textContent=hint(kind);help.id=(input.id||'socDate')+'Hint';input.insertAdjacentElement('afterend',help);input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),help.id].filter(Boolean).join(' '));
  input.addEventListener('input',()=>validateField(input));input.addEventListener('blur',()=>validateField(input,true));
 }
 function validate(scope){
  const fields=Array.isArray(scope)?scope:[...scope.querySelectorAll('input[data-soc-date]')];let first;
  for(const input of fields){if(input.disabled)continue;if(!validateField(input,true)&&!first)first=input;}
  if(first){first.reportValidity();first.focus();return false;}return true;
 }
 globalThis.SOCDate={parse,iso,toInput,display,enhance,validate};
 if(typeof document==='undefined')return;
 const scan=root=>{if(root.matches?.('input[data-soc-date],input[type="date"],input[type="datetime-local"]'))enhance(root);root.querySelectorAll?.('input[data-soc-date],input[type="date"],input[type="datetime-local"]').forEach(input=>enhance(input));};
 scan(document);
 new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node.nodeType===1)scan(node);}).observe(document.documentElement,{childList:true,subtree:true});
 document.addEventListener('submit',event=>{if(!validate(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
})();
