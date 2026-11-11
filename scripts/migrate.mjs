import { readFile, readdir } from 'node:fs/promises';
import { getPool, closePool } from '../lib/database.js';
const client=await getPool().connect();
try {await client.query('BEGIN');for(const name of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)).sort())await client.query(await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'));await client.query('COMMIT');console.log('SOC PostgreSQL schema ready. No Blob data was modified.');}
catch(error){await client.query('ROLLBACK');console.error('Migration failed. Database was rolled back; inspect restricted server logs.');process.exitCode=1;}
finally{client.release();await closePool();}
