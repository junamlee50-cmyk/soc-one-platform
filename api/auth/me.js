import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const user=await requireUser(req,res); if(!user)return;
  return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles,countryCode:user.countryCode,locale:user.locale,committeeRegion:user.committeeRegion||null}});
}