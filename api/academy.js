import crypto from 'node:crypto';
function clean(v,max=160){return typeof v==='string'?v.trim().replace(/[<>]/g,'').slice(0,max):''}
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}
  const b=req.body||{};
  const name=clean(b.name), region=clean(b.region,80), coach=clean(b.coach,80);
  if(!name||!coach) return res.status(400).json({ok:false,error:'required_fields'});
  return res.status(201).json({ok:true,academy:{id:crypto.randomUUID(),name,region,coach,status:'PENDING_REVIEW',createdAt:new Date().toISOString()}});
}
