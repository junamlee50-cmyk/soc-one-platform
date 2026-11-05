import { listJson } from '../lib/blobdb.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const user=await requireUser(req,res); if(!user)return;
  const role=String(req.query.role||'athlete').toLowerCase();
  const roles=user.roles||[];
  const allowed={
    athlete:['ATHLETE'],academy:['COACH','ACADEMY_ADMIN'],region:['COMMITTEE'],
    referee:['REFEREE'],ceo:['CEO']
  };
  if(allowed[role] && !allowed[role].some(r=>roles.includes(r)))return res.status(403).json({ok:false,error:'forbidden'});
  if(role==='athlete'){
    const [events,regs]=await Promise.all([listJson('ranking-events/',5000),listJson('registrations/',5000)]);
    const mine=events.filter(x=>x.athleteUserId===user.id);
    const points=mine.reduce((s,x)=>s+(Number(x.finalPoints)||0),0);
    const wins=mine.filter(x=>x.type==='WIN').length;
    const myRegs=regs.filter(x=>x.userId===user.id && !['CANCELED','REFUNDED'].includes(x.status));
    return res.status(200).json({ok:true,role,data:{points,wins,registrations:myRegs.length,paid:myRegs.filter(x=>x.paymentStatus==='PAID').length}});
  }
  if(role==='academy'){
    const [academies,regs,events]=await Promise.all([listJson('academies/',1000),listJson('registrations/',10000),listJson('ranking-events/',10000)]);
    const mine=academies.filter(x=>x.coachUserId===user.id && x.status==='APPROVED');
    const ids=new Set(mine.map(x=>x.id)); const myRegs=regs.filter(x=>ids.has(x.academyId));
    const athleteIds=new Set(myRegs.map(x=>x.userId)); const points=events.filter(x=>athleteIds.has(x.athleteUserId)).reduce((s,x)=>s+(Number(x.finalPoints)||0),0);
    return res.status(200).json({ok:true,role,data:{academies:mine.length,registeredAthletes:athleteIds.size,eventRegistrations:myRegs.length,teamPoints:points}});
  }
  if(role==='region'){
    const region=user.committeeRegion||''; const [academies,regs,audit]=await Promise.all([listJson('academies/',2000),listJson('registrations/',10000),listJson('audit/',2000)]); const scoped=region?academies.filter(x=>x.region===region):[]; const ids=new Set(scoped.map(x=>x.id)); const scopedRegs=regs.filter(x=>ids.has(x.academyId)); const activeAthletes=new Set(scopedRegs.map(x=>x.userId)).size; return res.status(200).json({ok:true,role,data:{region:region||'미지정',approvedAcademies:scoped.filter(x=>x.status==='APPROVED').length,pendingAcademies:scoped.filter(x=>x.status==='PENDING').length,eventRegistrations:scopedRegs.length,activeAthletes,activityEvents:audit.filter(x=>ids.has(x.entityId)).length}});
  }
  if(role==='referee'){
    const matches=await listJson('matches/',5000);
    const judged=matches.filter(x=>x.resultBy===user.id);
    return res.status(200).json({ok:true,role,data:{completedMatches:judged.length,scheduled:matches.filter(x=>x.status==='SCHEDULED').length,assignments:0,rating:'-'}});
  }
  if(role==='ceo'){
    const [users,academies,tournaments,regs,audit]=await Promise.all([listJson('users/',5000),listJson('academies/',2000),listJson('tournaments/',1000),listJson('registrations/',10000),listJson('audit/',3000)]);
    const paid=regs.filter(x=>x.paymentStatus==='PAID').reduce((s,x)=>s+(Number(x.amount)||0),0);
    return res.status(200).json({ok:true,role,data:{members:users.filter(x=>x.status==='ACTIVE').length,academies:academies.filter(x=>x.status==='APPROVED').length,tournaments:tournaments.length,paidRevenue:paid,registrations:regs.length,auditEvents:audit.length}});
  }
  return res.status(400).json({ok:false,error:'unknown_role'});
}