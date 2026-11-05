import { listJson, putJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

export default async function handler(req,res){
  if(req.method==='GET'){
    const rows=(await listJson('academies/',500)).filter(x=>x.status==='APPROVED' && x.active!==false);
    return res.status(200).json({ok:true,academies:rows.map(({id,name,region,coachName,slug,joinedAt})=>({id,name,region,coachName,slug,joinedAt}))});
  }
  if(req.method==='POST'){
    const user=await requireUser(req,res,['COACH','ADMIN','CEO']); if(!user)return;
    const b=req.body||{};
    const name=clean(b.name,160), region=clean(b.region,80), address=clean(b.address,300);
    if(!name||!region) return res.status(400).json({ok:false,error:'required_fields'});
    const id=makeId('aca');
    const row={id,name,slug:(name+'-'+id.slice(-6)).toLowerCase().replace(/[^a-z0-9가-힣-]+/g,'-'),region,address,coachUserId:user.id,coachName:user.name,status:'PENDING',active:true,createdAt:now(),joinedAt:null};
    await putJson('academies/'+id+'.json',row,{overwrite:false});
    return res.status(201).json({ok:true,academy:row});
  }
  res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}