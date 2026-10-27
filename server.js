// Hải Chiến Bo: serves the game page, keeps player accounts (nick + password, results, leaderboard)
// and relays room presence between players over WebSocket.
// The match itself still runs on the room host's device; this server only passes state along, quickly and evenly.
const http=require('http'), fs=require('fs'), path=require('path'), crypto=require('crypto'), {WebSocketServer}=require('ws');
const PORT=process.env.PORT||10000, PUB=path.join(__dirname,'public');
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png','.json':'application/json','.ico':'image/x-icon'};

/* ---------- storage: Postgres when DATABASE_URL is set, otherwise a JSON file (wiped whenever Render restarts the server) ---------- */
function pgStore(url){
  const {Pool}=require('pg');
  const u=new URL(url); u.searchParams.delete('sslmode');
  const local=/^(localhost|127\.|::1)/.test(u.hostname);
  const pool=new Pool({connectionString:u.toString(), ssl:local?false:{rejectUnauthorized:false}, max:5});
  const q=(t,v)=>pool.query(t,v).then(r=>r.rows);
  const ready=q(`create table if not exists hcb_users(
      id serial primary key, slug text not null unique, nick text not null, pass text not null,
      games int not null default 0, wins int not null default 0, kills int not null default 0, online_games int not null default 0,
      best_place int, created_at timestamptz not null default now(), last_played timestamptz);
    create table if not exists hcb_sessions(token text primary key, user_id int not null references hcb_users(id) on delete cascade, created_at timestamptz not null default now());`);
  const go=f=>(...a)=>ready.then(()=>f(...a));
  return { kind:'postgres', ready,
    bySlug:go(async s=>(await q('select * from hcb_users where slug=$1',[s]))[0]||null),
    byId:go(async id=>(await q('select * from hcb_users where id=$1',[id]))[0]||null),
    create:go(async (slug,nick,pass)=>(await q('insert into hcb_users(slug,nick,pass) values($1,$2,$3) on conflict(slug) do nothing returning *',[slug,nick,pass]))[0]||null),
    record:go(async (id,r)=>{ await q(`update hcb_users set games=games+1, wins=wins+$2, kills=kills+$3, online_games=online_games+$4,
      best_place=least(coalesce(best_place,99),$5), last_played=now() where id=$1`,[id,r.win?1:0,r.kills,r.online?1:0,r.place]); }),
    top:go(()=>q('select nick,games,wins,kills from hcb_users order by wins desc, kills desc, games asc limit 20')),
    addSession:go(async (h,id)=>{ await q('insert into hcb_sessions(token,user_id) values($1,$2)',[h,id]); }),
    session:go(async h=>(await q('select user_id from hcb_sessions where token=$1',[h]))[0]?.user_id||null),
    dropSession:go(async h=>{ await q('delete from hcb_sessions where token=$1',[h]); }),
  };
}
function fileStore(file){
  let d={users:[], sessions:{}, next:1};
  try{ d=JSON.parse(fs.readFileSync(file,'utf8')); }catch(_){}
  let t=null; const save=()=>{ if(!t) t=setTimeout(()=>{ t=null; fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(d)); },500); };
  const byId=id=>d.users.find(u=>u.id===id)||null;
  return { kind:'file', ready:Promise.resolve(),
    bySlug:async s=>d.users.find(u=>u.slug===s)||null,
    byId:async id=>byId(id),
    create:async (slug,nick,pass)=>{ if(d.users.some(u=>u.slug===slug)) return null; const u={id:d.next++, slug, nick, pass, games:0, wins:0, kills:0, online_games:0, best_place:null}; d.users.push(u); save(); return u; },
    record:async (id,r)=>{ const u=byId(id); if(!u) return; u.games++; u.wins+=r.win?1:0; u.kills+=r.kills; u.online_games+=r.online?1:0; u.best_place=Math.min(u.best_place||99,r.place); u.last_played=new Date().toISOString(); save(); },
    top:async ()=>[...d.users].sort((a,b)=>b.wins-a.wins||b.kills-a.kills||a.games-b.games).slice(0,20).map(({nick,games,wins,kills})=>({nick,games,wins,kills})),
    addSession:async (h,id)=>{ d.sessions[h]=id; save(); },
    session:async h=>d.sessions[h]||null,
    dropSession:async h=>{ delete d.sessions[h]; save(); },
  };
}
const db=process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore(path.join(__dirname,'data','accounts.json'));
db.ready.then(()=>console.log('accounts stored in '+db.kind),e=>console.error('database error',e.message));

/* ---------- accounts ---------- */
// nicks are unique by their plain-letter form, so "Thủy" and "thuy" cannot both exist
const slug=n=>String(n||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9_]/g,'');
const cleanNick=v=>String(v||'').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/gu,'').trim().slice(0,16);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function hashPass(p){ const salt=crypto.randomBytes(16); return salt.toString('hex')+':'+crypto.scryptSync(p,salt,32).toString('hex'); }
function checkPass(p,stored){ const [s,h]=String(stored).split(':'); if(!s||!h) return false; const x=crypto.scryptSync(p,Buffer.from(s,'hex'),32); return crypto.timingSafeEqual(x,Buffer.from(h,'hex')); }
const ADMIN_NICK=slug(process.env.ADMIN_NICK||'');
const pub=u=>({nick:u.nick, games:u.games, wins:u.wins, kills:u.kills, online_games:u.online_games, best_place:u.best_place, admin:!!ADMIN_NICK && u.slug===ADMIN_NICK});
async function userOf(token){ if(!token || typeof token!=='string' || token.length>100) return null; const id=await db.session(sha(token)); return id ? db.byId(id) : null; }
const bearer=req=>((req.headers.authorization||'').match(/^Bearer (\S+)$/)||[])[1]||'';
// slow down password guessing: 10 tries per address per 10 minutes
const tries=new Map();
function tooMany(ip){ const now=Date.now(), t=(tries.get(ip)||[]).filter(x=>now-x<600000); t.push(now); tries.set(ip,t); return t.length>10; }
setInterval(()=>{ const now=Date.now(); for(const [ip,t] of tries) if(!t.some(x=>now-x<600000)) tries.delete(ip); },600000);
const lastResult=new Map();

const json=(res,code,o)=>{ res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(o)); };
function body(req){ return new Promise((ok,no)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>2000){ no(new Error('big')); req.destroy(); } }); req.on('end',()=>ok(b)); req.on('error',no); }); }
async function api(req,res,p){
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  if(p==='/api/top' && req.method==='GET') return json(res,200,{top:await db.top()});
  if(p==='/api/me' && req.method==='GET'){ const u=await userOf(bearer(req)); return json(res,200,{user:u?pub(u):null, store:db.kind}); }
  if(req.method!=='POST') return json(res,405,{error:'method'});
  const raw=await body(req);
  if(p==='/api/admin'){ const key=process.env.ADMIN_KEY||''; res.writeHead(200,{'content-type':'text/plain'}); res.end(key.length>=6 && raw===key ? 'yes' : 'no'); return; }
  let b={}; try{ b=JSON.parse(raw||'{}'); }catch(_){ return json(res,400,{error:'bad'}); }
  if(p==='/api/signup' || p==='/api/login'){
    const nick=cleanNick(b.nick), s=slug(nick), pass=String(b.pass||'');
    if(s.length<3) return json(res,400,{error:'nick'});
    if(pass.length<6 || pass.length>72) return json(res,400,{error:'pass'});
    if(tooMany(ip)) return json(res,429,{error:'slow'});
    let u;
    if(p==='/api/signup'){ u=await db.create(s,nick,hashPass(pass)); if(!u) return json(res,409,{error:'taken'}); }
    else { u=await db.bySlug(s); if(!u || !checkPass(pass,u.pass)) return json(res,401,{error:'wrong'}); }
    const token=crypto.randomBytes(24).toString('base64url');
    await db.addSession(sha(token),u.id);
    return json(res,200,{token, user:pub(u)});
  }
  const u=await userOf(bearer(req));
  if(p==='/api/logout'){ if(u) await db.dropSession(sha(bearer(req))); return json(res,200,{ok:true}); }
  if(p==='/api/result'){
    if(!u) return json(res,401,{error:'login'});
    // one result per 40 seconds per account, numbers clamped, so a page edit cannot farm the leaderboard much
    const now=Date.now(); if(now-(lastResult.get(u.id)||0)<40000) return json(res,429,{error:'slow'});
    lastResult.set(u.id,now);
    await db.record(u.id,{win:!!b.win, kills:Math.max(0,Math.min(60,b.kills|0)), place:Math.max(1,Math.min(20,b.place|0||20)), online:!!b.online});
    return json(res,200,{user:pub(await db.byId(u.id))});
  }
  return json(res,404,{error:'not found'});
}

const server=http.createServer((req,res)=>{
  let p=decodeURIComponent((req.url||'/').split('?')[0]);
  if(p.startsWith('/api/')){ api(req,res,p).catch(e=>{ console.error(e.message); if(!res.headersSent) json(res,500,{error:'server'}); }); return; }
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
wss.on('connection',async (ws,req)=>{
  ws.peer='p'+(next++).toString(36)+Math.random().toString(36).slice(2,6);
  ws.rooms=new Set(); ws.alive=true;
  ws.on('pong',()=>{ ws.alive=true; });
  ws.on('close',()=>{ for(const name of [...ws.rooms]) leave(ws,name); });
  // online play needs a signed-in nick
  const qs=new URL(req.url,'http://x').searchParams;
  let u=null; try{ u=await userOf(qs.get('t')); }catch(e){ console.error(e.message); }
  if(!u){ send(ws,{t:'denied'}); ws.close(4001,'login'); return; }
  ws.nick=u.nick;
  // a verified admin (ADMIN_NICK, or the ADMIN_KEY typed on that device) gets _a:1 stamped on everything they send, so a host can trust it
  const key=process.env.ADMIN_KEY||'';
  ws.admin=pub(u).admin || (key.length>=6 && qs.get('k')===key);
  send(ws,{t:'hello',peer:ws.peer,nick:u.nick});
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
      const pres={...m.pres}; delete pres._a; if(ws.admin) pres._a=1;
      me.pres=pres; me.at=Date.now();
      others(name,ws.peer,{t:'p',room:name,peer:ws.peer,pres,at:me.at});
    } else if(m.t==='leave') leave(ws,name);
  });
});
// drop connections that stopped answering, and keep idle ones from being cut by proxies
setInterval(()=>{ for(const ws of wss.clients){ if(!ws.alive){ ws.terminate(); continue; } ws.alive=false; try{ ws.ping(); }catch(_){} } },20000);
server.listen(PORT,()=>console.log('Hải Chiến Bo on port '+PORT));
