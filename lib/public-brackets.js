import {getJson, listJson} from './blobdb.js';

// Public payloads are allowlisted. Internal user IDs, registration/payment
// fields, birth dates, exact weights, and referee identities never leave here.
export async function publicBrackets(tournamentId) {
  const brackets=(await listJson('brackets/',1000,{tournamentId})).filter(b=>b.status==='PUBLISHED'&&b.publicVisible===true);
  const ids=new Set(brackets.map(b=>b.id));
  const matches=(await listJson('matches/',1000,{tournamentId})).filter(m=>ids.has(m.bracketId));
  const profiles=new Map();
  for(const userId of new Set(matches.flatMap(m=>[m.athleteA?.userId,m.athleteB?.userId]).filter(Boolean)))
    profiles.set(userId,await getJson('athletes/'+userId+'.json'));
  const athlete=a=>a?{name:profiles.get(a.userId)?.publicProfile===true?(profiles.get(a.userId).displayName||a.name):'비공개 선수'}:null;
  return brackets.map(b=>({id:b.id,divisionKey:b.divisionKey,version:b.version||1,athleteCount:b.athleteCount,roundCount:b.roundCount,
    matches:matches.filter(m=>m.bracketId===b.id).sort((a,b)=>(a.roundNo-b.roundNo)||(a.sequenceNo-b.sequenceNo)).map(m=>({
      id:m.id,roundNo:m.roundNo,sequenceNo:m.sequenceNo,nextMatchId:m.nextMatchId||null,status:m.status,
      athleteA:athlete(m.athleteA),athleteB:athlete(m.athleteB),
      winnerSide:m.winnerUserId?(m.winnerUserId===m.athleteA?.userId?'A':m.winnerUserId===m.athleteB?.userId?'B':null):null,
      matNo:m.matNo||null,scheduledAt:m.scheduledAt||null,calledAt:m.calledAt||null,startedAt:m.startedAt||null,
      endedAt:m.endedAt||null,winMethod:m.winMethod||null,scoreA:m.scoreA||null,scoreB:m.scoreB||null
    }))}));
}
