import { apiHandler } from '../../lib/http.js';
import { getJson, putJson, hash, clean, makeId, makeSocId, passwordHash, now } from '../../lib/blobdb.js';
import { createSession } from '../../lib/auth.js';

async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,error:'method_not_allowed'});
  }
  const b=req.body||{};
  const token=typeof b.token==='string'?b.token:'';
  const expected=process.env.SOC_BOOTSTRAP_TOKEN||'';
  if(!expected || token.length<20 || hash(token)!==hash(expected)){
    return res.status(403).json({ok:false,error:'invalid_bootstrap_token'});
  }
  if(await getJson('system/bootstrap.json') || await getJson('system/admin-bootstrap.json')){
    return res.status(409).json({ok:false,error:'already_initialized'});
  }
  const name=clean(b.name,80);
  const email=clean(b.email,255).toLowerCase();
  const password=typeof b.password==='string'?b.password:'';
  if(!name||!email||!email.includes('@')) return res.status(400).json({ok:false,error:'invalid_profile'});
  if(password.length<12||password.length>256) return res.status(400).json({ok:false,error:'weak_password',message:'최초 관리자 비밀번호는 12자 이상이어야 합니다.'});
  const emailKey=hash(email);
  if(await getJson('user-email/'+emailKey+'.json')) return res.status(409).json({ok:false,error:'email_exists'});
  const id=makeId('usr');
  const ph=passwordHash(password);
  const user={id,socId:makeSocId(),name,email,emailKey,roles:['CEO','ADMIN','STAFF','FINANCE','MEMBER'],passwordSalt:ph.salt,passwordHash:ph.hash,status:'ACTIVE',countryCode:'KR',locale:'ko-KR',consentAt:now(),createdAt:now(),updatedAt:now()};
  await putJson('users/'+id+'.json',user,{overwrite:false});
  await putJson('user-email/'+emailKey+'.json',{userId:id,emailKey,createdAt:now()},{overwrite:false});
  await putJson('system/bootstrap.json',{initialized:true,ownerUserId:id,initializedAt:now()},{overwrite:false});
  await createSession(res,user);
  return res.status(201).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
}


export default apiHandler(handler, [
  "POST"
]);
