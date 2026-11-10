import {getJson,listJson} from './blobdb.js';
import {memberProfile} from './member-profile.js';
import {youtubeUrl} from './match-video.js';
export async function memberHistory(user){
 const [profile,registrations,tournaments,matches,medals,events]=await Promise.all([memberProfile(user),listJson('registrations/',1000,{userId:user.id}),listJson('tournaments/'),listJson('matches/'),listJson('medals/',1000,{athleteUserId:user.id}),listJson('ranking-events/',1000,{athleteUserId:user.id})]);
 const mine=matches.filter(m=>[m.athleteA?.userId,m.athleteB?.userId].includes(user.id));
 const ids=new Set([...registrations.map(r=>r.tournamentId),...mine.map(m=>m.tournamentId),...medals.map(m=>m.tournamentId)]);
 const history=[];
 for(const id of ids){
  const t=tournaments.find(t=>t.id===id),results=mine.filter(m=>m.tournamentId===id);
  const awards=medals.filter(m=>m.tournamentId===id&&!m.voidedAt&&results.some(r=>r.id===m.matchId&&r.status==='COMPLETED'));
  history.push({tournamentId:id,name:t?.name||'대회 기록',date:t?.startAt||null,venue:t?.venueName||'',
   registrations:registrations.filter(r=>r.tournamentId===id).map(({id,discipline,ageGroup,belt,weightClass,absolute,status,paymentStatus,amount})=>({id,discipline,ageGroup,belt,weightClass,absolute,status,paymentStatus,amount})),
   awards:awards.map(({medal,divisionKey,absolute})=>({medal,divisionKey,absolute})),
   matches:results.map(m=>{const opponent=m.athleteA?.userId===user.id?m.athleteB:m.athleteA;return {id:m.id,roundNo:m.roundNo,sequenceNo:m.sequenceNo,divisionKey:m.divisionKey,status:m.status,opponent:opponent?.name||'상대 미정',result:m.status==='BYE'?'BYE':m.status==='COMPLETED'?(m.winnerUserId===user.id?'WIN':'LOSS'):'PENDING',winMethod:m.winMethod||'',endedAt:m.endedAt||null,scoreA:m.scoreA||'',scoreB:m.scoreB||'',videoUrl:youtubeUrl(m.videoUrl)||null};}),
   points:events.filter(e=>e.tournamentId===id&&!e.voidedAt).reduce((n,e)=>n+(Number(e.finalPoints)||0),0)});
 }
 history.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 return {...profile,history,summary:{tournaments:history.length,wins:mine.filter(m=>m.status==='COMPLETED'&&m.winnerUserId===user.id).length,gold:history.reduce((n,t)=>n+t.awards.filter(a=>a.medal==='GOLD').length,0),medals:history.reduce((n,t)=>n+t.awards.length,0)}};
}
