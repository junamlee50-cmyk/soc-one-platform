import { getJson, putJson, clean, now, makeId } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const actor=await requireUser(req,res,['FINANCE','STAFF','ADMIN','CEO']); if(!actor)return;
  const b=req.body||{}; const id=clean(b.registrationId,80), status=clean(b.paymentStatus,30).toUpperCase();
  if(!['UNPAID','PENDING','PAID','REFUND_REQUESTED','REFUNDED','CANCELED'].includes(status))return res.status(400).json({ok:false,error:'invalid_status'});
  const reg=await getJson('registrations/'+id+'.json'); if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});
  const before={...reg}; reg.paymentStatus=status;reg.updatedAt=now();reg.paymentUpdatedBy=actor.id;reg.paymentReference=clean(b.reference,120);
  await putJson('registrations/'+id+'.json',reg);
  await putJson('audit/'+makeId('aud')+'.json',{actorUserId:actor.id,action:'PAYMENT_STATUS',entityType:'REGISTRATION',entityId:id,before,after:reg,createdAt:now()},{overwrite:false});
  return res.status(200).json({ok:true,registration:reg});
}