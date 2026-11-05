import { getJson, putJson, clean, now, makeId } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const actor=await requireUser(req,res,['CEO']); if(!actor)return;
  const b=req.body||{}; const userId=clean(b.userId,80), role=clean(b.role,30).toUpperCase(), action=clean(b.action,10).toUpperCase();
  const allowed=['ATHLETE','COACH','ACADEMY_ADMIN','COMMITTEE','REFEREE','STAFF','FINANCE','ADMIN'];
  if(!allowed.includes(role)||!['GRANT','REVOKE'].includes(action))return res.status(400).json({ok:false,error:'invalid_role_change'});
  const user=await getJson('users/'+userId+'.json'); if(!user)return res.status(404).json({ok:false,error:'user_not_found'});
  const before=[...(user.roles||[])];
  if(action==='GRANT')user.roles=[...new Set([...(user.roles||[]),role])]; else user.roles=(user.roles||[]).filter(x=>x!==role);
  user.updatedAt=now();await putJson('users/'+user.id+'.json',user);
  await putJson('audit/'+makeId('aud')+'.json',{actorUserId:actor.id,action:'ROLE_'+action,entityType:'USER',entityId:user.id,before:{roles:before},after:{roles:user.roles},createdAt:now()},{overwrite:false});
  return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
}