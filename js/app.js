import { DB } from './db.js';
import { db } from './firebaseConfig.js';
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
    activeMatchId: null,
    currentUserRole: null,
    currentLeague: 'U8_BOYS',
    filters: { group: '', team: '' }
};

// --- Initialization ---
const init = async () => {
    // 1. Setup UI Listeners immediately (Interactive UI)
    setupNavigation();
    setupForms();
    setupActions();
    setupRefereeBoard();
    setupSearch();
    
    // Initial empty render
    renderTeamsSelect();
    updateUI(); // Ensure UI state (hidden sidebar) is set immediately
    
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

    // League Selector Listener
    const leagueSelector = document.getElementById('league-selector');
    if (leagueSelector) {
        leagueSelector.value = state.currentLeague;
        leagueSelector.addEventListener('change', (e) => {
            state.currentLeague = e.target.value;
            // Update admin form select too
            const teamLeagueSelect = document.getElementById('team-league-select');
            if(teamLeagueSelect) teamLeagueSelect.value = state.currentLeague;
            updateUI();
        });
    }
    
    // 2. Setup Real-time Listeners
    updateDBStatus();
    
    // Migration: Fix missing leagues for existing data
    await loadData();
    let migrated = false;
    for (const t of state.teams) {
        if (!t.league) {
            await DB.updateTeam(t.id, { league: 'U10_BOYS' });
            migrated = true;
        }
    }
    if (migrated) await loadData();

    if (db) {
        DB.subscribe('teams', (data) => { state.teams = data; updateUI(); });
        DB.subscribe('players', (data) => { state.players = data; updateUI(); });
        DB.subscribe('matches', (data) => { state.matches = data; updateUI(); });
        updateDBStatus(true);
    } else {
        // Fallback to one-time load if Firebase fails
        try {
            await loadData();
            renderTeamsSelect();
            updateUI();
            updateDBStatus(false);
        } catch (e) {
            console.error("Data loading failed", e);
        }
    }
};

const updateDBStatus = (success = null) => {
    const badge = document.getElementById('db-status-badge');
    const dot = document.getElementById('db-status-dot');
    if (!badge) return;
    
    if (success === true) {
        badge.textContent = 'متصل بالسحابة';
        if(dot) dot.style.background = 'var(--success)';
    } else if (success === false) {
        badge.textContent = 'وضع الأوفلاين';
        if(dot) dot.style.background = 'var(--warning)';
    } else {
        badge.textContent = 'جاري الاتصال...';
        if(dot) dot.style.background = 'var(--text-muted)';
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
                    alert('يجب تسجيل الدخول للوصول إلى هذه الصفحة');
                    return;
                }
                if (state.currentUserRole === 'referee' && view !== 'referee') {
                    alert('صلاحيات غير كافية');
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
    const isAdmin = state.currentUserRole === 'admin';
    
    document.querySelectorAll('.nav-item').forEach(nav => {
        const isAdminOnly = nav.classList.contains('admin-only');
        
        if (isAdminOnly) {
            if (isAdmin) nav.classList.remove('hidden');
            else nav.classList.add('hidden');
        } else {
            // Public views are always visible
            nav.classList.remove('hidden');
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
        const league = document.getElementById('team-league-select').value;
        
        await DB.addTeam({ name, region, league, pps: 0 });
        await loadData();
        renderTeamsSelect();
        e.target.reset();
        document.getElementById('team-league-select').value = state.currentLeague;
        alert('تم إضافة الفريق بنجاح للفئة المختارة');
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
            alert('تم إضافة الحكم بنجاح');
        });
    }
};

// --- Actions ---
const setupActions = () => {

    document.getElementById('btn-cluster-teams').addEventListener('click', () => {
        renderPots();
        alert('تم تحديث وتصنيف الفرق حسب المستويات (Pots) للفئة المختارة');
    });

    document.getElementById('btn-generate-groups').addEventListener('click', async () => {
        const leagueTeams = filterByLeague(state.teams);
        if (leagueTeams.length < 3) {
            alert('لا يوجد عدد كافٍ من الفرق في هذه الفئة لتوليد مجموعات (تحتاج 3 على الأقل)');
            return;
        }
        const pots = clusterTeams(leagueTeams);
        const groups = generateGroups(pots);
        const matches = generateMatches(groups, state.currentRound);
        
        for (const m of matches) {
            await DB.addMatch(m);
        }
        
        await loadData();
        renderGroupsAndMatches(groups);
        alert('تم توليد المجموعات والمباريات للفئة المختارة');
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
                // await DB.clearAll(); // Don't clear all if we want to keep other leagues

                let processed = 0;
                for (const teamName of lines) {
                    btnGenerateTeams.textContent = `جاري إضافة ${teamName}...`;
                    await DB.addTeam({ name: teamName, region: 'محلي', league: state.currentLeague, pps: 0 });
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
                alert('الرجاء اختيار الفريق أولاً من القائمة');
                return;
            }

            const file = teamPlayersFileInput.files[0];
            if (!file) {
                alert('الرجاء اختيار ملف الأسماء أولاً');
                return;
            }

            btnAddPlayersFromFile.disabled = true;
            btnAddPlayersFromFile.textContent = "جاري قراءة الملف...";

            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                
                if (lines.length === 0) {
                    alert('الملف فارغ أو لا يحتوي على أسماء صالحة');
                    btnAddPlayersFromFile.disabled = false;
                    btnAddPlayersFromFile.textContent = "إضافة من الملف";
                    return;
                }

                let processed = 0;
                const maxVals = { maxH: 165, maxR: 175, maxJ: 45 };
                
                for (const playerName of lines) {
                    const player = {
                        teamId: teamId,
                        name: playerName,
                        league: state.currentLeague, // Added league for easier filtering
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
                
                alert(`نجاح! تم إضافة ${processed} لاعب للفريق.`);
                btnAddPlayersFromFile.disabled = false;
                btnAddPlayersFromFile.textContent = "إضافة من الملف";
                teamPlayersFileInput.value = ''; // clear input
            };
            reader.onerror = () => {
                alert('حدث خطأ أثناء قراءة الملف');
                btnAddPlayersFromFile.disabled = false;
                btnAddPlayersFromFile.textContent = "إضافة من الملف";
            };
            reader.readAsText(file);
        });
    }

    const btnMigrate = document.getElementById('btn-migrate-firebase');
    if (btnMigrate) {
        btnMigrate.addEventListener('click', async () => {
            btnMigrate.disabled = true;
            const originalText = btnMigrate.textContent;
            btnMigrate.textContent = 'جاري الرفع...';
            
            const success = await DB.migrateLocalToFirebase();
            if (success) {
                alert('تم رفع جميع البيانات المحلية إلى Firestore بنجاح!');
                await loadData();
                updateUI();
            } else {
                alert('فشل الرفع. يرجى التأكد من اتصال الإنترنت وإعدادات Firebase.');
            }
            
            btnMigrate.disabled = false;
            btnMigrate.textContent = originalText;
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

const filterByLeague = (items) => {
    return items.filter(i => (i.league === state.currentLeague) || (!i.league && state.currentLeague === 'U10_BOYS'));
};

const updateUI = () => {
    // Sync Selectors
    const leagueSelector = document.getElementById('league-selector');
    if(leagueSelector) leagueSelector.value = state.currentLeague;

    updateNavVisibility();
    renderDashboard();
    renderStandings();
    renderPots();
    renderMatchesList();
    renderRefereeSelect();
    renderRefereesTable();
    renderHistoryTable();
    renderAdminTeamsList();
    renderAdminPlayersTable();
    renderPublicTeamsList();
    renderPlayersDirectory();
};

const renderPublicTeamsList = () => {
    const container = document.getElementById('public-teams-list');
    if (!container) return;
    
    const leagueTeams = filterByLeague(state.teams);
    
    container.innerHTML = leagueTeams.map(t => `
        <div class="mc" onclick="showTeamDetails('${t.id}')">
            <div style="display: flex; align-items: center; gap: 20px;">
                <div style="width: 50px; height: 50px; background: var(--bg-subtle); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; border: 1px solid var(--border-bright);">🛡️</div>
                <div>
                    <div class="mtn">${t.name}</div>
                    <div style="font-size: 13px; color: var(--text-dim); margin-top: 4px;">
                        <span class="badge primary" style="padding: 2px 8px; font-size: 10px;">PPS ${t.pps?.toFixed(1) || '0.0'}</span>
                        <span style="margin-right: 8px;">${state.players.filter(p => p.teamId === t.id).length} لاعب</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
};

const renderAdminTeamsList = () => {
    const tbody = document.querySelector('#admin-teams-table tbody');
    const filter = document.getElementById('admin-player-team-filter');
    if (!tbody || !filter) return;
    
    tbody.innerHTML = '';
    const leagueTeams = filterByLeague(state.teams);
    
    // Update player filter
    const currentFilterVal = filter.value;
    filter.innerHTML = '<option value="">تصفية حسب الفريق...</option>';
    leagueTeams.forEach(t => {
        filter.innerHTML += `<option value="${t.id}">${t.name}</option>`;
    });
    filter.value = currentFilterVal;

    leagueTeams.forEach(t => {
        const teamPlayers = state.players.filter(p => p.teamId === t.id).length;
        tbody.innerHTML += `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td>${t.region || '-'}</td>
                <td><span class="badge ghost">${t.pps?.toFixed(1) || '0.0'}</span></td>
                <td>${teamPlayers}</td>
                <td>
                    <button class="btn ghost btn-sm" style="color: var(--danger);" onclick="deleteTeam('${t.id}')">حذف</button>
                </td>
            </tr>
        `;
    });
};

const renderAdminPlayersTable = () => {
    const tbody = document.querySelector('#admin-players-table tbody');
    const filter = document.getElementById('admin-player-team-filter');
    if (!tbody || !filter) return;
    
    const selectedTeamId = filter.value;
    let players = state.players;
    if (selectedTeamId) {
        players = players.filter(p => p.teamId === selectedTeamId);
    } else {
        players = players.slice(0, 10); // Limit if no filter to avoid lag
    }

    tbody.innerHTML = players.map(p => {
        const team = state.teams.find(t => t.id === p.teamId);
        return `
            <tr>
                <td>${p.name}</td>
                <td>${p.age}</td>
                <td><span class="badge ghost">${p.pps?.toFixed(1) || '0.0'}</span></td>
                <td>
                    <button class="btn ghost btn-sm" style="color: var(--danger);" onclick="deletePlayer('${p.id}')">حذف</button>
                </td>
            </tr>
        `;
    }).join('');
    
    if (players.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">لا يوجد لاعبين مطابقين</td></tr>';
    }
};

window.deleteTeam = async (id) => {
    if (confirm('هل أنت متأكد من حذف هذا الفريق؟ سيتم حذف بيانات الفريق فقط.')) {
        await DB.deleteTeam(id);
        await loadData();
        updateUI();
    }
};

window.deletePlayer = async (id) => {
    if (confirm('هل أنت متأكد من حذف هذا اللاعب؟')) {
        await DB.deletePlayer(id);
        await loadData();
        updateUI();
    }
};

const renderPlayersDirectory = () => {
    const tbody = document.querySelector('#players-directory-table tbody');
    const searchInput = document.getElementById('search-players');
    if (!tbody) return;

    const leagueTeams = filterByLeague(state.teams);
    const teamIds = leagueTeams.map(t => t.id);
    let players = state.players.filter(p => teamIds.includes(p.teamId));

    if (searchInput && searchInput.value) {
        const query = searchInput.value.toLowerCase();
        players = players.filter(p => p.name.toLowerCase().includes(query));
    }

    tbody.innerHTML = players.map(p => {
        const team = state.teams.find(t => t.id === p.teamId);
        return `
            <tr>
                <td><strong>${p.name}</strong></td>
                <td>${team ? team.name : '-'}</td>
                <td>${p.age} سنة</td>
                <td>${p.height} سم</td>
                <td>${p.jump || '-'} سم</td>
                <td><span class="badge primary">${p.pps?.toFixed(1) || '0.0'}</span></td>
            </tr>
        `;
    }).join('');

    if (players.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">لا يوجد لاعبين في هذه الفئة حالياً</td></tr>';
    }
};

// Add search listener after window load or in init
const setupSearch = () => {
    const searchInput = document.getElementById('search-players');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderPlayersDirectory());
    }
};

const renderDashboard = () => {
    const liveContainer = document.getElementById('dash-live-matches');
    const upcomingContainer = document.getElementById('dash-upcoming-matches');
    const groupsContainer = document.getElementById('dash-groups');
    
    if (!liveContainer || !upcomingContainer || !groupsContainer) return;

    const leagueTeams = filterByLeague(state.teams);
    const teamIds = leagueTeams.map(t => t.id);
    const leagueMatches = state.matches.filter(m => teamIds.includes(m.teamAId) || teamIds.includes(m.teamBId));

    // Update Stats
    const completedMatches = leagueMatches.filter(m => m.status === 'completed');
    const liveMatchesNow = leagueMatches.filter(m => m.status === 'playing');
    
    const statMatches = document.getElementById('stat-total-matches');
    const statTeams = document.getElementById('stat-total-teams');
    const statLive = document.getElementById('stat-live-now');

    if(statMatches) statMatches.textContent = completedMatches.length;
    if(statTeams) statTeams.textContent = state.teams.length;
    if(statLive) statLive.textContent = liveMatchesNow.length;
    
    const createMatchHTML = (m) => {
        const refNameMap = {};
        state.referees.forEach(r => refNameMap[r.id] = r.name);
        
        const isLive = m.status === 'playing';
        const isCompleted = m.status === 'completed';
        
        let scoreDisplay = `<div class="msd" style="font-size: 16px; color: var(--text-muted);">VS</div>`;
        
        if (isCompleted) {
            const setsA = m.sets ? m.sets.teamA : 0;
            const setsB = m.sets ? m.sets.teamB : 0;
            scoreDisplay = `<div class="msd">${setsA} - ${setsB}</div>`;
        } else if (isLive) {
            scoreDisplay = `
                <div style="text-align: center;">
                    <div class="msd">${m.score.A} - ${m.score.B}</div>
                    <div style="font-size: 11px; color: var(--primary); font-weight: 800;">أشواط ${m.score.setsA || 0} - ${m.score.setsB || 0}</div>
                </div>
            `;
        }

        return `
            <div class="mc" ${isCompleted ? `onclick="showMatchDetails('${m.id}')"` : ''}>
                <div class="mt">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1;">
                        <div style="width: 48px; height: 48px; background: var(--bg-subtle); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 1px solid var(--border-bright);">🛡️</div>
                        <span class="mtn" style="text-align: center;">${m.teamA.name}</span>
                    </div>
                    
                    ${scoreDisplay}
                    
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1;">
                        <div style="width: 48px; height: 48px; background: var(--bg-subtle); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 1px solid var(--border-bright);">🛡️</div>
                        <span class="mtn" style="text-align: center;">${m.teamB.name}</span>
                    </div>
                </div>
                
                <div class="mc-status">
                    <span>المجموعة ${m.groupId} | جولة ${m.round}</span>
                    <span class="badge ${isLive ? 'primary' : (isCompleted ? 'success' : 'ghost')}">
                        ${isLive ? '● مباشر' : (isCompleted ? 'انتهت' : 'قادمة')}
                    </span>
                </div>
            </div>
        `;
    };

    const renderMatchesWithLimit = (matches, container, emptyMsg, limit = 4, viewTarget = 'matchmaker') => {
        if (matches.length > 0) {
            const html = matches.slice(0, limit).map(createMatchHTML).join('');
            let btnHtml = '';
            if (matches.length > limit) {
                btnHtml = `<button class="btn ghost btn-full mt-4" onclick="document.querySelector('.nav-item[data-view=\\'${viewTarget}\\']').click()">عرض الكل (${matches.length})</button>`;
            }
            container.innerHTML = html + btnHtml;
        } else {
            container.innerHTML = `<div class="card" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); border-style: dashed;">${emptyMsg}</div>`;
        }
    };

    const liveAndRecent = state.matches.filter(m => m.status === 'playing' || m.status === 'completed');
    const upcomingMatches = state.matches.filter(m => m.status === 'pending');

    renderMatchesWithLimit(liveAndRecent, liveContainer, 'لا توجد نتائج مسجلة حالياً', 4, 'history');
    renderMatchesWithLimit(upcomingMatches, upcomingContainer, 'لا توجد مباريات مجدولة', 4, 'matchmaker');

    if (state.currentGroups && state.currentGroups.length > 0) {
        const groupsHtml = state.currentGroups.slice(0, 3).map((g, i) => `
            <div class="group-card">
                <h3>المجموعة ${i+1}</h3>
                <ul class="team-list">
                    ${g.map(t => `<li><span>${t.name}</span> <span class="badge ghost">PPS ${t.pps.toFixed(1)}</span></li>`).join('')}
                </ul>
            </div>
        `).join('');
        
        let btnHtml = '';
        if (state.currentGroups.length > 3) {
            btnHtml = `<button class="btn ghost btn-full mt-4" style="grid-column: 1/-1;" onclick="document.querySelector('.nav-item[data-view=\\'matchmaker\\']').click()">عرض باقي المجموعات</button>`;
        }
        groupsContainer.innerHTML = groupsHtml + btnHtml;
    } else {
        groupsContainer.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); border-style: dashed;">لم يتم إجراء القرعة بعد</div>';
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
    });
};

const renderTeamsSelect = () => {
    const select = document.getElementById('player-team-select');
    if(!select) return;
    const leagueTeams = filterByLeague(state.teams);
    select.innerHTML = '<option value="">اختر الفريق...</option>';
    leagueTeams.forEach(t => {
        select.innerHTML += `<option value="${t.id}">${t.name}</option>`;
    });
};

const renderPots = () => {
    const leagueTeams = filterByLeague(state.teams);
    const pots = clusterTeams(leagueTeams);
    ['potA', 'potB', 'potC'].forEach((potKey, index) => {
        const container = document.querySelector(`#pot-${['a','b','c'][index]}`);
        if(!container) return;
        const ul = container.querySelector('.team-list');
        ul.innerHTML = '';
        pots[potKey].forEach(t => {
            ul.innerHTML += `
                <li onclick="showTeamDetails('${t.id}')" style="cursor:pointer;">
                    <span>${t.name}</span> 
                    <span class="badge ${index===0?'primary':index===1?'ghost':'ghost'}" style="font-family:'Outfit';">PPS ${t.pps.toFixed(1)}</span>
                </li>`;
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
    
    const leagueTeams = filterByLeague(state.teams);
    const teamIds = leagueTeams.map(t => t.id);
    pendingMatches = pendingMatches.filter(m => teamIds.includes(m.teamAId) || teamIds.includes(m.teamBId));

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
            <div class="form-group" style="margin-top: 16px;">
                <label style="font-size: 11px;">تعيين حكم المباراة</label>
                <select class="match-referee-select" data-match-id="${m.id}" style="padding: 8px 12px; font-size: 12px;">
                    <option value="">اختر حكم...</option>
                    ${refereeOptions}
                </select>
            </div>
        ` : `<div style="margin-top: 16px; font-size: 13px; color: var(--text-dim); display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">👨‍⚖️</span> الحكم: ${refNameMap[m.referee] || 'لم يعين'}
             </div>`;

        container.innerHTML += `
            <div class="mc">
                <div class="mt">
                    <div style="flex: 1; text-align: center;">
                        <div style="width: 40px; height: 40px; background: var(--bg-subtle); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 8px; border: 1px solid var(--border-bright);">🛡️</div>
                        <div class="mtn" style="font-size: 15px;">${m.teamA.name}</div>
                    </div>
                    <div style="padding: 0 15px; font-weight: 900; color: var(--text-muted);">VS</div>
                    <div style="flex: 1; text-align: center;">
                        <div style="width: 40px; height: 40px; background: var(--bg-subtle); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 8px; border: 1px solid var(--border-bright);">🛡️</div>
                        <div class="mtn" style="font-size: 15px;">${m.teamB.name}</div>
                    </div>
                </div>
                <div class="mc-status" style="margin-top: 20px;">
                    <span style="font-size: 12px;">المجموعة ${m.groupId} | جولة ${m.round}</span>
                    <span class="badge ghost">منتظرة</span>
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
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const leagueTeams = filterByLeague(state.teams);
    const teamIds = leagueTeams.map(t => t.id);
    const leagueMatches = state.matches.filter(m => teamIds.includes(m.teamAId) || teamIds.includes(m.teamBId));

    const stats = calculateTeamStats(leagueTeams, leagueMatches);
    const limit = window.dashboardExpandedStandings ? stats.length : 5;
    
    stats.slice(0, limit).forEach((s, index) => {
        const isTop = index < 3;
        tbody.innerHTML += `
            <tr style="cursor: pointer;" onclick="showTeamDetails('${s.team.id}')">
                <td>
                    <span class="badge ${isTop ? 'primary' : 'ghost'}">${index + 1}</span>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; background: var(--bg); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px;">🛡️</div>
                        <strong>${s.team.name}</strong>
                    </div>
                </td>
                <td>${s.played}</td>
                <td>${s.wins}</td>
                <td>${s.losses}</td>
                <td>${(s.winRate * 100).toFixed(1)}%</td>
                <td>${s.cappedPointDiff}</td>
                <td>${(s.pointRatio * 100).toFixed(1)}%</td>
                <td><strong class="badge primary" style="font-size: 13px; font-family: 'Outfit';">${(s.finalScore * 100).toFixed(1)}</strong></td>
            </tr>
        `;
    });

    if (stats.length > limit) {
        tbody.innerHTML += `
            <tr>
                <td colspan="9" style="text-align: center; padding: 0;">
                    <button class="btn ghost btn-full" style="border-radius: 0; border: none; color: var(--primary); padding: 16px;" onclick="window.dashboardExpandedStandings = true; updateUI();">عرض باقي الترتيب (${stats.length - limit}+)</button>
                </td>
            </tr>
        `;
    }
};

const renderLiveMatches = (dashboardMatches) => {
    const container = document.getElementById('live-matches-container');
    if (!container) return;
    container.innerHTML = '';
    
    dashboardMatches.forEach(m => {
        const teamA = state.teams.find(t => t.id === m.teamAId);
        const teamB = state.teams.find(t => t.id === m.teamBId);
        
        const isLive = m.status === 'live';
        
        container.innerHTML += `
            <div class="card ${isLive ? 'live-border' : ''}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <span class="badge ghost" style="font-size: 10px;">الجولة ${m.round || '1'} | ${m.groupId || 'A'}</span>
                    ${isLive ? '<span class="live-badge"><span>●</span> مباشر</span>' : ''}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1; text-align: center;">
                        <div style="font-weight: bold; font-size: 14px;">${teamA ? teamA.name : 'انتظار...'}</div>
                    </div>
                    <div style="flex: 1; text-align: center; font-size: 20px; font-weight: 900; color: var(--teal);">
                        ${m.score.A} - ${m.score.B}
                    </div>
                    <div style="flex: 1; text-align: center;">
                        <div style="font-weight: bold; font-size: 14px;">${teamB ? teamB.name : 'انتظار...'}</div>
                    </div>
                </div>
                <div style="text-align: center; font-size: 10px; color: var(--text2); margin-top: 5px;">
                    أشواط: ${m.score.setsA || 0} - ${m.score.setsB || 0}
                </div>
            </div>
        `;
    });
};

const showTeamDetails = (teamId) => {
    const team = state.teams.find(t => t.id === teamId);
    if (!team) return;
    
    const teamPlayers = state.players.filter(p => p.teamId === teamId);
    const container = document.getElementById('team-details-content');
    
    // Switch view
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.getElementById('view-team-details').classList.add('active');
    
    container.innerHTML = `
        <div class="card" style="border-top: 4px solid var(--teal);">
            <div class="card-header">
                <h2>${team.name}</h2>
                <span class="badge bb">PPS: ${team.pps?.toFixed(1) || '0.0'}</span>
            </div>
            <p style="color: var(--text2); margin-bottom: 10px;">المنطقة: ${team.region || 'غير محدد'}</p>
        </div>
        
        <div class="sec-title">قائمة اللاعبين (${teamPlayers.length})</div>
        <div class="grid-2">
            ${teamPlayers.map(p => `
                <div class="card" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: bold; color: var(--text);">${p.name}</div>
                        <div style="font-size: 11px; color: var(--text2);">العمر: ${p.age} | الطول: ${p.height}سم</div>
                    </div>
                    <div class="badge ghost">PPS: ${p.pps?.toFixed(1) || '0.0'}</div>
                </div>
            `).join('')}
        </div>
    `;
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
        
        const servingEl = document.getElementById(`serving-${side.toLowerCase()}`);
        if(servingEl) servingEl.textContent = servingPlayer ? servingPlayer.name : '--';
        
        const courtDiv = document.getElementById(`court-${side.toLowerCase()}`);
        if(!courtDiv) return;

        // Court layout: [Pos 3, Pos 2, Pos 4, Pos 1] (Standard grid view)
        // Indices in onCourt: [0=Pos1, 1=Pos2, 2=Pos3, 3=Pos4]
        const displayOrder = [2, 1, 3, 0]; 
        courtDiv.innerHTML = displayOrder.map(idx => {
            const p = rot.onCourt[idx];
            const isServing = idx === 0;
            return `
                <div class="court-player" style="${isServing ? 'border-color: var(--primary); background: var(--primary-glow);' : ''}">
                    <div style="font-size: 10px; color: var(--text-dim); mb-1">مركز ${idx+1}</div>
                    <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p ? p.name.split(' ')[0] : '--'}</div>
                </div>
            `;
        }).join('');
    });

    const matchStatus = document.querySelector('.match-status');
    if (matchStatus) {
        matchStatus.innerHTML = `
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">الأشواط</div>
            <div style="font-size: 32px; font-weight: 900; color: var(--primary); font-family: 'Outfit';">
                ${match.score.setsA || 0} - ${match.score.setsB || 0}
            </div>
        `;
    }
};

const showMatchDetails = (matchId) => {
    document.querySelector('.nav-item[data-view="history"]').click();
};

const logMatchEvent = (match, msg) => {
    const logList = document.getElementById('match-log-list');
    const li = document.createElement('li');
    li.textContent = `[النتيجة ${match.score.A}-${match.score.B}] ${msg}`;
    logList.prepend(li);
};

// Start the app
init();
