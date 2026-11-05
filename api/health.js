export default function handler(req,res){
  res.status(200).json({
    ok:true,
    service:'SOC ONE',
    environment:process.env.VERCEL_ENV || 'unknown',
    timestamp:new Date().toISOString(),
    version:'1.0.0-prelaunch'
  });
}