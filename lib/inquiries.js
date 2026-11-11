import {listJson,getJson,putJson,clean,makeId,now} from './blobdb.js';
import {usesPostgres} from './database.js';
const categories=['ACCOUNT','REGISTRATION','PAYMENT','REFUND','RESULT','SUPPORT','OTHER'];
export async function inquiries(req,res,user,{admin=false}={}){
 if(!usesPostgres())return res.status(503).json({ok:false,error:'transactional_database_required'});
 const rows=await listJson('inquiries/',1000,admin?{}:{userId:user.id});
 if(req.method==='GET')return res.status(200).json({ok:true,inquiries:rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(({internalNotes,...row})=>row)});
 const b=req.body||{};
 if(!admin){
  if(rows.filter(r=>Date.parse(r.createdAt)>Date.now()-10*60000).length>=3)return res.status(429).json({ok:false,error:'too_many_inquiries',message:'문의가 접수되었습니다. 추가 문의는 잠시 후 등록해 주세요.'});
  const subject=clean(b.subject,160),message=clean(b.message,4000),category=clean(b.category,30),registrationId=clean(b.registrationId,80);
  if(!subject||message.length<5||!categories.includes(category))return res.status(400).json({ok:false,error:'invalid_inquiry'});
  if(registrationId){const reg=await getJson('registrations/'+registrationId+'.json');if(!reg||reg.userId!==user.id)return res.status(404).json({ok:false,error:'registration_not_found'});}
  const row={id:makeId('inq'),userId:user.id,socId:user.socId,name:user.name,category,subject,message,registrationId,status:'OPEN',revision:1,replies:[],createdAt:now(),updatedAt:now()};
  await putJson('inquiries/'+row.id+'.json',row,{overwrite:false});
  return res.status(201).json({ok:true,inquiry:row});
 }
 const row=rows.find(r=>r.id===b.id),reply=clean(b.reply,4000),status=clean(b.status,20);
 if(!row)return res.status(404).json({ok:false,error:'inquiry_not_found'});
 if(b.revision!==row.revision)return res.status(409).json({ok:false,error:'inquiry_version_conflict'});
 if(!['OPEN','ANSWERED','CLOSED'].includes(status)||!reply)return res.status(400).json({ok:false,error:'reply_and_status_required'});
 const before=structuredClone(row);row.replies.push({message:reply,staffName:user.name,createdAt:now()});row.status=status;row.revision++;row.updatedAt=now();
 await putJson('inquiries/'+row.id+'.json',row);
 await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'INQUIRY_REPLIED',entityId:row.id,before,after:row,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true,inquiry:row});
}
