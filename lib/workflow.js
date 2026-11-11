import {eventFingerprint} from './event-release.js';
import {PROCESSES,PROCESS_VERSION} from './processes.js';
import {usesPostgres} from './database.js';
import {getJson,listJson,putJson,makeId,clean,now} from './blobdb.js';
const operators=['STAFF','FINANCE','ADMIN','CEO'];
const manager=u=>u.roles?.some(r=>['ADMIN','CEO'].includes(r));
const visible=(r,u)=>manager(u)||r.ownerId===u.id||r.createdBy===u.id||r.reviewerId===u.id;
export async function workflows(req,res,user){
 const rows=await listJson('workflows/');
 if(req.method==='GET'){
  const users=(await listJson('users/')).filter(u=>u.status==='ACTIVE'&&u.roles?.some(r=>operators.includes(r)));
  const tasks=rows.filter(r=>visible(r,user)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  return res.status(200).json({ok:true,processes:PROCESSES,tasks,assignees:users.map(u=>({id:u.id,name:u.name,roles:u.roles})),canApprove:manager(user)});
 }
 if(!usesPostgres())return res.status(503).json({ok:false,error:'transactional_database_required'});
 const b=req.body||{},reason=clean(b.reason,500);
 if(!reason)return res.status(400).json({ok:false,error:'change_reason_required'});
 const action=b.action,existing=b.id?rows.find(r=>r.id===b.id):null;
 let row,before=null;
 if(action==='CREATE'){
  const process=PROCESSES.find(p=>p.id===b.processId),title=clean(b.title,180),target=clean(b.target,160);
  const due=Date.parse(b.dueAt),owner=await getJson('users/'+clean(b.ownerId,80)+'.json');
  if(!process||!title||!target||!Number.isFinite(due)||!owner||owner.status!=='ACTIVE'||!owner.roles?.some(r=>operators.includes(r)))return res.status(400).json({ok:false,error:'invalid_workflow'});
  if(!manager(user)&&owner.id!==user.id)return res.status(403).json({ok:false,error:'assignment_forbidden'});
  row={id:makeId('work'),processId:process.id,processVersion:PROCESS_VERSION,title,target,ownerId:owner.id,ownerName:owner.name,dueAt:new Date(due).toISOString(),status:'DRAFT',revision:0,evidence:process.checks.map(label=>({label,reference:''})),createdBy:user.id,createdAt:now(),history:[]};
 }else{
  if(!existing||!visible(existing,user))return res.status(404).json({ok:false,error:'workflow_not_found'});
  if(!Number.isInteger(b.revision)||b.revision!==existing.revision)return res.status(409).json({ok:false,error:'workflow_revision_conflict'});
  before=structuredClone(existing);row=structuredClone(existing);
  if(['SAVE','SUBMIT'].includes(action)){
   if(row.ownerId!==user.id)return res.status(403).json({ok:false,error:'workflow_owner_required'});
   if(!['DRAFT','RETURNED'].includes(row.status))return res.status(409).json({ok:false,error:'workflow_transition_invalid'});
   if(!Array.isArray(b.evidence)||b.evidence.length!==row.evidence.length)return res.status(400).json({ok:false,error:'workflow_evidence_required'});
   row.evidence=row.evidence.map((x,i)=>({...x,reference:clean(b.evidence[i],500)}));
   if(action==='SUBMIT'&&row.reviewerId){const reviewer=await getJson('users/'+row.reviewerId+'.json');if(!reviewer||reviewer.status!=='ACTIVE'||!manager(reviewer)||[row.ownerId,row.createdBy].includes(reviewer.id))return res.status(409).json({ok:false,error:'reviewer_unavailable'});}
   if(action==='SUBMIT'&&row.evidence.some(x=>!x.reference))return res.status(400).json({ok:false,error:'workflow_evidence_required'});
   if(action==='SUBMIT'&&row.processId==='P03'){const t=await getJson('tournaments/'+clean(row.target,80)+'.json');if(!t)return res.status(400).json({ok:false,error:'workflow_event_required'});row.targetFingerprint=eventFingerprint(t);}
   row.status=action==='SUBMIT'?'IN_REVIEW':'DRAFT';
  }else if(action==='UPDATE'){
   if(!manager(user))return res.status(403).json({ok:false,error:'workflow_approver_required'});
   if(['COMPLETED','CANCELED'].includes(row.status))return res.status(409).json({ok:false,error:'workflow_transition_invalid'});
   const owner=await getJson('users/'+clean(b.ownerId,80)+'.json');
   const reviewer=b.reviewerId?await getJson('users/'+clean(b.reviewerId,80)+'.json'):null;
   const due=Date.parse(b.dueAt);
   if(!owner||owner.status!=='ACTIVE'||!owner.roles?.some(r=>operators.includes(r))||!Number.isFinite(due))return res.status(400).json({ok:false,error:'invalid_workflow'});
   if(!reviewer||reviewer.status!=='ACTIVE'||!manager(reviewer)||[owner.id,row.createdBy].includes(reviewer.id))return res.status(400).json({ok:false,error:'reviewer_unavailable'});
   row.ownerId=owner.id;row.ownerName=owner.name;row.reviewerId=reviewer.id;row.dueAt=new Date(due).toISOString();
   row.status='RETURNED';delete row.reviewedBy;delete row.reviewedAt;
  }else if(action==='WITHDRAW'){
   if(row.ownerId!==user.id||row.status!=='IN_REVIEW')return res.status(409).json({ok:false,error:'workflow_transition_invalid'});
   row.status='DRAFT';
  }else if(action==='CANCEL'){
   if(!manager(user))return res.status(403).json({ok:false,error:'workflow_approver_required'});
   if(!['DRAFT','RETURNED','IN_REVIEW'].includes(row.status))return res.status(409).json({ok:false,error:'workflow_transition_invalid'});
   row.status='CANCELED';row.canceledAt=now();row.canceledBy=user.id;
  }else if(['APPROVE','RETURN'].includes(action)){
   if(!manager(user))return res.status(403).json({ok:false,error:'workflow_approver_required'});
   if(row.reviewerId&&row.reviewerId!==user.id)return res.status(403).json({ok:false,error:'designated_reviewer_required'});
   if(row.ownerId===user.id||row.createdBy===user.id)return res.status(403).json({ok:false,error:'independent_approver_required'});
   if(row.status!=='IN_REVIEW')return res.status(409).json({ok:false,error:'workflow_transition_invalid'});
   if(action==='APPROVE'&&row.processId==='P03'){const t=await getJson('tournaments/'+clean(row.target,80)+'.json');if(!t||row.targetFingerprint!==eventFingerprint(t))return res.status(409).json({ok:false,error:'workflow_target_changed'});}
   row.status=action==='APPROVE'?'APPROVED':'RETURNED';row.reviewedBy=user.id;row.reviewedAt=now();
  }else if(action==='COMPLETE'){
   if(row.ownerId!==user.id)return res.status(403).json({ok:false,error:'workflow_owner_required'});
   if(row.status!=='APPROVED')return res.status(409).json({ok:false,error:'workflow_transition_invalid'});
   const completionReference=clean(b.completionReference,500);
   if(!completionReference)return res.status(400).json({ok:false,error:'completion_evidence_required'});
   row.status='COMPLETED';row.completionReference=completionReference;row.completedBy=user.id;row.completedAt=now();
  }else if(action==='REOPEN'){
   if(!manager(user))return res.status(403).json({ok:false,error:'workflow_approver_required'});
   if(!['APPROVED','COMPLETED'].includes(row.status))return res.status(409).json({ok:false,error:'workflow_transition_invalid'});
   row.status='RETURNED';delete row.completionReference;delete row.completedAt;delete row.completedBy;delete row.reviewedBy;delete row.reviewedAt;
  }else return res.status(400).json({ok:false,error:'invalid_workflow_action'});
  row.revision++;
 }
 row.updatedAt=now();row.history.push({action,actorId:user.id,at:row.updatedAt,reason});
 await putJson('workflows/'+row.id+'.json',row,{overwrite:action!=='CREATE'});
 await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'WORKFLOW_'+action,entityType:'WORKFLOW',entityId:row.id,before,after:row,reason,createdAt:now()},{overwrite:false});
 return res.status(action==='CREATE'?201:200).json({ok:true,task:row});
}
