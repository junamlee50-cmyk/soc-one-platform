import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const u=await requireUser(req,res,['COACH','ACADEMY_ADMIN']);if(!u)return;
  const academyId=String(req.query.academyId||'');
  const own=(await listJson('academies/',2000)).some(x=>x.id===academyId&&(x.coachUserId===u.id||x.adminUserIds?.includes(u.id)));
  if(!own)return res.status(403).json({ok:false,error:'forbidden'});
  const rows=(await listJson('athletes/',5000)).filter(x=>x.academyId===academyId).map(x=>({socId:x.socId,displayName:x.displayName,belt:x.belt,status:x.status,publicProfile:x.publicProfile}));
  return res.status(200).json({ok:true,athletes:rows});
}