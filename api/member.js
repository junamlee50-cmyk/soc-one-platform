import {currentBankSettings,validBankSettings,bankSnapshot,paymentDeadline,memberPaymentChange,paymentSummary} from '../lib/manual-payments.js';
import { assignmentActive, assignmentCoversMatch } from '../lib/referee-scope.js';
import { registrationPrice, eligibility } from '../lib/registration.js';
import {inquiries} from '../lib/inquiries.js';
import {registrationPolicy} from '../lib/service-settings.js';
import { seasonRanking, DEFAULT_SEASON } from '../lib/ranking.js';
import { apiHandler } from '../lib/http.js';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { listJson, putJson, getJson, clean, makeId, hash, now } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

import { ticketSign, signingKey } from '../lib/tickets.js';

async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();
  if(op==='inquiries'){
    const user=await requireUser(req,res);if(!user)return;
    return inquiries(req,res,user);
  }

  if(op==='athlete'){
    const user=await requireUser(req,res,['ATHLETE']);if(!user)return;
    const path='athletes/'+user.id+'.json';
    if(req.method==='GET')return res.status(200).json({ok:true,athlete:await getJson(path)});
    if(req.method==='POST'||req.method==='PUT'){
      const b=req.body||{},prev=await getJson(path);let academyId=b.academyId===undefined?(prev?.academyId||''):clean(b.academyId,80),academyName=prev?.academyName||'';
      if(academyId){const a=await getJson('academies/'+academyId+'.json');if(!a||a.status!=='APPROVED'||a.active===false)return res.status(400).json({ok:false,error:'academy_not_approved'});academyName=a.name;}else academyName='';
      const row={userId:user.id,socId:user.socId,birthDate:clean(b.birthDate,10)||prev?.birthDate||null,displayName:clean(b.displayName,80)||prev?.displayName||user.name,belt:clean(b.belt,20)||prev?.belt||'WHITE',gender:clean(b.gender,20)||prev?.gender||'',defaultWeightKg:Number(b.defaultWeightKg)||prev?.defaultWeightKg||null,academyId,academyName,publicProfile:Boolean(b.publicProfile),countryCode:clean(b.countryCode,2)||prev?.countryCode||'KR',status:prev?.status||'REGISTERED',createdAt:prev?.createdAt||now(),updatedAt:now()};
      await putJson(path,row);return res.status(prev?200:201).json({ok:true,athlete:row});
    }
    res.setHeader('Allow','GET, POST, PUT');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='registration-quote'){
    const user=await requireUser(req,res,['ATHLETE']);if(!user)return;
    const tournamentId=clean(req.query.tournamentId,80),divisionId=clean(req.query.divisionId,80);
    const t=await getJson('tournaments/'+tournamentId+'.json'),division=await getJson('divisions/'+divisionId+'.json');
    if(!t||t.deletedAt||t.status!=='REGISTRATION_OPEN'||!division||division.active===false||division.tournamentId!==tournamentId)return res.status(404).json({ok:false,error:'registration_not_open'});
    const existing=await listJson('registrations/',3000,{userId:user.id,tournamentId});
    const price=registrationPrice(t,division,existing,clean(req.query.discountCode,60));
    if(price.error)return res.status(409).json({ok:false,error:price.error});
    return res.status(200).json({ok:true,price,priceKey:hash(JSON.stringify(price)),calculatedAt:now()});
  }

  if(op==='registrations'){
    const user=await requireUser(req,res);if(!user)return;
    if(req.method==='GET'){const rows=(await listJson('registrations/',3000)).filter(x=>x.userId===user.id);return res.status(200).json({ok:true,registrations:rows});}
    if(req.method==='POST'){
      if(!user.emailVerifiedAt)return res.status(409).json({ok:false,error:'email_verification_required',message:'MY SOC에서 이메일 인증을 완료한 뒤 참가신청해 주세요.'});
      if(!(user.roles||[]).includes('ATHLETE'))return res.status(403).json({ok:false,error:'athlete_role_required'});
      const b=req.body||{},tournamentId=clean(b.tournamentId,80),divisionId=clean(b.divisionId,80);if(!tournamentId||!divisionId)return res.status(400).json({ok:false,error:'tournament_and_division_required'});
      const service=await registrationPolicy();
      if(process.env.VERCEL_ENV==='production'&&!service.policy)return res.status(409).json({ok:false,error:'service_policy_required',message:'운영 약관 공개 후 신청할 수 있습니다.'});
      if(service.policy&&(b.policyId!==service.policy.id||b.refundConsent!==true))return res.status(409).json({ok:false,error:'refund_policy_consent_required',message:'현재 취소·환불 안내를 확인하고 동의해 주세요.'});
      const trn=await getJson('tournaments/'+tournamentId+'.json');if(!trn)return res.status(404).json({ok:false,error:'tournament_not_found'});
      if(trn.deletedAt||trn.status!=='REGISTRATION_OPEN')return res.status(409).json({ok:false,error:'registration_not_open'});
      const opens=trn.registrationOpenAt?Date.parse(trn.registrationOpenAt):null;
      const closes=trn.registrationCloseAt?Date.parse(trn.registrationCloseAt):null;
      const earlyEnd=trn.earlyUntil?Date.parse(trn.earlyUntil):null;
      const regularEnd=trn.regularUntil?Date.parse(trn.regularUntil):null;
      if([opens,closes,earlyEnd,regularEnd].some(x=>x!==null&&!Number.isFinite(x)))return res.status(409).json({ok:false,error:'invalid_registration_schedule'});
      if(opens!==null&&Date.now()<opens)return res.status(409).json({ok:false,error:'registration_not_started'});
      if(closes!==null&&Date.now()>=closes)return res.status(409).json({ok:false,error:'registration_closed'});
      const div=await getJson('divisions/'+divisionId+'.json');if(!div||div.tournamentId!==tournamentId||div.active===false)return res.status(404).json({ok:false,error:'division_not_found'});
      if((await listJson('brackets/',1000,{tournamentId,divisionKey:div.key})).some(b=>b.status==='PUBLISHED'))return res.status(409).json({ok:false,error:'division_bracket_locked'});
      const existing=(await listJson('registrations/',3000,{userId:user.id,tournamentId,divisionId})).find(x=>x.userId===user.id&&x.tournamentId===tournamentId&&x.divisionId===divisionId&&!['CANCELED','REFUNDED'].includes(x.status));if(existing)return res.status(409).json({ok:false,error:'duplicate_registration',registration:existing});
      if(div.capacity!=null){const capacity=Number(div.capacity);if(!Number.isInteger(capacity)||capacity<1)return res.status(409).json({ok:false,error:'invalid_capacity'});const active=(await listJson('registrations/',3000,{tournamentId,divisionId})).filter(x=>!['CANCELED','REFUNDED'].includes(x.status));if(active.length>=capacity)return res.status(409).json({ok:false,error:'division_full'});}
      const profile=await getJson('athletes/'+user.id+'.json');
      const guardian=await getJson('guardian-consents/'+user.id+'.json');
      const eligibilityError=eligibility(profile,div,trn,guardian);
      if(eligibilityError)return res.status(409).json({ok:false,error:eligibilityError});
      if(profile.academyId){const academy=await getJson('academies/'+profile.academyId+'.json');if(!academy||academy.status!=='APPROVED'||academy.active===false)return res.status(409).json({ok:false,error:'academy_not_approved'});}
      const other=(await listJson('registrations/',3000,{userId:user.id,tournamentId}));
      const price=registrationPrice(trn,div,other,clean(b.discountCode,60));
      if(price.error)return res.status(409).json({ok:false,error:price.error});
      if(b.expectedPriceKey!==undefined&&b.expectedPriceKey!==hash(JSON.stringify(price)))return res.status(409).json({ok:false,error:'price_changed',message:'적용 요금이 변경되었습니다. 새 금액을 확인한 뒤 다시 신청해 주세요.'});
      const {amount,phase}=price,id=makeId('reg'),bank=await currentBankSettings();
      if(amount>0&&!validBankSettings(bank))return res.status(409).json({ok:false,error:'bank_transfer_not_configured',message:'운영진의 입금계좌 설정 후 신청할 수 있습니다.'});
      const row={id,tournamentId,divisionId,userId:user.id,socId:user.socId,athleteName:profile?.displayName||user.name,academyId:profile?.academyId||'',discipline:div.discipline,ageGroup:div.ageGroup,belt:div.belt,weightClass:div.weightClass,divisionKey:div.key,gender:div.gender,absolute:!!div.absolute,priceSnapshot:price,paymentMethod:'BANK_TRANSFER',paymentRevision:0,bankTransfer:amount>0?bankSnapshot(bank):null,paymentDueAt:amount>0?paymentDeadline(trn,bank):null,status:'REGISTERED',paymentStatus:'UNPAID',pricingPhase:phase,amount,registeredAt:now(),updatedAt:now()};
      row.policySnapshot=service.policy?{policyId:service.policy.id,version:service.policy.policyVersion,refundText:service.policy.refundText,acceptedAt:now()}:null;
      await putJson('registrations/'+id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,registration:row});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='payment'){
    const user=await requireUser(req,res,['ATHLETE']);if(!user)return;
    const id=clean(req.method==='GET'?req.query.registrationId:req.body?.registrationId,80);
    const reg=await getJson('registrations/'+id+'.json');
    if(!reg||reg.userId!==user.id)return res.status(404).json({ok:false,error:'registration_not_found'});
    if(req.method==='GET')return res.status(200).json({ok:true,registration:reg});
    const result=await memberPaymentChange(reg,req.body||{},user);
    if(result.error)return res.status(result.status).json({ok:false,error:result.error});
    return res.status(200).json({ok:true,registration:result.registration});
  }

  if(op==='dashboard'){
    const user=await requireUser(req,res);if(!user)return;const role=String(req.query.role||'athlete').toLowerCase(),roles=user.roles||[];
    const allowed={athlete:['ATHLETE'],academy:['COACH','ACADEMY_ADMIN'],region:['COMMITTEE'],referee:['REFEREE'],ceo:['CEO']};
    if(allowed[role]&&!allowed[role].some(r=>roles.includes(r)))return res.status(403).json({ok:false,error:'forbidden'});
    if(role==='athlete'){
      const season=String(req.query.season||DEFAULT_SEASON);
      if(!/^\d{4}$/.test(season))return res.status(400).json({ok:false,error:'invalid_season'});
      const [events,regs,tournaments]=await Promise.all([listJson('ranking-events/',10000),listJson('registrations/',5000),listJson('tournaments/',1000)]);
      const categoryStats=seasonRanking(events.filter(x=>x.athleteUserId===user.id),tournaments,season);
      const stats=categoryStats.reduce((sum,x)=>({points:sum.points+x.points,wins:sum.wins+x.wins}),{points:0,wins:0});
      const myRegs=regs.filter(x=>x.userId===user.id&&!['CANCELED','REFUNDED'].includes(x.status));
      return res.status(200).json({ok:true,role,season,categoryStats,data:{points:stats.points,wins:stats.wins,registrations:myRegs.length,paid:myRegs.filter(x=>x.paymentStatus==='PAID').length}});
    }
    if(role==='academy'){
      const season=String(req.query.season||DEFAULT_SEASON);
      if(!/^\d{4}$/.test(season))return res.status(400).json({ok:false,error:'invalid_season'});
      const [academies,regs,events,tournaments]=await Promise.all([listJson('academies/',1000),listJson('registrations/',10000),listJson('ranking-events/',10000),listJson('tournaments/',1000)]);
      const mine=academies.filter(x=>(x.coachUserId===user.id||x.adminUserIds?.includes(user.id))&&x.status==='APPROVED'),ids=new Set(mine.map(x=>x.id));
      const myRegs=regs.filter(x=>ids.has(x.academyId)),athleteIds=new Set(myRegs.map(x=>x.userId));
      const teamPoints=seasonRanking(events.filter(x=>athleteIds.has(x.athleteUserId)),tournaments,season).reduce((sum,x)=>sum+x.points,0);
      return res.status(200).json({ok:true,role,season,data:{academies:mine.length,registeredAthletes:athleteIds.size,eventRegistrations:myRegs.length,teamPoints:Math.round(teamPoints*100)/100}});
    }
    if(role==='region'){const region=user.committeeRegion||'', [academies,regs,audit]=await Promise.all([listJson('academies/',2000),listJson('registrations/',10000),listJson('audit/',2000)]),scoped=region?academies.filter(x=>x.region===region):[],ids=new Set(scoped.map(x=>x.id)),scopedRegs=regs.filter(x=>ids.has(x.academyId));return res.status(200).json({ok:true,role,data:{region:region||'미지정',approvedAcademies:scoped.filter(x=>x.status==='APPROVED').length,pendingAcademies:scoped.filter(x=>x.status==='PENDING').length,eventRegistrations:scopedRegs.length,activeAthletes:new Set(scopedRegs.map(x=>x.userId)).size,activityEvents:audit.filter(x=>ids.has(x.entityId)).length}});}
    if(role==='referee'){const assignments=(await listJson('referee-assignments/',1000,{refereeUserId:user.id})).filter(a=>assignmentActive(a));const matches=(await listJson('matches/')).filter(m=>assignments.some(a=>assignmentCoversMatch(a,m))),judged=matches.filter(x=>x.resultBy===user.id&&x.status==='COMPLETED');return res.status(200).json({ok:true,role,data:{completedMatches:judged.length,scheduled:matches.filter(x=>x.status==='SCHEDULED').length,assignments:assignments.length,rating:'-'}});}
    if(role==='ceo'){const [users,academies,tournaments,regs,audit]=await Promise.all([listJson('users/',5000),listJson('academies/',2000),listJson('tournaments/',1000),listJson('registrations/',10000),listJson('audit/',3000)]);return res.status(200).json({ok:true,role,data:{members:users.filter(x=>x.status==='ACTIVE').length,academies:academies.filter(x=>x.status==='APPROVED').length,tournaments:tournaments.length,...paymentSummary(await listJson('payment-ledger/'),regs),registrations:regs.length,auditEvents:audit.length}});}
    return res.status(400).json({ok:false,error:'unknown_role'});
  }

  if(op==='ticket'||op==='ticket-qr'){
    const user=await requireUser(req,res,['ATHLETE']);if(!user)return;const id=clean(req.query.registrationId,80),reg=await getJson('registrations/'+id+'.json');if(!reg||reg.userId!==user.id)return res.status(404).json({ok:false,error:'registration_not_found'});if(reg.status!=='REGISTERED'||reg.paymentStatus!=='PAID')return res.status(409).json({ok:false,error:'paid_registration_required',message:'입금 확인 후 참가증을 발급할 수 있습니다.'});const event=await getJson('tournaments/'+reg.tournamentId+'.json');if(!event||event.status==='CANCELED')return res.status(409).json({ok:false,error:'tournament_inactive'});
    const payload='SOC:'+reg.id+':'+ticketSign(reg.id);
    if(op==='ticket')return res.status(200).json({ok:true,ticket:{registrationId:reg.id,tournamentId:reg.tournamentId,socId:user.socId,athleteName:user.name,payload,paymentStatus:reg.paymentStatus,checkInStatus:reg.checkInStatus||'NOT_CHECKED_IN'}});
    const svg=await QRCode.toString(payload,{type:'svg',margin:1,width:280,errorCorrectionLevel:'M'});res.setHeader('Content-Type','image/svg+xml; charset=utf-8');res.setHeader('Cache-Control','private, no-store');return res.status(200).send(svg);
  }

  if(op==='support'){
    const u=await requireUser(req,res,['ATHLETE']);if(!u)return;
    if(req.method==='GET'){return res.status(200).json({ok:true,applications:(await listJson('support-applications/',2000)).filter(x=>x.userId===u.id)});}
    if(req.method==='POST'){const b=req.body||{},season=clean(b.season,20)||'2027',tier=clean(b.tier,30).toUpperCase();if(!/^\d{4}$/.test(season))return res.status(400).json({ok:false,error:'invalid_season'});if(!['DEVELOPMENT','SUPPORTED','ELITE','PRO'].includes(tier))return res.status(400).json({ok:false,error:'invalid_tier'});const prior=(await listJson('support-applications/',2000)).find(x=>x.userId===u.id&&x.season===season&&x.tier===tier&&x.status!=='WITHDRAWN');if(prior)return res.status(409).json({ok:false,error:'already_applied'});const row={id:makeId('sup'),userId:u.id,socId:u.socId,season,tier,applicationKind:'INTEREST',status:'SUBMITTED',score:null,components:null,selected:false,submittedAt:now(),updatedAt:now()};await putJson('support-applications/'+row.id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,application:row});}
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='training'){
    const u=await requireUser(req,res,['ATHLETE']);if(!u)return;
    if(req.method==='GET')return res.status(200).json({ok:true,requests:(await listJson('training-requests/',3000)).filter(x=>x.athleteUserId===u.id)});
    if(req.method==='POST')return res.status(409).json({ok:false,error:'training_contract_and_quota_not_configured',message:'협약·이용한도·예약 정원이 확정된 뒤 신청할 수 있습니다.'});
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='academy-mine'){
    const u=await requireUser(req,res,['COACH','ACADEMY_ADMIN']);if(!u)return;const rows=(await listJson('academies/',2000)).filter(x=>x.coachUserId===u.id||x.adminUserIds?.includes(u.id));return res.status(200).json({ok:true,academies:rows});
  }

  if(op==='academy-athletes'){
    const u=await requireUser(req,res,['COACH','ACADEMY_ADMIN']);if(!u)return;const academyId=String(req.query.academyId||''),own=(await listJson('academies/',2000)).some(x=>x.id===academyId&&(x.coachUserId===u.id||x.adminUserIds?.includes(u.id)));if(!own)return res.status(403).json({ok:false,error:'forbidden'});const rows=(await listJson('athletes/',5000)).filter(x=>x.academyId===academyId).map(x=>({socId:x.socId,displayName:x.displayName,belt:x.belt,status:x.status,publicProfile:x.publicProfile}));return res.status(200).json({ok:true,athletes:rows});
  }

  if(op==='academy-training'){
    const u=await requireUser(req,res,['COACH','ACADEMY_ADMIN']);if(!u)return;const owned=(await listJson('academies/',2000)).filter(x=>x.coachUserId===u.id||x.adminUserIds?.includes(u.id)),ids=new Set(owned.map(x=>x.id));
    if(req.method==='GET')return res.status(200).json({ok:true,requests:(await listJson('training-requests/',5000)).filter(x=>ids.has(x.hostAcademyId))});
    if(req.method==='POST')return res.status(409).json({ok:false,error:'training_contract_and_quota_not_configured'});
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='referee-assignments'){
    const u=await requireUser(req,res,['REFEREE']);if(!u)return;return res.status(200).json({ok:true,assignments:(await listJson('referee-assignments/',3000)).filter(x=>x.refereeUserId===u.id)});
  }

  if(op==='certificate'||op==='certificate-qr'){
    const u=await requireUser(req,res,['ATHLETE']);if(!u)return;
    if(op==='certificate'){
      const tournamentId=clean(req.body.tournamentId,80);if(!tournamentId)return res.status(400).json({ok:false,error:'tournament_required'});
      const [trn,profile,events,matches,medals]=await Promise.all([getJson('tournaments/'+tournamentId+'.json'),getJson('athletes/'+u.id+'.json'),listJson('ranking-events/',10000),listJson('matches/',10000),listJson('medals/',5000)]);
      if(!trn||trn.status==='CANCELED')return res.status(404).json({ok:false,error:'tournament_not_found'});
      const mineMatches=matches.filter(x=>x.tournamentId===tournamentId&&x.status==='COMPLETED'&&(x.athleteA?.userId===u.id||x.athleteB?.userId===u.id));
      if(!mineMatches.length)return res.status(409).json({ok:false,error:'no_completed_result'});
      const mineEvents=events.filter(x=>x.tournamentId===tournamentId&&x.athleteUserId===u.id&&!x.voidedAt),mineMedals=medals.filter(x=>x.tournamentId===tournamentId&&x.athleteUserId===u.id);
      const code=crypto.createHmac('sha256',signingKey()).update('CERT|'+u.id+'|'+tournamentId+'|'+hash(JSON.stringify(mineEvents.map(e=>[e.id,e.finalPoints]).sort()))).digest('base64url').slice(0,28);
      const cert={code,socId:u.socId,athleteName:profile?.displayName||u.name,academyName:profile?.academyName||'',belt:profile?.belt||'',tournamentId,tournamentName:trn.name,eventDate:trn.startAt||'',wins:mineEvents.filter(x=>x.type==='WIN').length,points:mineEvents.reduce((s,x)=>s+(Number(x.finalPoints)||0),0),medals:mineMedals.map(x=>({medal:x.medal,absolute:x.absolute})),issuedAt:now()};
      await putJson('certificates/'+code+'.json',cert);
      return res.status(200).json({ok:true,certificate:cert});
    }
    const code=clean(req.query.code,60);const cert=await getJson('certificates/'+code+'.json');if(!cert||cert.revokedAt||cert.socId!==u.socId)return res.status(404).end();
    const verifyUrl='https://'+(req.headers.host||'soc-one-platform.vercel.app')+'/verify.html?code='+encodeURIComponent(code);const svg=await QRCode.toString(verifyUrl,{type:'svg',margin:1,width:260,errorCorrectionLevel:'M'});res.setHeader('Content-Type','image/svg+xml; charset=utf-8');res.setHeader('Cache-Control','private, no-store');return res.status(200).send(svg);
  }

  return res.status(404).json({ok:false,error:'unknown_member_operation'});
}

export default apiHandler(handler, {
  "registration-quote": ["GET"],
  "inquiries": ["GET","POST"],
  "payment": ["GET","POST"],
  "athlete": [
    "GET",
    "POST",
    "PUT"
  ],
  "registrations": [
    "GET",
    "POST"
  ],
  "dashboard": [
    "GET"
  ],
  "ticket": [
    "GET"
  ],
  "ticket-qr": [
    "GET"
  ],
  "support": [
    "GET",
    "POST"
  ],
  "training": [
    "GET",
    "POST"
  ],
  "academy-mine": [
    "GET"
  ],
  "academy-athletes": [
    "GET"
  ],
  "academy-training": [
    "GET",
    "POST"
  ],
  "referee-assignments": [
    "GET"
  ],
  "certificate": [
    "POST"
  ],
  "certificate-qr": [
    "GET"
  ]
});
