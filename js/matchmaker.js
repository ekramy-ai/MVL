export const generateGroups = (pots) => {
    const { potA, potB, potC } = pots;
    const totalTeams = potA.length + potB.length + potC.length;
    
    // Determine number of groups based on total teams (average 5 teams per group)
    const numGroups = Math.max(1, Math.floor(totalTeams / 5));
    const groups = Array.from({ length: numGroups }, () => []);

    const assignToGroups = (teams) => {
        teams.forEach((team, index) => {
            const groupIndex = index % numGroups;
            groups[groupIndex].push(team);
        });
    };

    // Distribute pots evenly across groups
    assignToGroups(potA);
    assignToGroups(potB);
    assignToGroups(potC);

    return groups;
};

export const generateMatches = (groups, roundNumber) => {
    const matches = [];

    groups.forEach((group, groupIndex) => {
        const groupId = `G${groupIndex + 1}`;
        const n = group.length;
        if (n < 2) return;

        // Number of matches per team (at least 40% of group size)
        const matchesPerTeam = Math.max(1, Math.ceil(0.4 * n));
        const jMax = Math.ceil(matchesPerTeam / 2);
        
        const addedMatches = new Set();
        
        for (let i = 0; i < n; i++) {
            for (let j = 1; j <= jMax; j++) {
                // If n=2, jMax=1, opponent is (i+1)%2. i=0->1, i=1->0 (duplicate prevented by Set)
                // If n is even and j = n/2, each pair is generated twice, handled by Set.
                if (j * 2 > n && n !== 2) continue; // Prevent crossing over if j is too large
                
                const opponentIndex = (i + j) % n;
                
                // Create unique key for the pair to avoid duplicates
                const id1 = group[i].id;
                const id2 = group[opponentIndex].id;
                const minId = id1 < id2 ? id1 : id2;
                const maxId = id1 > id2 ? id1 : id2;
                const key = `${minId}-${maxId}`;
                
                if (!addedMatches.has(key)) {
                    addedMatches.add(key);
                    matches.push({
                        groupId,
                        round: roundNumber,
                        teamAId: group[i].id,
                        teamA: group[i],
                        teamBId: group[opponentIndex].id,
                        teamB: group[opponentIndex],
                        status: 'pending',
                        score: { A: 0, B: 0, setsA: 0, setsB: 0, setHistory: [] }
                    });
                }
            }
        }
    });

    return matches;
};
