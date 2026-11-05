import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const actor=await requireUser(req,res,['FINANCE','STAFF','ADMIN','CEO']); if(!actor)return;
  const rows=(await listJson('registrations/',10000)).sort((a,b)=>String(b.registeredAt||'').localeCompare(String(a.registeredAt||'')));
  return res.status(200).json({ok:true,registrations:rows});
}