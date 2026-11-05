import { listJson } from '../lib/blobdb.js';
export default async function handler(req,res){
 const rows=(await listJson('content/',3000)).filter(x=>x.status==='PUBLISHED').sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||''))).slice(0,100);
 return res.status(200).json({ok:true,content:rows.map(({id,type,title,summary,coverUrl,publishedAt,athleteSocId,academyId})=>({id,type,title,summary,coverUrl,publishedAt,athleteSocId,academyId}))});
}