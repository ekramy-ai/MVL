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
    const snap = await getDocs(collection(db, 'referees'));
    const refs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const found = refs.find(r => r.name === name && r.password === pass);

    if (found) {
      currentRef = found;
      document.getElementById('ref-badge').textContent = found.name;
      document.getElementById('btn-logout').style.display = 'inline-block';
      await loadMatches();
      show('scr-matches');
      toast(`مرحباً ${found.name} 👋`);
    } else {
      // Check admin
      const settSnap = await getDocs(collection(db, 'settings'));
      const settings = settSnap.empty ? { adminUsername: 'admin', adminPassword: 'admin' } : settSnap.docs[0].data();
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
    // Fallback: localStorage
    const localRefs = JSON.parse(localStorage.getItem('mvl_referees') || '[]');
    const found = localRefs.find(r => r.name === name && r.password === pass);
    if (found) {
      currentRef = found;
      document.getElementById('ref-badge').textContent = found.name;
      document.getElementById('btn-logout').style.display = 'inline-block';
      await loadMatches();
      show('scr-matches');
      toast(`مرحباً ${found.name} (وضع أوفلاين)`);
    } else {
      errEl.style.display = 'block';
      errEl.textContent = 'فشل الاتصال أو بيانات خاطئة';
    }
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
        events: m.score.events || []
      };
    } else {
      liveScore = { A: 0, B: 0, setsA: 0, setsB: 0, set: 1, serving: 'A', events: [] };
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
window.renderLineupForm = async () => {
    const container = document.getElementById('lineup-form-container');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">جاري تحميل اللاعبين...</div>';
    
    try {
        const teamAId = currentMatch.teamA?.id || currentMatch.teamA;
        const teamBId = currentMatch.teamB?.id || currentMatch.teamB;
        
        const snap = await getDocs(collection(db, 'players'));
        const players = snap.docs.map(d => ({id: d.id, ...d.data()}));
        const playersA = players.filter(p => p.teamId === teamAId);
        const playersB = players.filter(p => p.teamId === teamBId);
        
        const nameA = currentMatch.teamA?.name || currentMatch.teamAName || 'فريق أ';
        const nameB = currentMatch.teamB?.name || currentMatch.teamBName || 'فريق ب';
        
        let html = `
          <div class="card" style="margin-bottom:10px">
            <h3 style="color:var(--teal);margin-bottom:10px;font-size:12px">${nameA}</h3>
            <div id="sel-players-a" style="display:flex;flex-wrap:wrap;gap:6px">
              ${playersA.map(p => `
                <label style="display:flex;align-items:center;gap:4px;background:var(--surface2);padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer">
                  <input type="checkbox" value="${p.id}" data-name="${p.name}"> ${p.name}
                </label>
              `).join('')}
              ${playersA.length === 0 ? '<div style="font-size:10px;color:var(--muted)">لا يوجد لاعبين مسجلين</div>' : ''}
            </div>
          </div>
          <div class="card" style="margin-bottom:10px">
            <h3 style="color:var(--amber);margin-bottom:10px;font-size:12px">${nameB}</h3>
            <div id="sel-players-b" style="display:flex;flex-wrap:wrap;gap:6px">
              ${playersB.map(p => `
                <label style="display:flex;align-items:center;gap:4px;background:var(--surface2);padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer">
                  <input type="checkbox" value="${p.id}" data-name="${p.name}"> ${p.name}
                </label>
              `).join('')}
              ${playersB.length === 0 ? '<div style="font-size:10px;color:var(--muted)">لا يوجد لاعبين مسجلين</div>' : ''}
            </div>
          </div>
        `;
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">فشل تحميل اللاعبين.</div>';
    }
};

window.saveLineup = async () => {
    const chkA = Array.from(document.querySelectorAll('#sel-players-a input:checked'));
    const chkB = Array.from(document.querySelectorAll('#sel-players-b input:checked'));
    
    if (chkA.length < 4 || chkA.length > 7) { toast('فريق أ: اختر من 4 إلى 7 لاعبين للتشكيل'); return; }
    if (chkB.length < 4 || chkB.length > 7) { toast('فريق ب: اختر من 4 إلى 7 لاعبين للتشكيل'); return; }
    
    liveScore.lineupA = chkA.map(el => ({ id: el.value, name: el.dataset.name }));
    liveScore.lineupB = chkB.map(el => ({ id: el.value, name: el.dataset.name }));
    
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
  if (liveScore.serving === 'A' && liveScore.lineupA) servingPlayer = liveScore.lineupA[0].name;
  else if (liveScore.serving === 'B' && liveScore.lineupB) servingPlayer = liveScore.lineupB[0].name;
  document.getElementById('serving-info').textContent = `المرسل: ${servingPlayer}`;

  const diff = Math.abs(liveScore.A - liveScore.B);
  if ((liveScore.A >= 25 || liveScore.B >= 25) && diff >= 2) {
      document.getElementById('set-info').textContent = '✨ الشوط منتهي (اضغط إنهاء الشوط)';
      document.getElementById('set-info').style.color = 'var(--green)';
  } else {
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
  
  const oldServing = liveScore.serving;
  liveScore[side]++;
  liveScore.serving = side;

  // Rotation logic: If regaining the serve (side-out)
  if (oldServing !== side && (liveScore.A > 0 || liveScore.B > 0)) {
      if (side === 'A' && liveScore.lineupA && liveScore.lineupA.length > 0) {
          liveScore.lineupA.push(liveScore.lineupA.shift());
      } else if (side === 'B' && liveScore.lineupB && liveScore.lineupB.length > 0) {
          liveScore.lineupB.push(liveScore.lineupB.shift());
      }
  }

  const now = new Date();
  liveScore.events = liveScore.events || [];
  liveScore.events.push({
    side, scoreA: liveScore.A, scoreB: liveScore.B,
    time: `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`
  });

  renderBoard();
  await saveScore();
};

// ── UNDO ──
window.undoPoint = async (side) => {
  if (!currentMatch || liveScore[side] <= 0) return;
  liveScore[side]--;
  if (liveScore.events && liveScore.events.length) liveScore.events.pop();
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

  // Check if match over (best of 3)
  if (liveScore.setsA === 2 || liveScore.setsB === 2) {
    await endMatch(); return;
  }

  liveScore.set++;
  liveScore.A = 0;
  liveScore.B = 0;
  liveScore.lineupA = null; // Clear lineup for the new set
  liveScore.lineupB = null;
  
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
