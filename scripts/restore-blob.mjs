// DATABASE_URL must point to an empty, dedicated SOC database. Never paste
// credentials into arguments or logs. The Blob token stays in the environment.
import { get } from '@vercel/blob';
import crypto from 'node:crypto';
import { restoreSnapshot } from '../lib/restore.js';
import { closePool } from '../lib/database.js';
process.env.SOC_DATA_BACKEND='postgres';
try{
  const path=process.env.SOC_BACKUP_PATH,expected=process.env.SOC_BACKUP_SHA256;
  if(!path?.startsWith('backups/')||!/^\w{64}$/.test(expected||''))throw new Error('backup_identity_required');
  const data=await get(path,{access:'private',useCache:false});
  if(data?.statusCode!==200)throw new Error('backup_unavailable');
  const bytes=await new Response(data.stream).text();
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('backup_digest_mismatch');
  const result=await restoreSnapshot(JSON.parse(bytes));
  console.log(JSON.stringify({ok:true,restored:result.count,sourceUnchanged:true}));
}catch{console.error('Restore failed. No partial import was committed. Review the target and backup in the restricted operator environment.');process.exitCode=1;}
finally{await closePool();}
