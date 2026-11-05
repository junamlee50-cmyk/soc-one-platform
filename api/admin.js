import { listJson, getJson, putJson, clean, makeId, hash, now } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();

  if(op==='bootstrap'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},key=typeof b.setupKey==='string'?b.setupKey:'';
    if(!process.env.SOC_ADMIN_SETUP_KEY||key!==process.env.SOC_ADMIN_SETUP_KEY)return res.status(403).json({ok:false,error:'invalid_setup_key'});
    if(await getJson('system/admin-bootstrap.json'))return res.status(409).json({ok:false,error:'already_bootstrapped'});
    const email=clean(b.email,255).toLowerCase();if(!email)return res.status(400).json({ok:false,error:'email_required'});
    const idx=await getJson('user-email/'+hash(email)+'.json');if(!idx)return res.status(404).json({ok:false,error:'user_not_found'});
    const user=await getJson('users/'+idx.userId+'.json');if(!user)return res.status(404).json({ok:false,error:'user_not_found'});
    user.roles=[...new Set([...(user.roles||[]),'STAFF','ADMIN','CEO'])];user.updatedAt=now();await putJson('users/'+user.id+'.json',user);await putJson('system/admin-bootstrap.json',{userId:user.id,emailHash:hash(email),createdAt:now()},{overwrite:false});
    return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,roles:user.roles}});
  }

  const roleMap={
    'overview':['STAFF','ADMIN','CEO'],'tournaments':['STAFF','ADMIN','CEO'],'academies':['STAFF','ADMIN','CEO'],
    'academy-status':['STAFF','ADMIN','CEO'],'registrations':['FINANCE','STAFF','ADMIN','CEO'],'payment-status':['FINANCE','STAFF','ADMIN','CEO'],
    'users':['STAFF','ADMIN','CEO'],'role':['CEO'],'audit':['ADMIN','CEO'],'support':['STAFF','ADMIN','CEO'],
    'training':['STAFF','FINANCE','ADMIN','CEO'],'training-settlement':['FINANCE','STAFF','ADMIN','CEO'],
    'referee-assignment':['STAFF','ADMIN','CEO'],'referee-assignments':['STAFF','ADMIN','CEO'],
    'sponsors':['STAFF','FINANCE','ADMIN','CEO'],'content':['STAFF','ADMIN','CEO']
  };
  const user=await requireUser(req,res,roleMap[op]||['ADMIN','CEO']);if(!user)return;

  if(op==='overview'){
    const [users,academies,tournaments,regs,audit]=await Promise.all([listJson('users/',5000),listJson('academies/',2000),listJson('tournaments/',1000),listJson('registrations/',10000),listJson('audit/',3000)]);
    const paid=regs.filter(x=>x.paymentStatus==='PAID').reduce((s,x)=>s+(Number(x.amount)||0),0);
    return res.status(200).json({ok:true,overview:{members:users.filter(x=>x.status==='ACTIVE').length,athletes:users.filter(x=>(x.roles||[]).includes('ATHLETE')).length,coaches:users.filter(x=>(x.roles||[]).includes('COACH')).length,approvedAcademies:academies.filter(x=>x.status==='APPROVED').length,pendingAcademies:academies.filter(x=>x.status==='PENDING').length,tournaments:tournaments.filter(x=>!x.deletedAt).length,registrations:regs.length,paidRevenue:paid,auditEvents:audit.length}});
  }

  if(op==='tournaments'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const rows=(await listJson('tournaments/',1000)).filter(x=>!x.deletedAt).sort((a,b)=>String(a.startAt||'').localeCompare(String(b.startAt||'')));return res.status(200).json({ok:true,tournaments:rows});
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
    const rows=(await listJson('registrations/',10000)).sort((a,b)=>String(b.registeredAt||'').localeCompare(String(a.registeredAt||'')));return res.status(200).json({ok:true,registrations:rows});
  }

  if(op==='payment-status'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},id=clean(b.registrationId,80),status=clean(b.paymentStatus,30).toUpperCase();if(!['UNPAID','PENDING','PAID','REFUND_REQUESTED','REFUNDED','CANCELED'].includes(status))return res.status(400).json({ok:false,error:'invalid_status'});const reg=await getJson('registrations/'+id+'.json');if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});const before={...reg};reg.paymentStatus=status;reg.updatedAt=now();reg.paymentUpdatedBy=user.id;reg.paymentReference=clean(b.reference,120);await putJson('registrations/'+id+'.json',reg);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'PAYMENT_STATUS',entityType:'REGISTRATION',entityId:id,before,after:reg,createdAt:now()},{overwrite:false});return res.status(200).json({ok:true,registration:reg});
  }

  if(op==='users'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const rows=(await listJson('users/',5000)).map(x=>({id:x.id,socId:x.socId,name:x.name,roles:x.roles,status:x.status,committeeRegion:x.committeeRegion||null,createdAt:x.createdAt}));return res.status(200).json({ok:true,users:rows});
  }

  if(op==='role'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},userId=clean(b.userId,80),role=clean(b.role,30).toUpperCase(),action=clean(b.action,10).toUpperCase(),allowed=['ATHLETE','COACH','ACADEMY_ADMIN','COMMITTEE','REFEREE','STAFF','FINANCE','ADMIN'];if(!allowed.includes(role)||!['GRANT','REVOKE'].includes(action))return res.status(400).json({ok:false,error:'invalid_role_change'});const target=await getJson('users/'+userId+'.json');if(!target)return res.status(404).json({ok:false,error:'user_not_found'});const before={roles:[...(target.roles||[])],committeeRegion:target.committeeRegion||null};if(action==='GRANT')target.roles=[...new Set([...(target.roles||[]),role])];else target.roles=(target.roles||[]).filter(x=>x!==role);if(role==='COMMITTEE')target.committeeRegion=action==='GRANT'?clean(b.region,80):null;target.updatedAt=now();await putJson('users/'+target.id+'.json',target);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'ROLE_'+action,entityType:'USER',entityId:target.id,before,after:{roles:target.roles,committeeRegion:target.committeeRegion||null},createdAt:now()},{overwrite:false});return res.status(200).json({ok:true,user:{id:target.id,socId:target.socId,name:target.name,roles:target.roles,committeeRegion:target.committeeRegion||null}});
  }

  if(op==='audit'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const rows=(await listJson('audit/',2000)).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,500);return res.status(200).json({ok:true,audit:rows});
  }

  if(op==='support'){
    if(req.method==='GET')return res.status(200).json({ok:true,applications:await listJson('support-applications/',5000)});
    if(req.method==='POST'){const b=req.body||{},id=clean(b.applicationId,80),row=await getJson('support-applications/'+id+'.json');if(!row)return res.status(404).json({ok:false,error:'not_found'});const c={competition:Number(b.competition)||0,external:Number(b.external)||0,growth:Number(b.growth)||0,activity:Number(b.activity)||0,compliance:Number(b.compliance)||0,media:Number(b.media)||0};if(c.competition>45||c.external>20||c.growth>10||c.activity>10||c.compliance>10||c.media>5)return res.status(400).json({ok:false,error:'score_out_of_range'});const before={...row};row.components=c;row.score=Object.values(c).reduce((s,x)=>s+x,0);row.status=clean(b.status,30)||'SCORED';row.selected=Boolean(b.selected);row.reviewedBy=user.id;row.updatedAt=now();await putJson('support-applications/'+id+'.json',row);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'SUPPORT_REVIEW',entityType:'SUPPORT_APPLICATION',entityId:id,before,after:row,createdAt:now()},{overwrite:false});return res.status(200).json({ok:true,application:row});}
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='training'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    return res.status(200).json({ok:true,requests:await listJson('training-requests/',5000)});
  }

  if(op==='training-settlement'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},id=clean(b.requestId,80),row=await getJson('training-requests/'+id+'.json');if(!row)return res.status(404).json({ok:false,error:'not_found'});const before={...row};row.settlementAmount=Number(b.amount)||0;row.settlementCurrency=clean(b.currency,3)||'KRW';row.settlementStatus=clean(b.status,20)||'PENDING';row.settlementUpdatedBy=user.id;row.updatedAt=now();await putJson('training-requests/'+id+'.json',row);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'TRAINING_SETTLEMENT',entityType:'TRAINING_REQUEST',entityId:id,before,after:row,createdAt:now()},{overwrite:false});return res.status(200).json({ok:true,request:row});
  }

  if(op==='referee-assignment'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},refereeUserId=clean(b.refereeUserId,80),tournamentId=clean(b.tournamentId,80);if(!refereeUserId||!tournamentId)return res.status(400).json({ok:false,error:'required_fields'});const row={id:makeId('rfa'),refereeUserId,tournamentId,matNo:Number(b.matNo)||null,session:clean(b.session,40),status:'ASSIGNED',assignedBy:user.id,createdAt:now()};await putJson('referee-assignments/'+row.id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,assignment:row});
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