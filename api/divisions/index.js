import { listJson, putJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method==='GET'){
    const tournamentId=clean(req.query.tournamentId,80);
    const rows=(await listJson('divisions/',5000)).filter(x=>x.tournamentId===tournamentId && x.active!==false);
    return res.status(200).json({ok:true,divisions:rows});
  }
  if(req.method==='POST'){
    const u=await requireUser(req,res,['STAFF','ADMIN','CEO']);if(!u)return;
    const b=req.body||{}; const tournamentId=clean(b.tournamentId,80),discipline=clean(b.discipline,20),ageGroup=clean(b.ageGroup,30),belt=clean(b.belt,20),weightClass=clean(b.weightClass,40);
    if(!tournamentId||!discipline||!ageGroup||!belt||!weightClass)return res.status(400).json({ok:false,error:'required_fields'});
    const id=makeId('div'); const key=[discipline,ageGroup,belt,weightClass,Boolean(b.absolute)?'ABS':'WEIGHT'].join('|');
    const row={id,tournamentId,key,discipline,ageGroup,belt,gender:clean(b.gender,20),weightClass,weightLimitKg:Number(b.weightLimitKg)||null,absolute:Boolean(b.absolute),active:true,createdBy:u.id,createdAt:now()};
    await putJson('divisions/'+id+'.json',row,{overwrite:false});
    return res.status(201).json({ok:true,division:row});
  }
  res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}