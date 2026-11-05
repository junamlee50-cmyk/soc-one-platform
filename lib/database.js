import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const context = new AsyncLocalStorage();
let pool;
export const usesPostgres = () => process.env.SOC_DATA_BACKEND === 'postgres';
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('database_not_configured');
  pool ||= new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
  return pool;
}
export const query = (sql, params=[]) => (context.getStore() || getPool()).query(sql,params);
export async function inTransaction(fn,{write=true}={}) {
  if (!usesPostgres()) return fn();
  if (context.getStore()) return fn();
  const client=await getPool().connect();
  try {
    await client.query(write?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL statement_timeout = '25s'");
    // Initial migration serializes writers across all instances. Replace with
    // tournament/division locks after measured contention, never in-memory locks.
    if(write)await client.query('SELECT pg_advisory_xact_lock(20859711)');
    const result=await context.run(client,fn);
    await client.query(result?.statusCode>=400?'ROLLBACK':'COMMIT');
    return result;
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {client.release();}
}
export async function closePool(){if(pool){await pool.end();pool=undefined;}}
