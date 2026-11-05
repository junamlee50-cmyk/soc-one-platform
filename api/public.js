import { listJson, putJson, getJson, clean, makeId, now } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();

  if(op==='health'){
    return res.status(200).json({ok:true,service:'SOC ONE',environment:process.env.VERCEL_ENV||'unknown',timestamp:new Date().toISOString(),version:'1.0.0-prelaunch'});
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
      const id=makeId('trn');const row={id,name,level,venueName,venueAddress:clean(b.venueAddress,300),countryCode:clean(b.countryCode,2)||'KR',startAt,registrationOpenAt:clean(b.registrationOpenAt,40),earlyUntil:clean(b.earlyUntil,40),regularUntil:clean(b.regularUntil,40),registrationCloseAt:clean(b.registrationCloseAt,40),status:clean(b.status,30)||'DRAFT',rankingMultiplier:Number(b.rankingMultiplier)||1,fees:{early:Number(b.earlyFee)||0,regular:Number(b.regularFee)||0,late:Number(b.lateFee)||0,extra:Number(b.extraFee)||0},createdBy:user.id,createdAt:now(),updatedAt:now()};
      await putJson('tournaments/'+id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,tournament:row});
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
      const id=makeId('div'),key=[discipline,ageGroup,belt,weightClass,Boolean(b.absolute)?'ABS':'WEIGHT'].join('|');
      const row={id,tournamentId,key,discipline,ageGroup,belt,gender:clean(b.gender,20),weightClass,weightLimitKg:Number(b.weightLimitKg)||null,absolute:Boolean(b.absolute),active:true,createdBy:u.id,createdAt:now()};
      await putJson('divisions/'+id+'.json',row,{overwrite:false});return res.status(201).json({ok:true,division:row});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});
  }

  if(op==='ranking'){
    const events=await listJson('ranking-events/',10000);const sums=new Map();
    for(const e of events){const k=e.athleteUserId;if(!k)continue;const x=sums.get(k)||{athleteUserId:k,points:0,wins:0,medals:0};x.points+=Number(e.finalPoints)||0;if(e.type==='WIN')x.wins++;if(['BRONZE','SILVER','GOLD','ABS_BRONZE','ABS_SILVER','ABS_GOLD'].includes(e.type))x.medals++;sums.set(k,x);}
    const ranked=[...sums.values()].sort((a,b)=>b.points-a.points),rows=[];
    for(const x of ranked){const p=await getJson('athletes/'+x.athleteUserId+'.json');if(!p?.publicProfile)continue;rows.push({...x,rank:rows.length+1,name:p.displayName,academy:p.academyName,belt:p.belt,weight:p.defaultWeightKg?String(p.defaultWeightKg)+'kg':''});}
    return res.status(200).json({ok:true,season:'2027',ranking:rows});
  }

  if(op==='content'){
    const rows=(await listJson('content/',3000)).filter(x=>x.status==='PUBLISHED').sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||''))).slice(0,100);
    return res.status(200).json({ok:true,content:rows.map(({id,type,title,summary,coverUrl,publishedAt,athleteSocId,academyId})=>({id,type,title,summary,coverUrl,publishedAt,athleteSocId,academyId}))});
  }

  if(op==='verify-cert'){
    const code=clean(req.query.code,60);if(!code)return res.status(400).json({ok:false,error:'code_required'});
    const cert=await getJson('certificates/'+code+'.json');if(!cert)return res.status(404).json({ok:false,valid:false,error:'certificate_not_found'});
    return res.status(200).json({ok:true,valid:true,certificate:cert});
  }

  return res.status(404).json({ok:false,error:'unknown_public_operation'});
}