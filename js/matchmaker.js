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

        // Round Robin: Every team plays every other team exactly once
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                matches.push({
                    groupId,
                    round: roundNumber,
                    teamAId: group[i].id,
                    teamA: group[i],
                    teamBId: group[j].id,
                    teamB: group[j],
                    status: 'pending',
                    score: { A: 0, B: 0, setsA: 0, setsB: 0, setHistory: [] }
                });
            }
        }
    });

    return matches;
};
