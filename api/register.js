import { put } from '@vercel/blob';
import crypto from 'node:crypto';

function clean(v, max=120){
  if(typeof v !== 'string') return '';
  return v.trim().replace(/[<>]/g,'').slice(0,max);
}

export default async function handler(req,res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,error:'method_not_allowed'});
  }
  try{
    const b=req.body || {};
    if(b.website) return res.status(200).json({ok:true}); // honeypot
    const type=clean(b.type,30);
    const region=clean(b.region,40);
    const academy=clean(b.academy,80);
    const name=clean(b.name,40);
    const contact=clean(b.contact,40);
    const consent=Boolean(b.consent);
    const testMode=Boolean(b.testMode);
    if(!consent) return res.status(400).json({ok:false,error:'consent_required'});
    if(!type || !name || !contact) return res.status(400).json({ok:false,error:'required_fields'});
    if(!testMode) return res.status(423).json({ok:false,error:'prelaunch_locked',message:'개인정보 처리방침과 운영 법인정보 확정 후 활성화됩니다.'});

    const id=crypto.randomUUID();
    const createdAt=new Date().toISOString();
    const day=createdAt.slice(0,10);
    const record={id,type,region,academy,name,contact,consent,createdAt,source:'soc-one-web',testMode:true};
    await put(`registrations-test/${day}/${id}.json`, JSON.stringify(record), {
      access:'private',
      contentType:'application/json',
      addRandomSuffix:false
    });
    return res.status(201).json({ok:true,id,createdAt,testMode:true});
  }catch(e){
    console.error('registration_error', e);
    return res.status(500).json({ok:false,error:'server_error'});
  }
}
