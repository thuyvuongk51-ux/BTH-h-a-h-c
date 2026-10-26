// Hải Chiến Bo: serves the game page and relays room presence between players over WebSocket.
// The match itself still runs on the room host's device; this server only passes state along, quickly and evenly.
const http=require('http'), fs=require('fs'), path=require('path'), {WebSocketServer}=require('ws');
const PORT=process.env.PORT||10000, PUB=path.join(__dirname,'public');
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png','.json':'application/json','.ico':'image/x-icon'};

const server=http.createServer((req,res)=>{
  let p=decodeURIComponent((req.url||'/').split('?')[0]);
  if(p==='/api/admin' && req.method==='POST'){
    let b=''; req.on('data',c=>{ b+=c; if(b.length>200) req.destroy(); });
    req.on('end',()=>{ const key=process.env.ADMIN_KEY||''; res.writeHead(200,{'content-type':'text/plain'}); res.end(key.length>=6 && b===key ? 'yes' : 'no'); });
    return;
  }
  if(p==='/health'){ res.writeHead(200,{'content-type':'text/plain'}); res.end('ok'); return; }
  if(p==='/') p='/index.html';
  const f=path.normalize(path.join(PUB,p));
  if(!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});
  fs.createReadStream(f).pipe(res);
});

// rooms: name -> Map(peer -> {ws, pres, at})
const rooms=new Map();
const MAX_MSG=64*1024, MAX_ROOMS_PER_PEER=16;
const send=(ws,o)=>{ if(ws.readyState===1) ws.send(typeof o==='string'?o:JSON.stringify(o)); };
function others(name,peer,msg){ const r=rooms.get(name); if(!r) return; const s=JSON.stringify(msg); for(const [id,m] of r) if(id!==peer) send(m.ws,s); }
function leave(ws,name){
  const r=rooms.get(name); if(!r || !r.has(ws.peer)) return;
  r.delete(ws.peer); ws.rooms.delete(name);
  if(!r.size) rooms.delete(name); else others(name,ws.peer,{t:'left',room:name,peer:ws.peer});
}
const wss=new WebSocketServer({server, path:'/ws', maxPayload:MAX_MSG});
let next=1;
wss.on('connection',ws=>{
  ws.peer='p'+(next++).toString(36)+Math.random().toString(36).slice(2,6);
  ws.rooms=new Set(); ws.alive=true;
  ws.on('pong',()=>{ ws.alive=true; });
  send(ws,{t:'hello',peer:ws.peer});
  ws.on('message',buf=>{
    let m; try{ m=JSON.parse(buf); }catch(_){ return; }
    if(!m || typeof m.room!=='string' || m.room.length>64) return;
    const name=m.room;
    if(m.t==='join'){
      if(ws.rooms.size>=MAX_ROOMS_PER_PEER && !ws.rooms.has(name)) return;
      const r=rooms.get(name)||new Map(); rooms.set(name,r);
      if(!r.has(ws.peer)){ r.set(ws.peer,{ws, pres:{}, at:Date.now()}); ws.rooms.add(name); }
      send(ws,{t:'peers',room:name,list:[...r].filter(([id])=>id!==ws.peer).map(([id,x])=>({peer:id,pres:x.pres,at:x.at}))});
      others(name,ws.peer,{t:'p',room:name,peer:ws.peer,pres:{},at:Date.now()});
    } else if(m.t==='p'){
      const r=rooms.get(name), me=r&&r.get(ws.peer); if(!me || !m.pres || typeof m.pres!=='object') return;
      me.pres=m.pres; me.at=Date.now();
      others(name,ws.peer,{t:'p',room:name,peer:ws.peer,pres:m.pres,at:me.at});
    } else if(m.t==='leave') leave(ws,name);
  });
  ws.on('close',()=>{ for(const name of [...ws.rooms]) leave(ws,name); });
});
// drop connections that stopped answering, and keep idle ones from being cut by proxies
setInterval(()=>{ for(const ws of wss.clients){ if(!ws.alive){ ws.terminate(); continue; } ws.alive=false; try{ ws.ping(); }catch(_){} } },20000);
server.listen(PORT,()=>console.log('Hải Chiến Bo on port '+PORT));
