import { putJson, getJson, deletePath, hash, now, passwordHash, verifyPassword } from '../lib/blobdb.js';

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({ok:false,error:'method_not_allowed'});
  }
  const token=String(req.query.token||'');
  const expected=process.env.SOC_DIAGNOSTIC_TOKEN||'';
  if(!expected || token.length<20 || hash(token)!==hash(expected)){
    return res.status(403).json({ok:false,error:'forbidden'});
  }
  const id='diagnostics/'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.json';
  const probe={ok:true,createdAt:now(),nonce:Math.random().toString(36).slice(2)};
  const checks={env:Boolean(process.env.BLOB_READ_WRITE_TOKEN),ticketKey:Boolean(process.env.SOC_TICKET_SIGNING_KEY),blobWrite:false,blobRead:false,blobDelete:false,passwordCrypto:false};
  try{
    await putJson(id,probe,{overwrite:false});
    checks.blobWrite=true;
    const read=await getJson(id);
    checks.blobRead=Boolean(read&&read.nonce===probe.nonce);
    await deletePath(id);
    checks.blobDelete=(await getJson(id))===null;
    const p=passwordHash('SOC-diagnostic-password');
    checks.passwordCrypto=verifyPassword('SOC-diagnostic-password',p.salt,p.hash)&&!verifyPassword('wrong',p.salt,p.hash);
    const ok=Object.values(checks).every(Boolean);
    return res.status(ok?200:500).json({ok,service:'SOC ONE',version:'1.0.0-prelaunch',checks,timestamp:now()});
  }catch(e){
    try{await deletePath(id)}catch{}
    return res.status(500).json({ok:false,error:'diagnostic_failed',checks,message:String(e?.message||e),timestamp:now()});
  }
}
