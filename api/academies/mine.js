import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const u=await requireUser(req,res,['COACH','ACADEMY_ADMIN']);if(!u)return;
  const rows=(await listJson('academies/',2000)).filter(x=>x.coachUserId===u.id||x.adminUserIds?.includes(u.id));
  return res.status(200).json({ok:true,academies:rows});
}