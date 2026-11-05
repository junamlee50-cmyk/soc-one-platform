import crypto from 'node:crypto';

const users = new Map();

function socId(){
  return 'SOC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
function clean(v,max=120){
  if(typeof v!=='string') return '';
  return v.trim().replace(/[<>]/g,'').slice(0,max);
}

export default async function handler(req,res){
  if(req.method==='POST'){
    const b=req.body||{};
    const email=clean(b.email,255).toLowerCase();
    const name=clean(b.name,80);
    const role=clean(b.role,30)||'ATHLETE';
    if(!email||!name) return res.status(400).json({ok:false,error:'required_fields'});
    let u=users.get(email);
    if(!u){
      u={id:crypto.randomUUID(),socId:socId(),email,name,roles:[role],createdAt:new Date().toISOString()};
      users.set(email,u);
    }else if(!u.roles.includes(role)) u.roles.push(role);
    return res.status(200).json({ok:true,user:u});
  }
  if(req.method==='GET'){
    return res.status(200).json({ok:true,demo:true,message:'Demo auth service is online'});
  }
  res.setHeader('Allow','GET, POST');
  return res.status(405).end();
}
