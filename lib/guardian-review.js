import {getJson,listJson,putJson,clean,makeId,now} from './blobdb.js';
import {usesPostgres} from './database.js';
export async function guardianReviews(req,res,user){
 if(req.method==='GET'){
  const users=(await listJson('users/')).filter(u=>u.status==='ACTIVE'&&u.roles?.includes('ATHLETE'));
  const consents=await listJson('guardian-consents/');
  return res.status(200).json({ok:true,athletes:users.map(u=>({id:u.id,name:u.name,socId:u.socId})),consents});
 }
 if(!usesPostgres())return res.status(503).json({ok:false,error:'transactional_database_required'});
 const b=req.body||{},id=clean(b.athleteUserId,80),athlete=await getJson('users/'+id+'.json');
 if(!athlete||!athlete.roles?.includes('ATHLETE'))return res.status(404).json({ok:false,error:'athlete_not_found'});
 if(id===user.id)return res.status(403).json({ok:false,error:'independent_verifier_required'});
 const prev=await getJson('guardian-consents/'+id+'.json'),reason=clean(b.reason,500);
 if(b.revision!==(prev?.revision||0))return res.status(409).json({ok:false,error:'consent_revision_conflict'});
 if(!reason||!['VERIFY','REVOKE'].includes(b.action))return res.status(400).json({ok:false,error:'consent_evidence_required'});
 let row;
 if(b.action==='VERIFY'){
  const relationshipReference=clean(b.relationshipReference,160),consentReference=clean(b.consentReference,160),policyVersion=clean(b.policyVersion,80);
  if(!relationshipReference||!consentReference||!policyVersion||b.verifiedInPerson!==true)return res.status(400).json({ok:false,error:'consent_evidence_required'});
  row={athleteUserId:id,status:'VERIFIED',relationshipReference,consentReference,policyVersion,verifiedBy:user.id,verifiedAt:now()};
 }else{
  if(!prev)return res.status(404).json({ok:false,error:'consent_not_found'});
  row={...prev,status:'REVOKED',revokedBy:user.id,revokedAt:now()};
 }
 row.revision=(prev?.revision||0)+1;row.updatedAt=now();
 await putJson('guardian-consents/'+id+'.json',row);
 await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'GUARDIAN_'+b.action,entityId:id,before:prev,after:row,reason,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true,consent:row});
}
