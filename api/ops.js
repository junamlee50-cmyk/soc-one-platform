import { bracketFactor, validateRules } from '../lib/rules.js';
import { scheduleError } from '../lib/scheduling.js';
import { apiHandler } from '../lib/http.js';
import { validTicketSignature } from '../lib/tickets.js';
import { listJson, putJson, getJson, clean, makeId, hash, now } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';


const nextPow2=n=>{let x=1;while(x<n)x*=2;return x};
function seededSlots(rows,size,seed){const ordered=[...rows].sort((a,b)=>hash(seed+a.socId).localeCompare(hash(seed+b.socId))),slots=Array(size).fill(null);ordered.forEach((r,i)=>{slots[Math.floor(i*size/ordered.length)]={userId:r.userId,socId:r.socId,name:r.athleteName,academyId:r.academyId||''}});return slots;}
async function propagateBye(match,map){const a=match.athleteA,b=match.athleteB;if((a&&!b)||(!a&&b)){const winner=a||b;match.winnerUserId=winner.userId;match.status='BYE';match.endedAt=now();await putJson('matches/'+match.id+'.json',match);if(match.nextMatchId){const next=map.get(match.nextMatchId)||await getJson('matches/'+match.nextMatchId+'.json');if(next){if(match.nextSlot==='A')next.athleteA=winner;else next.athleteB=winner;await putJson('matches/'+next.id+'.json',next);map.set(next.id,next);}}}}

async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();
  const user=await requireUser(req,res,['REFEREE','STAFF','ADMIN','CEO']);if(!user)return;
  const isStaff=['STAFF','ADMIN','CEO'].some(r=>(user.roles||[]).includes(r));
  const assignments=isStaff?[]:(await listJson('referee-assignments/',3000)).filter(x=>x.refereeUserId===user.id&&x.status==='ASSIGNED');
  const assigned=new Set(assignments.map(x=>x.tournamentId));
  const allowedMatch=m=>isStaff||assignments.some(a=>a.tournamentId===m.tournamentId&&Number(a.matNo)>0&&Number(a.matNo)===Number(m.matNo));
  const allowedTournament=id=>isStaff||assigned.has(id);
  const deny=()=>res.status(403).json({ok:false,error:'tournament_not_assigned'});
  if(op==='tournaments'){
    const rows=(await listJson('tournaments/',1000)).filter(x=>!x.deletedAt&&allowedTournament(x.id));
    return res.status(200).json({ok:true,tournaments:rows});
  }


  if(op==='registrations'){
    if(!isStaff)return res.status(200).json({ok:true,registrations:[]});
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const tournamentId=String(req.query.tournamentId||'');let rows=(await listJson('registrations/',10000)).filter(x=>allowedTournament(x.tournamentId));if(tournamentId)rows=rows.filter(x=>x.tournamentId===tournamentId);return res.status(200).json({ok:true,registrations:rows});
  }

  if(op==='matches'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const tournamentId=String(req.query.tournamentId||'');let rows=(await listJson('matches/',10000)).filter(x=>allowedMatch(x));if(tournamentId)rows=rows.filter(x=>x.tournamentId===tournamentId);rows.sort((a,b)=>(a.roundNo-b.roundNo)||(a.sequenceNo-b.sequenceNo));return res.status(200).json({ok:true,matches:rows});
  }

  if(op==='checkin'){
    if(!isStaff)return res.status(403).json({ok:false,error:'staff_required'});
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const payload=clean(req.body?.payload,220),m=/^SOC:([^:]+):([^:]+)$/.exec(payload||'');if(!m)return res.status(400).json({ok:false,error:'invalid_ticket'});const [,id,sig]=m;if(!validTicketSignature(id,sig))return res.status(400).json({ok:false,error:'invalid_signature'});const reg=await getJson('registrations/'+id+'.json');if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});if(!allowedTournament(reg.tournamentId))return deny();if(reg.status!=='REGISTERED')return res.status(409).json({ok:false,error:'registration_inactive'});if(reg.paymentStatus!=='PAID')return res.status(409).json({ok:false,error:'payment_not_completed'});if(reg.checkInStatus==='CHECKED_IN')return res.status(200).json({ok:true,registration:reg});const before={...reg};reg.checkInStatus='CHECKED_IN';reg.checkedInAt=now();reg.checkedInBy=user.id;reg.updatedAt=now();await putJson('registrations/'+id+'.json',reg);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'CHECK_IN',entityType:'REGISTRATION',entityId:id,before,after:reg,createdAt:now()},{overwrite:false});return res.status(200).json({ok:true,registration:reg});
  }

  if(op==='weighin'){
    if(!isStaff)return res.status(403).json({ok:false,error:'staff_required'});
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},registrationId=clean(b.registrationId,80),weight=Number(b.weightKg);if(!registrationId||!Number.isFinite(weight)||weight<=0)return res.status(400).json({ok:false,error:'invalid_input'});const reg=await getJson('registrations/'+registrationId+'.json');if(!reg)return res.status(404).json({ok:false,error:'registration_not_found'});if(!allowedTournament(reg.tournamentId))return deny();if(reg.status!=='REGISTERED')return res.status(409).json({ok:false,error:'registration_inactive'});if(reg.paymentStatus!=='PAID')return res.status(409).json({ok:false,error:'payment_not_completed'});
    const div=reg.divisionId?await getJson('divisions/'+reg.divisionId+'.json'):null;
    if(!div||(!div.absolute&&(!Number.isFinite(Number(div.weightLimitKg))||Number(div.weightLimitKg)<=0)))return res.status(409).json({ok:false,error:'division_weight_limit_required'});
    const limit=div.absolute?0:Number(div.weightLimitKg),passed=div.absolute||weight<=limit;
    const before={...reg};const row={id:makeId('wei'),registrationId,tournamentId:reg.tournamentId,userId:reg.userId,weightKg:weight,limitKg:limit||null,passed,measuredBy:user.id,measuredAt:now()};await putJson('weighins/'+row.id+'.json',row,{overwrite:false});reg.weighInStatus=passed?'PASSED':'FAILED';reg.weighedKg=weight;reg.updatedAt=now();await putJson('registrations/'+registrationId+'.json',reg);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'WEIGH_IN',entityType:'REGISTRATION',entityId:registrationId,before,after:reg,createdAt:now()},{overwrite:false});return res.status(201).json({ok:true,weighIn:row,registration:reg});
  }

  if(op==='bracket'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    if(!['STAFF','ADMIN','CEO'].some(r=>(user.roles||[]).includes(r)))return res.status(403).json({ok:false,error:'forbidden'});
    const b=req.body||{},tournamentId=clean(b.tournamentId,80),divisionKey=clean(b.divisionKey,80);if(!tournamentId||!divisionKey)return res.status(400).json({ok:false,error:'required_fields'});
    const tournament=await getJson('tournaments/'+tournamentId+'.json'),rules=tournament?.rulesId?await getJson('rules/'+tournament.rulesId+'.json'):null;
    if(!rules||rules.status!=='APPROVED'||validateRules(rules))return res.status(409).json({ok:false,error:'ranking_rules_unapproved'});
    const existingBracket=(await listJson('brackets/',3000)).find(x=>x.tournamentId===tournamentId&&x.divisionKey===divisionKey&&x.status==='PUBLISHED');if(existingBracket)return res.status(409).json({ok:false,error:'bracket_already_exists',bracketId:existingBracket.id});const regs=(await listJson('registrations/',5000)).filter(x=>x.tournamentId===tournamentId&&x.divisionKey===divisionKey&&x.status==='REGISTERED'&&x.paymentStatus==='PAID'&&x.weighInStatus==='PASSED');if(regs.length<2)return res.status(400).json({ok:false,error:'not_enough_eligible_athletes',count:regs.length});
    const bracketId=makeId('brk'),size=nextPow2(regs.length),roundCount=Math.log2(size),roundIds=[];for(let r=0;r<roundCount;r++){const count=size/(2**(r+1));roundIds.push(Array.from({length:count},()=>makeId('mat')))}
    const slots=seededSlots(regs,size,tournamentId+divisionKey),matches=[],map=new Map();
    for(let r=0;r<roundCount;r++){for(let i=0;i<roundIds[r].length;i++){const id=roundIds[r][i],nextId=r<roundCount-1?roundIds[r+1][Math.floor(i/2)]:null,m={id,bracketId,tournamentId,divisionKey,roundNo:r+1,sequenceNo:i+1,athleteA:r===0?slots[i*2]:null,athleteB:r===0?slots[i*2+1]:null,sourceMatchA:r===0?null:roundIds[r-1][i*2],sourceMatchB:r===0?null:roundIds[r-1][i*2+1],nextMatchId:nextId,nextSlot:nextId?(i%2===0?'A':'B'):null,winnerUserId:null,status:'SCHEDULED',createdAt:now()};matches.push(m);map.set(id,m);}}
    const bracket={id:bracketId,tournamentId,divisionKey,rankingPolicy:rules,athleteCount:regs.length,bracketSize:size,roundCount,status:'PUBLISHED',createdBy:user.id,createdAt:now(),rounds:roundIds};await putJson('brackets/'+bracketId+'.json',bracket,{overwrite:false});for(const m of matches)await putJson('matches/'+m.id+'.json',m,{overwrite:false});for(const m of matches.filter(x=>x.roundNo===1))await propagateBye(m,map);await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'BRACKET_PUBLISHED',entityType:'BRACKET',entityId:bracketId,after:bracket,createdAt:now()},{overwrite:false});return res.status(201).json({ok:true,bracket,matches:[...map.values()]});
  }

  if(op==='schedule'){
    if(!isStaff)return res.status(403).json({ok:false,error:'staff_required'});
    const b=req.body||{},id=clean(b.matchId,80),match=await getJson('matches/'+id+'.json');
    if(!match)return res.status(404).json({ok:false,error:'match_not_found'});
    if(match.status!=='SCHEDULED')return res.status(409).json({ok:false,error:'match_not_schedulable'});
    const before={...match},candidate={...match,matNo:Number(b.matNo),scheduledAt:clean(b.scheduledAt,40),scheduledEndAt:clean(b.scheduledEndAt,40)};
    const error=scheduleError(candidate,await listJson('matches/'));
    if(error)return res.status(409).json({ok:false,error});
    const reason=clean(b.reason,500);if(!reason)return res.status(400).json({ok:false,error:'change_reason_required'});
    candidate.scheduledBy=user.id;candidate.updatedAt=now();await putJson('matches/'+id+'.json',candidate);
    await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'MATCH_SCHEDULED',entityType:'MATCH',entityId:id,before,after:candidate,reason,createdAt:now()},{overwrite:false});
    return res.status(200).json({ok:true,match:candidate});
  }

  if(op==='result'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},matchId=clean(b.matchId,80),winnerUserId=clean(b.winnerUserId,80),match=await getJson('matches/'+matchId+'.json');
    if(!match)return res.status(404).json({ok:false,error:'match_not_found'});
    if(!allowedMatch(match))return res.status(403).json({ok:false,error:'mat_not_assigned'});
    if(match.status==='COMPLETED')return res.status(409).json({ok:false,error:'already_completed'});
    const participants=[match.athleteA,match.athleteB].filter(Boolean),winner=participants.find(x=>x.userId===winnerUserId),loser=participants.find(x=>x.userId!==winnerUserId);
    if(!winner||!loser)return res.status(400).json({ok:false,error:'winner_not_in_match'});
    if(match.nextMatchId){const next=await getJson('matches/'+match.nextMatchId+'.json');if(!next||next.status==='COMPLETED')return res.status(409).json({ok:false,error:'next_match_unavailable'});}
    const scoringBracket=await getJson('brackets/'+match.bracketId+'.json'),rules=scoringBracket?.rankingPolicy;
    if(!rules||rules.status!=='APPROVED'||validateRules(rules))return res.status(409).json({ok:false,error:'ranking_rules_unapproved'});
    const before={...match};match.winnerUserId=winnerUserId;match.winMethod=clean(b.winMethod,40);match.scoreA=clean(b.scoreA,30);match.scoreB=clean(b.scoreB,30);match.durationSeconds=Number(b.durationSeconds)||null;match.status='COMPLETED';match.endedAt=now();match.resultBy=user.id;await putJson('matches/'+match.id+'.json',match);
    if(match.nextMatchId){const next=await getJson('matches/'+match.nextMatchId+'.json');if(next){if(match.nextSlot==='A')next.athleteA=winner;else next.athleteB=winner;await putJson('matches/'+next.id+'.json',next);}}
    const trn=await getJson('tournaments/'+match.tournamentId+'.json'),bracket=await getJson('brackets/'+match.bracketId+'.json'),multiplier=Number(trn?.rankingMultiplier)||1;
    const existingEvents=await listJson('ranking-events/',10000);
    for(const athlete of participants){if(!existingEvents.some(e=>e.athleteUserId===athlete.userId&&e.tournamentId===match.tournamentId&&e.type==='PARTICIPATION')){const p={id:makeId('rnk'),athleteUserId:athlete.userId,tournamentId:match.tournamentId,divisionKey:match.divisionKey,matchId:match.id,type:'PARTICIPATION',rulesId:rules.id,participationCap:rules.participation,basePoints:rules.participation,multiplier:1,finalPoints:rules.participation,createdAt:now(),createdBy:user.id};await putJson('ranking-events/'+p.id+'.json',p,{overwrite:false});}}
    const win={id:makeId('rnk'),athleteUserId:winnerUserId,tournamentId:match.tournamentId,divisionKey:match.divisionKey,matchId:match.id,type:'WIN',rulesId:rules.id,basePoints:rules.win,multiplier,finalPoints:rules.win*multiplier,createdAt:now(),createdBy:user.id};await putJson('ranking-events/'+win.id+'.json',win,{overwrite:false});
    const isAbs=String(match.divisionKey||'').endsWith('|ABS'),count=Number(bracket?.athleteCount)||2,factor=bracketFactor(count,rules);
    const award=async(athlete,type,base)=>{const evt={id:makeId('rnk'),athleteUserId:athlete.userId,tournamentId:match.tournamentId,divisionKey:match.divisionKey,matchId:match.id,type,rulesId:rules.id,basePoints:base,multiplier,bracketFactor:factor,finalPoints:base*multiplier*factor,createdAt:now(),createdBy:user.id};await putJson('ranking-events/'+evt.id+'.json',evt,{overwrite:false});const med={id:makeId('med'),athleteUserId:athlete.userId,tournamentId:match.tournamentId,divisionKey:match.divisionKey,medal:type.replace('ABS_',''),absolute:isAbs,awardedAt:now()};await putJson('medals/'+med.id+'.json',med,{overwrite:false});};
    if(bracket&&match.roundNo===bracket.roundCount){await award(winner,isAbs?'ABS_GOLD':'GOLD',rules.medals[isAbs?'ABS_GOLD':'GOLD']);await award(loser,isAbs?'ABS_SILVER':'SILVER',rules.medals[isAbs?'ABS_SILVER':'SILVER']);}
    else if(bracket&&match.roundNo===bracket.roundCount-1){await award(loser,isAbs?'ABS_BRONZE':'BRONZE',rules.medals[isAbs?'ABS_BRONZE':'BRONZE']);}
    await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'MATCH_RESULT',entityType:'MATCH',entityId:match.id,before,after:match,createdAt:now()},{overwrite:false});
    return res.status(200).json({ok:true,match});
  }

  return res.status(404).json({ok:false,error:'unknown_operations_operation'});
}

export default apiHandler(handler, {
  "schedule": ["POST"],
  "registrations": [
    "GET"
  ],
  "matches": [
    "GET"
  ],
  "tournaments": [
    "GET"
  ],
  "checkin": [
    "POST"
  ],
  "weighin": [
    "POST"
  ],
  "bracket": [
    "POST"
  ],
  "result": [
    "POST"
  ]
});
