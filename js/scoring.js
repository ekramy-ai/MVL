export const calculateTeamStats = (teams, matches) => {
    // Initialize stats for each team
    const stats = {};
    teams.forEach(team => {
        stats[team.id] = {
            id: team.id,
            team: team,
            played: 0,
            wins: 0,
            losses: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDiffRaw: 0,
            cappedPointDiff: 0
        };
    });

    matches.forEach(match => {
        if (match.status !== 'completed') return;

        const { teamAId, teamBId, score } = match;
        if (!stats[teamAId] || !stats[teamBId]) return;

        stats[teamAId].played++;
        stats[teamBId].played++;

        const cap = 10; // Max point diff cap for Set 25
        
        let matchPointsA = 0;
        let matchPointsB = 0;
        
        // Sum from completed sets
        if (score.setHistory && score.setHistory.length > 0) {
            score.setHistory.forEach(set => {
                matchPointsA += set.A;
                matchPointsB += set.B;
                
                let diffA = set.A - set.B;
                let diffB = set.B - set.A;
                if (diffA > 0) {
                    stats[teamAId].cappedPointDiff += Math.min(diffA, cap);
                    stats[teamBId].cappedPointDiff += Math.max(diffB, -cap);
                } else {
                    stats[teamBId].cappedPointDiff += Math.min(diffB, cap);
                    stats[teamAId].cappedPointDiff += Math.max(diffA, -cap);
                }
            });
        }

        stats[teamAId].pointsFor += matchPointsA;
        stats[teamAId].pointsAgainst += matchPointsB;
        stats[teamBId].pointsFor += matchPointsB;
        stats[teamBId].pointsAgainst += matchPointsA;

        if (score.setsA > score.setsB) {
            stats[teamAId].wins++;
            stats[teamBId].losses++;
        } else if (score.setsB > score.setsA) {
            stats[teamBId].wins++;
            stats[teamAId].losses++;
        }
    });

    // Calculate final scores and sort
    const rankedStats = Object.values(stats).map(s => {
        const winRate = s.played > 0 ? s.wins / s.played : 0;
        
        // Normalize cap diff to a 0-1 scale approx (max cap per match is 6, so max possible over 'played' matches is played*6)
        const maxPossibleDiff = s.played * 6;
        const normalizedDiff = maxPossibleDiff > 0 ? (s.cappedPointDiff + maxPossibleDiff) / (2 * maxPossibleDiff) : 0; // mapped to 0-1

        const totalPoints = s.pointsFor + s.pointsAgainst;
        const pointRatio = totalPoints > 0 ? s.pointsFor / totalPoints : 0;

        const finalScore = (0.5 * winRate) + (0.3 * normalizedDiff) + (0.2 * pointRatio);

        return { ...s, winRate, pointRatio, finalScore };
    });

    // Tie breaker sort: 
    // Score descending, then points against ascending, then point ratio descending
    rankedStats.sort((a, b) => {
        if (Math.abs(b.finalScore - a.finalScore) > 0.0001) return b.finalScore - a.finalScore;
        // Head-to-head would require checking match results between the two, omitting for briefness unless strictly needed.
        if (a.pointsAgainst !== b.pointsAgainst) return a.pointsAgainst - b.pointsAgainst; // Lower is better
        return b.pointRatio - a.pointRatio;
    });

    return rankedStats;
};
