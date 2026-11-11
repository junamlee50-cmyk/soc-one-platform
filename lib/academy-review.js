import {getJson,putJson,listJson,clean,makeId,now} from './blobdb.js';
import {ownsAcademy} from './member-profile.js';

const fail=(res,status,message)=>res.status(status).json({ok:false,message});
export async function applyAcademy(req,res,user){
 const b=req.body||{},id=clean(b.id,80),previous=id?await getJson('academies/'+id+'.json'):null;
 if(id&&(!previous||!ownsAcademy(previous,user)))return fail(res,404,'본인이 신청한 도장을 선택해 주세요.');
 if(previous&&b.revision!==(previous.revision||0))return fail(res,409,'도장 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
 if(previous&&!['PENDING','REJECTED'].includes(previous.status))return fail(res,409,'승인·중지된 도장의 변경은 운영진에게 문의해 주세요.');
 const name=clean(b.name,160),region=clean(b.region,80),address=clean(b.address,300);
 if(!name||!region)return fail(res,400,'도장명과 지역을 입력해 주세요.');
 const normalized=s=>s.replace(/\s/g,'').toLowerCase();
 if((await listJson('academies/')).some(a=>a.id!==id&&a.active!==false&&normalized(a.name)===normalized(name)&&normalized(a.region)===normalized(region)))return fail(res,409,'같은 지역에 동일한 도장이 등록되어 있습니다. 기존 신청내역을 확인하거나 운영진에게 문의해 주세요.');
 const row={...previous,id:id||makeId('aca'),name,region,address,slug:previous?.slug||makeId('dojang'),coachUserId:previous?.coachUserId||user.id,coachName:previous?.coachName||user.name,status:'PENDING',active:true,revision:(previous?.revision||0)+1,reviewReason:'',createdAt:previous?.createdAt||now(),updatedAt:now(),submittedAt:now(),joinedAt:previous?.joinedAt||null};
 await putJson('academies/'+row.id+'.json',row,{overwrite:!!previous});
 await putJson('audit/'+makeId('aud')+'.json',{action:previous?'ACADEMY_RESUBMITTED':'ACADEMY_APPLIED',actorUserId:user.id,entityId:row.id,before:previous,after:row,createdAt:now()},{overwrite:false});
 return res.status(previous?200:201).json({ok:true,academy:row});
}
export async function reviewAcademy(req,res,user){
 const b=req.body||{},id=clean(b.academyId,80),a=await getJson('academies/'+id+'.json'),status=clean(b.status,20).toUpperCase(),reason=clean(b.reason,500);
 if(!a)return fail(res,404,'도장 신청내역을 찾을 수 없습니다.');
 if(b.revision!==undefined&&b.revision!==(a.revision||0))return fail(res,409,'다른 운영자가 먼저 처리했습니다. 목록을 새로고침해 주세요.');
 if(!['APPROVED','REJECTED','SUSPENDED'].includes(status)||status===a.status)return fail(res,409,'현재 상태에서는 이 처리를 할 수 없습니다.');
 if(status!=='APPROVED'&&!reason)return fail(res,400,'신청자가 확인할 반려·중지 사유를 입력해 주세요.');
 const before=structuredClone(a);a.status=status;a.reviewReason=reason;a.reviewedBy=user.id;a.reviewedAt=now();a.updatedAt=now();a.revision=(a.revision||0)+1;if(status==='APPROVED')a.joinedAt||=now();
 await putJson('academies/'+id+'.json',a);
 await putJson('audit/'+makeId('aud')+'.json',{action:'ACADEMY_STATUS',actorUserId:user.id,entityType:'ACADEMY',entityId:id,before,after:a,reason,createdAt:now()},{overwrite:false});
 const notice={id:makeId('notice'),userId:a.coachUserId,title:'도장 등록 '+({APPROVED:'승인',REJECTED:'반려',SUSPENDED:'중지'}[status]),body:a.name+(reason?' · '+reason:''),href:'/academy-app.html',createdAt:now(),readAt:null};
 await putJson('notifications/'+notice.id+'.json',notice,{overwrite:false});
 return res.status(200).json({ok:true,academy:a});
}
