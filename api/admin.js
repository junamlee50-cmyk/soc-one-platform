import {registrationSummary} from '../lib/registration-summary.js';
import {archiveEvent} from '../lib/event-archive.js';
import {guardianReviews} from '../lib/guardian-review.js';
import {releaseEvents} from '../lib/event-release.js';
import {workflows} from '../lib/workflow.js';
import {confirmBatchDeposit,reviewRefund} from '../lib/manual-payments.js';
import {currentBankSettings,validBankSettings,confirmManualPayment,paymentSummary} from '../lib/manual-payments.js';
import { assignmentConflict } from '../lib/referee-scope.js';
import { DRAFT_RULES, validateRules } from '../lib/rules.js';
import { apiHandler } from '../lib/http.js';
import { listJson, getJson, putJson, clean, makeId, hash, now } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();

  if(op==='bootstrap'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},key=typeof b.setupKey==='string'?b.setupKey:'';
    if(!process.env.SOC_ADMIN_SETUP_KEY||key!==process.env.SOC_ADMIN_SETUP_KEY)return res.status(403).json({ok:false,error:'invalid_setup_key'});
    if(await getJson('system/admin-bootstrap.json') || await getJson('system/bootstrap.json'))return res.status(409).json({ok:false,error:'already_bootstrapped'});
    const email=clean(b.email,255).toLowerCase();if(!email)return res.status(400).json({ok:false,error:'email_required'});
    const idx=await getJson('user-email/'+hash(email)+'.json');if(!idx)return res.status(404).json({ok:false,error:'user_not_found'});
    const user=await getJson('users/'+idx.userId+'.json');if(!user)return res.status(404).json({ok:false,error:'user_not_found'});
    user.roles=[...new Set([...(user.roles||[]),'STAFF','ADMIN','CEO'])];user.updatedAt=now();await putJson('users/'+user.id+'.json',user);await putJson('system/admin-bootstrap.json',{userId:user.id,emailHash:hash(email),createdAt:now()},{overwrite:false});
    return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,roles:user.roles}});
  }

  const roleMap={
    'event-archive':['ADMIN','CEO'],'guardian-review':['ADMIN','CEO'],'event-release':['STAFF','ADMIN','CEO'],'batch-deposit':['FINANCE','STAFF','ADMIN','CEO'],'workflows':['STAFF','FINANCE','ADMIN','CEO'],'refund-review':['ADMIN','CEO'],'payment-settings':['ADMIN','CEO'],'payment-ledger':['FINANCE','STAFF','ADMIN','CEO'],'rules':['ADMIN','CEO'],'overview':['STAFF','ADMIN','CEO'],'tournaments':['STAFF','ADMIN','CEO'],'academies':['STAFF','ADMIN','CEO'],
    'academy-status':['STAFF','ADMIN','CEO'],'registrations':['FINANCE','STAFF','ADMIN','CEO'],'payment-status':['FINANCE','STAFF','ADMIN','CEO'],
    'users':['STAFF','ADMIN','CEO'],'role':['CEO'],'audit':['ADMIN','CEO'],'support':['STAFF','ADMIN','CEO'],
    'training':['STAFF','FINANCE','ADMIN','CEO'],'training-settlement':['FINANCE','STAFF','ADMIN','CEO'],
    'referee-assignment':['STAFF','ADMIN','CEO'],'referee-assignments':['STAFF','ADMIN','CEO'],
    'sponsors':['STAFF','FINANCE','ADMIN','CEO'],'content':['STAFF','ADMIN','CEO']
  };
  const user=await requireUser(req,res,roleMap[op]||['ADMIN','CEO']);if(!user)return;

  if(op==='event-archive')return archiveEvent(req,res,user);
  if(op==='guardian-review')return guardianReviews(req,res,user);
  if(op==='event-release')return releaseEvents(req,res,user);
  if(op==='batch-deposit'){const result=await confirmBatchDeposit(req.body||{},user);return res.status(result.status||200).json(result.error?{ok:false,error:result.error}:{ok:true,batch:result.batch});}
  if(op==='workflows')return workflows(req,res,user);
  if(op==='refund-review'){
    const b=req.body||{},reg=await getJson('registrations/'+clean(b.registrationId,80)+'.json');
    if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});
    const result=await reviewRefund(reg,b,user);
    return res.status(result.status||200).json(result.error?{ok:false,error:result.error}:{ok:true,registration:result.registration});
  }

  if(op==='rules'){
    if(req.method==='GET')return res.status(200).json({ok:true,template:DRAFT_RULES,rules:await listJson('rules/')});
    if(!(user.roles||[]).includes('CEO'))return res.status(403).json({ok:false,error:'ceo_approval_required'});
    const b=req.body||{},error=validateRules(b);
    if(error)return res.status(400).json({ok:false,error});
    const reason=clean(b.reason,500);
    if(!reason||(b.status==='APPROVED'&&b.approvalAcknowledged!==true))return res.status(400).json({ok:false,error:'explicit_rules_approval_required'});
    const id=makeId('rule'),rule={id,version:b.version,status:b.status,participation:b.participation,win:b.win,bestEvents:b.bestEvents,medals:b.medals,bracketFactors:b.bracketFactors,reason,createdBy:user.id,createdAt:now()};
    await putJson('rules/'+id+'.json',rule,{overwrite:false});
    await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'RULES_'+rule.status,entityType:'RULES',entityId:id,after:rule,reason,createdAt:now()},{overwrite:false});
    return res.status(201).json({ok:true,rule});
  }

  if(op==='overview'){
    const [users,academies,tournaments,regs,audit]=await Promise.all([listJson('users/',5000),listJson('academies/',2000),listJson('tournaments/',1000),listJson('registrations/',10000),listJson('audit/',3000)]);
    const cash=paymentSummary(await listJson('payment-ledger/'),regs);
    return res.status(200).json({ok:true,overview:{members:users.filter(x=>x.status==='ACTIVE').length,athletes:users.filter(x=>(x.roles||[]).includes('ATHLETE')).length,coaches:users.filter(x=>(x.roles||[]).includes('COACH')).length,approvedAcademies:academies.filter(x=>x.status==='APPROVED').length,pendingAcademies:academies.filter(x=>x.status==='PENDING').length,tournaments:tournaments.filter(x=>!x.deletedAt).length,registrations:regs.length,received:cash.received,refunded:cash.refunded,netReceived:cash.netReceived,legacyUnreconciled:cash.legacyUnreconciled,auditEvents:audit.length}});
  }

  if(op==='tournaments'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const rows=(await listJson('tournaments/',1000)).filter(x=>req.query.includeArchived==='true'||!x.deletedAt).sort((a,b)=>String(a.startAt||'').localeCompare(String(b.startAt||'')));return res.status(200).json({ok:true,tournaments:rows});
  }

  if(op==='academies'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const rows=(await listJson('academies/',2000)).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));return res.status(200).json({ok:true,academies:rows});
  }

  if(op==='academy-status'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},id=clean(b.academyId,80),status=clean(b.status,20).toUpperCase();if(!['APPROVED','REJECTED','SUSPENDED'].includes(status))return res.status(400).json({ok:false,error:'invalid_status'});const a=await getJson('academies/'+id+'.json');if(!a)return res.status(404).json({ok:false,error:'academy_not_found'});const before={...a};a.status=status;a.joinedAt=status==='APPROVED'?(a.joinedAt||now()):a.joinedAt;a.updatedAt=now();a.reviewedBy=user.id;await putJson('academies/'+id+'.json',a);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'ACADEMY_STATUS',entityType:'ACADEMY',entityId:id,before,after:a,createdAt:now()},{overwrite:false});return res.status(200).json({ok:true,academy:a});
  }

  if(op==='registrations'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const [records,events]=await Promise.all([listJson('registrations/',10000),listJson('tournaments/',1000)]);
    const tournamentId=clean(req.query.tournamentId,80);
    const rows=records.filter(r=>!tournamentId||r.tournamentId===tournamentId).sort((a,b)=>String(b.registeredAt||'').localeCompare(String(a.registeredAt||'')));
    const grouped=new Map();for(const r of records){if(!grouped.has(r.tournamentId))grouped.set(r.tournamentId,[]);grouped.get(r.tournamentId).push(r);}
    const tournaments=events.map(t=>({id:t.id,name:t.name,startAt:t.startAt,status:t.status,archived:!!t.deletedAt,summary:registrationSummary(grouped.get(t.id)||[])}));
    for(const [id,entries]of grouped)if(!events.some(t=>t.id===id))tournaments.push({id,name:'대회 정보 확인 필요',summary:registrationSummary(entries)});
    return res.status(200).json({ok:true,registrations:rows,summary:registrationSummary(rows),tournaments});
  }

  if(op==='payment-settings'){
    const previous=await currentBankSettings();
    if(req.method==='GET')return res.status(200).json({ok:true,settings:previous});
    const b=req.body||{},reason=clean(b.reason,500);
    if(!reason)return res.status(400).json({ok:false,error:'change_reason_required'});
    if(b.expectedVersion!==(previous?.version||0))return res.status(409).json({ok:false,error:'settings_version_conflict'});
    const row={version:(previous?.version||0)+1,enabled:b.enabled===true,bankName:clean(b.bankName,80),accountNumber:clean(b.accountNumber,30),accountHolder:clean(b.accountHolder,80),instructions:clean(b.instructions,1000),paymentHours:Number(b.paymentHours),updatedBy:user.id,updatedAt:now()};
    if(row.enabled&&!validBankSettings(row))return res.status(400).json({ok:false,error:'invalid_bank_settings'});
    await putJson('system/bank-transfer.json',row);
    await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'BANK_SETTINGS_CHANGED',entityType:'PAYMENT_SETTINGS',entityId:'bank-transfer',before:previous,after:row,reason,createdAt:now()},{overwrite:false});
    return res.status(200).json({ok:true,settings:row});
  }
  if(op==='payment-ledger'){
    const ledger=(await listJson('payment-ledger/')).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));
    const regs=await listJson('registrations/');
    return res.status(200).json({ok:true,ledger,summary:paymentSummary(ledger,regs)});
  }
  if(op==='payment-status'){
    const b=req.body||{},reg=await getJson('registrations/'+clean(b.registrationId,80)+'.json');
    if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});
    const result=await confirmManualPayment(reg,b,user);
    if(result.error)return res.status(result.status).json({ok:false,error:result.error});
    return res.status(200).json({ok:true,registration:result.registration});
  }

  if(op==='users'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const rows=(await listJson('users/',5000)).map(x=>({id:x.id,socId:x.socId,name:x.name,roles:x.roles,status:x.status,committeeRegion:x.committeeRegion||null,createdAt:x.createdAt}));return res.status(200).json({ok:true,users:rows});
  }

  if(op==='role'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},userId=clean(b.userId,80),role=clean(b.role,30).toUpperCase(),action=clean(b.action,10).toUpperCase(),reason=clean(b.reason,500);
    const allowed=['ATHLETE','COACH','ACADEMY_ADMIN','COMMITTEE','REFEREE','STAFF','FINANCE','ADMIN'];
    if(!allowed.includes(role)||!['GRANT','REVOKE'].includes(action))return res.status(400).json({ok:false,error:'invalid_role_change'});
    if(!reason)return res.status(400).json({ok:false,error:'change_reason_required'});
    if(role==='COMMITTEE'&&action==='GRANT'&&!clean(b.region,80))return res.status(400).json({ok:false,error:'committee_region_required'});
    const target=await getJson('users/'+userId+'.json');if(!target)return res.status(404).json({ok:false,error:'user_not_found'});
    const before={roles:[...(target.roles||[])],committeeRegion:target.committeeRegion||null};
    if(action==='GRANT')target.roles=[...new Set([...(target.roles||[]),role])];else target.roles=(target.roles||[]).filter(x=>x!==role);
    if(role==='COMMITTEE')target.committeeRegion=action==='GRANT'?clean(b.region,80):null;
    target.updatedAt=now();target.authVersion=(target.authVersion||0)+1;await putJson('users/'+target.id+'.json',target);
    await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'ROLE_'+action,entityType:'USER',entityId:target.id,before,after:{roles:target.roles,committeeRegion:target.committeeRegion||null},reason,createdAt:now()},{overwrite:false});
    return res.status(200).json({ok:true,user:{id:target.id,socId:target.socId,name:target.name,roles:target.roles,committeeRegion:target.committeeRegion||null}});
  }

  if(op==='audit'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const rows=(await listJson('audit/',2000)).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,500);return res.status(200).json({ok:true,audit:rows});
  }

  if(op==='support'){
    if(req.method==='GET')return res.status(200).json({ok:true,applications:await listJson('support-applications/',5000)});
    if(req.method==='POST'){const b=req.body||{},id=clean(b.applicationId,80),row=await getJson('support-applications/'+id+'.json');if(!row)return res.status(404).json({ok:false,error:'not_found'});const c={competition:Number(b.competition??0),growth:Number(b.growth??0),activity:Number(b.activity??0),compliance:Number(b.compliance??0)};if(Object.values(c).some(x=>!Number.isFinite(x)||x<0)||c.competition>70||c.growth>15||c.activity>5||c.compliance>10||Number(b.external||0)!==0||Number(b.media||0)!==0)return res.status(400).json({ok:false,error:'score_out_of_range'});if(b.selected===true||!['DRAFT_SCORED',undefined].includes(b.status))return res.status(409).json({ok:false,error:'support_selection_policy_not_approved'});const before={...row};row.scoringVersion='DRAFT-2026-11-04-70-15-5-10';row.components=c;row.score=Object.values(c).reduce((s,x)=>s+x,0);row.status='DRAFT_SCORED';row.selected=false;row.reviewedBy=user.id;row.updatedAt=now();await putJson('support-applications/'+id+'.json',row);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'SUPPORT_REVIEW',entityType:'SUPPORT_APPLICATION',entityId:id,before,after:row,createdAt:now()},{overwrite:false});return res.status(200).json({ok:true,application:row});}
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='training'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    return res.status(200).json({ok:true,requests:await listJson('training-requests/',5000)});
  }

  if(op==='training-settlement'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    return res.status(409).json({ok:false,error:'training_settlement_not_configured',message:'협약·이용실적·정산조건·지급증빙 절차 설정 전에는 지급 완료로 처리할 수 없습니다.'});
  }

  if(op==='referee-assignment'){
    const b=req.body||{},reason=clean(b.reason,500);
    if(!reason)return res.status(400).json({ok:false,error:'change_reason_required'});
    if(b.action==='REVOKE'){
      const row=await getJson('referee-assignments/'+clean(b.assignmentId,80)+'.json');
      if(!row)return res.status(404).json({ok:false,error:'assignment_not_found'});
      if(row.status!=='ASSIGNED')return res.status(409).json({ok:false,error:'assignment_inactive'});
      const before={...row};row.status='REVOKED';row.revokedAt=now();row.revokedBy=user.id;
      await putJson('referee-assignments/'+row.id+'.json',row);
      await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'REFEREE_ASSIGNMENT_REVOKED',entityType:'REFEREE_ASSIGNMENT',entityId:row.id,before,after:row,reason,createdAt:now()},{overwrite:false});
      return res.status(200).json({ok:true,assignment:row});
    }
    const refereeUserId=clean(b.refereeUserId,80),tournamentId=clean(b.tournamentId,80),matNo=Number(b.matNo);
    const start=Date.parse(b.startsAt),end=Date.parse(b.endsAt);
    if(!refereeUserId||!tournamentId||!Number.isInteger(matNo)||matNo<1||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)
      return res.status(400).json({ok:false,error:'assignment_window_required'});
    const referee=await getJson('users/'+refereeUserId+'.json'),tournament=await getJson('tournaments/'+tournamentId+'.json');
    if(!referee?.roles?.includes('REFEREE')||referee.status!=='ACTIVE'||!tournament||tournament.deletedAt||['DRAFT','CANCELED','COMPLETED'].includes(tournament.status))return res.status(400).json({ok:false,error:'invalid_assignment'});
    const row={id:makeId('rfa'),refereeUserId,tournamentId,matNo,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),session:clean(b.session,40),status:'ASSIGNED',assignedBy:user.id,createdAt:now()};
    if(assignmentConflict(row,await listJson('referee-assignments/')))return res.status(409).json({ok:false,error:'assignment_schedule_conflict'});
    await putJson('referee-assignments/'+row.id+'.json',row,{overwrite:false});
    await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'REFEREE_ASSIGNED',entityType:'REFEREE_ASSIGNMENT',entityId:row.id,after:row,reason,createdAt:now()},{overwrite:false});
    return res.status(201).json({ok:true,assignment:row});
  }

  if(op==='referee-assignments'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    return res.status(200).json({ok:true,assignments:await listJson('referee-assignments/',5000)});
  }

  if(op==='sponsors'){
    if(req.method==='GET')return res.status(200).json({ok:true,sponsors:await listJson('sponsors/',2000)});
    if(req.method==='POST'){const b=req.body||{},name=clean(b.name,180);if(!name)return res.status(400).json({ok:false,error:'name_required'});const id=clean(b.id,80)||makeId('spn'),prev=await getJson('sponsors/'+id+'.json'),row={id,name,category:clean(b.category,80),status:clean(b.status,30)||'LEAD',contractValue:Number(b.contractValue)||0,currency:clean(b.currency,3)||'KRW',contractStart:clean(b.contractStart,20),contractEnd:clean(b.contractEnd,20),receivable:Number(b.receivable)||0,notes:clean(b.notes,500),createdAt:prev?.createdAt||now(),updatedAt:now(),updatedBy:user.id};await putJson('sponsors/'+id+'.json',row);return res.status(prev?200:201).json({ok:true,sponsor:row});}
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='content'){
    if(req.method==='GET')return res.status(200).json({ok:true,content:await listJson('content/',3000)});
    if(req.method==='POST'){const b=req.body||{},title=clean(b.title,220);if(!title)return res.status(400).json({ok:false,error:'title_required'});const id=clean(b.id,80)||makeId('cnt'),prev=await getJson('content/'+id+'.json'),status=clean(b.status,20)||'DRAFT',row={id,type:clean(b.type,30)||'NEWS',title,summary:clean(b.summary,800),body:clean(b.body,20000),coverUrl:clean(b.coverUrl,500),status,athleteSocId:clean(b.athleteSocId,30),academyId:clean(b.academyId,80),publishedAt:status==='PUBLISHED'?(prev?.publishedAt||now()):prev?.publishedAt||null,createdAt:prev?.createdAt||now(),updatedAt:now(),updatedBy:user.id};await putJson('content/'+id+'.json',row);return res.status(prev?200:201).json({ok:true,content:row});}
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  return res.status(404).json({ok:false,error:'unknown_admin_operation'});
}

export default apiHandler(handler, {
  "event-archive": ["POST"],
  "guardian-review": ["GET","POST"],
  "event-release": ["GET","POST"],
  "batch-deposit": ["POST"],
  "workflows": ["GET","POST"],
  "refund-review": ["POST"],
  "payment-settings": ["GET","POST"],
  "payment-ledger": ["GET"],
  "rules": ["GET","POST"],
  "bootstrap": [
    "POST"
  ],
  "overview": [
    "GET"
  ],
  "tournaments": [
    "GET"
  ],
  "academies": [
    "GET"
  ],
  "academy-status": [
    "POST"
  ],
  "registrations": [
    "GET"
  ],
  "payment-status": [
    "POST"
  ],
  "users": [
    "GET"
  ],
  "role": [
    "POST"
  ],
  "audit": [
    "GET"
  ],
  "support": [
    "GET",
    "POST"
  ],
  "training": [
    "GET"
  ],
  "training-settlement": [
    "POST"
  ],
  "referee-assignment": [
    "POST"
  ],
  "referee-assignments": [
    "GET"
  ],
  "sponsors": [
    "GET",
    "POST"
  ],
  "content": [
    "GET",
    "POST"
  ]
});
