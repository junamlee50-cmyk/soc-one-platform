// Count people by their stable account identity, never by display name.
export function registrationSummary(rows) {
  const identities=new Map(rows.filter(r=>r.userId&&r.socId).map(r=>[r.socId,r.userId]));
  const identity=r=>r.userId||(r.socId&&(identities.get(r.socId)||r.socId));
  const refunded=r=>r.status==='REFUNDED'||r.paymentStatus==='REFUNDED';
  const canceled=r=>!refunded(r)&&(r.status==='CANCELED'||r.paymentStatus==='CANCELED');
  const active=rows.filter(r=>r.status==='REGISTERED'&&!refunded(r)&&!canceled(r));
  const paid=active.filter(r=>r.paymentStatus==='PAID');
  const people=entries=>new Set(entries.map(identity).filter(Boolean)).size;
  return {
    totalEntries:rows.length,activeEntries:active.length,
    activeParticipants:people(active),confirmedParticipants:people(paid),
    confirmedEntries:paid.length,
    pendingEntries:active.filter(r=>['UNPAID','PENDING'].includes(r.paymentStatus)).length,
    refundRequestedEntries:active.filter(r=>r.paymentStatus==='REFUND_REQUESTED').length,
    canceledEntries:rows.filter(canceled).length,refundedEntries:rows.filter(refunded).length,
    unknownIdentityEntries:active.filter(r=>!identity(r)).length
  };
}
