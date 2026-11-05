function possibleAthletes(match,byId,visited=new Set()){
  if(!match||visited.has(match.id))return new Set();visited.add(match.id);
  const ids=new Set([match.athleteA?.userId,match.athleteB?.userId].filter(Boolean));
  for(const key of ['sourceMatchA','sourceMatchB'])for(const id of possibleAthletes(byId.get(match[key]),byId,visited))ids.add(id);
  return ids;
}
export function scheduleError(candidate,matches){
  const start=Date.parse(candidate.scheduledAt),end=Date.parse(candidate.scheduledEndAt);
  if(!Number.isInteger(candidate.matNo)||candidate.matNo<1||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 'invalid_schedule';
  const byId=new Map(matches.map(m=>[m.id,m])),athletes=possibleAthletes(candidate,byId);
  for(const key of ['sourceMatchA','sourceMatchB']){
    const source=byId.get(candidate[key]);
    if(source&&source.status!=='BYE'&&(!source.scheduledEndAt||Date.parse(source.scheduledEndAt)>start))return 'previous_round_schedule_required';
  }
  for(const other of matches){
    if(other.id===candidate.id||other.status==='BYE'||other.status==='VOIDED')continue;
    const os=Date.parse(other.scheduledAt),oe=Date.parse(other.scheduledEndAt);
    if(!(start<oe&&os<end))continue;
    if(other.tournamentId===candidate.tournamentId&&other.matNo===candidate.matNo)return 'mat_schedule_conflict';
    if([...possibleAthletes(other,byId)].some(id=>athletes.has(id)))return 'athlete_schedule_conflict';
  }
  // Moving a feeder later must not invalidate already scheduled later rounds.
  if(candidate.nextMatchId){const next=byId.get(candidate.nextMatchId);if(next?.scheduledAt&&Date.parse(next.scheduledAt)<end)return 'next_round_schedule_conflict';}
  return null;
}
