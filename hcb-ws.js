// Hải Chiến Bo (Render): the game's room API over one WebSocket to this site's own server
(()=>{
const url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
let ws=null, me=null, opening=null, retry=0;
const rooms={};   // name -> room object
function connect(){
  if(opening) return opening;
  opening=new Promise((res,rej)=>{
    const s=new WebSocket(url); let done=false;
    const fail=e=>{ if(!done){ done=true; opening=null; rej(e); } };
    s.onmessage=e=>{ let m; try{ m=JSON.parse(e.data); }catch(_){ return; }
      if(m.t==='hello'){ me=m.peer; ws=s; retry=0; if(!done){ done=true; res(); } for(const n in rooms) rooms[n]._rejoin(); return; }
      const r=rooms[m.room]; if(r) r._msg(m); };
    s.onerror=()=>fail(new Error('ws'));
    s.onclose=()=>{ fail(new Error('closed')); if(ws===s){ ws=null; opening=null; for(const n in rooms) rooms[n]._lost(); if(Object.keys(rooms).length) setTimeout(()=>connect().catch(()=>{}), Math.min(5000,500*(++retry))); } };
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
  await connect();
  if(rooms[name]) return rooms[name];
  const r=rooms[name]=makeRoom(name);
  out({t:'join',room:name});
  return r;
} };
window.claude={use:async n=>n==='room'?api:null};
})();
// admin: open the site once with ?admin=<ADMIN_KEY set on Render>; the key is remembered on this device
(()=>{
  try{ const k=new URLSearchParams(location.search).get('admin'); if(k){ localStorage.setItem('hcb-admin-key',k); history.replaceState(null,'',location.pathname); } }catch(_){}
  window.HCB_ADMIN_CHECK=async()=>{ let k=''; try{ k=localStorage.getItem('hcb-admin-key')||''; }catch(_){} if(!k) return false;
    const r=await fetch('/api/admin',{method:'POST',headers:{'content-type':'text/plain'},body:k}); return r.ok && (await r.text())==='yes'; };
})();
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
