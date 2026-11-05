import { listJson, putJson, getJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

export default async function handler(req,res){
  const user=await requireUser(req,res); if(!user)return;
  if(req.method==='GET'){
    const rows=(await listJson('registrations/',1000)).filter(x=>x.userId===user.id);
    return res.status(200).json({ok:true,registrations:rows});
  }
  if(req.method==='POST'){
    if(!(user.roles||[]).includes('ATHLETE')) return res.status(403).json({ok:false,error:'athlete_role_required'});
    const b=req.body||{}; const tournamentId=clean(b.tournamentId,80);
    if(!tournamentId) return res.status(400).json({ok:false,error:'tournament_required'});
    const trn=await getJson('tournaments/'+tournamentId+'.json'); if(!trn) return res.status(404).json({ok:false,error:'tournament_not_found'});
    const existing=(await listJson('registrations/',1000)).find(x=>x.userId===user.id && x.tournamentId===tournamentId && x.discipline===clean(b.discipline,20) && x.divisionKey===clean(b.divisionKey,80) && !['CANCELED','REFUNDED'].includes(x.status));
    if(existing) return res.status(409).json({ok:false,error:'duplicate_registration',registration:existing});
    const n=new Date(); const early=trn.earlyUntil?new Date(trn.earlyUntil):null, regular=trn.regularUntil?new Date(trn.regularUntil):null, close=trn.registrationCloseAt?new Date(trn.registrationCloseAt):null;
    if(close && n>close)return res.status(400).json({ok:false,error:'registration_closed'});
    let phase='REGULAR',amount=Number(trn.fees?.regular)||0;
    if(early && n<=early){phase='EARLY';amount=Number(trn.fees?.early)||amount;}
    else if(regular && n>regular){phase='LATE';amount=Number(trn.fees?.late)||amount;}
    if(Boolean(b.absolute))amount+=Number(trn.fees?.extra)||0;
    const id=makeId('reg');
    const row={id,tournamentId,userId:user.id,socId:user.socId,athleteName:user.name,academyId:clean(b.academyId,80),
      discipline:clean(b.discipline,20)||'GI',ageGroup:clean(b.ageGroup,30),belt:clean(b.belt,20),weightClass:clean(b.weightClass,40),
      divisionKey:clean(b.divisionKey,80),absolute:Boolean(b.absolute),status:'REGISTERED',paymentStatus:'UNPAID',
      pricingPhase:phase,amount,registeredAt:now(),updatedAt:now()};
    await putJson('registrations/'+id+'.json',row,{overwrite:false});
    return res.status(201).json({ok:true,registration:row});
  }
  res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}