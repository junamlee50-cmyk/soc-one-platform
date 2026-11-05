import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 const u=await requireUser(req,res,['STAFF','ADMIN','CEO']);if(!u)return;
 const rows=(await listJson('tournaments/',1000)).filter(x=>!x.deletedAt).sort((a,b)=>String(a.startAt||'').localeCompare(String(b.startAt||'')));
 return res.status(200).json({ok:true,tournaments:rows});
}