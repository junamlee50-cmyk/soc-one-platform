const tournaments=[
{id:'busan-open-2027',name:'SOC BUSAN OPEN 2027',level:'REGIONAL_OPEN',status:'COMING_SOON',fees:{early:49000,regular:59000,late:69000,extra:29000}},
{id:'seoul-major-2027',name:'SOC SEOUL MAJOR 2027',level:'MAJOR',status:'PLANNED',fees:{early:59000,regular:69000,late:79000,extra:35000}}
];
export default function handler(req,res){res.status(200).json({ok:true,tournaments});}
