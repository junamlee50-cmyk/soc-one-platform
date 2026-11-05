import { getJson, putJson, clean, makeId, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

const medalPoints={BRONZE:30,SILVER:60,GOLD:100,ABS_BRONZE:50,ABS_SILVER:100,ABS_GOLD:180};
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const user=await requireUser(req,res,['REFEREE','STAFF','ADMIN','CEO']); if(!user)return;
  const b=req.body||{}; const matchId=clean(b.matchId,80),winnerUserId=clean(b.winnerUserId,80);
  const match=await getJson('matches/'+matchId+'.json'); if(!match)return res.status(404).json({ok:false,error:'match_not_found'});
  if(![match.athleteA?.userId,match.athleteB?.userId].includes(winnerUserId))return res.status(400).json({ok:false,error:'winner_not_in_match'});
  match.winnerUserId=winnerUserId; match.winMethod=clean(b.winMethod,40);match.scoreA=clean(b.scoreA,30);match.scoreB=clean(b.scoreB,30);match.durationSeconds=Number(b.durationSeconds)||null;match.status='COMPLETED';match.endedAt=now();match.resultBy=user.id;
  await putJson('matches/'+match.id+'.json',match);
  const evt={id:makeId('rnk'),athleteUserId:winnerUserId,tournamentId:match.tournamentId,divisionKey:match.divisionKey,matchId:match.id,type:'WIN',basePoints:10,multiplier:Number(b.multiplier)||1,finalPoints:10*(Number(b.multiplier)||1),createdAt:now(),createdBy:user.id};
  await putJson('ranking-events/'+evt.id+'.json',evt,{overwrite:false});
  if(b.medal && medalPoints[String(b.medal).toUpperCase()]){
    const base=medalPoints[String(b.medal).toUpperCase()];
    const me={id:makeId('rnk'),athleteUserId:winnerUserId,tournamentId:match.tournamentId,divisionKey:match.divisionKey,matchId:match.id,type:String(b.medal).toUpperCase(),basePoints:base,multiplier:Number(b.multiplier)||1,finalPoints:base*(Number(b.multiplier)||1),createdAt:now(),createdBy:user.id};
    await putJson('ranking-events/'+me.id+'.json',me,{overwrite:false});
  }
  const audit={id:makeId('aud'),actorUserId:user.id,action:'MATCH_RESULT',entityType:'MATCH',entityId:match.id,after:match,createdAt:now()};
  await putJson('audit/'+audit.id+'.json',audit,{overwrite:false});
  return res.status(200).json({ok:true,match});
}