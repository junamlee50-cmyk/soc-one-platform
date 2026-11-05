import { getJson, putJson, clean, now, makeId } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 const u=await requireUser(req,res,['FINANCE','STAFF','ADMIN','CEO']);if(!u)return;
 const b=req.body||{},id=clean(b.requestId,80);const row=await getJson('training-requests/'+id+'.json');if(!row)return res.status(404).json({ok:false,error:'not_found'});
 const before={...row};row.settlementAmount=Number(b.amount)||0;row.settlementCurrency=clean(b.currency,3)||'KRW';row.settlementStatus=clean(b.status,20)||'PENDING';row.settlementUpdatedBy=u.id;row.updatedAt=now();
 await putJson('training-requests/'+id+'.json',row);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:u.id,action:'TRAINING_SETTLEMENT',entityType:'TRAINING_REQUEST',entityId:id,before,after:row,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true,request:row});
}