import { query, inTransaction } from './database.js';

// Import only into an empty database, in one transaction. Existing operational
// data is never truncated by this utility. Schema constraints are deliberately
// enforced; conflicting legacy records need review, never silent rewriting.
export async function restoreSnapshot(snapshot){
  if(snapshot?.format!=='soc-blob-backup-v1'||!Array.isArray(snapshot.records))throw new Error('invalid_backup_format');
  return inTransaction(async()=>{
    if(Number((await query('SELECT count(*) AS n FROM soc_records')).rows[0].n)!==0)throw new Error('restore_target_not_empty');
    const paths=new Set();
    for(const record of snapshot.records){
      if(!record||typeof record.path!=='string'||paths.has(record.path)||!record.value||Array.isArray(record.value)||typeof record.value!=='object')throw new Error('invalid_backup_record');
      paths.add(record.path);
      await query('INSERT INTO soc_records(path,value) VALUES ($1,$2::jsonb)',[record.path,JSON.stringify(record.value)]);
    }
    const count=Number((await query('SELECT count(*) AS n FROM soc_records')).rows[0].n);
    if(count!==snapshot.records.length)throw new Error('restore_count_mismatch');
    return {count};
  });
}
