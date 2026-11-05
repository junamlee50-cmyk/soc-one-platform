import { listJson, putJson, getJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['ATHLETE']);if(!u)return;
 if(req.method==='GET'){
   const rows=(await listJson('training-requests/',3000)).filter(x=>x.athleteUserId===u.id);
   return res.status(200).json({ok:true,requests:rows});
 }
 if(req.method==='POST'){
   const b=req.body||{};const hostAcademyId=clean(b.hostAcademyId,80),visitDate=clean(b.visitDate,20),passTier=clean(b.passTier,30)||'MEMBER';
   if(!hostAcademyId||!visitDate)return res.status(400).json({ok:false,error:'required_fields'});
   const a=await getJson('academies/'+hostAcademyId+'.json');if(!a||a.status!=='APPROVED')return res.status(404).json({ok:false,error:'host_academy_not_found'});
   const row={id:makeId('trq'),athleteUserId:u.id,socId:u.socId,athleteName:u.name,hostAcademyId,hostAcademyName:a.name,visitDate,passTier,status:'REQUESTED',settlementAmount:0,settlementCurrency:'KRW',createdAt:now(),updatedAt:now()};
   await putJson('training-requests/'+row.id+'.json',row,{overwrite:false});
   return res.status(201).json({ok:true,request:row});
 }
 res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}