import crypto from 'node:crypto';
import { getJson, putJson, deletePath, hash, now } from './blobdb.js';

const COOKIE='soc_session';
const MAX_AGE=60*60*24*7;

export function parseCookies(req){
  const raw=req.headers?.cookie||'';
  return Object.fromEntries(raw.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf('='); return [decodeURIComponent(x.slice(0,i)),decodeURIComponent(x.slice(i+1))];
  }));
}
export async function createSession(res,user){
  const token=crypto.randomBytes(32).toString('base64url');
  const session={id:hash(token),userId:user.id,roles:user.roles||[],createdAt:now(),expiresAt:new Date(Date.now()+MAX_AGE*1000).toISOString()};
  await putJson('sessions/'+session.id+'.json',session);
  res.setHeader('Set-Cookie',`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
  return session;
}
export async function destroySession(req,res){
  const c=parseCookies(req); const token=c[COOKIE];
  if(token) await deletePath('sessions/'+hash(token)+'.json');
  res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
export async function requireUser(req,res,allowedRoles=null){
  const c=parseCookies(req); const token=c[COOKIE];
  if(!token){res.status(401).json({ok:false,error:'unauthorized'});return null;}
  const s=await getJson('sessions/'+hash(token)+'.json');
  if(!s || new Date(s.expiresAt)<new Date()){res.status(401).json({ok:false,error:'session_expired'});return null;}
  const user=await getJson('users/'+s.userId+'.json');
  if(!user || user.status!=='ACTIVE'){res.status(401).json({ok:false,error:'user_inactive'});return null;}
  if(allowedRoles && !allowedRoles.some(r=>(user.roles||[]).includes(r))){res.status(403).json({ok:false,error:'forbidden'});return null;}
  return user;
}
