import { getJson, putJson, hash, clean, now } from '../../lib/blobdb.js';
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const b=req.body||{}; const key=typeof b.setupKey==='string'?b.setupKey:'';
  if(!process.env.SOC_ADMIN_SETUP_KEY || key!==process.env.SOC_ADMIN_SETUP_KEY) return res.status(403).json({ok:false,error:'invalid_setup_key'});
  if(await getJson('system/admin-bootstrap.json')) return res.status(409).json({ok:false,error:'already_bootstrapped'});
  const email=clean(b.email,255).toLowerCase(); if(!email)return res.status(400).json({ok:false,error:'email_required'});
  const idx=await getJson('user-email/'+hash(email)+'.json'); if(!idx)return res.status(404).json({ok:false,error:'user_not_found'});
  const user=await getJson('users/'+idx.userId+'.json'); if(!user)return res.status(404).json({ok:false,error:'user_not_found'});
  user.roles=[...new Set([...(user.roles||[]),'STAFF','ADMIN','CEO'])]; user.updatedAt=now();
  await putJson('users/'+user.id+'.json',user);
  await putJson('system/admin-bootstrap.json',{userId:user.id,emailHash:hash(email),createdAt:now()},{overwrite:false});
  return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
}