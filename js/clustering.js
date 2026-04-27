export const clusterTeams = (teams) => {
    // Sort teams by PPS descending
    const sortedTeams = [...teams].sort((a, b) => (b.pps || 0) - (a.pps || 0));
    
    const total = sortedTeams.length;
    if (total === 0) return { potA: [], potB: [], potC: [] };

    // Calculate cutoffs
    const countA = Math.round(total * 0.30);
    const countB = Math.round(total * 0.40);
    // Pot C gets the remainder to ensure no rounding errors miss teams
    
    const potA = sortedTeams.slice(0, countA);
    const potB = sortedTeams.slice(countA, countA + countB);
    const potC = sortedTeams.slice(countA + countB);

    return {
        potA,
        potB,
        potC
    };
};
