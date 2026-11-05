import { readFile } from 'node:fs/promises';
import { getPool, closePool } from '../lib/database.js';
const client=await getPool().connect();
try {await client.query('BEGIN');await client.query(await readFile(new URL('../db/migrations/001_operational_records.sql',import.meta.url),'utf8'));await client.query('COMMIT');console.log('SOC PostgreSQL schema ready. No Blob data was modified.');}
catch(error){await client.query('ROLLBACK');console.error('Migration failed. Database was rolled back; inspect restricted server logs.');process.exitCode=1;}
finally{client.release();await closePool();}
