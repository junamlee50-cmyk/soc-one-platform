import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['REFEREE']);if(!u)return;
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 const rows=(await listJson('referee-assignments/',3000)).filter(x=>x.refereeUserId===u.id);
 return res.status(200).json({ok:true,assignments:rows});
}