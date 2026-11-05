import { getJson, putJson, clean, now, makeId } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const actor=await requireUser(req,res,['STAFF','ADMIN','CEO']); if(!actor)return;
  const b=req.body||{}; const id=clean(b.academyId,80), status=clean(b.status,20).toUpperCase();
  if(!['APPROVED','REJECTED','SUSPENDED'].includes(status))return res.status(400).json({ok:false,error:'invalid_status'});
  const a=await getJson('academies/'+id+'.json'); if(!a)return res.status(404).json({ok:false,error:'academy_not_found'});
  const before={...a}; a.status=status;a.joinedAt=status==='APPROVED'?(a.joinedAt||now()):a.joinedAt;a.updatedAt=now();a.reviewedBy=actor.id;
  await putJson('academies/'+id+'.json',a);
  await putJson('audit/'+makeId('aud')+'.json',{actorUserId:actor.id,action:'ACADEMY_STATUS',entityType:'ACADEMY',entityId:id,before,after:a,createdAt:now()},{overwrite:false});
  return res.status(200).json({ok:true,academy:a});
}