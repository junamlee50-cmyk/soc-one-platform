import crypto from 'node:crypto';
function clean(v,max=120){return typeof v==='string'?v.trim().replace(/[<>]/g,'').slice(0,max):''}
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}
  const b=req.body||{};
  const socId=clean(b.socId,24), belt=clean(b.belt,20), academy=clean(b.academy,120);
  if(!socId) return res.status(400).json({ok:false,error:'soc_id_required'});
  return res.status(201).json({ok:true,athlete:{id:crypto.randomUUID(),socId,belt,academy,status:'REGISTERED',seasonPoints:0,record:{wins:0,losses:0}}});
}
