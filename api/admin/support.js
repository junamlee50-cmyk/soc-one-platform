import { listJson, getJson, putJson, clean, now, makeId } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['STAFF','ADMIN','CEO']);if(!u)return;
 if(req.method==='GET'){const rows=await listJson('support-applications/',5000);return res.status(200).json({ok:true,applications:rows});}
 if(req.method==='POST'){
  const b=req.body||{},id=clean(b.applicationId,80);const row=await getJson('support-applications/'+id+'.json');if(!row)return res.status(404).json({ok:false,error:'not_found'});
  const c={competition:Number(b.competition)||0,external:Number(b.external)||0,growth:Number(b.growth)||0,activity:Number(b.activity)||0,compliance:Number(b.compliance)||0,media:Number(b.media)||0};
  if(c.competition>45||c.external>20||c.growth>10||c.activity>10||c.compliance>10||c.media>5)return res.status(400).json({ok:false,error:'score_out_of_range'});
  const score=Object.values(c).reduce((s,x)=>s+x,0);const before={...row};row.components=c;row.score=score;row.status=clean(b.status,30)||'SCORED';row.selected=Boolean(b.selected);row.reviewedBy=u.id;row.updatedAt=now();
  await putJson('support-applications/'+id+'.json',row);
  await putJson('audit/'+makeId('aud')+'.json',{actorUserId:u.id,action:'SUPPORT_REVIEW',entityType:'SUPPORT_APPLICATION',entityId:id,before,after:row,createdAt:now()},{overwrite:false});
  return res.status(200).json({ok:true,application:row});
 }
 res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}