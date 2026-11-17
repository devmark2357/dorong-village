// Dorong village: the page itself always tries the network first (so updates arrive right away);
// pictures, music and character sheets are kept after the first load so the village opens fast.
const C='dorong-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(e.request.mode==='navigate'||u.pathname.endsWith('/')||u.pathname.endsWith('.html')){e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request)));return;}
  if(u.pathname.includes('/assets/')){e.respondWith(caches.open(C).then(x=>x.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok&&r.status===200)x.put(e.request,r.clone());return r;}))));}});
