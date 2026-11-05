// One calculation for the public ranking and member dashboards.
// Existing launch screens use the 2027 season; callers may request another year.
export const DEFAULT_SEASON = '2027';
const medals = new Set(['BRONZE','SILVER','GOLD','ABS_BRONZE','ABS_SILVER','ABS_GOLD']);
export function seasonRanking(events, tournaments, season = DEFAULT_SEASON) {
  const year = String(season);
  if (!/^\d{4}$/.test(year)) return [];
  const tournamentMap = new Map(tournaments.filter(t => !t.deletedAt && t.status !== 'CANCELED').map(t => [t.id, t]));
  const athletes = new Map(), seen = new Set();
  for (const event of events) {
    const tournament = tournamentMap.get(event.tournamentId);
    if (!tournament || !event.athleteUserId || event.voidedAt) continue;
    const timestamp = Date.parse(tournament.startAt);
    if (!Number.isFinite(timestamp)) continue;
    const eventYear = new Intl.DateTimeFormat('en', {year:'numeric',timeZone:'Asia/Seoul'}).format(new Date(timestamp));
    if (eventYear !== year) continue;
    const points = Number(event.finalPoints);
    if (!Number.isFinite(points) || points < 0) continue;
    const identity = [event.athleteUserId,event.tournamentId,event.type,event.type==='PARTICIPATION'?'':event.matchId||event.id].join('|');
    if (seen.has(identity)) continue;
    seen.add(identity);
    const categoryKey=event.divisionKey||'UNCLASSIFIED';
    const groupKey=event.athleteUserId+'|'+categoryKey;
    const athlete = athletes.get(groupKey) || {athleteUserId:event.athleteUserId,categoryKey,wins:0,medals:0,results:new Map()};
    const result = athlete.results.get(event.tournamentId) || {tournamentId:event.tournamentId,points:0};
    result.points += event.type==='PARTICIPATION' ? Math.min(points,Number(event.participationCap)||5) : points;
    athlete.results.set(event.tournamentId,result);
    if (event.type==='WIN') athlete.wins++;
    if (medals.has(event.type)) athlete.medals++;
    athletes.set(groupKey,athlete);
  }
  const rows = [...athletes.values()].map(({results,...athlete}) => {
    const counted = [...results.values()].sort((a,b)=>b.points-a.points||a.tournamentId.localeCompare(b.tournamentId)).slice(0,6);
    return {...athlete,points:Math.round(counted.reduce((s,r)=>s+r.points,0)*100)/100,countedTournaments:counted.length,totalTournaments:results.size};
  }).sort((a,b)=>a.categoryKey.localeCompare(b.categoryKey)||b.points-a.points||a.athleteUserId.localeCompare(b.athleteUserId));
  let rank=0,previous,category=null,index=0;
  return rows.map(row=>{if(category!==row.categoryKey){category=row.categoryKey;index=0;previous=undefined;}index++;if(row.points!==previous)rank=index;previous=row.points;return {...row,rank};});
}
