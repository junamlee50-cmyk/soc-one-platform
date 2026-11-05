import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const actor=await requireUser(req,res,['STAFF','ADMIN','CEO']); if(!actor)return;
  const [users,academies,tournaments,regs,audit]=await Promise.all([listJson('users/',5000),listJson('academies/',2000),listJson('tournaments/',500),listJson('registrations/',10000),listJson('audit/',1000)]);
  const paid=regs.filter(x=>x.paymentStatus==='PAID').reduce((s,x)=>s+(Number(x.amount)||0),0);
  return res.status(200).json({ok:true,overview:{members:users.filter(x=>x.status==='ACTIVE').length,athletes:users.filter(x=>(x.roles||[]).includes('ATHLETE')).length,coaches:users.filter(x=>(x.roles||[]).includes('COACH')).length,approvedAcademies:academies.filter(x=>x.status==='APPROVED').length,pendingAcademies:academies.filter(x=>x.status==='PENDING').length,tournaments:tournaments.filter(x=>!x.deletedAt).length,registrations:regs.length,paidRevenue:paid,auditEvents:audit.length}});
}