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
    // Check referees collection
    let snap;
    try { snap = await getDocs(collection(db, 'referees')); } catch(e) { /* offline */ }
    
    let found = null;
    if (snap) {
        const refs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        found = refs.find(r => r.name === name && r.password === pass);
    }
    
    // If not found in Firebase (or offline), check local storage (unsynced referees)
    if (!found) {
        const localRefs = JSON.parse(localStorage.getItem('mvl_referees') || '[]');
        found = localRefs.find(r => r.name === name && r.password === pass);
    }

    if (found) {
      currentRef = found;
      document.getElementById('ref-badge').textContent = found.name;
      document.getElementById('btn-logout').style.display = 'inline-block';
      await loadMatches();
      show('scr-matches');
      toast(`مرحباً ${found.name} 👋`);
    } else {
      // Check admin
      let settings = { adminUsername: 'admin', adminPassword: 'admin' };
      try {
          const settSnap = await getDocs(collection(db, 'settings'));
          if (!settSnap.empty) settings = settSnap.docs[0].data();
      } catch(e) {
          const localSet = JSON.parse(localStorage.getItem('mvl_settings') || 'null');
          if (localSet) settings = localSet;
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
    const snap = await getDocs(collection(db, 'matches'));
    let matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // If not admin, filter by assigned referee
    if (currentRef.id !== 'admin') {
      matches = matches.filter(m => m.referee === currentRef.id || !m.referee);
    }

    if (!matches.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:12px">لا توجد مباريات مخصصة</div>';
      return;
    }

    // Sort: playing first, then pending, then completed
    const order = { playing: 0, pending: 1, completed: 2 };
    matches.sort((a, b) => (order[a.status] || 1) - (order[b.status] || 1));

    list.innerHTML = matches.map(m => {
      const nameA = m.teamA?.name || m.teamAName || '؟';
      const nameB = m.teamB?.name || m.teamBName || '؟';
      const status = m.status || 'pending';
      const badgeCls = status === 'playing' ? 'b-live' : status === 'completed' ? 'b-done' : 'b-pending';
      const badgeTxt = status === 'playing' ? '● مباشر' : status === 'completed' ? '✓ منتهية' : '⏳ قادمة';
      const scoreStr = status === 'completed'
        ? `${m.sets?.teamA || 0} - ${m.sets?.teamB || 0}`
        : status === 'playing'
        ? `${m.score?.A || 0} / ${m.score?.B || 0} نقطة`
        : '';

      return `<div class="mc ${status}" onclick="openMatch('${m.id}')">
        <div class="match-teams">
          <span style="color:var(--teal)">${nameA}</span>
          <span style="color:var(--faint);font-size:11px">${scoreStr || 'VS'}</span>
          <span style="color:var(--amber)">${nameB}</span>
        </div>
        <div class="match-meta">
          <span class="badge ${badgeCls}">${badgeTxt}</span>
          ${m.groupId ? `<span>مجموعة ${m.groupId}</span>` : ''}
          ${m.round ? `<span>جولة ${m.round}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red);font-size:12px">فشل تحميل المباريات. تحقق من الاتصال.</div>';
  }
};

// ── OPEN MATCH ──
window.openMatch = async (matchId) => {
  try {
    const snap = await getDocs(collection(db, 'matches'));
    const matchDoc = snap.docs.find(d => d.id === matchId);
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
      await updateDoc(doc(db, 'matches', matchId), {
        status: 'playing',
        referee: currentRef.id,
        startedAt: serverTimestamp()
      });
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
        
        const snap = await getDocs(collection(db, 'players'));
        const players = snap.docs.map(d => ({id: d.id, ...d.data()}));
        window.availablePlayersA = players.filter(p => p.teamId === teamAId);
        window.availablePlayersB = players.filter(p => p.teamId === teamBId);
        
        window.updateLineupUI();
    } catch(e) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">فشل تحميل اللاعبين.</div>';
    }
};

window.updateLineupUI = () => {
    const container = document.getElementById('lineup-form-container');
    const nameA = currentMatch.teamA?.name || currentMatch.teamAName || 'فريق أ';
    const nameB = currentMatch.teamB?.name || currentMatch.teamBName || 'فريق ب';
    
    const playedA = liveScore.playedA || [];
    const playedB = liveScore.playedB || [];

    const renderSide = (side, players, played, name, color) => {
        const sel = window.lineupSelections[side];
        return `
          <div class="card" style="margin-bottom:10px">
            <h3 style="color:${color};margin-bottom:10px;font-size:12px">${name} <span style="color:var(--text2);font-size:10px">(اختر بالترتيب المطلوب للإرسال)</span></h3>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${players.map(p => {
                  if (played.includes(p.id)) {
                      return \`<div style="padding:6px 10px;border-radius:6px;font-size:11px;background:var(--surface);color:var(--muted);opacity:0.6;border:1px dashed var(--border)">\${p.name} (لعب سابقاً)</div>\`;
                  }
                  const selIdx = sel.findIndex(s => s.id === p.id);
                  const isSel = selIdx > -1;
                  const bg = isSel ? color : 'var(--surface2)';
                  const txt = isSel ? '#000' : 'var(--text)';
                  const badge = isSel ? \`<span style="background:rgba(255,255,255,0.8);color:#000;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;margin-right:6px;font-weight:bold">\${selIdx + 1}</span>\` : '';
                  
                  return \`<div onclick="toggleLineupPlayer('\${side}', '\${p.id}', '\${p.name.replace(/'/g, "\\\\'")}')" 
                               style="padding:6px 10px;border-radius:6px;font-size:11px;background:\${bg};color:\${txt};cursor:pointer;display:flex;align-items:center;font-weight:\${isSel?'bold':'normal'};user-select:none">
                            \${p.name} \${badge}
                          </div>\`;
              }).join('')}
              ${players.length === 0 ? '<div style="font-size:10px;color:var(--muted)">لا يوجد لاعبين مسجلين</div>' : ''}
            </div>
          </div>
        `;
    };

    container.innerHTML = renderSide('A', window.availablePlayersA, playedA, nameA, 'var(--teal)') +
                          renderSide('B', window.availablePlayersB, playedB, nameB, 'var(--amber)');
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

window.saveLineup = async () => {
    const chkA = window.lineupSelections.A;
    const chkB = window.lineupSelections.B;
    
    if (chkA.length < 4 || chkA.length > 7) { toast('فريق أ: اختر من 4 إلى 7 لاعبين للتشكيل'); return; }
    if (chkB.length < 4 || chkB.length > 7) { toast('فريق ب: اختر من 4 إلى 7 لاعبين للتشكيل'); return; }
    
    liveScore.lineupA = [...chkA];
    liveScore.lineupB = [...chkB];
    
    await saveScore();
    renderBoard();
    show('scr-live');
};

// ── RENDER BOARD ──
function renderBoard() {
  document.getElementById('board-score-a').textContent = liveScore.A;
  document.getElementById('board-score-b').textContent = liveScore.B;
  document.getElementById('sets-a').textContent = liveScore.setsA;
  document.getElementById('sets-b').textContent = liveScore.setsB;

  const limit = liveScore.set === 5 ? 15 : 25;
  document.getElementById('set-info').textContent = `الشوط ${liveScore.set} / ${limit} نقطة للفوز`;

  const nameA = document.getElementById('board-name-a').textContent;
  const nameB = document.getElementById('board-name-b').textContent;
  let servingPlayer = '—';
  const sIndex = liveScore.servesInBlock || 0;
  if (liveScore.serving === 'A' && liveScore.lineupA && liveScore.lineupA.length > sIndex) {
      servingPlayer = liveScore.lineupA[sIndex].name;
  } else if (liveScore.serving === 'B' && liveScore.lineupB && liveScore.lineupB.length > sIndex) {
      servingPlayer = liveScore.lineupB[sIndex].name;
  }
  document.getElementById('serving-info').textContent = `المرسل: ${servingPlayer} (الإرسال ${sIndex + 1} من 4)`;

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

// ── SAVE TO FIREBASE ──
async function saveScore() {
  if (!currentMatch) return;
  saving = true;
  const syncEl = document.getElementById('sync-status');
  if (syncEl) { syncEl.textContent = '● جاري الحفظ...'; syncEl.style.color = 'var(--amber)'; }

  try {
    await updateDoc(doc(db, 'matches', currentMatch.id), { score: liveScore });
    if (syncEl) { syncEl.textContent = '✓ تم الحفظ'; syncEl.style.color = 'var(--green)'; }
  } catch (e) {
    if (syncEl) { syncEl.textContent = '⚠ فشل الحفظ'; syncEl.style.color = 'var(--red)'; }
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
    await endMatch(); return;
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
window.endMatch = async () => {
  if (!currentMatch) return;
  if (!confirm('هل أنت متأكد من إنهاء المباراة وتسجيل النتيجة النهائية؟')) return;

  try {
    await updateDoc(doc(db, 'matches', currentMatch.id), {
      status: 'completed',
      score: liveScore,
      sets: { teamA: liveScore.setsA, teamB: liveScore.setsB },
      endedAt: serverTimestamp()
    });
    toast('✓ تم تسجيل نتيجة المباراة بنجاح!');
    if (unsub) { unsub(); unsub = null; }
    setTimeout(() => backToMatches(), 1500);
  } catch (e) {
    toast('فشل في حفظ النتيجة النهائية');
  }
};

// ── BACK ──
window.backToMatches = () => {
  if (unsub) { unsub(); unsub = null; }
  currentMatch = null;
  loadMatches();
  show('scr-matches');
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
