import { listJson, putJson, getJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

export default async function handler(req,res){
  const user=await requireUser(req,res); if(!user)return;
  if(req.method==='GET'){
    const rows=(await listJson('registrations/',3000)).filter(x=>x.userId===user.id);
    return res.status(200).json({ok:true,registrations:rows});
  }
  if(req.method==='POST'){
    if(!(user.roles||[]).includes('ATHLETE')) return res.status(403).json({ok:false,error:'athlete_role_required'});
    const b=req.body||{};
    const tournamentId=clean(b.tournamentId,80);
    const divisionId=clean(b.divisionId,80);
    if(!tournamentId||!divisionId) return res.status(400).json({ok:false,error:'tournament_and_division_required'});

    const trn=await getJson('tournaments/'+tournamentId+'.json');
    if(!trn) return res.status(404).json({ok:false,error:'tournament_not_found'});
    const div=await getJson('divisions/'+divisionId+'.json');
    if(!div||div.tournamentId!==tournamentId||div.active===false) return res.status(404).json({ok:false,error:'division_not_found'});

    const existing=(await listJson('registrations/',3000)).find(x=>x.userId===user.id&&x.tournamentId===tournamentId&&x.divisionId===divisionId&&!['CANCELED','REFUNDED'].includes(x.status));
    if(existing) return res.status(409).json({ok:false,error:'duplicate_registration',registration:existing});

    const n=new Date();
    const early=trn.earlyUntil?new Date(trn.earlyUntil):null;
    const regular=trn.regularUntil?new Date(trn.regularUntil):null;
    const close=trn.registrationCloseAt?new Date(trn.registrationCloseAt):null;
    if(close&&n>close) return res.status(400).json({ok:false,error:'registration_closed'});

    let phase='REGULAR';
    let amount=Number(trn.fees?.regular)||0;
    if(early&&n<=early){phase='EARLY';amount=Number(trn.fees?.early)||amount;}
    else if(regular&&n>regular){phase='LATE';amount=Number(trn.fees?.late)||amount;}
    if(div.absolute) amount+=Number(trn.fees?.extra)||0;

    const id=makeId('reg');
    const row={id,tournamentId,divisionId,userId:user.id,socId:user.socId,athleteName:user.name,
      academyId:clean(b.academyId,80),discipline:div.discipline,ageGroup:div.ageGroup,belt:div.belt,
      weightClass:div.weightClass,divisionKey:div.key,absolute:!!div.absolute,status:'REGISTERED',
      paymentStatus:'UNPAID',pricingPhase:phase,amount,registeredAt:now(),updatedAt:now()};
    await putJson('registrations/'+id+'.json',row,{overwrite:false});
    return res.status(201).json({ok:true,registration:row});
  }
  res.setHeader('Allow','GET, POST');
  return res.status(405).json({ok:false,error:'method_not_allowed'});
}