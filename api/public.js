import { validateTournament, validateDivision } from '../lib/configuration.js';
import { seasonRanking, DEFAULT_SEASON } from '../lib/ranking.js';
import { apiHandler } from '../lib/http.js';
import { listJson, putJson, getJson, clean, makeId, now } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();

  if(op==='health'){
    return res.status(200).json({ok:true,service:'SOC ONE',environment:process.env.VERCEL_ENV||'unknown',timestamp:new Date().toISOString(),version:'1.0.1-prelaunch',commit:process.env.VERCEL_GIT_COMMIT_SHA||null});
  }

  if(op==='academies'){
    if(req.method==='GET'){
      const rows=(await listJson('academies/',2000)).filter(x=>x.status==='APPROVED'&&x.active!==false);
      return res.status(200).json({ok:true,academies:rows.map(({id,name,region,coachName,slug,joinedAt})=>({id,name,region,coachName,slug,joinedAt}))});
    }
    if(req.method==='POST'){
      const user=await requireUser(req,res,['COACH','ADMIN','CEO']);if(!user)return;
      const b=req.body||{},name=clean(b.name,160),region=clean(b.region,80),address=clean(b.address,300);
      if(!name||!region)return res.status(400).json({ok:false,error:'required_fields'});
      const id=makeId('aca');const row={id,name,slug:(name+'-'+id.slice(-6)).toLowerCase().replace(/[^a-z0-9가-힣-]+/g,'-'),region,address,coachUserId:user.id,coachName:user.name,status:'PENDING',active:true,createdAt:now(),joinedAt:null};
      await putJson('academies/'+id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,academy:row});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='tournaments'){
    if(req.method==='GET'){
      const rows=(await listJson('tournaments/',1000)).filter(x=>!x.deletedAt&&['COMING_SOON','REGISTRATION_OPEN','PUBLISHED','CLOSED','COMPLETED'].includes(x.status)).sort((a,b)=>String(a.startAt||'').localeCompare(String(b.startAt||'')));
      return res.status(200).json({ok:true,tournaments:rows});
    }
    if(req.method==='POST'){
      const user=await requireUser(req,res,['STAFF','ADMIN','CEO']);if(!user)return;
      const b=req.body||{},name=clean(b.name,180),level=clean(b.level,30),venueName=clean(b.venueName,180),startAt=clean(b.startAt,40);
      if(!name||!level||!startAt)return res.status(400).json({ok:false,error:'required_fields'});
      const id=clean(b.id,80)||makeId('trn'),prev=b.id?await getJson('tournaments/'+id+'.json'):null;if(b.id&&!prev)return res.status(404).json({ok:false,error:'tournament_not_found'});const row={id,name,level,rulesId:clean(b.rulesId,80),venueName,venueAddress:clean(b.venueAddress,300),countryCode:clean(b.countryCode,2)||'KR',startAt,registrationOpenAt:clean(b.registrationOpenAt,40),earlyUntil:clean(b.earlyUntil,40),regularUntil:clean(b.regularUntil,40),registrationCloseAt:clean(b.registrationCloseAt,40),status:clean(b.status,30)||'DRAFT',rankingMultiplier:b.rankingMultiplier==null?1:Number(b.rankingMultiplier),discounts:b.discounts||[],fees:{early:Number(b.earlyFee),regular:Number(b.regularFee),late:Number(b.lateFee),additionalDiscipline:b.additionalDisciplineFee==null?null:Number(b.additionalDisciplineFee),absolute:b.absoluteFee==null?null:Number(b.absoluteFee)},createdBy:prev?.createdBy||user.id,createdAt:prev?.createdAt||now(),updatedAt:now()};
      const error=validateTournament(row);if(error)return res.status(400).json({ok:false,error});
      if(prev&&(row.rulesId!==prev.rulesId||row.rankingMultiplier!==prev.rankingMultiplier)&&(await listJson('brackets/',1000,{tournamentId:id})).length)return res.status(409).json({ok:false,error:'rules_locked_after_bracket'});
      const reason=clean(b.reason,500);if(prev&&!reason)return res.status(400).json({ok:false,error:'change_reason_required'});
      await putJson('tournaments/'+id+'.json',row,{overwrite:!!prev});
      await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:prev?'TOURNAMENT_UPDATED':'TOURNAMENT_CREATED',entityType:'TOURNAMENT',entityId:id,before:prev,after:row,reason,createdAt:now()},{overwrite:false});
      return res.status(prev?200:201).json({ok:true,tournament:row});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='divisions'){
    if(req.method==='GET'){
      const tournamentId=clean(req.query.tournamentId,80);const rows=(await listJson('divisions/',5000)).filter(x=>x.tournamentId===tournamentId&&x.active!==false);return res.status(200).json({ok:true,divisions:rows});
    }
    if(req.method==='POST'){
      const u=await requireUser(req,res,['STAFF','ADMIN','CEO']);if(!u)return;
      const b=req.body||{},tournamentId=clean(b.tournamentId,80),discipline=clean(b.discipline,20),ageGroup=clean(b.ageGroup,30),belt=clean(b.belt,20),weightClass=clean(b.weightClass,40);
      if(!tournamentId||!discipline||!ageGroup||!belt||!weightClass)return res.status(400).json({ok:false,error:'required_fields'});
      const tournament=await getJson('tournaments/'+tournamentId+'.json');if(!tournament||tournament.deletedAt)return res.status(404).json({ok:false,error:'tournament_not_found'});
      const id=makeId('div'),key=[discipline,ageGroup,clean(b.gender,20),belt,weightClass,Boolean(b.absolute)?'ABS':'WEIGHT'].join('|');
      const row={id,tournamentId,key,discipline,ageGroup,belt,capacity:b.capacity?Number(b.capacity):null,ageMin:b.ageMin!==undefined?Number(b.ageMin):null,ageMax:b.ageMax!==undefined?Number(b.ageMax):null,ageReferenceDate:clean(b.ageReferenceDate,10),gender:clean(b.gender,20),weightClass,weightLimitKg:Number(b.weightLimitKg)||null,absolute:Boolean(b.absolute),active:true,createdBy:u.id,createdAt:now()};
      const error=validateDivision(row);if(error)return res.status(400).json({ok:false,error});
      if((await listJson('divisions/',1000,{tournamentId})).some(d=>d.key===key&&d.active!==false))return res.status(409).json({ok:false,error:'division_exists'});
      await putJson('divisions/'+id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,division:row});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='ranking'){
    const season=String(req.query.season||DEFAULT_SEASON);
    if(!/^\d{4}$/.test(season))return res.status(400).json({ok:false,error:'invalid_season'});
    const [events,tournaments]=await Promise.all([listJson('ranking-events/',10000),listJson('tournaments/',1000)]);
    const visible=[];
    for(const athleteId of new Set(events.map(e=>e.athleteUserId))){const profile=await getJson('athletes/'+athleteId+'.json');if(profile?.publicProfile)visible.push([athleteId,profile]);}
    const profiles=new Map(visible);
    const rows=seasonRanking(events.filter(e=>profiles.has(e.athleteUserId)),tournaments,season).map(x=>{const p=profiles.get(x.athleteUserId);return {...x,name:p.displayName,academy:p.academyName,belt:p.belt,weight:p.defaultWeightKg?String(p.defaultWeightKg)+'kg':''};});
    const classified=rows.filter(x=>x.categoryKey.split('|').length===6);
    const categories=[...new Set(classified.map(x=>x.categoryKey))];
    const category=String(req.query.category||'');
    return res.status(200).json({ok:true,season,categories,category,ranking:classified.filter(x=>x.categoryKey===category),unclassifiedCount:rows.length-classified.length});
  }

  if(op==='content'){
    const rows=(await listJson('content/',3000)).filter(x=>x.status==='PUBLISHED').sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||''))).slice(0,100);
    return res.status(200).json({ok:true,content:rows.map(({id,type,title,summary,coverUrl,publishedAt,athleteSocId,academyId})=>({id,type,title,summary,coverUrl,publishedAt,athleteSocId,academyId}))});
  }

  if(op==='verify-cert'){
    const code=clean(req.query.code,60);if(!code)return res.status(400).json({ok:false,error:'code_required'});
    const cert=await getJson('certificates/'+code+'.json');if(!cert)return res.status(404).json({ok:false,valid:false,error:'certificate_not_found'});
    const tournament=await getJson('tournaments/'+cert.tournamentId+'.json');
    if(cert.revokedAt||!tournament||tournament.status==='CANCELED')return res.status(409).json({ok:false,valid:false,error:'certificate_revoked',message:'결과 정정 또는 대회 취소로 재발급이 필요합니다.'});
    return res.status(200).json({ok:true,valid:true,certificate:cert});
  }

  return res.status(404).json({ok:false,error:'unknown_public_operation'});
}

export default apiHandler(handler, {
  "health": [
    "GET"
  ],
  "academies": [
    "GET",
    "POST"
  ],
  "tournaments": [
    "GET",
    "POST"
  ],
  "divisions": [
    "GET",
    "POST"
  ],
  "ranking": [
    "GET"
  ],
  "content": [
    "GET"
  ],
  "verify-cert": [
    "GET"
  ]
});
