import { listJson, putJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

export default async function handler(req,res){
  if(req.method==='GET'){
    const rows=(await listJson('tournaments/',300)).filter(x=>!x.deletedAt).sort((a,b)=>String(a.startAt||'').localeCompare(String(b.startAt||'')));
    return res.status(200).json({ok:true,tournaments:rows});
  }
  if(req.method==='POST'){
    const user=await requireUser(req,res,['STAFF','ADMIN','CEO']); if(!user)return;
    const b=req.body||{};
    const name=clean(b.name,180),level=clean(b.level,30),venueName=clean(b.venueName,180),startAt=clean(b.startAt,40);
    if(!name||!level||!startAt) return res.status(400).json({ok:false,error:'required_fields'});
    const id=makeId('trn');
    const row={id,name,level,venueName,venueAddress:clean(b.venueAddress,300),countryCode:clean(b.countryCode,2)||'KR',startAt,
      registrationOpenAt:clean(b.registrationOpenAt,40),earlyUntil:clean(b.earlyUntil,40),regularUntil:clean(b.regularUntil,40),registrationCloseAt:clean(b.registrationCloseAt,40),
      status:clean(b.status,30)||'DRAFT',rankingMultiplier:Number(b.rankingMultiplier)||1,
      fees:{early:Number(b.earlyFee)||0,regular:Number(b.regularFee)||0,late:Number(b.lateFee)||0,extra:Number(b.extraFee)||0},
      createdBy:user.id,createdAt:now(),updatedAt:now()};
    await putJson('tournaments/'+id+'.json',row,{overwrite:false});
    return res.status(201).json({ok:true,tournament:row});
  }
  res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}