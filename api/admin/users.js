import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const actor=await requireUser(req,res,['STAFF','ADMIN','CEO']); if(!actor)return;
  const rows=(await listJson('users/',5000)).map(x=>({id:x.id,socId:x.socId,name:x.name,email:x.email,roles:x.roles,status:x.status,createdAt:x.createdAt}));
  return res.status(200).json({ok:true,users:rows});
}