import { query, usesPostgres } from './database.js';
import { put, get, list, del, BlobNotFoundError } from '@vercel/blob';
import crypto from 'node:crypto';

export const hash = (v='') => crypto.createHash('sha256').update(String(v)).digest('hex');
export const now = () => new Date().toISOString();

export async function putJson(path, value, {overwrite=true}={}) {
  if(usesPostgres()){
    const conflict=overwrite?' ON CONFLICT(path) DO UPDATE SET value=excluded.value,updated_at=now()':'';
    await query('INSERT INTO soc_records(path,value) VALUES ($1,$2::jsonb)'+conflict,[path,JSON.stringify(value)]);
    return {pathname:path};
  }
  return put(path, JSON.stringify(value), {
    access:'private',
    contentType:'application/json',
    addRandomSuffix:false,
    allowOverwrite:overwrite
  });
}

export async function getJson(path) {
  if(usesPostgres())return (await query('SELECT value FROM soc_records WHERE path=$1',[path])).rows[0]?.value??null;
  try{
    const r = await get(path,{access:'private',useCache:false});
    if (!r || r.statusCode === 404) return null;
    if (r.statusCode !== 200) throw new Error('storage_read_failed');
    const text = await new Response(r.stream).text();
    return JSON.parse(text);
  }catch(error){if(error instanceof BlobNotFoundError)return null;throw error;}
}

export async function listJson(prefix, _legacyLimit=1000, filter={}) {
  if(usesPostgres()){
    // Keyset pages remove the old silent 1,000/3,000/10,000-row cutoffs.
    const rows=[];let after='';
    while(true){
      const page=await query('SELECT path,value FROM soc_records WHERE collection=$1 AND path>$2 AND value @> $3::jsonb ORDER BY path LIMIT 500',[prefix.replace(/\/$/,''),after,JSON.stringify(filter)]);
      rows.push(...page.rows.map(x=>x.value));
      if(page.rows.length<500)break;
      after=page.rows.at(-1).path;
    }
    return rows;
  }
  let cursor;const rows=[];
  do {
    const r=await list({prefix,limit:1000,cursor});
    for(const b of r.blobs||[]) {
      const v=await getJson(b.pathname);
      if(v&&Object.entries(filter).every(([key,value])=>v[key]===value))rows.push(v);
    }
    cursor=r.cursor;
  } while(cursor);
  return rows;
}

export async function deletePath(path){if(usesPostgres())await query('DELETE FROM soc_records WHERE path=$1',[path]);else await del(path);}

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
