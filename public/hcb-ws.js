// Hải Chiến Bo (Render): nick accounts and the game's room API, both served by this site's own server
(()=>{
let token=''; try{ token=localStorage.getItem('hcb-token')||''; }catch(_){}
const HCB=window.HCB_R={user:null};
const err=(code,message)=>Object.assign(new Error(message||code),{code});

/* ---------- rooms over one WebSocket ---------- */
let ws=null, me=null, opening=null, retry=0;
const rooms={};   // name -> room object
function connect(){
  if(opening) return opening;
  opening=new Promise((res,rej)=>{
    const s=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?t='+encodeURIComponent(token)); let done=false, denied=false;
    const fail=e=>{ if(!done){ done=true; opening=null; rej(e); } };
    s.onmessage=e=>{ let m; try{ m=JSON.parse(e.data); }catch(_){ return; }
      if(m.t==='denied'){ denied=true; fail(err('not_permitted','login')); return; }
      if(m.t==='hello'){ me=m.peer; ws=s; retry=0; if(!done){ done=true; res(); } for(const n in rooms) rooms[n]._rejoin(); return; }
      const r=rooms[m.room]; if(r) r._msg(m); };
    s.onerror=()=>fail(err('upstream_error','ws'));
    s.onclose=()=>{ fail(err('upstream_error','closed')); if(ws===s){ ws=null; opening=null; for(const n in rooms) rooms[n]._lost(); if(!denied && Object.keys(rooms).length) setTimeout(()=>connect().catch(()=>{}), Math.min(5000,500*(++retry))); } };
  });
  return opening;
}
const out=o=>{ if(ws && ws.readyState===1) ws.send(JSON.stringify(o)); };
function makeRoom(name){
  const others=new Map(); let mine=Object.freeze({}), snap=null, hs=new Set(), pend=false, ch=new Set(), connected=true;
  const notify=()=>{ snap=null; if(pend) return; pend=true; queueMicrotask(()=>{ pend=false; const p=r.peers(); for(const h of hs) try{ h({peers:p, joined:[], left:[], updated:p}); }catch(e){ console.warn(e); } }); };
  const r={name,
    emit:()=>Promise.resolve(), on:()=>()=>{},
    presence(patch){ const o={...mine}; for(const k in patch){ if(patch[k]===null) delete o[k]; else o[k]=patch[k]; } mine=Object.freeze(o); out({t:'p',room:name,pres:mine}); notify(); return Promise.resolve(); },
    peers(){ if(snap) return snap;
      const l=[Object.freeze({peer:me||'me', by:null, isMe:true, sameTab:true, kind:'viewer', guest:false, presence:mine, updatedAt:Date.now()})];
      for(const [id,x] of others) l.push(Object.freeze({peer:id, by:null, isMe:false, sameTab:false, kind:'viewer', guest:false, presence:x.pres, updatedAt:x.at}));
      return snap=Object.freeze(l); },
    onPeers(h){ hs.add(h); queueMicrotask(()=>{ const p=r.peers(); h({peers:p, joined:p, left:[], updated:[]}); }); return ()=>hs.delete(h); },
    connected:()=>connected,
    onConnection(h){ ch.add(h); queueMicrotask(()=>h(connected)); return ()=>ch.delete(h); },
    leave(){ out({t:'leave',room:name}); delete rooms[name]; hs.clear(); return Promise.resolve(); },
    _msg(m){
      if(m.t==='peers'){ others.clear(); for(const x of m.list||[]) others.set(x.peer,{pres:Object.freeze(x.pres||{}),at:x.at||Date.now()}); notify(); }
      else if(m.t==='p'){ others.set(m.peer,{pres:Object.freeze(m.pres||{}),at:m.at||Date.now()}); notify(); }
      else if(m.t==='left'){ others.delete(m.peer); notify(); }
    },
    _rejoin(){ out({t:'join',room:name}); if(Object.keys(mine).length) out({t:'p',room:name,pres:mine}); connected=true; for(const h of ch) h(true); },
    _lost(){ connected=false; for(const h of ch) h(false); }
  };
  return r;
}
const api={ async join(name){
  if(!HCB.user) throw err('not_permitted','login');
  await connect();
  if(rooms[name]) return rooms[name];
  const r=rooms[name]=makeRoom(name);
  out({t:'join',room:name});
  return r;
} };
window.claude={use:async n=>n==='room'?api:null};

/* ---------- accounts and results ---------- */
const $=s=>document.querySelector(s);
async function call(path,body){
  const h={}; if(token) h.authorization='Bearer '+token;
  if(body) h['content-type']='application/json';
  const r=await fetch(path,{method:body?'POST':'GET', headers:h, body:body?JSON.stringify(body):undefined});
  let j={}; try{ j=await r.json(); }catch(_){}
  if(!r.ok) throw err(j.error||('http'+r.status));
  return j;
}
function setToken(t){ token=t||''; try{ if(token) localStorage.setItem('hcb-token',token); else localStorage.removeItem('hcb-token'); }catch(_){}
  if(ws){ const s=ws; ws=null; opening=null; s.close(); } }
function msg(t,bad){ const el=$('#acMsg'); el.textContent=t||''; el.classList.toggle('bad',!!bad); }
function render(){
  const p=HCB.user, inn=!!p;
  $('#acctOut').hidden=inn; $('#acctIn').hidden=!inn;
  if(inn){
    $('#acInfo').textContent='Chào '+p.nick+' · '+p.games+' trận · thắng '+p.wins+' · hạ gục '+p.kills+(p.best_place?' · hạng cao nhất '+p.best_place:'');
    $('#nick').value=p.nick; $('#nick').disabled=true;
  } else $('#nick').disabled=false;
  for(const id of ['#mkRoom','#joinRoom']) $(id).classList.toggle('locked',!inn);
  HCB.adminCache=null;
}
async function refresh(){
  if(!token){ HCB.user=null; render(); return; }
  try{ const j=await call('/api/me'); HCB.user=j.user; if(!j.user) setToken(''); }
  catch(e){ msg('Chưa kết nối được máy chủ. Nếu trang vừa mở sau lâu không ai chơi, đợi khoảng 1 phút rồi tải lại trang.',true); }
  render();
}
async function signIn(create){
  const nick=$('#acNick').value.trim(), pass=$('#acPass').value;
  if(nick.length<3){ msg('Nick cần ít nhất 3 chữ cái hoặc số.',true); return; }
  if(pass.length<6){ msg('Mật khẩu cần ít nhất 6 ký tự.',true); return; }
  for(const b of ['#acLogin','#acSign']) $(b).disabled=true;
  msg(create?'Đang tạo nick…':'Đang đăng nhập…');
  try{
    const j=await call(create?'/api/signup':'/api/login',{nick,pass});
    setToken(j.token); HCB.user=j.user; $('#acPass').value=''; msg(create?'Đã tạo nick, chúc thầy chơi vui!':''); render();
  }catch(e){
    const c=e.code;
    msg(c==='taken' ? 'Nick này đã có người dùng (kể cả khi khác dấu), chọn nick khác.'
      : c==='wrong' ? 'Sai nick hoặc mật khẩu.'
      : c==='nick' ? 'Nick cần ít nhất 3 chữ cái hoặc số.'
      : c==='pass' ? 'Mật khẩu cần từ 6 đến 72 ký tự.'
      : c==='slow' ? 'Thử quá nhiều lần, đợi 10 phút rồi thử lại.'
      : 'Chưa kết nối được máy chủ, đợi một chút rồi thử lại.', true);
  }finally{ for(const b of ['#acLogin','#acSign']) $(b).disabled=false; }
}
async function showBoard(){
  $('#board').hidden=false; const tb=$('#boardRows'); tb.replaceChildren();
  let data;
  try{ data=(await call('/api/top')).top; }
  catch(_){ const tr=document.createElement('tr'), td=document.createElement('td'); td.colSpan=5; td.textContent='Không tải được bảng xếp hạng.'; tr.append(td); tb.append(tr); return; }
  data.forEach((r,i)=>{ const tr=document.createElement('tr'); for(const v of [i+1,r.nick,r.wins,r.kills,r.games]){ const td=document.createElement('td'); td.textContent=v; tr.append(td); } if(HCB.user && r.nick===HCB.user.nick) tr.className='me'; tb.append(tr); });
}
// the game calls this once when a match ends for this player
window.HCB_onEnd=async r=>{
  if(!HCB.user) return;
  try{ const j=await call('/api/result',{win:!!r.win, kills:r.kills|0, place:r.place|0, online:!!r.online}); HCB.user=j.user; render(); }catch(e){ console.warn('record',e); }
};
function wire(){
  $('#acLogin').addEventListener('click',()=>signIn(false));
  $('#acSign').addEventListener('click',()=>signIn(true));
  $('#acPass').addEventListener('keydown',e=>{ if(e.key==='Enter') signIn(false); });
  $('#acOut').addEventListener('click',async()=>{ try{ await call('/api/logout',{}); }catch(_){} setToken(''); HCB.user=null; msg(''); render(); });
  $('#acBoard').addEventListener('click',showBoard);
  $('#boardClose').addEventListener('click',()=>{ $('#board').hidden=true; });
  // online play needs a nick
  document.addEventListener('click',e=>{
    if(HCB.user || !e.target.closest || !e.target.closest('#mkRoom,#joinRoom')) return;
    e.stopPropagation(); e.preventDefault();
    const n=$('#netMsg'); n.textContent='Đăng nhập hoặc tạo nick ở trên để chơi online.'; n.classList.add('bad');
  },true);
  render(); refresh();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();

/* ---------- admin ---------- */
// admin is the nick named by ADMIN_NICK on Render, or any device that typed the ADMIN_KEY once (menu link or ?admin=KEY)
try{ const k=new URLSearchParams(location.search).get('admin'); if(k){ localStorage.setItem('hcb-admin-key',k); history.replaceState(null,'',location.pathname); } }catch(_){}
window.HCB_ADMIN_CHECK=async()=>{
  if(HCB.user && HCB.user.admin) return true;
  if(HCB.adminCache!=null) return HCB.adminCache;
  let k=''; try{ k=localStorage.getItem('hcb-admin-key')||''; }catch(_){} if(!k) return HCB.adminCache=false;
  const r=await fetch('/api/admin',{method:'POST',headers:{'content-type':'text/plain'},body:k});
  return HCB.adminCache=(r.ok && (await r.text())==='yes');
};
// the key can also be typed in the menu (a home-screen app on a phone keeps its own storage, so the ?admin link does not carry over)
addEventListener('DOMContentLoaded',()=>{
  const a=document.getElementById('adminKeyBtn'); if(!a) return;
  a.addEventListener('click',e=>{ e.preventDefault();
    let cur=''; try{ cur=localStorage.getItem('hcb-admin-key')||''; }catch(_){}
    const k=prompt('Khóa admin (giá trị ADMIN_KEY trên Render). Để trống để xóa khóa trên máy này:',cur);
    if(k===null) return;
    try{ if(k.trim()) localStorage.setItem('hcb-admin-key',k.trim()); else localStorage.removeItem('hcb-admin-key'); }catch(_){}
    location.reload(); });
});
})();
