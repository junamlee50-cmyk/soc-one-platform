import { listJson } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const u=await requireUser(req,res,['STAFF','ADMIN','CEO','REFEREE']);if(!u)return;
  const tournamentId=String(req.query.tournamentId||'');let rows=await listJson('matches/',10000);if(tournamentId)rows=rows.filter(x=>x.tournamentId===tournamentId);rows.sort((a,b)=>(a.roundNo-b.roundNo)||(a.sequenceNo-b.sequenceNo));
  return res.status(200).json({ok:true,matches:rows});
}