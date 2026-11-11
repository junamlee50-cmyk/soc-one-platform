import crypto from 'node:crypto';
import {getJson,putJson,deletePath,hash,clean,passwordHash,makeId,now} from './blobdb.js';
import {usesPostgres} from './database.js';
import {requireUser} from './auth.js';
import {verifyMfa} from './mfa.js';
export const emailConfigured=()=>Boolean(process.env.RESEND_API_KEY&&process.env.SOC_EMAIL_FROM&&process.env.SOC_TICKET_SIGNING_KEY);
const digest=(purpose,email,code)=>crypto.createHmac('sha256',process.env.SOC_TICKET_SIGNING_KEY).update(purpose+'|'+email+'|'+code).digest('hex');
export async function accountEmail(req,res){
 if(!usesPostgres()||!emailConfigured())return res.status(503).json({ok:false,error:'email_service_not_configured',message:'이메일 인증 서비스 준비 중입니다. 운영자에게 문의해 주세요.'});
 const op=req.query.op,b=req.body||{},purpose=op.startsWith('email-')?'VERIFY':'RESET';
 let user,email;
 if(purpose==='VERIFY'){user=await requireUser(req,res,null,{allowMfaSetup:true});if(!user)return;email=user.email;}
 else{email=clean(b.email,255).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({ok:false,error:'invalid_email'});const idx=await getJson('user-email/'+hash(email)+'.json');user=idx?await getJson('users/'+idx.userId+'.json'):null;}
 const path='email-challenges/'+hash(purpose+'|'+email)+'.json';
 if(op.endsWith('-request')){
  if(user?.status==='ACTIVE'&&!(purpose==='VERIFY'&&user.emailVerifiedAt)){
   const code=String(crypto.randomInt(0,100000000)).padStart(8,'0'),id=makeId('mail');
   await putJson(path,{userId:user.id,purpose,emailHash:hash(email),digest:digest(purpose,email,code),authVersion:user.authVersion||0,expiresAt:new Date(Date.now()+15*60000).toISOString()});
   const sent=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:process.env.SOC_EMAIL_FROM,to:[email],subject:purpose==='VERIFY'?'SOC ONE 이메일 인증':'SOC ONE 비밀번호 복구',text:'SOC ONE '+(purpose==='VERIFY'?'이메일 인증':'비밀번호 복구')+' 코드: '+code+'\n15분 동안 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.'})});
   if(!sent.ok)throw new Error('email_delivery_failed');
  }
  return res.status(200).json({ok:true,message:'해당 계정이 있으면 인증 코드를 발송했습니다. 수신함과 스팸함을 확인해 주세요.'});
 }
 const challenge=await getJson(path),code=typeof b.code==='string'?b.code:'';
 if(!user||user.status!=='ACTIVE'||!challenge||challenge.userId!==user.id||challenge.authVersion!==(user.authVersion||0)||Date.parse(challenge.expiresAt)<=Date.now()||!/^\d{8}$/.test(code)||challenge.digest!==digest(purpose,email,code))return res.status(400).json({ok:false,error:'invalid_or_expired_code',message:'인증 코드가 잘못됐거나 만료되었습니다.'});
 if(purpose==='RESET'){
  if(typeof b.newPassword!=='string'||b.newPassword.length<12||b.newPassword.length>256)return res.status(400).json({ok:false,error:'weak_password'});
  if(user.mfaEnabled&&!await verifyMfa(user,b.otp,b.recoveryCode))return res.status(401).json({ok:false,error:'mfa_required'});
  const ph=passwordHash(b.newPassword);user.passwordSalt=ph.salt;user.passwordHash=ph.hash;user.authVersion=(user.authVersion||0)+1;
 }else user.emailVerifiedAt=now();
 user.updatedAt=now();await putJson('users/'+user.id+'.json',user);await deletePath(path);
 await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action:purpose==='RESET'?'PASSWORD_RECOVERED':'EMAIL_VERIFIED',entityId:user.id,createdAt:now()},{overwrite:false});
 return res.status(200).json({ok:true});
}
