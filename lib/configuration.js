export function validateTournament(t) {
  if(!['DRAFT','COMING_SOON','REGISTRATION_OPEN','PUBLISHED','CLOSED','COMPLETED','CANCELED'].includes(t.status))return 'invalid_tournament_status';
  if(!Number.isFinite(Date.parse(t.startAt)))return 'invalid_event_date';
  if(!Number.isFinite(t.rankingMultiplier)||t.rankingMultiplier<=0||t.rankingMultiplier>10)return 'invalid_multiplier';
  for(const value of Object.values(t.fees))if(value!==null&&(!Number.isSafeInteger(value)||value<0))return 'invalid_fee';
  const dates=['registrationOpenAt','earlyUntil','regularUntil','registrationCloseAt'];
  let previous=-Infinity;
  for(const key of dates){if(!t[key])continue;const time=Date.parse(t[key]);if(!Number.isFinite(time)||time<previous||time>Date.parse(t.startAt))return 'invalid_registration_schedule';previous=time;}
  if(t.status==='REGISTRATION_OPEN'&&(!t.registrationOpenAt||!t.registrationCloseAt))return 'registration_window_required';
  if(!Array.isArray(t.discounts)||t.discounts.length>50)return 'invalid_discounts';
  const codes=new Set();
  for(const d of t.discounts){
    if(!/^[A-Z0-9_-]{2,30}$/.test(d.code||'')||codes.has(d.code)||!Number.isSafeInteger(d.amount)||d.amount<0||!['BASE','ADDITIONAL_DISCIPLINE','ABSOLUTE',''].includes(d.kind||''))return 'invalid_discount';
    codes.add(d.code);
    if([d.startsAt,d.endsAt].some(v=>v&&!Number.isFinite(Date.parse(v)))||d.startsAt&&d.endsAt&&Date.parse(d.endsAt)<=Date.parse(d.startsAt))return 'invalid_discount_dates';
  }
  return null;
}
export function validateDivision(d) {
  if(!['GI','NO-GI'].includes(d.discipline)||!['MALE','FEMALE'].includes(d.gender))return 'invalid_division';
  if(!['WHITE','BLUE','PURPLE','BROWN','BLACK','GREY','YELLOW','ORANGE','GREEN'].includes(d.belt))return 'invalid_belt';
  if(!Number.isInteger(d.ageMin)||!Number.isInteger(d.ageMax)||d.ageMin<0||d.ageMax<d.ageMin||d.ageMax>120)return 'invalid_age_range';
  if(d.capacity!==null&&(!Number.isSafeInteger(d.capacity)||d.capacity<1))return 'invalid_capacity';
  if(!d.absolute&&(!Number.isFinite(d.weightLimitKg)||d.weightLimitKg<=0))return 'invalid_weight_limit';
  if(d.ageReferenceDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.ageReferenceDate)||!Number.isFinite(Date.parse(d.ageReferenceDate))||new Date(d.ageReferenceDate).toISOString().slice(0,10)!==d.ageReferenceDate))return 'invalid_age_reference';
  return null;
}
