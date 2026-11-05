import { getJson, hash, clean, verifyPassword } from '../../lib/blobdb.js';
import { createSession } from '../../lib/auth.js';

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const b=req.body||{};
  const email=clean(b.email,255).toLowerCase();
  const password=typeof b.password==='string'?b.password:'';
  const idx=await getJson('user-email/'+hash(email)+'.json');
  if(!idx) return res.status(401).json({ok:false,error:'invalid_credentials'});
  const user=await getJson('users/'+idx.userId+'.json');
  if(!user || user.status!=='ACTIVE' || !verifyPassword(password,user.passwordSalt,user.passwordHash)) return res.status(401).json({ok:false,error:'invalid_credentials'});
  await createSession(res,user);
  return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
}