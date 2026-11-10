import {demoAccess,ensureDemoAccount,DEMO_EMAIL} from '../lib/demo-account.js';
import {accountEmail} from '../lib/account-email.js';
import {requireRegistrationPolicy} from '../lib/service-settings.js';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {usesPostgres,isDemoTransaction} from '../lib/database.js';
import {mfaConfigured,base32,encryptSecret,decryptSecret,matchCounter,verifyMfa,recoveryCodes} from '../lib/mfa.js';
import { apiHandler } from '../lib/http.js';
import { getJson, putJson, deletePath, hash, clean, makeId, makeSocId, passwordHash, verifyPassword, now } from '../lib/blobdb.js';
import { createSession, destroySession, requireUser } from '../lib/auth.js';

async function handler(req,res){
  const op=String(req.query.op||'').toLowerCase();

  if(op==='demo-access')return res.status(200).json({ok:true,...demoAccess()});

  if(['email-request','email-confirm','reset-request','reset-confirm'].includes(op))return accountEmail(req,res);
  if(op==='register'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{}; const name=clean(b.name,80),email=clean(b.email,255).toLowerCase(),password=typeof b.password==='string'?b.password:'',requestedRole=clean(b.role,20).toUpperCase(),consent=b.consent===true;
    if(email===DEMO_EMAIL)return res.status(400).json({ok:false,error:'reserved_test_email'});
    if(!name||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({ok:false,error:'invalid_profile'});
    if(password.length<10||password.length>256)return res.status(400).json({ok:false,error:'weak_password',message:'비밀번호는 10자 이상이어야 합니다.'});
    if(!consent)return res.status(400).json({ok:false,error:'consent_required'});
    const policy=await requireRegistrationPolicy(b);
    if(policy.error)return res.status(409).json({ok:false,...policy});
    const role=requestedRole==='COACH'?'COACH':'ATHLETE',emailKey=hash(email);
    if(await getJson('user-email/'+emailKey+'.json'))return res.status(409).json({ok:false,error:'email_exists'});
    const id=makeId('usr'),ph=passwordHash(password);
    const user={id,socId:makeSocId(),name,email,emailKey,roles:[role,'MEMBER'],passwordSalt:ph.salt,passwordHash:ph.hash,status:'ACTIVE',countryCode:'KR',locale:'ko-KR',consentAt:now(),createdAt:now(),updatedAt:now()};
    user.policyConsent={policyId:policy.policyId,policyVersion:policy.policyVersion,privacyConsent:consent,termsConsent:b.termsConsent===true,acceptedAt:user.consentAt};
    await putJson('users/'+id+'.json',user,{overwrite:false});await putJson('user-email/'+emailKey+'.json',{userId:id,emailKey,createdAt:now()},{overwrite:false});await createSession(res,user);
    return res.status(201).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
  }

  if(op==='login'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const b=req.body||{},email=clean(b.email,255).toLowerCase(),password=typeof b.password==='string'?b.password:'';
    if(password.length>256)return res.status(400).json({ok:false,error:'invalid_credentials'});
    if(email===DEMO_EMAIL&&!isDemoTransaction())return res.status(401).json({ok:false,error:'invalid_credentials'});
    if(email===DEMO_EMAIL)await ensureDemoAccount(password);
    const idx=await getJson('user-email/'+hash(email)+'.json');if(!idx)return res.status(401).json({ok:false,error:'invalid_credentials'});
    const user=await getJson('users/'+idx.userId+'.json');if(!user||user.status!=='ACTIVE'||!verifyPassword(password,user.passwordSalt,user.passwordHash))return res.status(401).json({ok:false,error:'invalid_credentials'});
    if(user.mfaEnabled&&!(await verifyMfa(user,b.otp,b.recoveryCode)))return res.status(401).json({ok:false,error:'mfa_required',message:'인증 앱의 6자리 코드 또는 일회용 복구코드를 입력해 주세요.'});
    await createSession(res,user,{mfaVerified:!!user.mfaEnabled});return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles}});
  }

  if(op==='me'){
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    const user=await requireUser(req,res,null,{allowMfaSetup:true});if(!user)return;
    return res.status(200).json({ok:true,user:{id:user.id,socId:user.socId,name:user.name,email:user.email,roles:user.roles,countryCode:user.countryCode,locale:user.locale,committeeRegion:user.committeeRegion||null,demoAccount:!!user.demoAccount,mfaEnabled:!!user.mfaEnabled,emailVerifiedAt:user.emailVerifiedAt||null}});
  }

  if(['mfa-status','mfa-start','mfa-confirm','change-password','logout-all'].includes(op)){
    const user=await requireUser(req,res,null,{allowMfaSetup:['mfa-status','mfa-start','mfa-confirm'].includes(op)});if(!user)return;
    if(user.demoAccount&&op!=='mfa-status')return res.status(409).json({ok:false,error:'demo_account_fixed',message:'공용 테스트 계정의 비밀번호와 추가인증 설정은 변경할 수 없습니다.'});
    if(op==='mfa-status')return res.status(200).json({ok:true,enabled:!!user.mfaEnabled,available:usesPostgres()&&mfaConfigured()});
    if(!usesPostgres())return res.status(503).json({ok:false,error:'transactional_database_required'});
    const b=req.body||{};
    if(op==='logout-all'){
      user.authVersion=(user.authVersion||0)+1;await putJson('users/'+user.id+'.json',user);await destroySession(req,res);return res.status(200).json({ok:true});
    }
    if(op==='change-password'||op==='mfa-start'){
      if(typeof b.currentPassword!=='string'||b.currentPassword.length>256||!verifyPassword(b.currentPassword,user.passwordSalt,user.passwordHash))return res.status(401).json({ok:false,error:'invalid_credentials'});
    }
    if(op==='change-password'){
      if(typeof b.newPassword!=='string'||b.newPassword.length<12||b.newPassword.length>256)return res.status(400).json({ok:false,error:'weak_password'});
      if(user.mfaEnabled&&!(await verifyMfa(user,b.otp,b.recoveryCode)))return res.status(401).json({ok:false,error:'mfa_required'});
      const p=passwordHash(b.newPassword);user.passwordSalt=p.salt;user.passwordHash=p.hash;user.authVersion=(user.authVersion||0)+1;user.updatedAt=now();await putJson('users/'+user.id+'.json',user);
      await createSession(res,user,{mfaVerified:!!user.mfaEnabled});
      await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'PASSWORD_CHANGED',entityType:'USER',entityId:user.id,createdAt:now()},{overwrite:false});
      return res.status(200).json({ok:true});
    }
    if(!mfaConfigured())return res.status(503).json({ok:false,error:'mfa_not_configured'});
    if(user.mfaEnabled)return res.status(409).json({ok:false,error:'mfa_already_enabled'});
    if(op==='mfa-start'){
      const secret=crypto.randomBytes(20),encoded=base32(secret),uri='otpauth://totp/'+encodeURIComponent('SOC ONE:'+user.email)+'?secret='+encoded+'&issuer=SOC%20ONE&algorithm=SHA1&digits=6&period=30';
      await putJson('mfa-pending/'+user.id+'.json',{userId:user.id,secret:encryptSecret(secret,user.id),expiresAt:new Date(Date.now()+600000).toISOString()});
      return res.status(200).json({ok:true,secret:encoded,qr:await QRCode.toDataURL(uri,{width:240,margin:1}),expiresIn:600});
    }
    const pending=await getJson('mfa-pending/'+user.id+'.json');
    if(!pending||!Number.isFinite(Date.parse(pending.expiresAt))||Date.parse(pending.expiresAt)<=Date.now())return res.status(409).json({ok:false,error:'mfa_setup_expired'});
    const counter=matchCounter(decryptSecret(pending.secret,user.id),b.otp);
    if(counter===null)return res.status(401).json({ok:false,error:'invalid_mfa_code'});
    const recovery=recoveryCodes();await putJson('mfa/'+user.id+'.json',{userId:user.id,secret:pending.secret,lastCounter:counter,recoveryHashes:recovery.hashes,enabledAt:now()});
    await deletePath('mfa-pending/'+user.id+'.json');
    user.mfaEnabled=true;user.authVersion=(user.authVersion||0)+1;await putJson('users/'+user.id+'.json',user);await createSession(res,user,{mfaVerified:true});
    await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:'MFA_ENABLED',entityType:'USER',entityId:user.id,createdAt:now()},{overwrite:false});
    return res.status(200).json({ok:true,recoveryCodes:recovery.codes});
  }

  if(op==='logout'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
    await destroySession(req,res);return res.status(200).json({ok:true});
  }

  return res.status(404).json({ok:false,error:'unknown_auth_operation'});
}

export default apiHandler(handler, {
  "demo-access": ["GET"],
  "email-request": ["POST"], "email-confirm": ["POST"], "reset-request": ["POST"], "reset-confirm": ["POST"],
  "mfa-status": ["GET"], "mfa-start": ["POST"], "mfa-confirm": ["POST"], "change-password": ["POST"], "logout-all": ["POST"],
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
