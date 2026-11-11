import {getJson,putJson,clean,makeId,now} from './blobdb.js';
import {youtubeUrl} from './match-video.js';
export async function saveContent(req,res,user){
 const b=req.body||{},previous=b.id?await getJson('content/'+clean(b.id,80)+'.json'):null;
 if(b.id&&!previous)return res.status(404).json({ok:false,message:'게시물을 찾을 수 없습니다.'});
 if(previous&&b.revision!==(previous.revision||0))return res.status(409).json({ok:false,message:'게시물이 변경되었습니다. 다시 불러와 주세요.'});
 const status=clean(b.status,20)||'DRAFT',type=clean(b.type,30)||'NEWS',title=clean(b.title,220),coverUrl=clean(b.coverUrl,500),videoUrl=youtubeUrl(b.videoUrl),reason=clean(b.reason,500);
 let coverValid=!coverUrl;try{const u=new URL(coverUrl);coverValid=u.protocol==='https:'&&!u.username&&!u.password;}catch{}
 if(!title||!['DRAFT','PUBLISHED'].includes(status)||!['NEWS','VIDEO','INTERVIEW','ACADEMY'].includes(type)||!coverValid||b.videoUrl&&!videoUrl||previous&&!reason)return res.status(400).json({ok:false,message:'제목·유형·공개 상태·이미지 또는 유튜브 주소·수정 사유를 확인해 주세요.'});
 const row={...previous,id:previous?.id||makeId('cnt'),type,title,summary:clean(b.summary,800),body:clean(b.body,20000),coverUrl,videoUrl:videoUrl||'',status,revision:(previous?.revision||0)+1,publishedAt:status==='PUBLISHED'?(previous?.publishedAt||now()):previous?.publishedAt||null,createdAt:previous?.createdAt||now(),updatedAt:now(),updatedBy:user.id};
 await putJson('content/'+row.id+'.json',row,{overwrite:!!previous});await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'CONTENT_SAVED',entityId:row.id,before:previous,after:row,reason,createdAt:now()},{overwrite:false});return res.status(previous?200:201).json({ok:true,content:row});
}
