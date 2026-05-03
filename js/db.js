import { db, collection, addDoc, getDocs, updateDoc, doc, onSnapshot, deleteDoc, setDoc } from './firebaseConfig.js';

// In-memory fallback using localStorage
let localTeams = JSON.parse(localStorage.getItem('mvl_teams') || '[]');
let localPlayers = JSON.parse(localStorage.getItem('mvl_players') || '[]');
let localMatches = JSON.parse(localStorage.getItem('mvl_matches') || '[]');
let localReferees = JSON.parse(localStorage.getItem('mvl_referees') || '[]');
let localSettings = JSON.parse(localStorage.getItem('mvl_settings') || '{"adminUsername":"admin","adminPassword":"admin"}');

const saveLocal = () => {
    localStorage.setItem('mvl_teams', JSON.stringify(localTeams));
    localStorage.setItem('mvl_players', JSON.stringify(localPlayers));
    localStorage.setItem('mvl_matches', JSON.stringify(localMatches));
    localStorage.setItem('mvl_referees', JSON.stringify(localReferees));
    localStorage.setItem('mvl_settings', JSON.stringify(localSettings));
};

// ── Smart Cache System (reduces Firebase reads by 90%) ──
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = {};

const getCached = (key) => {
    const entry = cache[key];
    if (entry && (Date.now() - entry.ts) < CACHE_TTL_MS) return entry.data;
    // Also try localStorage cache
    try {
        const stored = JSON.parse(localStorage.getItem(`mvl_cache_${key}`) || 'null');
        if (stored && (Date.now() - stored.ts) < CACHE_TTL_MS) {
            cache[key] = stored;
            return stored.data;
        }
    } catch(e) {}
    return null;
};

const setCache = (key, data) => {
    const entry = { data, ts: Date.now() };
    cache[key] = entry;
    try { localStorage.setItem(`mvl_cache_${key}`, JSON.stringify(entry)); } catch(e) {}
};

const clearCache = (key) => {
    delete cache[key];
    try { localStorage.removeItem(`mvl_cache_${key}`); } catch(e) {}
};

let firebaseDisabled = false;

// Auto-detect quota exceeded and switch to offline
const handleFirebaseError = (e, context = '') => {
    if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota exceeded') || e?.message?.includes('quota')) {
        console.warn(`⚠️ Firebase quota exceeded (${context}). Switching to offline mode.`);
        firebaseDisabled = true;
        window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
        return true;
    }
    return false;
};

const isFirebaseActive = () => {
    return !firebaseDisabled && db !== null && db !== undefined;
};

export const DB = {
    setFirebaseDisabled(val) {
        firebaseDisabled = val;
    },
    async migrateLocalToFirebase() {
        if (!isFirebaseActive()) return;
        try {
            console.log("Migrating Teams...");
            for (const t of localTeams) { await setDoc(doc(db, "teams", t.id), t); }
            console.log("Migrating Players...");
            for (const p of localPlayers) { await setDoc(doc(db, "players", p.id), p); }
            console.log("Migrating Matches...");
            for (const m of localMatches) { await setDoc(doc(db, "matches", m.id), m); }
            console.log("Migrating Referees...");
            for (const r of localReferees) { await setDoc(doc(db, "referees", r.id), r); }
            console.log("Migrating Settings...");
            await setDoc(doc(db, "settings", "global"), localSettings);
            console.log("Migration complete.");
            
            // CLEAR CACHE AFTER SUCCESS
            localTeams = [];
            localPlayers = [];
            localMatches = [];
            localReferees = [];
            saveLocal();
            
            return true;
        } catch (e) {
            console.error("Migration failed:", e);
            return false;
        }
    },

    async addTeam(team) {
        if (isFirebaseActive()) {
            try {
                const docRef = await addDoc(collection(db, "teams"), team);
                return { id: docRef.id, ...team };
            } catch (e) { console.error("Error adding team", e); return null; }
        } else {
            const newTeam = { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), ...team };
            localTeams.push(newTeam);
            saveLocal();
            return newTeam;
        }
    },

    async getTeams() {
        const cached = getCached('teams');
        if (cached) return cached;
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "teams"));
                const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCache('teams', data);
                localTeams = data; saveLocal();
                return data;
            } catch (e) {
                handleFirebaseError(e, 'getTeams');
                return [...localTeams];
            }
        } else {
            return [...localTeams];
        }
    },
    
    async updateTeam(id, data) {
        clearCache('teams');
        if (isFirebaseActive()) {
            try {
                await updateDoc(doc(db, "teams", id), data);
            } catch (e) { handleFirebaseError(e, 'updateTeam'); console.error("Error updating team", e); }
        } else {
            const index = localTeams.findIndex(t => t.id === id);
            if(index > -1) { localTeams[index] = { ...localTeams[index], ...data }; saveLocal(); }
        }
    },

    async addPlayer(player) {
        if (isFirebaseActive()) {
            try {
                const docRef = await addDoc(collection(db, "players"), player);
                return { id: docRef.id, ...player };
            } catch (e) { console.error("Error adding player", e); return null; }
        } else {
            const newPlayer = { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), ...player };
            localPlayers.push(newPlayer);
            saveLocal();
            return newPlayer;
        }
    },

    async getPlayers() {
        const cached = getCached('players');
        if (cached) return cached;
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "players"));
                const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCache('players', data);
                localPlayers = data; saveLocal();
                return data;
            } catch (e) { handleFirebaseError(e, 'getPlayers'); return [...localPlayers]; }
        } else {
            return [...localPlayers];
        }
    },

    async addMatch(match) {
        if (isFirebaseActive()) {
            try {
                const docRef = await addDoc(collection(db, "matches"), match);
                return { id: docRef.id, ...match };
            } catch (e) { console.error("Error adding match", e); return null; }
        } else {
            const newMatch = { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), ...match };
            localMatches.push(newMatch);
            saveLocal();
            return newMatch;
        }
    },
    
    async updateMatch(id, data) {
        if (isFirebaseActive()) {
            try {
                await updateDoc(doc(db, "matches", id), data);
            } catch (e) { console.error("Error updating match", e); }
        } else {
            const index = localMatches.findIndex(m => m.id === id);
            if(index > -1) {
                localMatches[index] = { ...localMatches[index], ...data };
                saveLocal();
            }
        }
    },

    async getMatches() {
        const cached = getCached('matches');
        if (cached) return cached;
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "matches"));
                const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCache('matches', data);
                localMatches = data; saveLocal();
                return data;
            } catch (e) { handleFirebaseError(e, 'getMatches'); return [...localMatches]; }
        } else {
            return [...localMatches];
        }
    },
    
    async clearAll() {
        if (isFirebaseActive()) {
            try {
                const cols = ['teams', 'players', 'matches', 'referees'];
                for (const c of cols) {
                    const qs = await getDocs(collection(db, c));
                    const deletePromises = qs.docs.map(d => deleteDoc(doc(db, c, d.id)));
                    await Promise.all(deletePromises);
                }
            } catch (e) { console.error("Error clearing data", e); }
        } else {
            localTeams = [];
            localPlayers = [];
            localMatches = [];
            localReferees = [];
            saveLocal();
        }
    },

    async addReferee(referee) {
        clearCache('referees');
        if (isFirebaseActive()) {
            try {
                const docRef = await addDoc(collection(db, "referees"), referee);
                const newRef = { id: docRef.id, ...referee };
                // ALWAYS save locally as backup for offline/quota scenarios
                localReferees.push(newRef);
                saveLocal();
                return newRef;
            } catch (e) {
                handleFirebaseError(e, 'addReferee');
                console.error("Error adding referee", e);
                // fallthrough to local save
            }
        }
        // Local save (offline or Firebase failed)
        const newRef = { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), ...referee };
        localReferees.push(newRef);
        saveLocal();
        return newRef;
    },

    async getReferees() {
        const cached = getCached('referees');
        if (cached) return cached;
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "referees"));
                const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCache('referees', data);
                localReferees = data; saveLocal();
                return data;
            } catch (e) { handleFirebaseError(e, 'getReferees'); return [...localReferees]; }
        } else {
            return [...localReferees];
        }
    },

    async deleteReferee(id) {
        clearCache('referees');
        if (isFirebaseActive()) {
            try { await deleteDoc(doc(db, "referees", id)); } catch (e) { handleFirebaseError(e, 'deleteReferee'); console.error(e); }
        } else {
            localReferees = localReferees.filter(r => r.id !== id);
            saveLocal();
        }
    },

    async deleteTeam(id) {
        clearCache('teams');
        if (isFirebaseActive()) {
            try { await deleteDoc(doc(db, "teams", id)); } catch (e) { handleFirebaseError(e, 'deleteTeam'); console.error(e); }
        } else {
            localTeams = localTeams.filter(t => t.id !== id);
            saveLocal();
        }
    },

    async deletePlayer(id) {
        clearCache('players');
        if (isFirebaseActive()) {
            try { await deleteDoc(doc(db, "players", id)); } catch (e) { handleFirebaseError(e, 'deletePlayer'); console.error(e); }
        } else {
            localPlayers = localPlayers.filter(p => p.id !== id);
            saveLocal();
        }
    },

    async updatePlayer(id, data) {
        clearCache('players');
        if (isFirebaseActive()) {
            try {
                await updateDoc(doc(db, "players", id), data);
            } catch (e) { handleFirebaseError(e, 'updatePlayer'); console.error("Error updating player", e); }
        } else {
            const index = localPlayers.findIndex(p => p.id === id);
            if (index > -1) {
                localPlayers[index] = { ...localPlayers[index], ...data };
                saveLocal();
            }
        }
    },

    async deleteMatch(id) {
        clearCache('matches');
        if (isFirebaseActive()) {
            try { await deleteDoc(doc(db, "matches", id)); } catch (e) { handleFirebaseError(e, 'deleteMatch'); console.error(e); }
        } else {
            localMatches = localMatches.filter(m => m.id !== id);
            saveLocal();
        }
    },

    async getSettings() {
        const cached = getCached('settings');
        if (cached) return cached;
        if (isFirebaseActive()) {
            try {
                const docSnap = await getDocs(collection(db, "settings"));
                if (!docSnap.empty) {
                    const data = docSnap.docs[0].data();
                    setCache('settings', data);
                    localSettings = data; saveLocal();
                    return data;
                }
            } catch (e) { handleFirebaseError(e, 'getSettings'); }
        }
        return localSettings;
    },

    async updateSettings(data) {
        clearCache('settings');
        if (isFirebaseActive()) {
            try {
                await updateDoc(doc(db, "settings", "global"), data);
            } catch(e) { handleFirebaseError(e, 'updateSettings'); console.error(e); }
        } else {
            localSettings = { ...localSettings, ...data };
            saveLocal();
        }
    },

    subscribe(collectionName, callback) {
        if (!isFirebaseActive()) return () => {};
        return onSnapshot(collection(db, collectionName), (querySnapshot) => {
            const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(data);
        }, (error) => {
            console.error(`Subscription error for ${collectionName}:`, error);
        });
    }
};
