import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { getJson, clean } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

const sign=(id)=>crypto.createHmac('sha256',process.env.SOC_TICKET_SIGNING_KEY||'').update(id).digest('base64url').slice(0,24);
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
  const u=await requireUser(req,res,['ATHLETE']); if(!u)return;
  const id=clean(req.query.registrationId,80); const reg=await getJson('registrations/'+id+'.json');
  if(!reg||reg.userId!==u.id)return res.status(404).end();
  const payload='SOC:'+id+':'+sign(id);
  const svg=await QRCode.toString(payload,{type:'svg',margin:1,width:280,errorCorrectionLevel:'M'});
  res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control','private, no-store');
  return res.status(200).send(svg);
}