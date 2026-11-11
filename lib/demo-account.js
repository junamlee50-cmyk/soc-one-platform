import {demoEnabled,isDemoTransaction} from './database.js';
import {getJson,putJson,hash,passwordHash,now} from './blobdb.js';
// Deliberately public credentials, valid only for the isolated demo database.
export const DEMO_EMAIL='admin@soc-demo.test';
export const DEMO_PASSWORD='SOC-Demo-2026!';
export const DEMO_PERSONAS=[
 {id:'demo-admin',email:DEMO_EMAIL,name:'테스트 관리자',roles:['CEO','ADMIN','ATHLETE','COACH','MEMBER']},
 {id:'demo-reviewer',email:'reviewer@soc-demo.test',name:'테스트 승인 관리자',roles:['ADMIN','FINANCE']},
 {id:'demo-coach',email:'coach@soc-demo.test',name:'테스트 관장',roles:['COACH','ATHLETE','MEMBER']},
 {id:'demo-athlete',email:'athlete@soc-demo.test',name:'테스트 선수',roles:['ATHLETE','MEMBER']},
 {id:'demo-member',email:'member@soc-demo.test',name:'테스트 일반회원',roles:['MEMBER']}
];
export const isDemoEmail=email=>DEMO_PERSONAS.some(p=>p.email===email);
export function demoAccess(){return demoEnabled()?{enabled:true,active:isDemoTransaction(),email:DEMO_EMAIL,password:DEMO_PASSWORD,personas:DEMO_PERSONAS.map(({email,name})=>({email,name}))}:{enabled:false,active:false};}
export async function ensureDemoAccount(password,email=DEMO_EMAIL){
 const persona=DEMO_PERSONAS.find(p=>p.email===email);
 if(!demoEnabled()||!isDemoTransaction()||password!==DEMO_PASSWORD||!persona)return;
 if(await getJson('users/'+persona.id+'.json'))return;
 const ph=passwordHash(DEMO_PASSWORD),user={...persona,socId:'SOC-'+persona.id.toUpperCase(),emailKey:hash(email),status:'ACTIVE',demoAccount:true,emailVerifiedAt:now(),passwordSalt:ph.salt,passwordHash:ph.hash,createdAt:now()};
 await putJson('users/'+user.id+'.json',user,{overwrite:false});await putJson('user-email/'+user.emailKey+'.json',{userId:user.id,emailKey:user.emailKey,createdAt:now()},{overwrite:false});
 if(persona.roles.includes('ATHLETE'))await putJson('athletes/'+user.id+'.json',{userId:user.id,socId:user.socId,displayName:user.name,birthDate:'1990-01-01',belt:'WHITE',gender:'MALE',defaultWeightKg:69,academyName:'',academyId:'',publicProfile:false},{overwrite:false});
}
