import {getJson,putJson,listJson,clean,makeId,now} from './blobdb.js';
import {usesPostgres,query} from './database.js';
import {emailConfigured} from './account-email.js';
import {mfaConfigured} from './mfa.js';

const fields={operatorName:160,representative:80,contactEmail:255,contactPhone:50,address:300,privacyOfficer:100,policyVersion:80,effectiveDate:10,privacyText:24000,termsText:24000,refundText:12000};
export const emptyServiceSettings=()=>Object.fromEntries(Object.keys(fields).map(k=>[k,'']));
export async function serviceState(){return await getJson('system/service-settings.json')||{revision:0,draft:emptyServiceSettings(),published:null,registrationEnabled:false};}
export function policyProblems(p){
 const problems=[];
 for(const k of Object.keys(fields))if(!p?.[k])problems.push(k);
 if(p?.contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contactEmail))problems.push('contactEmail');
 if(p?.contactPhone&&!/^[+\d() .-]{7,50}$/.test(p.contactPhone))problems.push('contactPhone');
 if(p?.effectiveDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate)||!Number.isFinite(Date.parse(p.effectiveDate))||new Date(p.effectiveDate).toISOString().slice(0,10)!==p.effectiveDate))problems.push('effectiveDate');
 for(const k of ['privacyText','termsText','refundText'])if((p?.[k]||'').trim().length<80||/\[.*?(입력|미정|확정).*?\]|TODO|TBD/.test(p?.[k]||''))problems.push(k);
 return [...new Set(problems)];
}
export async function registrationPolicy(){
 const state=await serviceState(),production=process.env.VERCEL_ENV==='production';
 const policy=state.published,blockers=[];
 if(production){
  if(!policy||policyProblems(policy).length)blockers.push('운영정보·이용약관·개인정보처리방침 확정');
  if(!state.registrationEnabled)blockers.push('회원가입 개시');
  if(!usesPostgres())blockers.push('운영 데이터베이스 연결');
  if(!emailConfigured())blockers.push('이메일 인증 서비스 연결');
  if(!mfaConfigured())blockers.push('관리자 추가인증 설정');
  if(policy?.effectiveDate&&policy.effectiveDate>new Date(Date.now()+9*3600000).toISOString().slice(0,10))blockers.push('약관 시행일 도래');
 }
 return {policy,canRegister:blockers.length===0,blockers,isPreview:!production};
}
export async function requireRegistrationPolicy(body){
 const current=await registrationPolicy();
 if(!current.canRegister)return {error:'registration_not_ready',message:'회원가입 준비 중입니다. 운영 안내를 확인해 주세요.'};
 if(current.policy&&(body.policyId!==current.policy.id||body.consent!==true||body.termsConsent!==true))return {error:'current_policy_consent_required',message:'최신 이용약관과 개인정보처리방침을 확인하고 각각 동의해 주세요.'};
 return {policyId:current.policy?.id||null,policyVersion:current.policy?.policyVersion||null};
}
export async function serviceReadiness(){
 const state=await serviceState();
 let database=false;
 if(usesPostgres()){
  const result=await query("SELECT to_regclass('public.soc_records') IS NOT NULL AND to_regclass('public.soc_auth_attempts') IS NOT NULL AS ready");
  database=Boolean(result.rows[0]?.ready);
 }
 const adminUsers=(await listJson('users/')).filter(u=>u.status==='ACTIVE'&&u.roles?.some(r=>['ADMIN','CEO'].includes(r)));
 const checks=[
  {key:'database',label:'데이터베이스 연결·기본 스키마',ok:database,detail:database?'조회 성공':'연결·스키마 확인 필요'},
  {key:'email',label:'인증 이메일 발송 설정',ok:emailConfigured(),detail:'설정 여부만 확인합니다. 실제 수신 검수는 별도입니다.'},
  {key:'mfa',label:'관리자 추가인증 설정',ok:mfaConfigured()&&adminUsers.some(u=>u.mfaEnabled),detail:'추가인증을 등록한 활성 관리자 필요'},
  {key:'policy',label:'운영정보·약관 공개',ok:!!state.published&&!policyProblems(state.published).length,detail:state.published?.policyVersion||'미공개'},
  {key:'registration',label:'회원가입 개시',ok:state.registrationEnabled===true,detail:state.registrationEnabled?'개시 설정됨':'준비 중'},
 ];
 return {state,checks,environment:process.env.VERCEL_ENV||'local',commit:process.env.VERCEL_GIT_COMMIT_SHA||null,operationallyVerified:false,remainingVerification:['운영 데이터 이관·백업 복구','인증·복구 이메일 실제 수신','실제 배포에서 대회 접수부터 결과·환불까지 리허설']};
}
export async function serviceSettings(req,res,user){
 if(req.method==='GET')return res.status(200).json({ok:true,...await serviceReadiness()});
 if(!usesPostgres())return res.status(503).json({ok:false,error:'transactional_database_required'});
 const b=req.body||{},previous=await serviceState(),reason=clean(b.reason,500),action=clean(b.action,30);
 if(b.revision!==previous.revision)return res.status(409).json({ok:false,error:'settings_version_conflict',message:'다른 관리자가 변경했습니다. 새로고침 후 다시 확인해 주세요.'});
 if(!reason)return res.status(400).json({ok:false,error:'change_reason_required'});
 if(!['SAVE','PUBLISH','OPEN','PAUSE'].includes(action))return res.status(400).json({ok:false,error:'invalid_action'});
 if(action!=='SAVE'&&!user.roles?.includes('CEO'))return res.status(403).json({ok:false,error:'ceo_required'});
 const state=structuredClone(previous);
 if(action==='SAVE')state.draft=Object.fromEntries(Object.entries(fields).map(([key,max])=>[key,clean(b.settings?.[key],max)]));
 if(action==='PUBLISH'){
  const problems=policyProblems(state.draft);
  if(problems.length)return res.status(400).json({ok:false,error:'incomplete_service_settings',fields:problems,message:'운영정보와 약관의 미입력 항목을 확인해 주세요.'});
  if(b.confirmReviewed!==true)return res.status(400).json({ok:false,error:'policy_review_required'});
  const policy={...state.draft,id:makeId('policy'),publishedAt:now(),publishedBy:user.id};
  if(state.published?.policyVersion===policy.policyVersion)return res.status(409).json({ok:false,error:'new_policy_version_required',message:'새 약관 버전을 입력해 주세요.'});
  await putJson('service-policies/'+policy.id+'.json',policy,{overwrite:false});state.published=policy;
 }
 if(action==='OPEN'){
  const p=state.published;
  if(!p||policyProblems(p).length||!emailConfigured()||!mfaConfigured()||!user.mfaEnabled||p.effectiveDate>new Date(Date.now()+9*3600000).toISOString().slice(0,10))return res.status(409).json({ok:false,error:'service_not_ready',message:'공개 약관·시행일·이메일 설정·대표 계정 추가인증을 확인해 주세요.'});
  state.registrationEnabled=true;
 }
 if(action==='PAUSE')state.registrationEnabled=false;
 state.revision++;state.updatedAt=now();state.updatedBy=user.id;
 await putJson('system/service-settings.json',state);
 await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'SERVICE_'+action,entityId:'service-settings',before:previous,after:state,reason,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true,state});
}
