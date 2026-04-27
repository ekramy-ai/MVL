import { DB } from './db.js';
import { calculatePlayerPPS, calculateTeamPPS } from './ppsCalculator.js';
import { clusterTeams } from './clustering.js';
import { generateGroups, generateMatches } from './matchmaker.js';
import { calculateTeamStats } from './scoring.js';

// --- State ---
let state = {
    teams: [],
    players: [],
    matches: [],
    referees: [],
    currentRound: 1,
    matches: [],
    referees: [],
    currentRound: 1,
    activeMatchId: null,
    currentUserRole: null,
    filters: { group: '', team: '' }
};

// --- Initialization ---
const init = async () => {
    // 1. Setup UI Listeners immediately (Interactive UI)
    setupNavigation();
    setupForms();
    setupActions();
    setupRefereeBoard();
    
    // Initial empty render
    renderTeamsSelect();
    
    // Auth Listener
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const un = document.getElementById('login-username').value;
            const pw = document.getElementById('login-password').value;
            const settings = await DB.getSettings();
            
            if (un === settings.adminUsername && pw === settings.adminPassword) {
                state.currentUserRole = 'admin';
                finishLogin('المدير (Admin)');
                document.querySelector('.nav-item[data-view="dashboard"]').click();
            } else {
                const ref = state.referees.find(r => r.name === un && r.password === pw);
                if (ref) {
                    state.currentUserRole = ref.id;
                    finishLogin(ref.name);
                    document.querySelector('.nav-item[data-view="referee"]').click();
                } else {
                    alert('بيانات الدخول غير صحيحة');
                }
            }
        });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            state.currentUserRole = null;
            document.getElementById('current-user-display').textContent = 'غير مسجل الدخول';
            btnLogout.classList.add('hidden');
            
            document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
            document.getElementById('view-dashboard').classList.add('active');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelector('.nav-item[data-view="dashboard"]').classList.add('active');
            
            updateUI();
        });
    }

    const btnLoginTop = document.getElementById('btn-login-top');
    if (btnLoginTop) {
        btnLoginTop.addEventListener('click', () => {
            document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
            document.getElementById('view-login').classList.add('active');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        });
    }
    
    // 2. Load data in background
    try {
        await loadData();
        // Update render after data arrives
        renderTeamsSelect();
        updateUI();
    } catch (e) {
        console.error("Data loading failed", e);
    }
};

const loadData = async () => {
    state.teams = await DB.getTeams();
    state.players = await DB.getPlayers();
    state.matches = await DB.getMatches();
    state.referees = await DB.getReferees() || [];
    
    // Recalculate PPS in memory
    state.teams.forEach(t => {
        t.pps = calculateTeamPPS(t.id, state.players);
    });
};

const finishLogin = (name) => {
    document.getElementById('current-user-display').textContent = name;
    document.getElementById('btn-logout').classList.remove('hidden');
    
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.getElementById('view-dashboard').classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-view="dashboard"]').classList.add('active');
    
    updateNavVisibility();
    updateUI();
};

// --- Navigation ---
const setupNavigation = () => {
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.addEventListener('click', (e) => {
            e.preventDefault();
            const view = nav.dataset.view;
            
            // Access control logic
            const publicViews = ['dashboard', 'pots', 'matchmaker', 'history', 'login'];
            if (!publicViews.includes(view)) {
                if (!state.currentUserRole) {
                    alert(currentLang === 'ar' ? 'يجب تسجيل الدخول للوصول إلى هذه الصفحة' : 'Login required');
                    return;
                }
                if (state.currentUserRole === 'referee' && view !== 'referee') {
                    alert(currentLang === 'ar' ? 'صلاحيات غير كافية' : 'Insufficient permissions');
                    return;
                }
            }

            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
            
            nav.classList.add('active');
            const viewId = `view-${view}`;
            document.getElementById(viewId).classList.add('active');
            
            updateUI(); // Refresh data on view change
        });
    });
};

const updateNavVisibility = () => {
    const sidebar = document.querySelector('.sidebar');
    
    if (!state.currentUserRole) {
        if (sidebar) sidebar.style.display = 'none';
    } else {
        if (sidebar) {
            // Desktop: flex column, Mobile: flex row
            sidebar.style.display = 'flex';
        }
    }

    document.querySelectorAll('.nav-item').forEach(nav => {
        const view = nav.dataset.view;
        const publicViews = ['dashboard', 'pots', 'matchmaker', 'history'];
        
        if (view === 'login') {
            nav.style.display = 'none';
            return;
        }

        if (state.currentUserRole === 'admin') {
            nav.style.display = 'flex';
        } else if (state.currentUserRole === 'referee' && (view === 'referee' || publicViews.includes(view))) {
            nav.style.display = 'flex';
        } else {
            nav.style.display = 'none';
        }
    });

    // Hide/Show Admin Buttons in Public Views
    const adminButtons = [
        document.getElementById('btn-generate-groups'),
        document.getElementById('btn-cluster-teams')
    ];
    adminButtons.forEach(btn => {
        if(btn) btn.style.display = state.currentUserRole === 'admin' ? 'inline-block' : 'none';
    });

    const btnLoginTop = document.getElementById('btn-login-top');
    if (btnLoginTop) {
        btnLoginTop.style.display = state.currentUserRole ? 'none' : 'inline-block';
    }
};

// --- Forms ---
const setupForms = () => {
    document.getElementById('add-team-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('team-name').value;
        const region = document.getElementById('team-region').value;
        
        await DB.addTeam({ name, region, pps: 0 });
        await loadData();
        renderTeamsSelect();
        e.target.reset();
        alert('تم إضافة الفريق بنجاح');
    });

    document.getElementById('add-player-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const teamId = document.getElementById('player-team-select').value;
        const player = {
            teamId,
            name: document.getElementById('player-name').value,
            age: parseInt(document.getElementById('player-age').value),
            height: parseInt(document.getElementById('player-height').value),
            reach: parseInt(document.getElementById('player-reach').value),
            jump: parseInt(document.getElementById('player-jump').value),
        };
        
        // Calculate player PPS before adding
        player.pps = calculatePlayerPPS(player, state.players);
        
        await DB.addPlayer(player);
        await loadData(); // Reloads and updates team PPS
        
        // Update team in DB with new PPS
        const team = state.teams.find(t => t.id === teamId);
        if(team) await DB.updateTeam(teamId, { pps: team.pps });
        
        e.target.reset();
        alert('تم إضافة اللاعب وحساب مستوى الأداء (PPS) بنجاح');
    });

    const addRefereeForm = document.getElementById('add-referee-form');
    if (addRefereeForm) {
        addRefereeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('referee-name').value;
            const grade = document.getElementById('referee-grade').value;
            const password = document.getElementById('referee-password').value;
            await DB.addReferee({ name, grade, password });
            await loadData();
            updateUI();
            e.target.reset();
            alert(currentLang === 'ar' ? 'تم إضافة الحكم بنجاح' : 'Referee added successfully');
        });
    }
};

// --- Actions ---
const setupActions = () => {
    document.getElementById('btn-migrate-firebase')?.addEventListener('click', async () => {
        if (confirm(currentLang === 'ar' ? 'هل أنت متأكد أنك تريد رفع جميع البيانات المحلية الحالية إلى قاعدة بيانات Firebase السحابية؟' : 'Are you sure you want to migrate all local data to Firebase?')) {
            const btn = document.getElementById('btn-migrate-firebase');
            btn.textContent = currentLang === 'ar' ? 'جاري الرفع...' : 'Migrating...';
            btn.disabled = true;
            const success = await DB.migrateLocalToFirebase();
            if (success) {
                alert(currentLang === 'ar' ? 'تم رفع البيانات بنجاح! النظام الآن يعمل سحابياً.' : 'Data migrated successfully! System is now online.');
            } else {
                alert(currentLang === 'ar' ? 'حدث خطأ أثناء رفع البيانات. تحقق من الاتصال.' : 'Error migrating data. Check your connection.');
            }
            btn.textContent = currentLang === 'ar' ? 'رفع البيانات المحلية إلى السحابة (Firebase)' : 'Migrate Local Data to Firebase';
            btn.disabled = false;
        }
    });

    document.getElementById('btn-cluster-teams').addEventListener('click', () => {
        renderPots();
        alert('تم تحديث وتصنيف الفرق حسب المستويات (Pots)');
    });

    document.getElementById('btn-generate-groups').addEventListener('click', async () => {
        const pots = clusterTeams(state.teams);
        const groups = generateGroups(pots);
        const matches = generateMatches(groups, state.currentRound);
        
        for (const m of matches) {
            await DB.addMatch(m);
        }
        
        await loadData();
        renderGroupsAndMatches(groups);
        alert('تم توليد المجموعات والمباريات لهذه الجولة');
    });

    const btnGenerateTeams = document.getElementById('btn-generate-teams-from-file');
    const teamsFileInput = document.getElementById('teams-file-input');
    if (btnGenerateTeams && teamsFileInput) {
        btnGenerateTeams.addEventListener('click', () => {
            const file = teamsFileInput.files[0];
            if (!file) {
                alert('الرجاء اختيار ملف أولاً');
                return;
            }

            btnGenerateTeams.disabled = true;
            btnGenerateTeams.textContent = "جاري قراءة الملف...";

            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                
                if (lines.length === 0) {
                    alert('الملف فارغ أو لا يحتوي على أسماء صالحة');
                    btnGenerateTeams.disabled = false;
                    btnGenerateTeams.textContent = "توليد الفرق من الملف";
                    return;
                }

                btnGenerateTeams.textContent = "جاري مسح البيانات السابقة...";
                await DB.clearAll();

                let processed = 0;
                for (const teamName of lines) {
                    btnGenerateTeams.textContent = `جاري إضافة ${teamName}...`;
                    await DB.addTeam({ name: teamName, region: 'محلي', pps: 0 });
                    processed++;
                }

                await loadData();
                renderTeamsSelect();
                alert(`نجاح! تم إضافة ${processed} فريق من الملف.`);
                btnGenerateTeams.disabled = false;
                btnGenerateTeams.textContent = "توليد الفرق من الملف";
            };
            reader.onerror = () => {
                alert('حدث خطأ أثناء قراءة الملف');
                btnGenerateTeams.disabled = false;
                btnGenerateTeams.textContent = "توليد الفرق من الملف";
            };
            reader.readAsText(file);
        });
    }

    const btnAddPlayersFromFile = document.getElementById('btn-add-players-from-file');
    const teamPlayersFileInput = document.getElementById('team-players-file-input');
    
    if (btnAddPlayersFromFile && teamPlayersFileInput) {
        btnAddPlayersFromFile.addEventListener('click', () => {
            const teamId = document.getElementById('player-team-select').value;
            if (!teamId) {
                alert(currentLang === 'ar' ? 'الرجاء اختيار الفريق أولاً من القائمة' : 'Please select a team first');
                return;
            }

            const file = teamPlayersFileInput.files[0];
            if (!file) {
                alert(currentLang === 'ar' ? 'الرجاء اختيار ملف الأسماء أولاً' : 'Please select a file first');
                return;
            }

            btnAddPlayersFromFile.disabled = true;
            btnAddPlayersFromFile.textContent = currentLang === 'ar' ? "جاري قراءة الملف..." : "Reading file...";

            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                
                if (lines.length === 0) {
                    alert(currentLang === 'ar' ? 'الملف فارغ أو لا يحتوي على أسماء صالحة' : 'File is empty or invalid');
                    btnAddPlayersFromFile.disabled = false;
                    btnAddPlayersFromFile.textContent = currentLang === 'ar' ? "إضافة من الملف" : "Add from file";
                    return;
                }

                let processed = 0;
                const maxVals = { maxH: 165, maxR: 175, maxJ: 45 };
                
                for (const playerName of lines) {
                    const player = {
                        teamId: teamId,
                        name: playerName,
                        age: Math.floor(Math.random() * (12 - 9 + 1)) + 9,
                        height: Math.floor(Math.random() * (maxVals.maxH - 130 + 1)) + 130,
                        reach: Math.floor(Math.random() * (maxVals.maxR - 140 + 1)) + 140,
                        jump: Math.floor(Math.random() * (maxVals.maxJ - 20 + 1)) + 20
                    };
                    player.pps = calculatePlayerPPS(player, [], maxVals);
                    await DB.addPlayer(player);
                    processed++;
                }

                await loadData();
                const team = state.teams.find(t => t.id === teamId);
                if(team) await DB.updateTeam(teamId, { pps: team.pps });
                
                alert(currentLang === 'ar' ? `نجاح! تم إضافة ${processed} لاعب للفريق.` : `Success! Added ${processed} players to the team.`);
                btnAddPlayersFromFile.disabled = false;
                btnAddPlayersFromFile.textContent = currentLang === 'ar' ? "إضافة من الملف" : "Add from file";
                teamPlayersFileInput.value = ''; // clear input
            };
            reader.onerror = () => {
                alert(currentLang === 'ar' ? 'حدث خطأ أثناء قراءة الملف' : 'Error reading file');
                btnAddPlayersFromFile.disabled = false;
                btnAddPlayersFromFile.textContent = currentLang === 'ar' ? "إضافة من الملف" : "Add from file";
            };
            reader.readAsText(file);
        });
    }

    const btnClearData = document.getElementById('btn-clear-data');
    if (btnClearData) {
        btnClearData.addEventListener('click', async () => {
            if (confirm('هل أنت متأكد من مسح جميع الفرق واللاعبين والمباريات؟ لا يمكن التراجع عن هذا الإجراء.')) {
                await DB.clearAll();
                await loadData();
                renderTeamsSelect();
                updateUI();
                alert('تم مسح جميع البيانات بنجاح.');
            }
        });
    }

    const btnGeneratePlayers = document.getElementById('btn-generate-players');
    if (btnGeneratePlayers) {
        btnGeneratePlayers.addEventListener('click', async () => {
            if (state.teams.length === 0) {
                alert('لا يوجد فرق حالياً. يرجى إضافة فرق أولاً.');
                return;
            }

            btnGeneratePlayers.disabled = true;
            const originalText = btnGeneratePlayers.textContent;
            
            try {
                const playersPerTeam = 15;
                const maxVals = { maxH: 165, maxR: 175, maxJ: 45 };
                let processed = 0;

                for (const team of state.teams) {
                    btnGeneratePlayers.textContent = `جاري توليد لاعبي فريق ${team.name}...`;
                    
                    const playerPromises = [];
                    for(let j = 1; j <= playersPerTeam; j++) {
                        const player = {
                            teamId: team.id,
                            name: `لاعب ${j} - ${team.name}`,
                            age: Math.floor(Math.random() * 4) + 9,
                            height: Math.floor(Math.random() * 35) + 130,
                            reach: Math.floor(Math.random() * 35) + 140,
                            jump: Math.floor(Math.random() * 25) + 20
                        };
                        player.pps = calculatePlayerPPS(player, [], maxVals);
                        playerPromises.push(DB.addPlayer(player));
                        processed++;
                    }
                    await Promise.all(playerPromises);
                }
                
                // Need to update PPS for all teams after adding players
                for (const team of state.teams) {
                    const teamPlayers = await DB.getPlayers(); // need fresh players or rely on memory
                    const tPlayers = teamPlayers.filter(p => p.teamId === team.id);
                    const newPPS = calculateTeamPPS(team.id, teamPlayers);
                    await DB.updateTeam(team.id, { pps: newPPS });
                }

                await loadData();
                renderTeamsSelect();
                alert(`نجاح! تم توليد وتوزيع ${processed} لاعب آلياً.`);
            } catch (e) {
                console.error(e);
                alert('حدث خطأ أثناء التوليد');
            }

            btnGeneratePlayers.textContent = originalText;
            btnGeneratePlayers.disabled = false;
        });
    }
};

// --- UI Updaters ---
const updateUI = () => {
    updateNavVisibility();
    renderDashboard();
    renderStandings();
    renderPots();
    renderMatchesList();
    renderRefereeSelect();
    renderRefereesTable();
    renderHistoryTable();
};

const renderDashboard = () => {
    const liveContainer = document.getElementById('dash-live-matches');
    const upcomingContainer = document.getElementById('dash-upcoming-matches');
    const groupsContainer = document.getElementById('dash-groups');
    
    if (!liveContainer || !upcomingContainer || !groupsContainer) return;
    
    const createMatchHTML = (m) => {
        const refNameMap = {};
        state.referees.forEach(r => refNameMap[r.id] = r.name);
        
        let scoreDisplay = '<span class="msd" style="color:var(--faint); font-size:16px;">VS</span>';
        if (m.status === 'completed' || m.status === 'playing') {
            const setsA = m.sets ? m.sets.teamA : 0;
            const setsB = m.sets ? m.sets.teamB : 0;
            scoreDisplay = `<span class="msd" style="color:var(--teal); font-size:18px;">${setsA} - ${setsB}</span>`;
        }

        return `
            <div class="mc">
                <div class="mm">
                    <span>المجموعة ${m.groupId} - الجولة ${m.round}</span>
                    <span class="badge ${m.status === 'playing' ? 'ba' : (m.status === 'completed' ? 'bb' : 'ghost')}">
                        ${m.status === 'playing' ? 'جارية' : (m.status === 'completed' ? 'انتهت' : 'لم تبدأ')}
                    </span>
                </div>
                <div class="mt" style="margin-top:8px">
                    <span class="mtn">${m.teamA.name}</span>
                    ${scoreDisplay}
                    <span class="mtn away">${m.teamB.name}</span>
                </div>
                <div style="margin-top: 10px; font-size: 11px; color: var(--text2); text-align: center;">
                    الحكم: ${refNameMap[m.referee] || 'لم يعين'}
                </div>
            </div>
        `;
    };

    const renderMatchesWithLimit = (matches, container, emptyMsg, limit = 2, viewTarget = 'matchmaker') => {
        if (matches.length > 0) {
            const html = matches.slice(0, limit).map(createMatchHTML).join('');
            let btnHtml = '';
            if (matches.length > limit) {
                btnHtml = `<button class="btn ghost btn-full mt-2" style="grid-column: 1/-1; border: 1px dashed var(--faint);" onclick="document.querySelector('.nav-item[data-view=\\'${viewTarget}\\']').click()">عرض باقي المباريات (${matches.length - limit}+)</button>`;
            }
            container.innerHTML = html + btnHtml;
        } else {
            container.innerHTML = `<p style="color: var(--text2); grid-column: 1 / -1; text-align: center;">${emptyMsg}</p>`;
        }
    };

    const liveMatches = state.matches.filter(m => m.status === 'playing' || m.status === 'completed');
    const upcomingMatches = state.matches.filter(m => m.status === 'pending');

    renderMatchesWithLimit(liveMatches, liveContainer, 'لا توجد مباريات جارية أو ملعوبة حالياً.', 2, 'history');
    renderMatchesWithLimit(upcomingMatches, upcomingContainer, 'لا توجد مباريات قادمة.', 2, 'matchmaker');

    if (state.currentGroups && state.currentGroups.length > 0) {
        const groupsHtml = state.currentGroups.slice(0, 2).map((g, i) => `
            <div class="card">
                <div class="card-header" style="justify-content: center;"><h3>المجموعة ${i+1}</h3></div>
                <ul class="team-list">
                    ${g.map(t => `<li><span>${t.name}</span> <span class="badge ghost">PPS: ${t.pps.toFixed(1)}</span></li>`).join('')}
                </ul>
            </div>
        `).join('');
        
        let btnHtml = '';
        if (state.currentGroups.length > 2) {
            btnHtml = `<button class="btn ghost btn-full mt-2" style="grid-column: 1/-1; border: 1px dashed var(--faint);" onclick="document.querySelector('.nav-item[data-view=\\'pots\\']').click()">عرض كل المجموعات</button>`;
        }
        groupsContainer.innerHTML = groupsHtml + btnHtml;
    } else {
        groupsContainer.innerHTML = '<p style="color: var(--text2); grid-column: 1 / -1; text-align: center;">لم يتم توليد المجموعات بعد.</p>';
    }
};

const renderRefereesTable = () => {
    const tbody = document.querySelector('#referees-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.referees.forEach(r => {
        const assignedMatches = state.matches.filter(m => m.referee === r.id).length;
        tbody.innerHTML += `
            <tr>
                <td>${r.name}</td>
                <td>${r.grade || '-'}</td>
                <td>${assignedMatches}</td>
                <td>
                    <button class="btn danger btn-delete-ref" data-id="${r.id}" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">حذف</button>
                </td>
            </tr>
        `;
    });
    
    document.querySelectorAll('.btn-delete-ref').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm('هل أنت متأكد من حذف هذا الحكم؟')) {
                const id = e.target.dataset.id;
                await DB.deleteReferee(id);
                await loadData();
                updateUI();
            }
        });
    });
};

const renderHistoryTable = () => {
    const tbody = document.querySelector('#history-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const completedMatches = state.matches.filter(m => m.status === 'completed');
    
    if (completedMatches.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">لا توجد مباريات مكتملة</td></tr>';
        return;
    }
    
    completedMatches.forEach(m => {
        const ref = state.referees.find(r => r.id === m.referee);
        const refName = ref ? ref.name : 'لم يحدد';
        
        const teamA = state.teams.find(t => t.id === m.teamAId);
        const teamB = state.teams.find(t => t.id === m.teamBId);
        const teamAName = teamA ? teamA.name : (m.teamA ? m.teamA.name : '?');
        const teamBName = teamB ? teamB.name : (m.teamB ? m.teamB.name : '?');
        
        const setsA = m.sets ? m.sets.teamA : 0;
        const setsB = m.sets ? m.sets.teamB : 0;
        
        tbody.innerHTML += `
            <tr>
                <td>${m.groupId || '-'}</td>
                <td>${teamAName}</td>
                <td style="font-weight: bold; color: var(--teal);">${setsA} - ${setsB}</td>
                <td>${teamBName}</td>
                <td>${refName}</td>
            </tr>
        `;
const renderTeamsSelect = () => {
    const select = document.getElementById('player-team-select');
    select.innerHTML = '<option value="">اختر الفريق...</option>';
    state.teams.forEach(t => {
        select.innerHTML += `<option value="${t.id}">${t.name}</option>`;
    });
};

const renderPots = () => {
    const pots = clusterTeams(state.teams);
    ['potA', 'potB', 'potC'].forEach((potKey, index) => {
        const ul = document.querySelector(`#pot-${['a','b','c'][index]} .team-list`);
        ul.innerHTML = '';
        pots[potKey].forEach(t => {
            ul.innerHTML += `<li><span>${t.name}</span> <span class="badge ${index===0?'ba':index===1?'bb':'bc'}">PPS: ${t.pps.toFixed(1)}</span></li>`;
        });
    });
};

const renderGroupsAndMatches = (groups = null) => {
    if (groups) {
        state.currentGroups = groups;
    }
    const groupsContainer = document.getElementById('groups-container');
    if (state.currentGroups && state.currentGroups.length > 0) {
        groupsContainer.innerHTML = state.currentGroups.map((g, i) => `
            <div class="card">
                <div class="card-header"><h3>المجموعة ${i+1}</h3></div>
                <ul class="team-list">
                    ${g.map(t => `<li><span>${t.name}</span> <span class="badge ghost">PPS: ${t.pps.toFixed(1)}</span></li>`).join('')}
                </ul>
            </div>
        `).join('');
    }
    renderMatchesList();
};

const renderMatchesList = () => {
    const container = document.getElementById('matches-container');
    container.innerHTML = '';
    
    // Setup filter options
    const filterGroup = document.getElementById('filter-group');
    const filterTeam = document.getElementById('filter-team');
    
    if (filterGroup && filterGroup.options.length <= 1) {
        const groups = [...new Set(state.matches.map(m => m.groupId))];
        groups.forEach(g => {
            if(g) filterGroup.innerHTML += `<option value="${g}">المجموعة ${g}</option>`;
        });
        filterGroup.addEventListener('change', (e) => { state.filters.group = e.target.value; renderMatchesList(); });
    }
    
    if (filterTeam && filterTeam.options.length <= 1) {
        state.teams.forEach(t => {
            filterTeam.innerHTML += `<option value="${t.id}">${t.name}</option>`;
        });
        filterTeam.addEventListener('change', (e) => { state.filters.team = e.target.value; renderMatchesList(); });
    }

    let pendingMatches = state.matches.filter(m => m.status === 'pending');
    
    if (state.filters.group) {
        pendingMatches = pendingMatches.filter(m => m.groupId === state.filters.group);
    }
    if (state.filters.team) {
        pendingMatches = pendingMatches.filter(m => m.teamAId === state.filters.team || m.teamBId === state.filters.team);
    }
    
    if (pendingMatches.length === 0) {
        container.innerHTML = '<p>لا توجد مباريات مطابقة للبحث.</p>';
        return;
    }

    pendingMatches.forEach(m => {
        const refNameMap = {};
        state.referees.forEach(r => refNameMap[r.id] = r.name);
        
        const refereeOptions = state.referees.map(r => `<option value="${r.id}" ${m.referee === r.id ? 'selected' : ''}>${r.name}</option>`).join('');
        
        const refereeSelect = state.currentUserRole === 'admin' ? `
            <select class="match-referee-select" data-match-id="${m.id}" style="margin-top: 10px; width: 100%; padding: 6px; font-size: 11px; background: var(--surface2); border: 1px solid var(--faint); color: var(--text); border-radius: 6px;">
                <option value="">تعيين حكم...</option>
                ${refereeOptions}
            </select>
        ` : `<div style="margin-top: 10px; font-size: 11px; color: var(--text2);">الحكم: ${refNameMap[m.referee] || 'لم يعين'}</div>`;

        container.innerHTML += `
            <div class="mc">
                <div class="mm">
                    <span>المجموعة ${m.groupId} - الجولة ${m.round}</span>
                    <span class="badge bdraw">Best of 3 Sets</span>
                </div>
                <div class="mt" style="margin-top:8px">
                    <span class="mtn">${m.teamA.name}</span>
                    <span class="msd" style="color:var(--faint); font-size:16px;">VS</span>
                    <span class="mtn away">${m.teamB.name}</span>
                </div>
                ${refereeSelect}
            </div>
        `;
    });

    document.querySelectorAll('.match-referee-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const matchId = e.target.dataset.matchId;
            const ref = e.target.value;
            const match = state.matches.find(m => m.id === matchId);
            if (match) {
                match.referee = ref;
                await DB.updateMatch(matchId, { referee: ref });
                renderRefereeSelect();
            }
        });
    });
};

const renderStandings = () => {
    const tbody = document.querySelector('#standings-table tbody');
    tbody.innerHTML = '';
    
    const stats = calculateTeamStats(state.teams, state.matches);
    const limit = window.dashboardExpandedStandings ? stats.length : 3;
    
    stats.slice(0, limit).forEach((s, index) => {
        tbody.innerHTML += `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${s.team.name}</strong></td>
                <td>${s.played}</td>
                <td>${s.wins}</td>
                <td>${s.losses}</td>
                <td>${(s.winRate * 100).toFixed(1)}%</td>
                <td>${s.cappedPointDiff}</td>
                <td>${(s.pointRatio * 100).toFixed(1)}%</td>
                <td><strong class="badge bb" style="font-size: 12px;">${(s.finalScore * 100).toFixed(1)}</strong></td>
            </tr>
        `;
    });

    if (stats.length > limit) {
        tbody.innerHTML += `
            <tr class="expand-row">
                <td colspan="9" style="text-align: center; padding: 0;">
                    <button class="btn ghost btn-full" style="border-radius: 0; border: none; color: var(--teal); padding: 12px;" onclick="window.dashboardExpandedStandings = true; updateUI();">عرض باقي الترتيب (${stats.length - limit}+)</button>
                </td>
            </tr>
        `;
    }
};

// --- Referee Dashboard ---
const setupRefereeBoard = () => {
    const select = document.getElementById('referee-match-select');
    select.addEventListener('change', async (e) => {
        const matchId = e.target.value;
        if (matchId) {
            state.activeMatchId = matchId;
            const match = state.matches.find(m => m.id === matchId);
            if (!match.rotations) {
                await openLineupModal(match);
                await DB.updateMatch(match.id, { rotations: match.rotations });
            }
            document.getElementById('active-match-board').classList.remove('hidden');
            renderActiveMatch();
        } else {
            document.getElementById('active-match-board').classList.add('hidden');
        }
    });

    document.querySelectorAll('.add-point-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(!state.activeMatchId) return;
            const teamSide = e.target.dataset.team; // 'A' or 'B'
            const match = state.matches.find(m => m.id === state.activeMatchId);
            
            if(match) {
                if (match.score.setsA >= 2 || match.score.setsB >= 2) return;

                // 1. Point added
                match.score[teamSide]++;
                
                // 2. Rotation after EVERY point (as per rule 6)
                rotateTeam(match, 'A');
                rotateTeam(match, 'B');
                
                logMatchEvent(match, `نقطة لـ ${teamSide === 'A' ? match.teamA.name : match.teamB.name}. تدوير الفريقين.`);
                
                // 3. Set/Match win logic...
                const scoreA = match.score.A;
                const scoreB = match.score.B;
                
                if (scoreA >= 25 && scoreA - scoreB >= 2) {
                    match.score.setsA++;
                    match.score.setHistory.push({ A: scoreA, B: scoreB });
                    logMatchEvent(match, `🏆 ${match.teamA.name} يفوز بالشوط!`);
                    match.score.A = 0; match.score.B = 0;
                    if (match.score.setsA < 2 && match.score.setsB < 2) {
                        await resetRotations(match);
                    }
                } else if (scoreB >= 25 && scoreB - scoreA >= 2) {
                    match.score.setsB++;
                    match.score.setHistory.push({ A: scoreA, B: scoreB });
                    logMatchEvent(match, `🏆 ${match.teamB.name} يفوز بالشوط!`);
                    match.score.A = 0; match.score.B = 0;
                    if (match.score.setsA < 2 && match.score.setsB < 2) {
                        await resetRotations(match);
                    }
                }

                if (match.score.setsA >= 2 || match.score.setsB >= 2) {
                    logMatchEvent(match, `🌟 المباراة انتهت!`);
                }

                await DB.updateMatch(match.id, { score: match.score, rotations: match.rotations });
                renderActiveMatch();
            }
        });
    });

    document.getElementById('btn-end-match').addEventListener('click', async () => {
        if(!state.activeMatchId) return;
        const match = state.matches.find(m => m.id === state.activeMatchId);
        if(match) {
            match.status = 'completed';
            await DB.updateMatch(match.id, { status: 'completed' });
            alert('تم إنهاء المباراة بنجاح وسيتم تحديث التصنيف العالمي.');
            document.getElementById('active-match-board').classList.add('hidden');
            select.value = "";
            await loadData();
            updateUI();
        }
    });
};

// --- Rotation Logic ---
const openLineupModal = (match) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('lineup-modal');
        modal.style.display = 'flex';
        
        document.getElementById('lineup-teamA-name').textContent = match.teamA.name;
        document.getElementById('lineup-teamB-name').textContent = match.teamB.name;
        
        const teamAPlayers = state.players.filter(p => p.teamId === match.teamAId);
        const teamBPlayers = state.players.filter(p => p.teamId === match.teamBId);
        
        const renderPlayers = (players, containerId) => {
            const container = document.getElementById(containerId);
            container.innerHTML = players.map(p => `
                <label style="display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.05); padding: 5px; border-radius: 4px; cursor: pointer;">
                    <input type="checkbox" value="${p.id}" class="lineup-cb" data-team="${p.teamId}">
                    <span>${p.name}</span>
                </label>
            `).join('');
            
            // Default check first 4
            const cbs = container.querySelectorAll('.lineup-cb');
            for(let i=0; i<Math.min(4, cbs.length); i++) cbs[i].checked = true;
        };
        
        renderPlayers(teamAPlayers, 'lineup-teamA-players');
        renderPlayers(teamBPlayers, 'lineup-teamB-players');
        
        const saveBtn = document.getElementById('btn-save-lineup');
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        
        newSaveBtn.addEventListener('click', () => {
            const getSelected = (teamId) => {
                const checked = Array.from(document.querySelectorAll(`.lineup-cb[data-team="${teamId}"]:checked`)).map(cb => cb.value);
                const selectedPlayers = state.players.filter(p => checked.includes(p.id));
                return {
                    onCourt: selectedPlayers.slice(0, 4),
                    subs: selectedPlayers.slice(4)
                };
            };
            
            const rotA = getSelected(match.teamAId);
            const rotB = getSelected(match.teamBId);
            
            if (rotA.onCourt.length < 4 || rotB.onCourt.length < 4) {
                alert('يجب اختيار 4 لاعبين على الأقل لكل فريق');
                return;
            }
            
            match.rotations = { A: rotA, B: rotB };
            modal.style.display = 'none';
            resolve();
        });
        
        const cancelBtn = document.getElementById('btn-cancel-lineup');
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        newCancelBtn.addEventListener('click', () => {
             match.rotations = {
                A: { onCourt: teamAPlayers.slice(0, 4), subs: teamAPlayers.slice(4) },
                B: { onCourt: teamBPlayers.slice(0, 4), subs: teamBPlayers.slice(4) }
             };
             modal.style.display = 'none';
             resolve();
        });
    });
};

const rotateTeam = (match, side) => {
    if (!match.rotations) return;
    const rot = match.rotations[side];
    if (rot.onCourt.length < 4) return;

    // Rotation order: 1 -> 4 -> 3 -> 2 -> 1
    // Index mapping for display: [2, 1, 3, 0] (Front-Left, Front-Right, Back-Left, Back-Right/Serve)
    // Shift: player at index 0 (Pos 1) goes to subs, new player comes from subs to Pos 2?
    // Rule: "When a player reaches serve position: → automatic substitution occurs"
    // Let's treat onCourt as [Pos 1, Pos 2, Pos 3, Pos 4]
    
    // 1. Move players: 1->4, 4->3, 3->2, 2->1
    const p1 = rot.onCourt[0];
    const p2 = rot.onCourt[1];
    const p3 = rot.onCourt[2];
    const p4 = rot.onCourt[3];

    // New positions
    rot.onCourt[3] = p1; // 1 to 4
    rot.onCourt[2] = p4; // 4 to 3
    rot.onCourt[1] = p3; // 3 to 2
    rot.onCourt[0] = p2; // 2 to 1 (Reaches serve position)

    // 2. Automatic substitution at Pos 1 (index 0)
    if (rot.subs.length > 0) {
        const playerLeaving = rot.onCourt[0];
        const playerEntering = rot.subs.shift();
        rot.onCourt[0] = playerEntering;
        rot.subs.push(playerLeaving);
        logMatchEvent(match, `تبديل في ${side === 'A' ? match.teamA.name : match.teamB.name}: دخول ${playerEntering.name} وخروج ${playerLeaving.name}`);
    }
};

const resetRotations = async (match) => {
    delete match.rotations;
    await openLineupModal(match);
};

const renderRefereeSelect = () => {
    const select = document.getElementById('referee-match-select');
    select.innerHTML = '<option value="">اختر مباراة جارية...</option>';
    let allowedMatches = state.matches.filter(m => m.status === 'pending');
    
    if (state.currentUserRole !== 'admin') {
        allowedMatches = allowedMatches.filter(m => m.referee === state.currentUserRole);
    }
    
    allowedMatches.forEach(m => {
        select.innerHTML += `<option value="${m.id}">${m.teamA.name} ضد ${m.teamB.name} (المجموعة ${m.groupId})</option>`;
    });
};

const renderActiveMatch = () => {
    const match = state.matches.find(m => m.id === state.activeMatchId);
    if (!match || !match.rotations) return;

    document.querySelector('#board-team-a .team-name').textContent = match.teamA.name;
    document.querySelector('#board-team-a .score-display').textContent = match.score.A;
    
    document.querySelector('#board-team-b .team-name').textContent = match.teamB.name;
    document.querySelector('#board-team-b .score-display').textContent = match.score.B;

    // Render Court and Serving Info
    ['A', 'B'].forEach(side => {
        const rot = match.rotations[side];
        const servingPlayer = rot.onCourt[0]; // Pos 1
        document.getElementById(`serving-${side.toLowerCase()}`).textContent = servingPlayer ? servingPlayer.name : '--';
        document.getElementById(`next-sub-${side.toLowerCase()}`).textContent = rot.subs.length > 0 ? rot.subs[0].name : 'لا يوجد';

        const courtDiv = document.getElementById(`court-${side.toLowerCase()}`);
        // Court layout: [Pos 3, Pos 2, Pos 4, Pos 1] (Standard grid view)
        // Indices in onCourt: [0=Pos1, 1=Pos2, 2=Pos3, 3=Pos4]
        const displayOrder = [2, 1, 3, 0]; 
        courtDiv.innerHTML = displayOrder.map(idx => {
            const p = rot.onCourt[idx];
            return `
                <div class="court-pos ${idx === 0 ? 'serving' : ''}">
                    <small>مركز ${idx+1}</small>
                    <b>${p ? p.name.split(' ')[0] : '--'}</b>
                </div>
            `;
        }).join('');
    });

    const matchStatus = document.querySelector('.match-status');
    if (matchStatus) {
        matchStatus.innerHTML = `
            <div>الأشواط</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--primary);">
                ${match.score.setsA || 0} - ${match.score.setsB || 0}
            </div>
            ${(match.score.setsA >= 2 || match.score.setsB >= 2) ? '<div style="color:var(--secondary);margin-top:10px;">انتهت المباراة</div>' : ''}
        `;
    }
};

const logMatchEvent = (match, msg) => {
    const logList = document.getElementById('match-log-list');
    const li = document.createElement('li');
    li.textContent = `[النتيجة ${match.score.A}-${match.score.B}] ${msg}`;
    logList.prepend(li);
};

// Start the app
init();
