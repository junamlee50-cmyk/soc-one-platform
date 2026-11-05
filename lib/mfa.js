import crypto from 'node:crypto';
import {getJson,putJson,hash,now} from './blobdb.js';

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
export function totp(secret,at=Date.now(),digits=6){
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(at/30000)));
  const digest=crypto.createHmac('sha1',secret).update(counter).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%(10**digits)).padStart(digits,'0');
}
function key(){const value=process.env.SOC_MFA_ENCRYPTION_KEY||'';if(!/^[a-f0-9]{64}$/i.test(value))throw new Error('mfa_key_not_configured');return Buffer.from(value,'hex');}
export function mfaConfigured(){return /^[a-f0-9]{64}$/i.test(process.env.SOC_MFA_ENCRYPTION_KEY||'');}
export function encryptSecret(secret,userId){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(userId));const encrypted=Buffer.concat([cipher.update(secret),cipher.final()]);return {iv:iv.toString('hex'),data:encrypted.toString('hex'),tag:cipher.getAuthTag().toString('hex')};}
export function decryptSecret(envelope,userId){const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(envelope.iv,'hex'));decipher.setAAD(Buffer.from(userId));decipher.setAuthTag(Buffer.from(envelope.tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(envelope.data,'hex')),decipher.final()]);}
export function matchCounter(secret,code,lastCounter=-1,at=Date.now()){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  const current=Math.floor(at/30000);
  for(const counter of [current,current-1,current+1])if(counter>lastCounter&&crypto.timingSafeEqual(Buffer.from(totp(secret,counter*30000)),Buffer.from(code)))return counter;
  return null;
}
export async function verifyMfa(user,code,recoveryCode){
  const record=await getJson('mfa/'+user.id+'.json');if(!record?.enabledAt)return false;
  if(typeof recoveryCode==='string'&&/^[a-f0-9]{16}$/i.test(recoveryCode)){
    const target=hash(recoveryCode.toLowerCase()),index=(record.recoveryHashes||[]).findIndex(x=>x===target);
    if(index<0)return false;record.recoveryHashes.splice(index,1);
  }else{
    const counter=matchCounter(decryptSecret(record.secret,user.id),code,record.lastCounter??-1);
    if(counter===null)return false;record.lastCounter=counter;
  }
  record.lastVerifiedAt=now();await putJson('mfa/'+user.id+'.json',record);return true;
}
export function recoveryCodes(){const codes=Array.from({length:8},()=>crypto.randomBytes(8).toString('hex'));return {codes,hashes:codes.map(c=>hash(c))};}
