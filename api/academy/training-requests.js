import { listJson, getJson, putJson, clean, now, makeId } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['COACH','ACADEMY_ADMIN']);if(!u)return;
 const owned=(await listJson('academies/',2000)).filter(x=>x.coachUserId===u.id||x.adminUserIds?.includes(u.id));const ids=new Set(owned.map(x=>x.id));
 if(req.method==='GET'){
   const rows=(await listJson('training-requests/',5000)).filter(x=>ids.has(x.hostAcademyId));
   return res.status(200).json({ok:true,requests:rows});
 }
 if(req.method==='POST'){
   const b=req.body||{},id=clean(b.requestId,80),status=clean(b.status,20).toUpperCase();
   if(!['APPROVED','REJECTED','COMPLETED'].includes(status))return res.status(400).json({ok:false,error:'invalid_status'});
   const row=await getJson('training-requests/'+id+'.json');if(!row||!ids.has(row.hostAcademyId))return res.status(404).json({ok:false,error:'request_not_found'});
   const before={...row};row.status=status;row.hostReviewedBy=u.id;row.hostReviewedAt=now();row.updatedAt=now();
   await putJson('training-requests/'+id+'.json',row);
   await putJson('audit/'+makeId('aud')+'.json',{actorUserId:u.id,action:'TRAINING_'+status,entityType:'TRAINING_REQUEST',entityId:id,before,after:row,createdAt:now()},{overwrite:false});
   return res.status(200).json({ok:true,request:row});
 }
 res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}