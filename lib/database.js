import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const context = new AsyncLocalStorage();
let pool,demoPool;
export const usesPostgres = () => process.env.SOC_DATA_BACKEND === 'postgres';
export function demoEnabled(){
 if(process.env.VERCEL_ENV!=='preview'||process.env.SOC_PREVIEW_ISOLATED!=='true'||process.env.SOC_DEMO_ENABLED!=='true'||!usesPostgres())return false;
 try{const real=new URL(process.env.DATABASE_URL),demo=new URL(process.env.SOC_DEMO_DATABASE_URL);return demo.pathname==='/soc_demo'&&real.pathname!=='/soc_demo'&&['postgres:','postgresql:'].includes(demo.protocol);}catch{return false;}
}
export const isDemoTransaction=()=>context.getStore()?.socDemo===true;
export function getPool({demo=false}={}) {
  if(demo){if(!demoEnabled())throw new Error('demo_disabled');demoPool ||= new pg.Pool({connectionString:process.env.SOC_DEMO_DATABASE_URL,max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});return demoPool;}
  if (!process.env.DATABASE_URL) throw new Error('database_not_configured');
  pool ||= new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
  return pool;
}
export const query = (sql, params=[]) => (context.getStore() || getPool()).query(sql,params);
export async function inTransaction(fn,{write=true,demo=false}={}) {
  if (!usesPostgres()) return fn();
  if (context.getStore()) return fn();
  const client=await getPool({demo}).connect();client.socDemo=demo;
  try {
    await client.query(write?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL statement_timeout = '25s'");
    if(demo){const check=await client.query("SELECT current_database() AS name, (SELECT value->>'isolated' FROM soc_records WHERE path='system/demo-environment.json') AS isolated");if(check.rows[0]?.name!=='soc_demo'||check.rows[0]?.isolated!=='true')throw new Error('demo_database_not_isolated');}
    // Initial migration serializes writers across all instances. Replace with
    // tournament/division locks after measured contention, never in-memory locks.
    if(write)await client.query('SELECT pg_advisory_xact_lock(20859711)');
    const result=await context.run(client,fn);
    await client.query(result?.statusCode>=400?'ROLLBACK':'COMMIT');
    return result;
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {client.release();}
}
export async function closePool(){if(pool){await pool.end();pool=undefined;}if(demoPool){await demoPool.end();demoPool=undefined;}}
