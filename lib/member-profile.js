import {getJson,listJson,clean} from './blobdb.js';
export function normalizeBirthDate(value){
 if(typeof value!=='string')return null;
 const digits=value.replace(/[.\s/-]/g,'');if(!/^\d{8}$/.test(digits))return null;
 const date=digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6);
 const time=Date.parse(date);if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date)return null;
 if(date<'1900-01-01'||date>new Date(Date.now()+9*3600000).toISOString().slice(0,10))return null;
 return date;
}
export const ownsAcademy=(a,u)=>a.coachUserId===u.id||a.adminUserIds?.includes(u.id);
export async function memberProfile(user){
 const saved=await getJson('athletes/'+user.id+'.json'),all=await listJson('academies/');
 const owned=all.filter(a=>ownsAcademy(a,user)&&a.active!==false);
 const options=all.filter(a=>a.active!==false&&(a.status==='APPROVED'||ownsAcademy(a,user))).map(({id,name,region,status})=>({id,name,region,status}));
 const profile=saved?{...saved}:{userId:user.id,socId:user.socId,displayName:user.name,belt:'WHITE'};
 if(!profile.affiliationSet&&!profile.academyId&&!profile.academyName&&owned.length===1){profile.academyId=owned[0].id;profile.academyName=owned[0].name;profile.inferredAcademy=true;}
 const academy=all.find(a=>a.id===profile.academyId);
 profile.academyStatus=academy?.status||(profile.academyName?'SELF_REPORTED':'NONE');
 if(academy)profile.academyName=academy.name;
 return {athlete:profile,academies:options,managedAcademies:owned.map(({id,name,region,status})=>({id,name,region,status}))};
}
export async function resolveAffiliation(body,previous,user){
 const id=body.academyId===undefined?(previous?.academyId||''):clean(body.academyId,80);
 if(id){const academy=await getJson('academies/'+id+'.json');if(!academy||academy.active===false||academy.status!=='APPROVED'&&!ownsAcademy(academy,user))return {error:'academy_not_available',message:'선택한 도장의 등록 상태를 확인해 주세요.'};return {academyId:id,academyName:academy.name,academyStatus:academy.status};}
 const name=body.academyName===undefined?(previous?.academyName||''):clean(body.academyName,160);
 return {academyId:'',academyName:name,academyStatus:name?'SELF_REPORTED':'NONE'};
}
