export function registrationPrice(tournament,division,existing,code='',now=Date.now()){
 const fees=tournament.fees||{},early=Date.parse(tournament.earlyUntil),regular=Date.parse(tournament.regularUntil);
 let phase=Number.isFinite(early)&&now<=early?'EARLY':Number.isFinite(regular)&&now>regular?'LATE':'REGULAR';
 const base=existing.filter(r=>!r.absolute&&!['CANCELED','REFUNDED'].includes(r.status)&&!['CANCELED','REFUNDED','REFUND_REQUESTED'].includes(r.paymentStatus));
 let kind='BASE',amount=fees[phase.toLowerCase()],dependency=null;
 if(division.absolute){dependency=base.find(r=>r.discipline===division.discipline);if(!dependency)return {error:'base_discipline_required'};kind='ABSOLUTE';amount=fees.absolute;}
 else if(base.some(r=>r.discipline!==division.discipline)){dependency=base.find(r=>r.discipline!==division.discipline);kind='ADDITIONAL_DISCIPLINE';amount=fees.additionalDiscipline;}
 if(amount===null||amount===''||!Number.isSafeInteger(Number(amount))||amount===undefined||Number(amount)<0)return {error:'fee_not_configured'};
 amount=Number(amount);let discount=0;
 if(code){
  const rule=(tournament.discounts||[]).find(d=>d.code===code&&d.active===true);
  if(!rule)return {error:'invalid_discount'};
  if([rule.startsAt,rule.endsAt].some(v=>v&&!Number.isFinite(Date.parse(v))))return {error:'invalid_discount_configuration'};
  if(rule.startsAt&&now<Date.parse(rule.startsAt)||rule.endsAt&&now>=Date.parse(rule.endsAt))return {error:'discount_expired'};
  if(rule.kind&&rule.kind!==kind)return {error:'discount_not_applicable'};
  discount=Number(rule.amount);
  if(!Number.isSafeInteger(discount)||discount<0)return {error:'invalid_discount_configuration'};
 }
 return {amount:Math.max(0,amount-discount),phase,kind,baseRegistrationId:dependency?.id||null,baseAmount:amount,discountAmount:Math.min(amount,discount),discountCode:code||null};
}
export function eligibility(profile,division,tournament,guardian,now=Date.now()){
 if(!profile)return 'athlete_profile_required';
 if(profile.belt!==division.belt)return 'belt_mismatch';
 if(!division.gender||!['MALE','FEMALE'].includes(division.gender))return 'division_gender_required';
 if(profile.gender!==division.gender)return 'gender_mismatch';
 const dob=profile.birthDate,date=division.ageReferenceDate||String(tournament.startAt||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dob||'')||!Number.isFinite(Date.parse(dob))||new Date(dob).toISOString().slice(0,10)!==dob)return 'birth_date_required';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return 'age_reference_required';
 const birth=new Date(dob+'T00:00:00Z'),ref=new Date(date+'T00:00:00Z');
 let age=ref.getUTCFullYear()-birth.getUTCFullYear();
 if(ref.getUTCMonth()<birth.getUTCMonth()||ref.getUTCMonth()===birth.getUTCMonth()&&ref.getUTCDate()<birth.getUTCDate())age--;
 if(!Number.isInteger(division.ageMin)||!Number.isInteger(division.ageMax)||division.ageMin<0||division.ageMax<division.ageMin)return 'division_age_rule_required';
 if(age<division.ageMin||age>division.ageMax)return 'age_mismatch';
 if(age<18&&(!guardian||guardian.status!=='VERIFIED'||guardian.athleteUserId!==profile.userId))return 'verified_guardian_consent_required';
 if(!division.absolute&&(!Number.isFinite(Number(profile.defaultWeightKg))||Number(profile.defaultWeightKg)<=0||Number(profile.defaultWeightKg)>Number(division.weightLimitKg)))return 'weight_mismatch';
 return null;
}
