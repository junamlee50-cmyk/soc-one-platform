import { apiHandler } from '../lib/http.js';
import { getJson, putJson, hash, clean, makeId, makeSocId, passwordHash, verifyPassword, now } from '../lib/blobdb.js';
import { createSession, destroySession, requireUser } from '../lib/auth.js';

async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();

  if(op==='register'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{}; const name=clean(b.name,80),email=clean(b.email,255).toLowerCase(),password=typeof b.password==='string'?b.password:'',requestedRole=clean(b.role,20).toUpperCase(),consent=b.consent===true;
    if(!name||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({ok:false,error:'invalid_profile'});
    if(password.length<10||password.length>256)return res.status(400).json({ok:false,error:'weak_password',message:'비밀번호는 10자 이상이어야 합니다.'});
    if(!consent)return res.status(400).json({ok:false,error:'consent_required'});
    const role=requestedRole==='COACH'?'COACH':'ATHLETE',emailKey=hash(email);
    if(await getJson('user-email/'+emailKey+'.json'))return res.status(409).json({ok:false,error:'email_exists'});
    const id=makeId('usr'),ph=passwordHash(password);
    const user={id,socId:makeSocId(),name,email,emailKey,roles:[role,'MEMBER'],passwordSalt:ph.salt,passwordHash:ph.hash,status:'ACTIVE',countryCode:'KR',locale:'ko-KR',consentAt:now(),createdAt:now(),updatedAt:now()};
    await putJson('users/'+id+'.json',user,{overwrite:false});await putJson('user-email/'+emailKey+'.json',{userId:id,emailKey,createdAt:now()},{overwrite:false});await createSession(res,user);
    return res.status(201).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
  }

  if(op==='login'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},email=clean(b.email,255).toLowerCase(),password=typeof b.password==='string'?b.password:'';
    if(password.length>256)return res.status(400).json({ok:false,error:'invalid_credentials'});
    const idx=await getJson('user-email/'+hash(email)+'.json');if(!idx)return res.status(401).json({ok:false,error:'invalid_credentials'});
    const user=await getJson('users/'+idx.userId+'.json');if(!user||user.status!=='ACTIVE'||!verifyPassword(password,user.passwordSalt,user.passwordHash))return res.status(401).json({ok:false,error:'invalid_credentials'});
    await createSession(res,user);return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
  }

  if(op==='me'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const user=await requireUser(req,res);if(!user)return;
    return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles,countryCode:user.countryCode,locale:user.locale,committeeRegion:user.committeeRegion||null}});
  }

  if(op==='logout'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    await destroySession(req,res);return res.status(200).json({ok:true});
  }

  return res.status(404).json({ok:false,error:'unknown_auth_operation'});
}

export default apiHandler(handler, {
  "register": [
    "POST"
  ],
  "login": [
    "POST"
  ],
  "me": [
    "GET"
  ],
  "logout": [
    "POST"
  ]
});
