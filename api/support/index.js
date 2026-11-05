import { listJson, putJson, makeId, clean, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['ATHLETE']);if(!u)return;
 if(req.method==='GET'){
  const rows=(await listJson('support-applications/',2000)).filter(x=>x.userId===u.id);
  return res.status(200).json({ok:true,applications:rows});
 }
 if(req.method==='POST'){
  const b=req.body||{};const season=clean(b.season,20)||'2027',tier=clean(b.tier,30).toUpperCase();
  if(!['DEVELOPMENT','SUPPORTED','ELITE','PRO'].includes(tier))return res.status(400).json({ok:false,error:'invalid_tier'});
  const prior=(await listJson('support-applications/',2000)).find(x=>x.userId===u.id&&x.season===season&&x.tier===tier&&x.status!=='WITHDRAWN');
  if(prior)return res.status(409).json({ok:false,error:'already_applied'});
  const row={id:makeId('sup'),userId:u.id,socId:u.socId,season,tier,status:'SUBMITTED',score:null,components:null,selected:false,submittedAt:now(),updatedAt:now()};
  await putJson('support-applications/'+row.id+'.json',row,{overwrite:false});
  return res.status(201).json({ok:true,application:row});
 }
 res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}