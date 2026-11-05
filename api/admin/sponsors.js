import { listJson, putJson, getJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['STAFF','FINANCE','ADMIN','CEO']);if(!u)return;
 if(req.method==='GET'){const rows=await listJson('sponsors/',2000);return res.status(200).json({ok:true,sponsors:rows});}
 if(req.method==='POST'){
  const b=req.body||{},name=clean(b.name,180);if(!name)return res.status(400).json({ok:false,error:'name_required'});
  const id=clean(b.id,80)||makeId('spn');const prev=await getJson('sponsors/'+id+'.json');
  const row={id,name,category:clean(b.category,80),status:clean(b.status,30)||'LEAD',contractValue:Number(b.contractValue)||0,currency:clean(b.currency,3)||'KRW',contractStart:clean(b.contractStart,20),contractEnd:clean(b.contractEnd,20),receivable:Number(b.receivable)||0,notes:clean(b.notes,500),createdAt:prev?.createdAt||now(),updatedAt:now(),updatedBy:u.id};
  await putJson('sponsors/'+id+'.json',row);return res.status(prev?200:201).json({ok:true,sponsor:row});
 }
 res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}