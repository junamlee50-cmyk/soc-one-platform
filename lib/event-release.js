import {emailConfigured} from './account-email.js';
import {registrationPolicy} from './service-settings.js';
import {getJson,listJson,hash,clean,putJson,makeId,now} from './blobdb.js';
import {validateRules} from './rules.js';
import {validBankSettings,currentBankSettings} from './manual-payments.js';
import {usesPostgres} from './database.js';
// Keep legacy fields in approval signatures; registration pricing no longer uses them.
export function eventFingerprint(t){return hash(JSON.stringify([t.id,t.name,t.level,t.venueName,t.venueAddress||'',t.startAt,t.rulesId,t.registrationOpenAt,t.registrationCloseAt,t.earlyUntil||'',t.regularUntil||'',t.fees,t.discounts||[],t.rankingMultiplier]));}
export async function eventReadiness(t){
 const rules=t.rulesId?await getJson('rules/'+t.rulesId+'.json'):null;
 const bank=await currentBankSettings(),divisions=await listJson('divisions/',1000,{tournamentId:t.id});
 const blockers=[];
 if(process.env.VERCEL_ENV==='production')blockers.push(...(await registrationPolicy()).blockers);
 if(!emailConfigured())blockers.push('회원 인증 이메일 발송 설정·검수');
 if(!usesPostgres())blockers.push('운영 데이터베이스 연결');
 if(!t.venueName||!t.startAt)blockers.push('대회 장소·일정');
 if(!t.registrationOpenAt||!t.registrationCloseAt)blockers.push('접수 시작·종료 시각');
 if(!rules||rules.status!=='APPROVED'||validateRules(rules))blockers.push('경기·랭킹 규정 승인');
 if(!validBankSettings(bank))blockers.push('수납 계좌·입금 기한');
 if(!divisions.some(d=>d.active!==false))blockers.push('참가 부문 등록');
 const approvals=(await listJson('workflows/',1000,{processId:'P03',target:t.id})).filter(w=>['APPROVED','COMPLETED'].includes(w.status)&&w.targetFingerprint===eventFingerprint(t));
 if(!approvals.length)blockers.push('현재 대회 설정에 대한 독립 검토 승인');
 return {tournamentId:t.id,name:t.name,status:t.status,blockers,ready:blockers.length===0,approvalId:approvals[0]?.id||null};
}
export async function releaseEvents(req,res,user){
 const events=(await listJson('tournaments/')).filter(t=>!t.deletedAt);
 if(req.method==='GET')return res.status(200).json({ok:true,events:await Promise.all(events.map(eventReadiness))});
 const b=req.body||{},t=events.find(t=>t.id===b.tournamentId),reason=clean(b.reason,500);
 if(!user.roles?.some(r=>['ADMIN','CEO'].includes(r)))return res.status(403).json({ok:false,error:'forbidden'});
 if(!t||!reason)return res.status(400).json({ok:false,error:'event_and_reason_required'});
 if(!['DRAFT','COMING_SOON','CLOSED'].includes(t.status))return res.status(409).json({ok:false,error:'invalid_release_state'});
 const readiness=await eventReadiness(t);if(!readiness.ready)return res.status(409).json({ok:false,error:'event_not_ready',blockers:readiness.blockers});
 if(Date.parse(t.registrationCloseAt)<=Date.now())return res.status(409).json({ok:false,error:'registration_closed'});
 const before=structuredClone(t);t.status='REGISTRATION_OPEN';t.releaseApprovalId=readiness.approvalId;t.updatedAt=now();
 await putJson('tournaments/'+t.id+'.json',t);
 await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'EVENT_RELEASED',entityId:t.id,before,after:t,reason,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true,tournament:t});
}
