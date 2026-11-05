export default function handler(req,res){
  const role=(req.query.role||'athlete').toLowerCase();
  const data={
    athlete:{ranking:'#12',points:620,record:'14W 4L',support:'78/100'},
    academy:{members:86,activeAthletes:23,teamRanking:'#4',nextEvent:12},
    region:{kpi:84,grade:'A',academies:18,rank:'#3'},
    referee:{grade:'B',matches:42,rating:4.8,assignments:3},
    ceo:{members:1284,academies:118,monthlyRevenue:42600000,cash:71200000}
  };
  res.status(200).json({ok:true,role,data:data[role]||data.athlete,demo:true});
}
