import { put, get, list, del } from '@vercel/blob';
import crypto from 'node:crypto';

export const hash = (v='') => crypto.createHash('sha256').update(String(v)).digest('hex');
export const now = () => new Date().toISOString();

export async function putJson(path, value, {overwrite=true}={}) {
  return put(path, JSON.stringify(value), {
    access:'private',
    contentType:'application/json',
    addRandomSuffix:false,
    allowOverwrite:overwrite
  });
}

export async function getJson(path) {
  try{
    const r = await get(path,{access:'private'});
    if (!r || r.statusCode !== 200) return null;
    const text = await new Response(r.stream).text();
    return JSON.parse(text);
  }catch{return null;}
}

export async function listJson(prefix, limit=1000) {
  let cursor;
  const rows=[];
  do {
    const r=await list({prefix,limit:Math.min(1000,limit-rows.length),cursor});
    for(const b of r.blobs||[]) {
      const v=await getJson(b.pathname);
      if(v) rows.push(v);
      if(rows.length>=limit) break;
    }
    cursor=r.cursor;
  } while(cursor && rows.length<limit);
  return rows;
}

export async function deletePath(path){ try{await del(path);}catch{} }

export const clean=(v,max=160)=>typeof v==='string'?v.trim().replace(/[<>]/g,'').slice(0,max):'';
export const makeId=(prefix='id')=>prefix+'_'+crypto.randomUUID();
export const makeSocId=()=> 'SOC-'+crypto.randomBytes(5).toString('hex').toUpperCase();

export function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')){
  const derived=crypto.scryptSync(password,salt,64).toString('hex');
  return {salt,hash:derived};
}
export function verifyPassword(password,salt,expected){
  const got=crypto.scryptSync(password,salt,64);
  const exp=Buffer.from(expected,'hex');
  return got.length===exp.length && crypto.timingSafeEqual(got,exp);
}
