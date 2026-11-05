import { listJson } from '../../lib/blobdb.js';
export default async function handler(req,res){
  const events=await listJson('ranking-events/',5000);
  const sums=new Map();
  for(const e of events){const k=e.athleteUserId;if(!k)continue;const x=sums.get(k)||{athleteUserId:k,points:0,wins:0,medals:0};x.points+=Number(e.finalPoints)||0;if(e.type==='WIN')x.wins++;if(['BRONZE','SILVER','GOLD','ABS_BRONZE','ABS_SILVER','ABS_GOLD'].includes(e.type))x.medals++;sums.set(k,x);}
  const rows=[...sums.values()].sort((a,b)=>b.points-a.points).map((x,i)=>({...x,rank:i+1}));
  return res.status(200).json({ok:true,season:'2027',ranking:rows});
}