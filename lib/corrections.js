import {getJson,listJson,putJson,deletePath,makeId,now} from './blobdb.js';

// Called only inside an authorized PostgreSQL write transaction. A correction
// retracts dependent results for explicit re-entry; it never silently awards a
// new winner in a match played by different participants.
export async function retractResult(root,actorUserId,reason){
  const all=await listJson('matches/',1000,{tournamentId:root.tournamentId}),byId=new Map(all.map(m=>[m.id,m]));
  const affected=[];let cursor=root;
  while(cursor){
    if(affected.some(m=>m.id===cursor.id))throw new Error('cyclic_bracket');
    affected.push(cursor);
    if(!cursor.nextMatchId)break;
    cursor=byId.get(cursor.nextMatchId);if(!cursor)throw new Error('missing_dependent_match');
  }
  const ids=new Set(affected.map(m=>m.id)),users=new Set(affected.flatMap(m=>[m.athleteA?.userId,m.athleteB?.userId]).filter(Boolean));
  const events=(await listJson('ranking-events/',1000,{tournamentId:root.tournamentId})).filter(e=>ids.has(e.matchId));
  const medals=(await listJson('medals/',1000,{tournamentId:root.tournamentId})).filter(m=>ids.has(m.matchId)||events.some(e=>e.athleteUserId===m.athleteUserId&&e.divisionKey===m.divisionKey&&e.type.replace('ABS_','')===m.medal));
  const certificates=(await listJson('certificates/',1000,{tournamentId:root.tournamentId})).filter(c=>affected.some(m=>[m.athleteA?.socId,m.athleteB?.socId].includes(c.socId))&&!c.revokedAt);
  const before={matches:structuredClone(affected),events,medals,certificateCodes:certificates.map(c=>c.code)};
  for(const event of events)await deletePath('ranking-events/'+event.id+'.json');
  for(const medal of medals)await deletePath('medals/'+medal.id+'.json');
  for(const match of affected){
    if(ids.has(match.sourceMatchA))match.athleteA=null;
    if(ids.has(match.sourceMatchB))match.athleteB=null;
    for(const key of ['winnerUserId','winMethod','scoreA','scoreB','durationSeconds','endedAt','resultBy','calledAt','startedAt','calledBy','startedBy'])delete match[key];
    match.status='SCHEDULED';match.correctedAt=now();match.correctedBy=actorUserId;
    await putJson('matches/'+match.id+'.json',match);
  }
  // Participation originally attached to a retracted match may still be due
  // for a different completed match. Restore exactly one event per tournament.
  for(const userId of users){
    if(!events.some(e=>e.athleteUserId===userId&&e.type==='PARTICIPATION'))continue;
    const remaining=all.filter(m=>!ids.has(m.id)&&m.status==='COMPLETED'&&[m.athleteA?.userId,m.athleteB?.userId].includes(userId)).sort((a,b)=>String(a.endedAt).localeCompare(String(b.endedAt)))[0];
    if(!remaining)continue;
    const rules=(await getJson('brackets/'+remaining.bracketId+'.json'))?.rankingPolicy;
    if(!rules)throw new Error('missing_rule_snapshot');
    const id=makeId('rnk');await putJson('ranking-events/'+id+'.json',{id,athleteUserId:userId,tournamentId:root.tournamentId,divisionKey:remaining.divisionKey,matchId:remaining.id,type:'PARTICIPATION',rulesId:rules.id,participationCap:rules.participation,basePoints:rules.participation,multiplier:1,finalPoints:rules.participation,createdAt:now(),createdBy:actorUserId},{overwrite:false});
  }
  for(const cert of certificates){cert.revokedAt=now();cert.revokedReason='MATCH_RESULT_CORRECTED';await putJson('certificates/'+cert.code+'.json',cert);}
  const auditId=makeId('aud');await putJson('audit/'+auditId+'.json',{actorUserId,action:'MATCH_RESULT_RETRACTED',entityType:'MATCH',entityId:root.id,before,after:{matchIds:[...ids],status:'SCHEDULED'},reason,createdAt:now()},{overwrite:false});
  return {matchIds:[...ids],revokedCertificates:certificates.length,auditId};
}
