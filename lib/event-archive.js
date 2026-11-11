import {getJson,listJson,putJson,clean,makeId,now} from './blobdb.js';
export async function archiveEvent(req,res,user){
 const b=req.body||{},id=clean(b.tournamentId,80),reason=clean(b.reason,500),t=await getJson('tournaments/'+id+'.json');
 if(!t)return res.status(404).json({ok:false,error:'tournament_not_found'});
 if(!reason||!['ARCHIVE','RESTORE'].includes(b.action))return res.status(400).json({ok:false,error:'change_reason_required'});
 if(b.updatedAt!==t.updatedAt)return res.status(409).json({ok:false,error:'event_changed'});
 const before=structuredClone(t);
 if(b.action==='ARCHIVE'){
  if(t.deletedAt||!['DRAFT','COMING_SOON','CANCELED'].includes(t.status))return res.status(409).json({ok:false,error:'close_event_before_archive'});
  for(const collection of ['registrations','brackets','matches','ranking-events','payment-ledger'])if((await listJson(collection+'/',1000,{tournamentId:id})).length)return res.status(409).json({ok:false,error:'event_has_records',message:'신청·입금·경기 기록이 있어 삭제할 수 없습니다. 대회 취소 또는 마감을 사용하세요.'});
  t.deletedAt=now();t.deletedBy=user.id;
 }else{
  if(!t.deletedAt)return res.status(409).json({ok:false,error:'event_not_archived'});
  delete t.deletedAt;delete t.deletedBy;t.status='DRAFT';
 }
 t.updatedAt=now();await putJson('tournaments/'+id+'.json',t);
 await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'EVENT_'+b.action,entityType:'TOURNAMENT',entityId:id,before,after:t,reason,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true,tournament:t});
}
