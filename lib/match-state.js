export function matchTransitionError(match, action, matches) {
  const expected = {CALL: 'SCHEDULED', START: 'CALLED'}[action];
  if (!expected || match.status !== expected) return 'invalid_match_transition';
  if (!Number.isInteger(match.matNo) || match.matNo < 1) return 'mat_required';
  if (!match.athleteA?.userId || !match.athleteB?.userId || match.athleteA.userId === match.athleteB.userId)
    return 'match_participants_pending';
  const players = new Set([match.athleteA.userId, match.athleteB.userId]);
  for (const other of matches) {
    if (other.id === match.id || !['CALLED', 'IN_PROGRESS'].includes(other.status)) continue;
    if (other.tournamentId === match.tournamentId && other.matNo === match.matNo) return 'mat_busy';
    if ([other.athleteA?.userId, other.athleteB?.userId].some(id => players.has(id))) return 'athlete_busy';
  }
  for (const sourceId of [match.sourceMatchA, match.sourceMatchB].filter(Boolean)) {
    if (!matches.some(m => m.id === sourceId && ['COMPLETED', 'BYE'].includes(m.status)))
      return 'previous_round_incomplete';
  }
  return null;
}
