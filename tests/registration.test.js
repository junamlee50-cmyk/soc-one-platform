import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registrationPrice,eligibility} from '../lib/registration.js';
import {validateTournament,validateDivision} from '../lib/configuration.js';
const t={startAt:'2027-03-01',fees:{early:49000,regular:59000,late:69000,additionalDiscipline:29000,absolute:25000}};
test('additional discipline and absolute have distinct server prices; canceled base is excluded',()=>{
 const existing=[{discipline:'GI',status:'REGISTERED',paymentStatus:'PAID'}];
 assert.equal(registrationPrice(t,{discipline:'NO-GI'},existing).amount,29000);
 assert.equal(registrationPrice(t,{discipline:'GI',absolute:true},existing).amount,25000);
 assert.equal(registrationPrice(t,{discipline:'NO-GI',absolute:true},existing).error,'base_discipline_required');
 assert.equal(registrationPrice(t,{discipline:'GI',absolute:true},[{...existing[0],paymentStatus:'REFUNDED'}]).error,'base_discipline_required');
 assert.equal(registrationPrice({...t,fees:{absolute:null}},{discipline:'GI',absolute:true},existing).error,'fee_not_configured');
});
test('discounts are server configured, date bounded, and cannot produce a negative total',()=>{
 const tournament={...t,discounts:[{code:'SOC',active:true,amount:70000,kind:'BASE'}]};
 assert.equal(registrationPrice(tournament,{discipline:'GI'},[],'SOC').amount,0);
 assert.equal(registrationPrice(tournament,{discipline:'GI'},[],'FAKE').error,'invalid_discount');
 tournament.discounts[0].endsAt='2020-01-01';assert.equal(registrationPrice(tournament,{discipline:'GI'},[],'SOC').error,'discount_expired');
 tournament.discounts[0].endsAt='bad-date';assert.equal(registrationPrice(tournament,{discipline:'GI'},[],'SOC').error,'invalid_discount_configuration');
});
test('age, gender, belt, weight, and verified guardian consent are enforced',()=>{
 const profile={userId:'a',birthDate:'2010-03-02',gender:'MALE',belt:'WHITE',defaultWeightKg:60};
 const div={ageMin:16,ageMax:17,gender:'MALE',belt:'WHITE',weightLimitKg:65};
 assert.equal(eligibility(profile,div,t,null),'verified_guardian_consent_required');
 const consent={athleteUserId:'a',status:'VERIFIED'};
 assert.equal(eligibility(profile,div,t,consent),null);
 assert.equal(eligibility({...profile,birthDate:'2010-02-31'},div,t,consent),'birth_date_required');
 assert.equal(eligibility({...profile,gender:'FEMALE'},div,t,consent),'gender_mismatch');
 assert.equal(eligibility({...profile,belt:'BLUE'},div,t,consent),'belt_mismatch');
 assert.equal(eligibility({...profile,defaultWeightKg:66},div,t,consent),'weight_mismatch');
 assert.equal(eligibility({...profile,birthDate:'2000-01-01'},div,t,consent),'age_mismatch');
});
test('admin configuration rejects negative prices and impossible schedules or divisions',()=>{
 const valid={...t,status:'DRAFT',rankingMultiplier:1,discounts:[]};
 assert.equal(validateTournament(valid),null);
 assert.equal(validateTournament({...valid,fees:{regular:-1}}),'invalid_fee');
 assert.equal(validateTournament({...valid,registrationOpenAt:'2027-03-02'}),'invalid_registration_schedule');
 assert.equal(validateTournament({...valid,status:'REGISTRATION_OPEN'}),'registration_window_required');
 assert.equal(validateDivision({discipline:'GI',gender:'MALE',belt:'WHITE',ageMin:18,ageMax:17}),'invalid_age_range');
});

test('only advance and regular fees apply, including events with retired late settings',async()=>{
 const {feeSchedule}=await import('../lib/registration.js');
 const event={...t,registrationOpenAt:'2027-01-01T00:00:00+09:00',earlyUntil:'2027-01-10T00:00:00+09:00',regularUntil:'2027-01-20T00:00:00+09:00',registrationCloseAt:'2027-02-01T00:00:00+09:00'};
 const at=value=>registrationPrice(event,{discipline:'GI'},[],'',Date.parse(value));
 assert.equal(at('2027-01-09T23:59:59.999+09:00').amount,49000);
 assert.equal(at(event.earlyUntil).amount,59000);
 assert.equal(at('2027-01-19T23:59:59.999+09:00').amount,59000);
 assert.equal(at(event.regularUntil).amount,59000);
 assert.equal(at('2027-01-31T23:59:59.999+09:00').phase,'REGULAR');
 assert.equal(at('2027-01-31T23:59:59.999+09:00').amount,59000);
 assert.deepEqual(feeSchedule(event).map(row=>[row.phase,row.label]),[['EARLY','사전등록'],['REGULAR','일반등록']]);
 assert.equal(feeSchedule(event)[1].endsAt,event.registrationCloseAt);
 const two={...event,regularUntil:'',fees:{...event.fees,late:null}};
 assert.equal(registrationPrice(two,{discipline:'GI'},[],'',Date.parse('2027-01-25')).amount,59000);
 assert.equal(feeSchedule(two).length,2);assert.equal(feeSchedule(two)[1].endsAt,event.registrationCloseAt);
 assert.equal(feeSchedule({...two,earlyUntil:''}).length,1);
});

test('blank fees never become free entries and enabled periods require an explicit amount',async()=>{
 const {parseFee}=await import('../lib/configuration.js');
 for(const value of [undefined,null,'','  '])assert.equal(parseFee(value),null);
 assert.equal(parseFee('0'),0);assert.equal(parseFee(0),0);assert.equal(parseFee('49000'),49000);
 for(const value of [true,{},[],'-1','1.5'])assert(Number.isNaN(parseFee(value)));
 const valid={...t,status:'DRAFT',rankingMultiplier:1,discounts:[]};
 assert.equal(validateTournament({...valid,fees:{regular:null}}),'fee_required');
 assert.equal(validateTournament({...valid,earlyUntil:'2027-01-10',fees:{regular:59000,early:null}}),'fee_required');
 assert.equal(validateTournament({...valid,regularUntil:'retired-invalid-value',fees:{regular:59000,late:null}}),null);
 assert.equal(validateTournament({...valid,registrationOpenAt:'2027-01-10',earlyUntil:'2027-01-10'}),'invalid_registration_schedule');
 assert.equal(validateTournament({...valid,fees:{regular:0,early:null,late:null}}),null);
});
