import crypto from 'node:crypto';
import { getJson, clean } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

const sign=(id)=>crypto.createHmac('sha256',process.env.SOC_TICKET_SIGNING_KEY||'').update(id).digest('base64url').slice(0,24);
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const user=await requireUser(req,res,['ATHLETE']); if(!user)return;
  const id=clean(req.query.registrationId,80); if(!id)return res.status(400).json({ok:false,error:'registration_required'});
  const reg=await getJson('registrations/'+id+'.json'); if(!reg||reg.userId!==user.id)return res.status(404).json({ok:false,error:'registration_not_found'});
  const payload='SOC:'+reg.id+':'+sign(reg.id);
  return res.status(200).json({ok:true,ticket:{registrationId:reg.id,tournamentId:reg.tournamentId,socId:user.socId,athleteName:user.name,payload,paymentStatus:reg.paymentStatus,checkInStatus:reg.checkInStatus||'NOT_CHECKED_IN'}});
}