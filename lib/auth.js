import {isDemoTransaction,demoEnabled} from './database.js';
import crypto from 'node:crypto';
import { getJson, putJson, deletePath, hash, now } from './blobdb.js';

const COOKIE='__Host-soc_session';
const MAX_AGE=60*60*24*7;

export function parseCookies(req){
  const raw=req.headers?.cookie||'';
  const pairs=[];
  for(const item of raw.split(';')){
    const text=item.trim();
    if(!text)continue;
    const i=text.indexOf('=');
    if(i<=0)continue;
    try { pairs.push([decodeURIComponent(text.slice(0,i)),decodeURIComponent(text.slice(i+1))]); }
    catch { /* Ignore malformed cookies instead of crashing authentication. */ }
  }
  return Object.fromEntries(pairs);
}

export function requireSameOrigin(req,res){
  const origin=req.headers?.origin;
  const fetchSite=String(req.headers?.['sec-fetch-site']||'');
  if(fetchSite&& !['same-origin','none'].includes(fetchSite)){
    res.status(403).json({ok:false,error:'cross_site_request_blocked'});
    return false;
  }
  if(!origin){
    if(fetchSite==='same-origin')return true;
    res.status(403).json({ok:false,error:'origin_required'});
    return false;
  }
  const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'').split(',')[0].trim();
  const proto=String(req.headers?.['x-forwarded-proto']||'https').split(',')[0].trim();
  if(!host||origin!==`${proto}://${host}`){
    res.status(403).json({ok:false,error:'origin_mismatch'});
    return false;
  }
  return true;
}

export async function createSession(res,user,{mfaVerified=false}={}){
  const token=crypto.randomBytes(32).toString('base64url');
  const session={id:hash(token),userId:user.id,roles:user.roles||[],authVersion:user.authVersion||0,mfaVerifiedAt:mfaVerified?now():null,createdAt:now(),expiresAt:new Date(Date.now()+MAX_AGE*1000).toISOString()};
  await putJson('sessions/'+session.id+'.json',session);
  const sessionCookie=`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;res.setHeader('Set-Cookie',demoEnabled()?[sessionCookie,`__Host-soc_demo=${isDemoTransaction()?'1':''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${isDemoTransaction()?MAX_AGE:0}`]:sessionCookie);
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  return session;
}

export async function destroySession(req,res){
  const c=parseCookies(req); const token=c[COOKIE];
  if(token) await deletePath('sessions/'+hash(token)+'.json');
  const emptyCookie=`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;res.setHeader('Set-Cookie',parseCookies(req)['__Host-soc_demo']?[emptyCookie,'__Host-soc_demo=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']:emptyCookie);
  res.setHeader('Cache-Control','private, no-store, max-age=0');
}

export async function requireUser(req,res,allowedRoles=null,{allowMfaSetup=false}={}){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  const c=parseCookies(req); const token=c[COOKIE];
  if(!token){res.status(401).json({ok:false,error:'unauthorized'});return null;}
  const path='sessions/'+hash(token)+'.json';
  const s=await getJson(path);
  if(!s || !Number.isFinite(Date.parse(s.expiresAt)) || Date.parse(s.expiresAt)<=Date.now()){
    res.status(401).json({ok:false,error:'session_expired'});return null;
  }
  const user=await getJson('users/'+s.userId+'.json');
  if(!user || user.status!=='ACTIVE'){res.status(401).json({ok:false,error:'user_inactive'});return null;}
  if(user.demoAccount&&!isDemoTransaction()){res.status(401).json({ok:false,error:'invalid_session'});return null;}
  if((s.authVersion||0)!==(user.authVersion||0)){res.status(401).json({ok:false,error:'session_revoked'});return null;}
  if(allowedRoles && !allowedRoles.some(r=>(user.roles||[]).includes(r))){res.status(403).json({ok:false,error:'forbidden'});return null;}
  const privileged=(user.roles||[]).some(r=>['CEO','ADMIN','STAFF','FINANCE'].includes(r));
  if(!allowMfaSetup){
    if(process.env.VERCEL_ENV==='production'&&privileged&&!user.mfaEnabled){res.status(403).json({ok:false,error:'mfa_setup_required',message:'계정 보안 화면에서 추가인증을 등록해 주세요.'});return null;}
    if(user.mfaEnabled&&!s.mfaVerifiedAt){res.status(403).json({ok:false,error:'mfa_verification_required',message:'추가인증을 포함하여 다시 로그인해 주세요.'});return null;}
  }
  return user;
}
