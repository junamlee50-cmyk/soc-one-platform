import { listJson, putJson, clean, makeId, hash, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

function order(rows,seed){
  return [...rows].sort((a,b)=>hash(seed+a.socId).localeCompare(hash(seed+b.socId)));
}
function separateAcademies(rows){
  const out=[]; const pool=[...rows];
  while(pool.length){
    const last=out.at(-1); let i=pool.findIndex(x=>!last || !x.academyId || x.academyId!==last.academyId);
    if(i<0)i=0; out.push(pool.splice(i,1)[0]);
  }
  return out;
}
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const user=await requireUser(req,res,['STAFF','ADMIN','CEO']); if(!user)return;
  const b=req.body||{}; const tournamentId=clean(b.tournamentId,80),divisionKey=clean(b.divisionKey,80);
  if(!tournamentId||!divisionKey) return res.status(400).json({ok:false,error:'required_fields'});
  let regs=(await listJson('registrations/',2000)).filter(x=>x.tournamentId===tournamentId&&x.divisionKey===divisionKey&&x.status==='REGISTERED'&&x.weighInStatus!=='FAILED');
  if(regs.length<2)return res.status(400).json({ok:false,error:'not_enough_athletes',count:regs.length});
  regs=separateAcademies(order(regs,tournamentId+divisionKey));
  const bracketId=makeId('brk'), matches=[]; let round=1, current=regs.map(x=>({userId:x.userId,socId:x.socId,name:x.athleteName,academyId:x.academyId}));
  let seq=1;
  while(current.length>1){
    const next=[];
    for(let i=0;i<current.length;i+=2){
      const a=current[i], b=current[i+1]||null;
      if(!b){next.push(a);continue;}
      const m={id:makeId('mat'),bracketId,tournamentId,divisionKey,roundNo:round,sequenceNo:seq++,athleteA:a,athleteB:b,winnerUserId:null,status:'SCHEDULED',createdAt:now()};
      matches.push(m); next.push({sourceMatchId:m.id,userId:null,socId:null,name:'TBD',academyId:null});
    }
    current=next; round++;
  }
  const bracket={id:bracketId,tournamentId,divisionKey,athleteCount:regs.length,status:'PUBLISHED',createdBy:user.id,createdAt:now(),matchIds:matches.map(x=>x.id)};
  await putJson('brackets/'+bracketId+'.json',bracket,{overwrite:false});
  for(const m of matches)await putJson('matches/'+m.id+'.json',m,{overwrite:false});
  return res.status(201).json({ok:true,bracket,matches});
}