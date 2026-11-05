import { listJson, putJson, getJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
 const u=await requireUser(req,res,['STAFF','ADMIN','CEO']);if(!u)return;
 if(req.method==='GET'){const rows=await listJson('content/',3000);return res.status(200).json({ok:true,content:rows});}
 if(req.method==='POST'){
  const b=req.body||{},title=clean(b.title,220);if(!title)return res.status(400).json({ok:false,error:'title_required'});
  const id=clean(b.id,80)||makeId('cnt');const prev=await getJson('content/'+id+'.json');const status=clean(b.status,20)||'DRAFT';
  const row={id,type:clean(b.type,30)||'NEWS',title,summary:clean(b.summary,800),body:clean(b.body,20000),coverUrl:clean(b.coverUrl,500),status,athleteSocId:clean(b.athleteSocId,30),academyId:clean(b.academyId,80),publishedAt:status==='PUBLISHED'?(prev?.publishedAt||now()):prev?.publishedAt||null,createdAt:prev?.createdAt||now(),updatedAt:now(),updatedBy:u.id};
  await putJson('content/'+id+'.json',row);return res.status(prev?200:201).json({ok:true,content:row});
 }
 res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
}