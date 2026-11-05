const CACHE='soc-one-public-v3';
const PUBLIC_ASSETS=[
  '/','/index.html','/competition.html','/academies.html','/ranking.html','/support.html','/pro.html','/global.html','/media.html','/gear.html','/rules.html','/sponsors.html','/talent.html',
  '/assets/soc.css','/assets/soc.js','/favicon.svg','/manifest.webmanifest','/offline.html'
];
const PRIVATE_PATHS=[
  '/my-soc.html','/setup.html','/admin.html','/athlete-app.html','/academy-app.html','/region-app.html','/referee-app.html','/ceo-app.html','/tournament-ops.html'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC_ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/api/')||PRIVATE_PATHS.includes(url.pathname)){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }
  if(PUBLIC_ASSETS.includes(url.pathname)){
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
      return response;
    }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('/offline.html'))));
    return;
  }
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
  }
});
