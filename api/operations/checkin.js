import crypto from 'node:crypto';
import { getJson, putJson, clean, now, makeId } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

const sign=(id)=>crypto.createHmac('sha256',process.env.SOC_TICKET_SIGNING_KEY||'').update(id).digest('base64url').slice(0,24);
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const actor=await requireUser(req,res,['STAFF','ADMIN','CEO','REFEREE']); if(!actor)return;
  const payload=clean(req.body?.payload,220); const m=/^SOC:([^:]+):([^:]+)$/.exec(payload||'');
  if(!m)return res.status(400).json({ok:false,error:'invalid_ticket'});
  const [,id,sig]=m; if(sig!==sign(id))return res.status(400).json({ok:false,error:'invalid_signature'});
  const reg=await getJson('registrations/'+id+'.json'); if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});
  if(reg.paymentStatus!=='PAID')return res.status(409).json({ok:false,error:'payment_not_completed'});
  const before={...reg};reg.checkInStatus='CHECKED_IN';reg.checkedInAt=now();reg.checkedInBy=actor.id;reg.updatedAt=now();
  await putJson('registrations/'+id+'.json',reg);
  await putJson('audit/'+makeId('aud')+'.json',{actorUserId:actor.id,action:'CHECK_IN',entityType:'REGISTRATION',entityId:id,before,after:reg,createdAt:now()},{overwrite:false});
  return res.status(200).json({ok:true,registration:reg});
}