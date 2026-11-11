import {getJson,putJson,clean,makeId,now} from './blobdb.js';
export function youtubeUrl(value){
 if(typeof value!=='string'||!value.trim())return null;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
 let id;if(u.hostname==='youtu.be')id=u.pathname.slice(1);else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)){if(u.pathname==='/watch')id=u.searchParams.get('v');else id=u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];}
 if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))return null;
 const out=new URL('https://www.youtube.com/watch');out.searchParams.set('v',id);const time=u.searchParams.get('t')||u.searchParams.get('start');if(time&&/^\d{1,6}$/.test(time))out.searchParams.set('t',time);return out.href;
 }catch{return null;}
}
export async function saveMatchVideo(req,res,user){
 const b=req.body||{},id=clean(b.matchId,80),match=await getJson('matches/'+id+'.json');
 if(!match)return res.status(404).json({ok:false,error:'match_not_found'});
 if(b.revision!==(match.videoRevision||0))return res.status(409).json({ok:false,error:'video_changed',message:'영상 정보가 변경됐습니다. 새로고침 후 확인하세요.'});
 const value=typeof b.videoUrl==='string'?b.videoUrl.trim():null,url=youtubeUrl(value),reason=clean(b.reason,500);
 if(value===null||value&&!url||!reason)return res.status(400).json({ok:false,error:'invalid_video',message:'유튜브 영상 주소와 변경 사유를 확인해 주세요.'});
 const before=structuredClone(match);match.videoUrl=url||'';match.videoRevision=(match.videoRevision||0)+1;match.videoUpdatedBy=user.id;match.videoUpdatedAt=now();
 await putJson('matches/'+id+'.json',match);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'MATCH_VIDEO_UPDATED',entityId:id,before,after:match,reason,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true,match});
}
