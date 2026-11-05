import { putJson, makeId, clean, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['STAFF','ADMIN','CEO']);if(!u)return;
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 const b=req.body||{};const refereeUserId=clean(b.refereeUserId,80),tournamentId=clean(b.tournamentId,80);if(!refereeUserId||!tournamentId)return res.status(400).json({ok:false,error:'required_fields'});
 const row={id:makeId('rfa'),refereeUserId,tournamentId,matNo:Number(b.matNo)||null,session:clean(b.session,40),status:'ASSIGNED',assignedBy:u.id,createdAt:now()};
 await putJson('referee-assignments/'+row.id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,assignment:row});
}