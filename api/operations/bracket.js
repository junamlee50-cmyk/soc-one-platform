import { listJson, putJson, getJson, clean, makeId, hash, now } from '../../lib/blobdb.js';
import { requireUser } from '../../lib/auth.js';

const nextPow2=n=>{let x=1;while(x<n)x*=2;return x};
function seededSlots(rows,size,seed){
  const ordered=[...rows].sort((a,b)=>hash(seed+a.socId).localeCompare(hash(seed+b.socId)));
  const slots=Array(size).fill(null);
  ordered.forEach((r,i)=>{slots[Math.floor(i*size/ordered.length)]={userId:r.userId,socId:r.socId,name:r.athleteName,academyId:r.academyId||''}});
  return slots;
}
async function propagateBye(match,matchMap){
  const a=match.athleteA,b=match.athleteB;
  if((a&&!b)||(!a&&b)){
    const winner=a||b; match.winnerUserId=winner.userId;match.status='BYE';match.endedAt=now();
    await putJson('matches/'+match.id+'.json',match);
    if(match.nextMatchId){
      const next=matchMap.get(match.nextMatchId)||await getJson('matches/'+match.nextMatchId+'.json');
      if(next){if(match.nextSlot==='A')next.athleteA=winner;else next.athleteB=winner;await putJson('matches/'+next.id+'.json',next);matchMap.set(next.id,next);}
    }
  }
}
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const user=await requireUser(req,res,['STAFF','ADMIN','CEO']); if(!user)return;
  const b=req.body||{}; const tournamentId=clean(b.tournamentId,80),divisionKey=clean(b.divisionKey,80);
  if(!tournamentId||!divisionKey)return res.status(400).json({ok:false,error:'required_fields'});
  const regs=(await listJson('registrations/',5000)).filter(x=>x.tournamentId===tournamentId&&x.divisionKey===divisionKey&&x.status==='REGISTERED'&&x.paymentStatus==='PAID'&&x.weighInStatus==='PASSED');
  if(regs.length<2)return res.status(400).json({ok:false,error:'not_enough_eligible_athletes',count:regs.length});
  const bracketId=makeId('brk'),size=nextPow2(regs.length),roundCount=Math.log2(size),roundIds=[];
  for(let r=0;r<roundCount;r++){const count=size/(2**(r+1));roundIds.push(Array.from({length:count},()=>makeId('mat')));}
  const slots=seededSlots(regs,size,tournamentId+divisionKey),matches=[],map=new Map();
  for(let r=0;r<roundCount;r++){
    for(let i=0;i<roundIds[r].length;i++){
      const id=roundIds[r][i], nextId=r<roundCount-1?roundIds[r+1][Math.floor(i/2)]:null;
      const m={id,bracketId,tournamentId,divisionKey,roundNo:r+1,sequenceNo:i+1,
        athleteA:r===0?slots[i*2]:null,athleteB:r===0?slots[i*2+1]:null,
        sourceMatchA:r===0?null:roundIds[r-1][i*2],sourceMatchB:r===0?null:roundIds[r-1][i*2+1],
        nextMatchId:nextId,nextSlot:nextId?(i%2===0?'A':'B'):null,winnerUserId:null,status:'SCHEDULED',createdAt:now()};
      matches.push(m);map.set(id,m);
    }
  }
  const bracket={id:bracketId,tournamentId,divisionKey,athleteCount:regs.length,bracketSize:size,roundCount,status:'PUBLISHED',createdBy:user.id,createdAt:now(),rounds:roundIds};
  await putJson('brackets/'+bracketId+'.json',bracket,{overwrite:false});
  for(const m of matches)await putJson('matches/'+m.id+'.json',m,{overwrite:false});
  for(const m of matches.filter(x=>x.roundNo===1))await propagateBye(m,map);
  return res.status(201).json({ok:true,bracket,matches:[...map.values()]});
}