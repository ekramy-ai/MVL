export const calculatePlayerPPS = (player, allPlayers = [], maxValues = null) => {
    // Normalize to max value in current cohort to act as percentile
    let maxH = 160, maxR = 170, maxJ = 45; // Defaults for 9-12 yrs
    
    if (maxValues) {
        maxH = maxValues.maxH;
        maxR = maxValues.maxR;
        maxJ = maxValues.maxJ;
    } else if (allPlayers && allPlayers.length > 0) {
        maxH = Math.max(...allPlayers.map(p => Number(p.height)), 130);
        maxR = Math.max(...allPlayers.map(p => Number(p.reach)), 130);
        maxJ = Math.max(...allPlayers.map(p => Number(p.jump)), 20);
    }

    const hPercentile = Math.min((Number(player.height) / maxH) * 100, 100);
    const rPercentile = Math.min((Number(player.reach) / maxR) * 100, 100);
    const jPercentile = Math.min((Number(player.jump) / maxJ) * 100, 100);

    return (0.4 * hPercentile) + (0.3 * rPercentile) + (0.3 * jPercentile);
};

export const calculateTeamPPS = (teamId, players) => {
    const teamPlayers = players.filter(p => p.teamId === teamId);
    if (teamPlayers.length === 0) return 0;

    // We assume players already have a calculated PPS
    const sortedPPS = teamPlayers.map(p => p.pps || 0).sort((a, b) => b - a);
    
    const avgPPS = sortedPPS.reduce((a, b) => a + b, 0) / sortedPPS.length;
    
    const top3 = sortedPPS.slice(0, 3);
    const top3Avg = top3.length > 0 ? (top3.reduce((a, b) => a + b, 0) / top3.length) : 0;

    return (0.7 * avgPPS) + (0.3 * top3Avg);
};
