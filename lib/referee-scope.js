// Legacy assignments without an explicit time window must be renewed by staff.
export function assignmentActive(assignment, at = Date.now()) {
  const start = Date.parse(assignment.startsAt), end = Date.parse(assignment.endsAt);
  return assignment.status === 'ASSIGNED' && Number.isInteger(assignment.matNo) &&
    assignment.matNo > 0 && Number.isFinite(start) && Number.isFinite(end) &&
    start <= at && at < end;
}

export function assignmentCoversMatch(assignment, match, at = Date.now()) {
  if (!assignmentActive(assignment, at) || assignment.tournamentId !== match.tournamentId ||
      assignment.matNo !== match.matNo) return false;
  if (match.scheduledAt || match.scheduledEndAt) {
    const start = Date.parse(match.scheduledAt), end = Date.parse(match.scheduledEndAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
        start < Date.parse(assignment.startsAt) || end > Date.parse(assignment.endsAt)) return false;
  }
  return true;
}

export function assignmentConflict(candidate, assignments) {
  const start = Date.parse(candidate.startsAt), end = Date.parse(candidate.endsAt);
  return assignments.some(a => a.status === 'ASSIGNED' && a.id !== candidate.id &&
    start < Date.parse(a.endsAt) && Date.parse(a.startsAt) < end &&
    (a.refereeUserId === candidate.refereeUserId ||
      (a.tournamentId === candidate.tournamentId && a.matNo === candidate.matNo)));
}
