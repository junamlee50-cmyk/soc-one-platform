// Credential input is stdin only. Output contains counts and private backup metadata,
// never account/session contents or environment values.
import { list, get, put } from '@vercel/blob';
import crypto from 'node:crypto';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdout.write('Ready for credential JSON on stdin (input hidden).\n');
let input='';
process.stdin.on('data',async chunk=>{
 input+=chunk.toString();if(!input.includes('\n'))return;process.stdin.pause();
 try{
  const {token,backup=false}=JSON.parse(input.trim());input='';
  const snapshot={format:'soc-blob-backup-v1',storeId:'store_96F26w4rmj4ycIB8',createdAt:new Date().toISOString(),records:[]};
  let cursor;const counts={};
  do{
   const page=await list({token,limit:1000,cursor});cursor=page.cursor;
   for(const entry of page.blobs){
    if(entry.pathname.startsWith('backups/'))continue;
    const data=await get(entry.pathname,{token,access:'private',useCache:false});
    if(!data||data.statusCode!==200)throw new Error('inventory_read_failed');
    const value=JSON.parse(await new Response(data.stream).text());
    snapshot.records.push({path:entry.pathname,value});
    const group=entry.pathname.split('/')[0];counts[group]=(counts[group]||0)+1;
   }
  }while(cursor);
  const bytes=JSON.stringify(snapshot),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  let backupPath=null;
  if(backup){backupPath='backups/soc-'+snapshot.createdAt.replace(/[:.]/g,'-')+'.json';await put(backupPath,bytes,{token,access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});const verified=await get(backupPath,{token,access:'private',useCache:false});const restored=await new Response(verified.stream).text();if(crypto.createHash('sha256').update(restored).digest('hex')!==sha256)throw new Error('backup_verification_failed');}
  process.stdout.write(JSON.stringify({ok:true,total:snapshot.records.length,counts,backupPath,sha256,backupVerified:backup})+'\n');process.exit(0);
 }catch{process.stdout.write(JSON.stringify({ok:false,error:'inventory_or_backup_failed'})+'\n');process.exit(1);}
});
