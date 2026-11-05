import { getJson, putJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const user=await requireUser(req,res,['REFEREE','STAFF','ADMIN','CEO']); if(!user)return;
  const b=req.body||{}; const registrationId=clean(b.registrationId,80); const weight=Number(b.weightKg);
  if(!registrationId||!Number.isFinite(weight)||weight<=0) return res.status(400).json({ok:false,error:'invalid_input'});
  const reg=await getJson('registrations/'+registrationId+'.json'); if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});
  const limit=Number(b.limitKg)||0; const passed=limit?weight<=limit:Boolean(b.passed!==false);
  const row={id:makeId('wei'),registrationId,tournamentId:reg.tournamentId,userId:reg.userId,weightKg:weight,limitKg:limit||null,passed,measuredBy:user.id,measuredAt:now()};
  await putJson('weighins/'+row.id+'.json',row,{overwrite:false});
  reg.weighInStatus=passed?'PASSED':'FAILED'; reg.weighedKg=weight; reg.updatedAt=now();
  await putJson('registrations/'+registrationId+'.json',reg);
  return res.status(201).json({ok:true,weighIn:row,registration:reg});
}