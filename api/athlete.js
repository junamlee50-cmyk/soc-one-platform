import { getJson, putJson, clean, now } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req,res){
  const user=await requireUser(req,res,['ATHLETE']); if(!user)return;
  const path='athletes/'+user.id+'.json';
  if(req.method==='GET'){
    const row=await getJson(path);
    return res.status(200).json({ok:true,athlete:row});
  }
  if(req.method==='POST'||req.method==='PUT'){
    const b=req.body||{}; const prev=await getJson(path);
    let academyId=clean(b.academyId,80)||prev?.academyId||'';
    let academyName=prev?.academyName||'';
    if(academyId){
      const a=await getJson('academies/'+academyId+'.json');
      if(!a||a.status!=='APPROVED'||a.active===false)return res.status(400).json({ok:false,error:'academy_not_approved'});
      academyName=a.name;
    } else academyName='';
    const row={userId:user.id,socId:user.socId,displayName:clean(b.displayName,80)||prev?.displayName||user.name,
      belt:clean(b.belt,20)||prev?.belt||'WHITE',gender:clean(b.gender,20)||prev?.gender||'',
      defaultWeightKg:Number(b.defaultWeightKg)||prev?.defaultWeightKg||null,
      academyId,academyName,publicProfile:Boolean(b.publicProfile),
      countryCode:clean(b.countryCode,2)||prev?.countryCode||'KR',
      status:prev?.status||'REGISTERED',createdAt:prev?.createdAt||now(),updatedAt:now()};
    await putJson(path,row);
    return res.status(prev?200:201).json({ok:true,athlete:row});
  }
  res.setHeader('Allow','GET, POST, PUT');return res.status(405).json({ok:false,error:'method_not_allowed'});
}