import { db } from './firebaseConfig.js';
import { collection, addDoc, getDocs, updateDoc, doc, onSnapshot, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

let firebaseDisabled = false;

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
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "teams"));
                return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) { 
                console.error("Error getting teams", e); 
                if (e.code === 'resource-exhausted') {
                    firebaseDisabled = true;
                    window.dispatchEvent(new CustomEvent('firebase-quota-exceeded'));
                }
                return [...localTeams]; 
            }
        } else {
            return [...localTeams];
        }
    },
    
    async updateTeam(id, data) {
        if (isFirebaseActive()) {
            try {
                await updateDoc(doc(db, "teams", id), data);
            } catch (e) { console.error("Error updating team", e); }
        } else {
            const index = localTeams.findIndex(t => t.id === id);
            if(index > -1) {
                localTeams[index] = { ...localTeams[index], ...data };
                saveLocal();
            }
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
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "players"));
                return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) { console.error("Error getting players", e); return []; }
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
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "matches"));
                return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) { console.error("Error getting matches", e); return []; }
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
        if (isFirebaseActive()) {
            try {
                const docRef = await addDoc(collection(db, "referees"), referee);
                return { id: docRef.id, ...referee };
            } catch (e) { console.error("Error adding referee", e); return null; }
        } else {
            const newRef = { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), ...referee };
            localReferees.push(newRef);
            saveLocal();
            return newRef;
        }
    },

    async getReferees() {
        if (isFirebaseActive()) {
            try {
                const querySnapshot = await getDocs(collection(db, "referees"));
                return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) { console.error("Error getting referees", e); return []; }
        } else {
            return [...localReferees];
        }
    },

    async deleteReferee(id) {
        if (isFirebaseActive()) {
            try { await deleteDoc(doc(db, "referees", id)); } catch (e) { console.error(e); }
        } else {
            localReferees = localReferees.filter(r => r.id !== id);
            saveLocal();
        }
    },

    async deleteTeam(id) {
        if (isFirebaseActive()) {
            try { await deleteDoc(doc(db, "teams", id)); } catch (e) { console.error(e); }
        } else {
            localTeams = localTeams.filter(t => t.id !== id);
            saveLocal();
        }
    },

    async deletePlayer(id) {
        if (isFirebaseActive()) {
            try { await deleteDoc(doc(db, "players", id)); } catch (e) { console.error(e); }
        } else {
            localPlayers = localPlayers.filter(p => p.id !== id);
            saveLocal();
        }
    },

    async getSettings() {
        if (isFirebaseActive()) {
            try {
                const docSnap = await getDocs(collection(db, "settings"));
                if (!docSnap.empty) return docSnap.docs[0].data();
            } catch (e) { console.error(e); }
        }
        return localSettings;
    },

    async updateSettings(data) {
        if (isFirebaseActive()) {
            try {
                await updateDoc(doc(db, "settings", "global"), data);
            } catch(e) { console.error(e); }
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
