import {demoEnabled,isDemoTransaction} from './database.js';
import {getJson,putJson,hash,passwordHash,now} from './blobdb.js';
// Deliberately public credentials, valid only for the isolated demo database.
export const DEMO_EMAIL='admin@soc-demo.test';
export const DEMO_PASSWORD='SOC-Demo-2026!';
export function demoAccess(){return demoEnabled()?{enabled:true,active:isDemoTransaction(),email:DEMO_EMAIL,password:DEMO_PASSWORD}:{enabled:false,active:false};}
export async function ensureDemoAccount(password){
 if(!demoEnabled()||!isDemoTransaction()||password!==DEMO_PASSWORD)return;
 if(await getJson('users/demo-admin.json'))return;
 const ph=passwordHash(DEMO_PASSWORD),user={id:'demo-admin',socId:'SOC-DEMO-ADMIN',name:'테스트 관리자',email:DEMO_EMAIL,emailKey:hash(DEMO_EMAIL),roles:['CEO','ADMIN','ATHLETE','COACH','MEMBER'],status:'ACTIVE',demoAccount:true,emailVerifiedAt:now(),passwordSalt:ph.salt,passwordHash:ph.hash,createdAt:now()};
 await putJson('users/demo-admin.json',user,{overwrite:false});await putJson('user-email/'+user.emailKey+'.json',{userId:user.id,emailKey:user.emailKey,createdAt:now()},{overwrite:false});
 await putJson('athletes/demo-admin.json',{userId:user.id,socId:user.socId,displayName:'테스트 관리자',birthDate:'1990-01-01',belt:'WHITE',gender:'MALE',defaultWeightKg:69,academyName:'',academyId:'',publicProfile:false},{overwrite:false});
}
