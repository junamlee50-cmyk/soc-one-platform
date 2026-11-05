const sample=[
{rank:1,name:'DEMO ATHLETE A',academy:'SOC ACADEMY',belt:'BLACK',weight:'-76kg',points:980},
{rank:2,name:'DEMO ATHLETE B',academy:'CONTROL BJJ',belt:'BROWN',weight:'-82kg',points:920},
{rank:3,name:'DEMO ATHLETE C',academy:'ONE TEAM',belt:'PURPLE',weight:'-70kg',points:875},
{rank:4,name:'DEMO ATHLETE D',academy:'STATE JIU-JITSU',belt:'BLUE',weight:'-64kg',points:820}
];
export default function handler(req,res){
  res.status(200).json({ok:true,season:'2027',demo:true,ranking:sample});
}
