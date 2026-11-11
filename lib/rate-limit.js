import crypto from 'node:crypto';
import {getPool} from './database.js';

// This autocommit update runs BEFORE the API transaction: an invalid password
// must not roll back its own attempt counter. Counters contain hashes only.
export async function consumeAuthAttempt(operation,email,{demo=false}={}){
  const key=crypto.createHash('sha256').update(operation+'|'+String(email||'').trim().toLowerCase()).digest('hex');
  const result=await getPool({demo}).query(`
    INSERT INTO soc_auth_attempts(bucket,attempts,reset_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN soc_auth_attempts.reset_at<=now() THEN 1 ELSE soc_auth_attempts.attempts+1 END,
      reset_at=CASE WHEN soc_auth_attempts.reset_at<=now() THEN now()+interval '15 minutes' ELSE soc_auth_attempts.reset_at END
    RETURNING attempts,reset_at`,[key]);
  const row=result.rows[0],limit=operation==='login'?10:5;
  return {allowed:row.attempts<=limit,retryAfter:Math.max(1,Math.ceil((new Date(row.reset_at).getTime()-Date.now())/1000))};
}
