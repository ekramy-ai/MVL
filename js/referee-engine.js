import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc,
  updateDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ── Firebase Init ──
const firebaseConfig = {
  apiKey: "AIzaSyAvRbBG41CuTSme8CRhFqA0xeKRHwsXOqc",
  authDomain: "mini-volley-engine.firebaseapp.com",
  projectId: "mini-volley-engine",
  storageBucket: "mini-volley-engine.firebasestorage.app",
  messagingSenderId: "1010578790428",
  appId: "1:1010578790428:web:d10e833efb18ad250da7d9"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── State ──
let currentRef = null;
let currentMatch = null;
let liveScore = { A: 0, B: 0, setsA: 0, setsB: 0, set: 1, serving: 'A', events: [] };
let unsub = null;
let saving = false;
let pendingServeInfo = null; // {playerId, playerName, side}
const serveStatsKey = 'mvl_serve_stats_all';

// ── Toast ──
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = '0', 2400);
}

// ── Screen switch ──
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── LOGIN ──
window.doLogin = async () => {
  const name = document.getElementById('inp-name').value.trim();
  const pass = document.getElementById('inp-pass').value.trim();
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none';

  if (!name || !pass) { errEl.style.display = 'block'; errEl.textContent = 'يرجى إدخال الاسم وكلمة المرور'; return; }

  const btn = document.getElementById('btn-login');
  btn.textContent = 'جاري التحقق...'; btn.disabled = true;

  try {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

    // Step 1: Try Firebase SDK
    let snap;
    try { snap = await Promise.race([getDocs(collection(db, 'referees')), timeout(3000)]); } catch(e) {}

    let found = null;
    if (snap) {
        const refs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        try { localStorage.setItem('mvl_referees', JSON.stringify(refs)); } catch(e) {}
        try { localStorage.setItem('mvl_cache_referees', JSON.stringify({ data: refs, ts: Date.now() })); } catch(e) {}
        found = refs.find(r => (r.name||'').trim() === name && (r.password||'').trim() === pass);
    }

    // Step 2: Try REST API
    if (!found && !snap) {
        try {
            const res = await Promise.race([
              fetch('https://firestore.googleapis.com/v1/projects/mini-volley-engine/databases/(default)/documents/referees'),
              timeout(4000)
            ]);
            if (res && res.ok) {
              const data = await res.json();
              if (data.documents) {
                  const refs = data.documents.map(d => {
                      const f = d.fields || {};
                      return {
                          id: d.name.split('/').pop(),
                          name: f.name ? f.name.stringValue || '' : '',
                          password: f.password ? f.password.stringValue || '' : '',
                          grade: f.grade ? f.grade.stringValue || '' : ''
                      };
                  });
                  try { localStorage.setItem('mvl_referees', JSON.stringify(refs)); } catch(e) {}
                  try { localStorage.setItem('mvl_cache_referees', JSON.stringify({ data: refs, ts: Date.now() })); } catch(e) {}
                  found = refs.find(r => r.name.trim() === name && r.password.trim() === pass);
              }
            }
        } catch(ex) {}
    }

    // Step 3: All localStorage sources
    if (!found) {
        const srcs = [];
        try { srcs.push(...JSON.parse(localStorage.getItem('mvl_referees') || '[]')); } catch(e) {}
        try { const c = JSON.parse(localStorage.getItem('mvl_cache_referees') || 'null'); if (c && c.data) srcs.push(...c.data); } catch(e) {}
        const seen = {};
        const allLocalRefs = srcs.filter(r => r && r.id && !seen[r.id] && (seen[r.id] = 1));
        found = allLocalRefs.find(r => (r.name||'').trim() === name && (r.password||'').trim() === pass);
    }

    if (found) {
      currentRef = found;
      document.getElementById('ref-badge').textContent = found.name;
      document.getElementById('btn-logout').style.display = 'inline-block';
      await loadMatches();
      show('scr-matches');
      toast('مرحباً ' + found.name + ' 👋');
    } else {
      let settings = { adminUsername: 'admin', adminPassword: 'admin' };
      try {
          const settSnap = await Promise.race([getDocs(collection(db, 'settings')), timeout(2000)]);
          if (settSnap && !settSnap.empty) {
            settings = settSnap.docs[0].data();
            try { localStorage.setItem('mvl_settings', JSON.stringify(settings)); } catch(e) {}
            try { localStorage.setItem('mvl_cache_settings', JSON.stringify({ data: settings, ts: Date.now() })); } catch(e) {}
          }
      } catch(e) {
          try { const c = JSON.parse(localStorage.getItem('mvl_cache_settings') || 'null'); if (c && c.data) settings = c.data; } catch(e2) {}
          try { const s = JSON.parse(localStorage.getItem('mvl_settings') || 'null'); if (s) settings = s; } catch(e2) {}
      }

      if (name === settings.adminUsername && pass === settings.adminPassword) {
        currentRef = { id: 'admin', name: 'المدير', grade: 'Admin' };
        document.getElementById('ref-badge').textContent = 'المدير';
        document.getElementById('btn-logout').style.display = 'inline-block';
        await loadMatches();
        show('scr-matches');
        toast('مرحباً بالمدير 👑');
      } else {
        errEl.style.display = 'block';
        errEl.textContent = 'بيانات الدخول غير صحيحة';
      }
    }
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent = 'حدث خطأ غير متوقع';
  }

  btn.textContent = 'دخول ⚡'; btn.disabled = false;
};

// ── LOAD MATCHES ──
window.loadMatches = async () => {
  const list = document.getElementById('matches-list');
  list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:12px">جاري التحميل...</div>';
  try {
    let matches = [];
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
    // Try Firebase SDK
    try {
      const snap = await Promise.race([getDocs(collection(db, 'matches')), timeout(4000)]);
      matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
      // Try REST API
      try {
        const res = await Promise.race([
          fetch('https://firestore.googleapis.com/v1/projects/mini-volley-engine/databases/(default)/documents/matches'),
          timeout(5000)
        ]);
        if (res.ok) {
          const data = await res.json();
          if (data.documents) {
            matches = data.documents.map(d => {
              const f = d.fields || {};
              const ext = (o) => {
                if (!o) return null;
                if (o.stringValue !== undefined) return o.stringValue;
                if (o.integerValue !== undefined) return Number(o.integerValue);
                if (o.booleanValue !== undefined) return o.booleanValue;
                if (o.mapValue) { const m = {}; for (const k in o.mapValue.fields) m[k] = ext(o.mapValue.fields[k]); return m; }
                if (o.arrayValue) return (o.arrayValue.values || []).map(v => ext(v));
                return null;
              };
              return { id: d.name.split('/').pop(), status: ext(f.status), referee: ext(f.referee), teamA: ext(f.teamA), teamB: ext(f.teamB), score: ext(f.score), sets: ext(f.sets), groupId: ext(f.groupId), round: ext(f.round) };
            });
          }
        }
      } catch(e2) { /* offline */ }
    }
    window.allMatches = matches;
    window.currentFilter = window.currentFilter || 'all';
    applyMatchFilter(window.currentFilter);
  } catch (e) {
    console.error('loadMatches:', e);
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--amber);font-size:12px">⚠ يعمل بدون اتصال</div>';
    window.allMatches = window.allMatches || [];
    applyMatchFilter(window.currentFilter || 'all');
  }
};

// ── FILTER MATCHES ──
window.filterMatches = function(status) {
  window.currentFilter = status;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.filter-tab[data-status="${status}"]`);
  if (activeTab) activeTab.classList.add('active');
  applyMatchFilter(status);
};

window.applyMatchFilter = function(status) {
  if (!currentRef) return;
  const isAdmin = currentRef.id === 'admin';
  const list = document.getElementById('matches-list');
  let filtered = window.allMatches || [];
  
  if (!isAdmin) {
    filtered = filtered.filter(m => m.referee === currentRef.id);
  }
  
  if (status !== 'all') {
    filtered = filtered.filter(m => (m.status || 'pending') === status);
  }
  
  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:12px">لا توجد مباريات</div>';
    return;
  }
  
  const order = { playing: 0, pending: 1, completed: 2 };
  filtered.sort((a, b) => (order[a.status || 'pending'] || 1) - (order[b.status || 'pending'] || 1));
  
  list.innerHTML = filtered.map(m => {
    const nameA = m.teamA?.name || m.teamAName || '؟';
    const nameB = m.teamB?.name || m.teamBName || '؟';
    const s = m.status || 'pending';
    const badgeCls = s === 'playing' ? 'b-live' : s === 'completed' ? 'b-done' : 'b-pending';
    const badgeTxt = s === 'playing' ? '● مباشر' : s === 'completed' ? '✓ منتهية' : '⏳ قادمة';
    const scoreStr = s === 'completed'
      ? `${m.sets?.teamA || 0} - ${m.sets?.teamB || 0}`
      : s === 'playing'
      ? `${m.score?.A || 0} / ${m.score?.B || 0} نقطة`
      : '';
      
    const refBadge = isAdmin && m.referee ? `<span style="font-size:9px;background:var(--surface2);padding:2px 6px;border-radius:4px;color:var(--teal)">حكم: ${m.referee}</span>` : isAdmin ? `<span style="font-size:9px;background:var(--red-bg);padding:2px 6px;border-radius:4px;color:var(--red)">بدون حكم</span>` : '';

    return `<div class="mc ${s}" onclick="openMatch('${m.id}')">
      <div class="match-teams">
        <span style="color:var(--teal)">${nameA}</span>
        <span style="color:var(--faint);font-size:11px">${scoreStr || 'VS'}</span>
        <span style="color:var(--amber)">${nameB}</span>
      </div>
      <div class="match-meta">
        <span class="badge ${badgeCls}">${badgeTxt}</span>
        ${m.groupId ? `<span>مجموعة ${m.groupId}</span>` : ''}
        ${m.round ? `<span>جولة ${m.round}</span>` : ''}
        ${refBadge}
      </div>
    </div>`;
  }).join('');
};

// ── OPEN MATCH ──
window.openMatch = async (matchId) => {
  try {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
    const snap = await Promise.race([getDocs(collection(db, 'matches')), timeout(3000)]);
    let matchDoc = null;
    if (snap) {
      matchDoc = snap.docs.find(d => d.id === matchId);
    } else {
      // Fallback: search matches list if snap failed
      const res = await fetch('https://firestore.googleapis.com/v1/projects/mini-volley-engine/databases/(default)/documents/matches');
      const data = await res.json();
      if (data.documents) {
        const d = data.documents.find(doc => doc.name.endsWith('/' + matchId));
        if (d) {
          const ext = (obj) => {
              if(!obj) return null;
              if(obj.stringValue !== undefined) return obj.stringValue;
              if(obj.integerValue !== undefined) return Number(obj.integerValue);
              if(obj.mapValue) {
                  const m = {};
                  for(const k in obj.mapValue.fields) m[k] = ext(obj.mapValue.fields[k]);
                  return m;
              }
              if(obj.arrayValue) return obj.arrayValue.values ? obj.arrayValue.values.map(v => ext(v)) : [];
              return null;
          };
          matchDoc = { id: matchId, data: () => ({
              status: ext(d.fields.status),
              referee: ext(d.fields.referee),
              teamA: ext(d.fields.teamA),
              teamB: ext(d.fields.teamB),
              score: ext(d.fields.score),
              sets: ext(d.fields.sets),
              groupId: ext(d.fields.groupId),
              round: ext(d.fields.round)
          })};
        }
      }
    }
    
    if (!matchDoc) return;

    currentMatch = { id: matchId, ...matchDoc.data() };
    const m = currentMatch;

    // Init live score
    if (m.status === 'playing' && m.score) {
      liveScore = {
        A: m.score.A || 0, B: m.score.B || 0,
        setsA: m.score.setsA || 0, setsB: m.score.setsB || 0,
        set: m.score.set || 1, serving: m.score.serving || 'A',
        events: m.score.events || [],
        lineupA: m.score.lineupA || null,
        lineupB: m.score.lineupB || null,
        servesInBlock: m.score.servesInBlock || 0,
        blocksA: m.score.blocksA || 0,
        blocksB: m.score.blocksB || 0
      };
    } else {
      liveScore = { 
        A: 0, B: 0, setsA: 0, setsB: 0, set: 1, 
        serving: 'A', events: [], lineupA: null, lineupB: null,
        servesInBlock: 0, blocksA: 0, blocksB: 0
      };
    }

    const nameA = m.teamA?.name || m.teamAName || 'فريق أ';
    const nameB = m.teamB?.name || m.teamBName || 'فريق ب';

    // Update board labels
    document.getElementById('board-name-a').textContent = nameA;
    document.getElementById('board-name-b').textContent = nameB;
    document.getElementById('team-a-sets-lbl').textContent = nameA;
    document.getElementById('team-b-sets-lbl').textContent = nameB;

    if (!liveScore.lineupA || !liveScore.lineupB) {
        await renderLineupForm();
        show('scr-lineup');
    } else {
        renderBoard();
        show('scr-live');
    }

    // Real-time listener
    if (unsub) unsub();
    unsub = onSnapshot(doc(db, 'matches', matchId), (d) => {
      if (!d.exists()) return;
      const data = d.data();
      if (data.score && !saving) {
        liveScore = { ...liveScore, ...data.score };
        renderBoard();
      }
    });

    // Mark as playing
    if (m.status !== 'playing' && m.status !== 'completed') {
      try {
          await Promise.race([
              updateDoc(doc(db, 'matches', matchId), {
                status: 'playing',
                referee: currentRef.id,
                startedAt: serverTimestamp()
              }),
              timeout(2000)
          ]);
      } catch(e) {
          console.warn('Offline: Could not mark match as playing on server');
      }
    }

    toast(`تم فتح: ${nameA} vs ${nameB}`);
  } catch (e) {
    toast('فشل فتح المباراة');
  }
};

// ── LINEUP SELECTION ──
window.lineupSelections = { A: [], B: [] };

window.renderLineupForm = async () => {
    const container = document.getElementById('lineup-form-container');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">جاري تحميل اللاعبين...</div>';
    
    try {
        window.lineupSelections = { A: [], B: [] };
        const teamAId = currentMatch.teamA?.id || currentMatch.teamA;
        const teamBId = currentMatch.teamB?.id || currentMatch.teamB;
        
        const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
        let players = [];
        try {
            const snap = await Promise.race([getDocs(collection(db, 'players')), timeout(3000)]);
            if (snap) players = snap.docs.map(d => ({id: d.id, ...d.data()}));
        } catch (e) {
            // Fallback to REST
            const res = await fetch('https://firestore.googleapis.com/v1/projects/mini-volley-engine/databases/(default)/documents/players');
            const data = await res.json();
            if (data.documents) {
                players = data.documents.map(d => {
                    const ext = (obj) => {
                        if(!obj) return null;
                        if(obj.stringValue !== undefined) return obj.stringValue;
                        if(obj.integerValue !== undefined) return Number(obj.integerValue);
                        return null;
                    };
                    return {
                        id: d.name.split('/').pop(),
                        name: ext(d.fields?.name),
                        teamId: ext(d.fields?.teamId)
                    };
                });
            }
        }
        
        window.availablePlayersA = players.filter(p => p.teamId === teamAId);
        window.availablePlayersB = players.filter(p => p.teamId === teamBId);
        
        // Compute team player counts
        const totalA = window.availablePlayersA.length;
        const totalB = window.availablePlayersB.length;
        const totalPlayers = Math.min(totalA, totalB);
        const setNum = liveScore.set || 1;
        const reqSize = Math.max(4, Math.min(7, getSetLineupSize(Math.max(12, Math.min(21, totalPlayers)), setNum)));
        window.lineupRequiredSize = reqSize;
        window.lineupMaxSize = reqSize;
        // Update hint
        const hintEl = document.getElementById('lineup-hint');
        if (hintEl) hintEl.textContent = 'يجب اختيار ' + reqSize + ' لاعب بالترتيب (إجمالي لاعبين: أ=' + totalA + ' ب=' + totalB + ')';
        const lblEl = document.getElementById('lineup-set-label');
        if (lblEl) lblEl.textContent = 'الشوط ' + (liveScore.set || 1);
        const badgesEl = document.getElementById('lineup-count-badges');
        if (badgesEl) badgesEl.innerHTML =
          '<span style="background:rgba(94,234,212,.15);color:var(--teal);border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700">أ: ' + window.lineupSelections.A.length + '/' + reqSize + '</span>' +
          '<span style="background:rgba(245,158,11,.15);color:var(--amber);border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700">ب: ' + window.lineupSelections.B.length + '/' + reqSize + '</span>';
        window.updateLineupUI();
    } catch(e) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">فشل تحميل اللاعبين.</div>';
    }
};

window.getRequiredLineupSize = (totalPlayers, setNum) => {
    if (totalPlayers === 0) return 4;
    const base = Math.floor(totalPlayers / 3);
    if (setNum >= 3) return totalPlayers - (base * 2);
    return base;
};

window.updateLineupUI = () => {
    const container = document.getElementById('lineup-form-container');
    const nameA = currentMatch.teamA ? (currentMatch.teamA.name || '') : (currentMatch.teamAName || 'فريق أ');
    const nameB = currentMatch.teamB ? (currentMatch.teamB.name || '') : (currentMatch.teamBName || 'فريق ب');
    
    const playedA = liveScore.playedA || [];
    const playedB = liveScore.playedB || [];

    const renderSide = (side, players, played, teamName, color) => {
        const req = window.getRequiredLineupSize(players.length, liveScore.set || 1);
        const sel = window.lineupSelections[side];
        let html = '<div class="card" style="margin-bottom:10px">';
        html += '<h3 style="color:' + color + ';margin-bottom:10px;font-size:12px">' + teamName + ' <span style="color:var(--text2);font-size:10px">(اختر ' + req + ' لاعبين بالترتيب المطلوب للإرسال)</span></h3>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        
        if (players.length === 0) {
            html += '<div style="font-size:10px;color:var(--muted)">لا يوجد لاعبين مسجلين</div>';
        }
        
        players.forEach(function(p) {
            if (played.includes(p.id)) {
                html += '<div style="padding:6px 10px;border-radius:6px;font-size:11px;background:var(--surface);color:var(--muted);opacity:0.6;border:1px dashed var(--border)">' + p.name + ' (لعب سابقاً)</div>';
                return;
            }
            const selIdx = sel.findIndex(function(s) { return s.id === p.id; });
            const isSel = selIdx > -1;
            const bg = isSel ? color : 'var(--surface2)';
            const txt = isSel ? '#000' : 'var(--text)';
            const fw = isSel ? 'bold' : 'normal';
            const badge = isSel ? '<span style="background:rgba(255,255,255,0.8);color:#000;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;margin-right:6px;font-weight:bold">' + (selIdx + 1) + '</span>' : '';
            const safeName = p.name.replace(/'/g, "\\'");
            html += '<div onclick="toggleLineupPlayer(\'' + side + '\', \'' + p.id + '\', \'' + safeName + '\')" style="padding:6px 10px;border-radius:6px;font-size:11px;background:' + bg + ';color:' + txt + ';cursor:pointer;display:flex;align-items:center;font-weight:' + fw + ';user-select:none">' + p.name + ' ' + badge + '</div>';
        });
        
        html += '</div></div>';
        return html;
    };

    // Update count badges after each selection
    const reqSize = window.lineupRequiredSize || 4;
    const badgesEl = document.getElementById('lineup-count-badges');
    if (badgesEl) {
        const selA = window.lineupSelections.A.length;
        const selB = window.lineupSelections.B.length;
        const colorA = selA === reqSize ? 'var(--green)' : 'var(--teal)';
        const colorB = selB === reqSize ? 'var(--green)' : 'var(--amber)';
        badgesEl.innerHTML =
            '<span style="background:rgba(94,234,212,.15);color:' + colorA + ';border-radius:20px;padding:3px 12px;font-size:10px;font-weight:700">أ: ' + selA + '/' + reqSize + (selA===reqSize?' ✓':'') + '</span>' +
            '<span style="background:rgba(245,158,11,.15);color:' + colorB + ';border-radius:20px;padding:3px 12px;font-size:10px;font-weight:700">ب: ' + selB + '/' + reqSize + (selB===reqSize?' ✓':'') + '</span>';
    }
};
window.toggleLineupPlayer = (side, id, name) => {
    const list = window.lineupSelections[side];
    const idx = list.findIndex(p => p.id === id);
    if (idx > -1) {
        list.splice(idx, 1);
    } else {
        if (list.length >= 7) { toast('الحد الأقصى 7 لاعبين'); return; }
        list.push({ id, name });
    }
    window.updateLineupUI();
};

// ── DYNAMIC LINEUP SIZE ──
function getSetLineupSize(totalPlayers, setNumber) {
  const base = Math.floor(totalPlayers / 3);
  const rem = totalPlayers % 3;
  return setNumber === 3 ? base + rem : base;
}

window.toggleLineupPlayer = (side, id, name) => {
    const list = window.lineupSelections[side];
    const max = window.lineupMaxSize || 7;
    const idx = list.findIndex(function(p){ return p.id === id; });
    if (idx > -1) { list.splice(idx, 1); }
    else {
        if (list.length >= max) { toast("الحد الأقصى " + max + " لاعب لهذا الشوط"); return; }
        list.push({ id: id, name: name });
    }
    window.updateLineupUI();
};

window.saveLineup = async () => {
    const chkA = window.lineupSelections.A;
    const chkB = window.lineupSelections.B;
    const required = window.lineupRequiredSize || 4;
    if (chkA.length !== required) { toast("فريق أ: يجب اختيار " + required + " لاعب بالضبط"); return; }
    if (chkB.length !== required) { toast("فريق ب: يجب اختيار " + required + " لاعب بالضبط"); return; }
    liveScore.lineupA = chkA.slice();
    liveScore.lineupB = chkB.slice();
    await saveScore();
    renderBoard();
    show("scr-live");
};
// ── RENDER BOARD ──
function renderBoard() {
  document.getElementById('board-score-a').textContent = liveScore.A;
  document.getElementById('board-score-b').textContent = liveScore.B;
  document.getElementById('sets-a').textContent = liveScore.setsA;
  document.getElementById('sets-b').textContent = liveScore.setsB;

  const limit = liveScore.set === 5 ? 15 : 25;
  document.getElementById('set-info').textContent = `الشوط ${liveScore.set} / ${limit} نقطة للفوز`;

  const syncDot = document.getElementById('sync-dot');
  const syncEl = document.getElementById('sync-status');
  // (sync state handled in saveScore)
  const nameA = document.getElementById('board-name-a').textContent;
  const nameB = document.getElementById('board-name-b').textContent;
  const sIndex = liveScore.servesInBlock || 0;
  const serveBlockSize = 4;
  const pct = (sIndex / serveBlockSize) * 100;
  const progressBar = document.getElementById('serve-progress-bar');
  if (progressBar) progressBar.style.width = pct + '%';
  const blockInfoEl = document.getElementById('serve-block-info');
  if (blockInfoEl) blockInfoEl.textContent = 'إرسال ' + (sIndex + 1) + ' من ' + serveBlockSize + ' — الفريق المرسل: ' + (liveScore.serving === 'A' ? nameA : nameB);

  const diff = Math.abs(liveScore.A - liveScore.B);
  if ((liveScore.A >= 25 || liveScore.B >= 25) && diff >= 2) {
      if (!window.endingSet) {
          window.endingSet = true;
          document.getElementById('set-info').textContent = '✨ الشوط انتهى! انتقال تلقائي...';
          document.getElementById('set-info').style.color = 'var(--green)';
          setTimeout(() => {
              window.endingSet = false;
              window.endSet();
          }, 2000);
      }
  } else {
      window.endingSet = false;
      document.getElementById('set-info').style.color = 'var(--amber)';
  }

  // Events log
  const logEl = document.getElementById('event-log');
  if (liveScore.events && liveScore.events.length) {
    logEl.innerHTML = [...liveScore.events].reverse().slice(0, 20).map(ev => `
      <div class="log-item">
        <span style="color:${ev.side === 'A' ? 'var(--teal)' : 'var(--amber)'};font-weight:700">
          ${ev.side === 'A' ? nameA : nameB}
        </span>
        <span style="color:var(--text2)">${ev.scoreA} : ${ev.scoreB}</span>
        <span style="color:var(--faint)">${ev.time || ''}</span>
      </div>`).join('');
  } else {
    logEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);font-size:10px">لا أحداث بعد — ابدأ التسجيل</div>';
  }
}

async function saveScore() {
  if (!currentMatch) return;
  saving = true;
  const dot = document.getElementById('sync-dot');
  const syncEl = document.getElementById('sync-status');
  if (dot) { dot.className = 'sync-dot saving'; }
  if (syncEl) syncEl.textContent = 'جاري الحفظ...';
  try {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
    await Promise.race([
        updateDoc(doc(db, 'matches', currentMatch.id), { score: liveScore }),
        timeout(2000)
    ]);
    if (dot) { dot.className = 'sync-dot ok'; }
    if (syncEl) syncEl.textContent = 'محفوظ ✓';
  } catch (e) {
    if (dot) { dot.className = 'sync-dot err'; }
    if (syncEl) syncEl.textContent = 'محلي فقط';
  }
  saving = false;
}

// ── ADD POINT ──
window.addPoint = async (side) => {
  if (!currentMatch) return;
  
  // Save previous state for undo
  const oldState = {
      serving: liveScore.serving,
      servesInBlock: liveScore.servesInBlock,
      blocksA: liveScore.blocksA,
      blocksB: liveScore.blocksB,
      lineupA: liveScore.lineupA ? [...liveScore.lineupA] : null,
      lineupB: liveScore.lineupB ? [...liveScore.lineupB] : null
  };

  liveScore[side]++;

  // Advance serve block logic (independent of who won the point)
  liveScore.servesInBlock = (liveScore.servesInBlock || 0) + 1;
  
  if (liveScore.servesInBlock >= 4) {
      // Switch serving team
      liveScore.servesInBlock = 0;
      if (liveScore.serving === 'A') {
          liveScore.blocksA = (liveScore.blocksA || 0) + 1;
          liveScore.serving = 'B';
          // Rotation for B when they get serve back (if they already served before)
          if (liveScore.blocksB > 0 && liveScore.lineupB && liveScore.lineupB.length > 0) {
              liveScore.lineupB.push(liveScore.lineupB.shift());
          }
      } else {
          liveScore.blocksB = (liveScore.blocksB || 0) + 1;
          liveScore.serving = 'A';
          // Rotation for A when they get serve back
          if (liveScore.blocksA > 0 && liveScore.lineupA && liveScore.lineupA.length > 0) {
              liveScore.lineupA.push(liveScore.lineupA.shift());
          }
      }
  }

  const now = new Date();
  liveScore.events = liveScore.events || [];
  liveScore.events.push({
    side, scoreA: liveScore.A, scoreB: liveScore.B,
    time: `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`,
    prevState: oldState
  });

  renderBoard();
  await saveScore();
};

// ── UNDO ──
window.undoPoint = async (side) => {
  if (!currentMatch || liveScore[side] <= 0) return;
  liveScore[side]--;
  
  if (liveScore.events && liveScore.events.length > 0) {
      const lastEvent = liveScore.events.pop();
      if (lastEvent.prevState) {
          liveScore.serving = lastEvent.prevState.serving;
          liveScore.servesInBlock = lastEvent.prevState.servesInBlock;
          liveScore.blocksA = lastEvent.prevState.blocksA;
          liveScore.blocksB = lastEvent.prevState.blocksB;
          if (lastEvent.prevState.lineupA) liveScore.lineupA = lastEvent.prevState.lineupA;
          if (lastEvent.prevState.lineupB) liveScore.lineupB = lastEvent.prevState.lineupB;
      }
  }
  
  renderBoard();
  await saveScore();
  toast('↩ تم التراجع');
};

// ── END SET ──
window.endSet = async () => {
  if (!currentMatch) return;
  const winnerSide = liveScore.A >= liveScore.B ? 'A' : 'B';

  if (winnerSide === 'A') liveScore.setsA++;
  else liveScore.setsB++;

  toast(`انتهى الشوط ${liveScore.set}! الفائز: ${winnerSide === 'A' ? document.getElementById('board-name-a').textContent : document.getElementById('board-name-b').textContent}`);

  // Record set score and played players
  liveScore.setScores = liveScore.setScores || [];
  liveScore.setScores.push({ A: liveScore.A, B: liveScore.B });
  
  liveScore.playedA = liveScore.playedA || [];
  liveScore.playedB = liveScore.playedB || [];
  if (liveScore.lineupA) liveScore.playedA.push(...liveScore.lineupA.map(p => p.id));
  if (liveScore.lineupB) liveScore.playedB.push(...liveScore.lineupB.map(p => p.id));

  // Check if match over (best of 3)
  if (liveScore.setsA === 2 || liveScore.setsB === 2) {
    await endMatch(true); return; // skipConfirm = true for automatic end
  }

  liveScore.set++;
  liveScore.A = 0;
  liveScore.B = 0;
  liveScore.lineupA = null; // Clear lineup for the new set
  liveScore.lineupB = null;
  liveScore.servesInBlock = 0;
  liveScore.blocksA = 0;
  liveScore.blocksB = 0;
  
  await saveScore();
  await renderLineupForm();
  show('scr-lineup');
};

// ── END MATCH ──
window.endMatch = async (skipConfirm = false) => {
  if (!currentMatch) return;
  if (!skipConfirm && !confirm('هل أنت متأكد من إنهاء المباراة وتسجيل النتيجة النهائية؟')) return;

  try {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
    await Promise.race([
        updateDoc(doc(db, 'matches', currentMatch.id), {
          status: 'completed',
          score: liveScore,
          sets: { teamA: liveScore.setsA, teamB: liveScore.setsB },
          endedAt: serverTimestamp()
        }),
        timeout(3000)
    ]);
    toast('✓ تم تسجيل نتيجة المباراة بنجاح!');
    if (unsub) { unsub(); unsub = null; }
    setTimeout(function() { showResultScreen(); }, 800);
  } catch (e) {
    toast('⚠ تم الحفظ محلياً');
    if (unsub) { unsub(); unsub = null; }
    setTimeout(function() { showResultScreen(); }, 800);
  }
};

// ── RESULT SCREEN ──
window.showResultScreen = function showResultScreen() {
  const m = currentMatch;
  if (!m) { backToMatches(); return; }
  const nameA = document.getElementById('board-name-a').textContent;
  const nameB = document.getElementById('board-name-b').textContent;
  const sA = liveScore.setsA, sB = liveScore.setsB;
  const winner = sA > sB ? nameA : nameB;
  const el = function(id) { return document.getElementById(id); };
  el('result-winner').textContent = '🏆 ' + winner + ' يفوز!';
  el('result-teams').textContent = nameA + ' ضد ' + nameB;
  el('result-sets').textContent = sA + ' - ' + sB;
  // Set history
  const hist = liveScore.setScores || [];
  el('result-set-history').innerHTML = hist.map(function(s,i) {
    return '<span class="set-pill">ش' + (i+1) + ': ' + s.A + '-' + s.B + '</span>';
  }).join('');
  // Stats
  const totalPtsA = (liveScore.events || []).filter(function(e){return e.side==='A';}).length;
  const totalPtsB = (liveScore.events || []).filter(function(e){return e.side==='B';}).length;
  el('result-stats').innerHTML =
    '<div class="stat-cell"><div class="stat-val" style="color:var(--teal)">' + totalPtsA + '</div><div class="stat-lbl">نقاط ' + nameA + '</div></div>' +
    '<div class="stat-cell"><div class="stat-val" style="color:var(--amber)">' + totalPtsB + '</div><div class="stat-lbl">نقاط ' + nameB + '</div></div>' +
    '<div class="stat-cell"><div class="stat-val">' + sA + '</div><div class="stat-lbl">أشواط ' + nameA + '</div></div>' +
    '<div class="stat-cell"><div class="stat-val">' + sB + '</div><div class="stat-lbl">أشواط ' + nameB + '</div></div>';
  // Events log
  const evLog = el('result-event-log');
  const evs = liveScore.events || [];
  if (evs.length) {
    evLog.innerHTML = evs.slice().reverse().map(function(ev) {
      return '<div class="log-item"><span style="color:' + (ev.side==='A'?'var(--teal)':'var(--amber)') + ';font-weight:700">' + (ev.side==='A'?nameA:nameB) + '</span><span style="color:var(--text2)">' + ev.scoreA + ' : ' + ev.scoreB + '</span><span style="color:var(--faint)">' + (ev.time||'') + '</span></div>';
    }).join('');
  } else {
    evLog.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:11px">لا أحداث مسجلة</div>';
  }
  // Serve leaderboard
  const top3 = getTopServers(3);
  const medals = ['🥇','🥈','🥉'];
  const leaderEl = document.getElementById('result-serve-leaders');
  if (leaderEl) {
    leaderEl.innerHTML = top3.length ? top3.map(function(p,i){
      const total = p.aces + p.faults + p.normals;
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface2);border-radius:10px;margin-bottom:6px">' +
        '<span style="font-size:20px">' + medals[i] + '</span>' +
        '<div style="flex:1">' +
          '<div style="font-size:12px;font-weight:700">' + p.name + '</div>' +
          '<div style="font-size:10px;color:var(--muted)">' +
            '<span style="color:var(--teal)">⚡ ' + p.aces + ' إيس</span>  ' +
            '<span style="color:var(--red)">❌ ' + p.faults + ' خطأ</span>  ' +
            '<span style="color:var(--text2)">▶ ' + p.normals + ' عادي</span>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:14px;font-weight:900;color:var(--amber)">' + (p.aces*3 + p.normals) + ' نقطة</div>' +
      '</div>';
    }).join('') : '<div style="text-align:center;padding:16px;color:var(--muted);font-size:11px">لا إحصائيات إرسال بعد</div>';
  }
  show('scr-result');
};

// ── BACK ──
window.backToMatches = () => {
  if (unsub) { unsub(); unsub = null; }
  currentMatch = null;
  loadMatches();
  show('scr-matches');
};

// ── SERVE TRACKING ──
function showServeModal() {
  if (!pendingServeInfo || !pendingServeInfo.player) return;
  const modal = document.getElementById('serve-modal');
  const lbl = document.getElementById('serve-player-name');
  if (!modal) return;
  if (lbl) lbl.textContent = pendingServeInfo.player.name;
  modal.style.display = 'flex';
}

window.recordServe = function(type) {
  const modal = document.getElementById('serve-modal');
  if (modal) modal.style.display = 'none';
  if (!pendingServeInfo || !pendingServeInfo.player) return;
  const p = pendingServeInfo.player;
  const all = JSON.parse(localStorage.getItem(serveStatsKey) || '{}');
  if (!all[p.id]) all[p.id] = { name: p.name, aces: 0, faults: 0, normals: 0 };
  all[p.id].name = p.name;
  if (type === 'ace') all[p.id].aces++;
  else if (type === 'fault') all[p.id].faults++;
  else all[p.id].normals++;
  localStorage.setItem(serveStatsKey, JSON.stringify(all));
  if (!liveScore.serveStats) liveScore.serveStats = {};
  if (!liveScore.serveStats[p.id]) liveScore.serveStats[p.id] = { name: p.name, aces: 0, faults: 0, normals: 0 };
  if (type === 'ace') liveScore.serveStats[p.id].aces++;
  else if (type === 'fault') liveScore.serveStats[p.id].faults++;
  else liveScore.serveStats[p.id].normals++;
  pendingServeInfo = null;
  toast(type === 'ace' ? '⚡ إرسال بنقطة!' : type === 'fault' ? '❌ إرسال ضائع' : '▶ إرسال عادي');
};

window.dismissServeModal = function() {
  const modal = document.getElementById('serve-modal');
  if (modal) modal.style.display = 'none';
  pendingServeInfo = null;
};

function getTopServers(n) {
  const all = JSON.parse(localStorage.getItem(serveStatsKey) || '{}');
  return Object.values(all)
    .sort(function(a,b){ return (b.aces*3 + b.normals) - (a.aces*3 + a.normals); })
    .slice(0, n);
}

// ── MATCH FILTER ──
window.allMatches = [];
window.currentFilter = 'all';

window.filterMatches = function(status) {
  window.currentFilter = status;
  document.querySelectorAll('.filter-tab').forEach(function(b){
    b.classList.remove('active');
    b.classList.add('btn-ghost');
    b.classList.remove('btn-primary');
  });
  const activeBtn = document.querySelector('.filter-tab[data-status="' + status + '"]');
  if (activeBtn) { activeBtn.classList.add('active','btn-primary'); activeBtn.classList.remove('btn-ghost'); }
  applyMatchFilter(status);
};

window.applyMatchFilter = function applyMatchFilter(status) {
  if (!currentRef) return;
  const isAdmin = currentRef.id === 'admin';
  let matches = (window.allMatches || []).slice();
  // Admin sees all; referee sees only assigned
  if (!isAdmin) matches = matches.filter(function(m){ return m.referee === currentRef.id; });
  // Status filter
  if (status && status !== 'all') matches = matches.filter(function(m){ return m.status === status; });
  const order = { playing: 0, pending: 1, completed: 2 };
  matches.sort(function(a,b){ return (order[a.status]||1)-(order[b.status]||1); });
  const list = document.getElementById('matches-list');
  const title = document.getElementById('matches-title');
  const sub = document.getElementById('matches-subtitle');
  if (title) title.textContent = isAdmin ? 'جميع المباريات' : 'مباراياتي';
  if (sub) sub.textContent = matches.length + ' مباراة';
  if (!matches.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:12px">لا توجد مباريات' + (isAdmin?'':' مخصصة لك') + '</div>';
    return;
  }
  list.innerHTML = matches.map(function(m) {
    const nameA = m.teamA ? (m.teamA.name || m.teamA) : (m.teamAName || '؟');
    const nameB = m.teamB ? (m.teamB.name || m.teamB) : (m.teamBName || '؟');
    const st = m.status || 'pending';
    const badgeCls = st==='playing'?'b-live':st==='completed'?'b-done':'b-pending';
    const badgeTxt = st==='playing'?'● مباشر':st==='completed'?'✓ منتهية':'⏳ قادمة';
    const sc = st==='completed'?(m.sets?m.sets.teamA+'-'+m.sets.teamB:''):st==='playing'?(m.score?(m.score.A||0)+':'+(m.score.B||0)+' نقطة':''):'';
    const adminBadge = isAdmin && m.referee ? '<span class="badge b-admin">لها حكم</span>' : (isAdmin?'<span class="badge b-pending">بلا حكم</span>':'');
    return '<div class="mc ' + st + '" onclick="openMatch(\'' + m.id + '\')">' +
      '<div class="match-teams">' +
        '<span style="color:var(--teal)">' + nameA + '</span>' +
        '<span style="color:var(--faint);font-size:11px">' + (sc||'VS') + '</span>' +
        '<span style="color:var(--amber)">' + nameB + '</span>' +
      '</div>' +
      '<div class="match-meta">' +
        '<span class="badge ' + badgeCls + '">' + badgeTxt + '</span>' +
        (m.groupId?'<span>مجموعة ' + m.groupId + '</span>':'') +
        (m.round?'<span>جولة ' + m.round + '</span>':'') +
        adminBadge +
      '</div>' +
    '</div>';
  }).join('');
};

// ── LOGOUT ──
window.doLogout = () => {
  if (unsub) { unsub(); unsub = null; }
  currentRef = null; currentMatch = null;
  document.getElementById('ref-badge').textContent = 'تسجيل الدخول';
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('inp-name').value = '';
  document.getElementById('inp-pass').value = '';
  show('scr-login');
  toast('تم تسجيل الخروج');
};
