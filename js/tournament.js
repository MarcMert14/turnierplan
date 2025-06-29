// Turnier-Konfiguration
const TOURNAMENT_CONFIG = {
    startTime: '2025-07-05T14:00:00',
    gameDuration: 8, // Minuten
    breakDuration: 4, // Minuten
    totalDuration: 12, // Minuten pro Spiel (8 + 4)
    teams: [] // Wird dynamisch von der Backend-API geladen
};

// Turnier-Status
class TournamentManager {
    constructor() {
        this.currentMatch = null;
        this.matches = [];
        this.standings = [];
        this.currentTime = new Date();
        this.tournamentStart = new Date(TOURNAMENT_CONFIG.startTime);
        this.isTournamentStarted = false;
        this.delays = 0; // Verzögerungen in Minuten
        
        this.init();
    }

    async init() {
        await this.loadTeams();
        this.generateSchedule();
        this.updateCurrentMatch();
        this.startTimer();
    }

    // Teams von der Backend-API laden
    async loadTeams() {
        try {
            const response = await fetch('/api/teams');
            const teams = await response.json();
            TOURNAMENT_CONFIG.teams = teams.map(team => team.name);
        } catch (error) {
            console.error('Fehler beim Laden der Teams:', error);
            // Fallback auf Standard-Teams
            TOURNAMENT_CONFIG.teams = [
                'Team A', 'Team B', 'Team C', 'Team D', 'Team E',
                'Team F', 'Team G', 'Team H', 'Team I', 'Team J'
            ];
        }
    }

    // Spielplan generieren
    generateSchedule() {
        const teams = [...TOURNAMENT_CONFIG.teams];
        let matchNumber = 1;
        let currentTime = new Date(this.tournamentStart);

        // Vorrunde: Jeder spielt 2 Spiele
        const groupMatches = this.generateGroupMatches(teams);
        
        groupMatches.forEach((match, index) => {
            const matchTime = new Date(currentTime);
            matchTime.setMinutes(matchTime.getMinutes() + (index * TOURNAMENT_CONFIG.totalDuration));
            
            this.matches.push({
                id: `G${matchNumber}`,
                phase: 'group',
                round: 'Vorrunde',
                team1: match.team1,
                team2: match.team2,
                score1: null,
                score2: null,
                scheduledTime: matchTime,
                actualTime: null,
                status: 'scheduled', // scheduled, live, completed
                matchNumber: matchNumber++
            });
        });

        // K.O.-Runde Spiele (Platzhalter)
        const knockoutMatches = [
            { id: 'AF1', round: 'Achtelfinale', team1: 'Platz 7', team2: 'Platz 10', phase: 'knockout' },
            { id: 'AF2', round: 'Achtelfinale', team1: 'Platz 8', team2: 'Platz 9', phase: 'knockout' },
            { id: 'VF1', round: 'Viertelfinale', team1: 'Platz 1', team2: 'Sieger AF2', phase: 'knockout' },
            { id: 'VF2', round: 'Viertelfinale', team1: 'Platz 2', team2: 'Sieger AF1', phase: 'knockout' },
            { id: 'VF3', round: 'Viertelfinale', team1: 'Platz 3', team2: 'Platz 6', phase: 'knockout' },
            { id: 'VF4', round: 'Viertelfinale', team1: 'Platz 4', team2: 'Platz 5', phase: 'knockout' },
            { id: 'HF1', round: 'Halbfinale', team1: 'Sieger VF1', team2: 'Sieger VF4', phase: 'knockout' },
            { id: 'HF2', round: 'Halbfinale', team1: 'Sieger VF2', team2: 'Sieger VF3', phase: 'knockout' },
            { id: 'FINAL', round: 'Finale', team1: 'Sieger HF1', team2: 'Sieger HF2', phase: 'knockout' }
        ];

        // K.O.-Spiele nach Vorrunde einplanen
        const groupEndTime = new Date(currentTime);
        groupEndTime.setMinutes(groupEndTime.getMinutes() + (groupMatches.length * TOURNAMENT_CONFIG.totalDuration));

        knockoutMatches.forEach((match, index) => {
            const matchTime = new Date(groupEndTime);
            matchTime.setMinutes(matchTime.getMinutes() + (index * TOURNAMENT_CONFIG.totalDuration));
            
            this.matches.push({
                id: match.id,
                phase: match.phase,
                round: match.round,
                team1: match.team1,
                team2: match.team2,
                score1: null,
                score2: null,
                scheduledTime: matchTime,
                actualTime: null,
                status: 'scheduled',
                matchNumber: matchNumber++
            });
        });
    }

    // Vorrundenspiele generieren (jeder spielt 2 Spiele, keine Dopplungen, keine Selbstpaarung)
    generateGroupMatches(teams) {
        const matches = [];
        const n = teams.length;
        for (let i = 0; i < n; i++) {
            // Jeder spielt gegen die nächsten zwei Teams in der Liste (mit Wrap-around)
            for (let k = 1; k <= 2; k++) {
                const j = (i + k) % n;
                // Prüfe, ob Paarung schon existiert (egal in welcher Reihenfolge)
                if (!matches.some(m => (m.team1 === teams[i] && m.team2 === teams[j]) || (m.team1 === teams[j] && m.team2 === teams[i]))) {
                    matches.push({ team1: teams[i], team2: teams[j] });
                }
            }
        }
        return matches;
    }

    // Aktuelles Spiel ermitteln
    updateCurrentMatch() {
        const now = new Date();
        this.currentTime = now;
        
        // Turnier gestartet?
        if (now >= this.tournamentStart) {
            this.isTournamentStarted = true;
        }

        // Aktuelles Spiel finden
        this.currentMatch = this.matches.find(match => {
            const matchStart = new Date(match.scheduledTime);
            const matchEnd = new Date(matchStart);
            matchEnd.setMinutes(matchEnd.getMinutes() + TOURNAMENT_CONFIG.gameDuration);
            
            return now >= matchStart && now < matchEnd && match.status !== 'completed';
        });

        // Status der Spiele aktualisieren
        this.matches.forEach(match => {
            const matchStart = new Date(match.scheduledTime);
            const matchEnd = new Date(matchStart);
            matchEnd.setMinutes(matchEnd.getMinutes() + TOURNAMENT_CONFIG.gameDuration);
            
            if (now >= matchEnd && match.status !== 'completed') {
                match.status = 'completed';
                if (!match.actualTime) {
                    match.actualTime = matchEnd;
                }
            } else if (now >= matchStart && now < matchEnd && match.status === 'scheduled') {
                match.status = 'live';
                if (!match.actualTime) {
                    match.actualTime = matchStart;
                }
            }
        });

        // Tabelle aktualisieren
        this.updateStandings();
    }

    // Tabelle berechnen
    updateStandings() {
        const teamStats = {};
        
        // Initialisierung
        TOURNAMENT_CONFIG.teams.forEach(team => {
            teamStats[team] = {
                name: team,
                played: 0,
                won: 0,
                drawn: 0,
                lost: 0,
                goalsFor: 0,
                goalsAgainst: 0,
                points: 0
            };
        });

        // Abgeschlossene Spiele auswerten
        this.matches.filter(m => m.status === 'completed' && m.phase === 'group').forEach(match => {
            if (match.score1 !== null && match.score2 !== null) {
                const team1 = teamStats[match.team1];
                const team2 = teamStats[match.team2];
                
                team1.played++;
                team2.played++;
                team1.goalsFor += match.score1;
                team1.goalsAgainst += match.score2;
                team2.goalsFor += match.score2;
                team2.goalsAgainst += match.score1;
                
                if (match.score1 > match.score2) {
                    team1.won++;
                    team1.points += 3;
                    team2.lost++;
                } else if (match.score1 < match.score2) {
                    team2.won++;
                    team2.points += 3;
                    team1.lost++;
                } else {
                    team1.drawn++;
                    team2.drawn++;
                    team1.points += 1;
                    team2.points += 1;
                }
            }
        });

        // Tabelle sortieren
        this.standings = Object.values(teamStats).sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const aDiff = a.goalsFor - a.goalsAgainst;
            const bDiff = b.goalsFor - b.goalsAgainst;
            if (bDiff !== aDiff) return bDiff - aDiff;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return a.name.localeCompare(b.name);
        });
    }

    // Spielstand eintragen
    updateScore(matchId, score1, score2) {
        const match = this.matches.find(m => m.id === matchId);
        if (match) {
            match.score1 = score1;
            match.score2 = score2;
            match.status = 'completed';
            match.actualTime = new Date();
            
            // K.O.-Runde aktualisieren
            this.updateKnockoutBracket();
            
            // Tabelle aktualisieren
            this.updateStandings();
            
            // UI aktualisieren
            this.updateUI();
        }
    }

    // K.O.-Runde aktualisieren
    updateKnockoutBracket() {
        // Hier würde die Logik für die K.O.-Runde implementiert
        // Basierend auf den Platzierungen der Vorrunde
    }

    // Timer starten
    startTimer() {
        setInterval(() => {
            this.updateCurrentMatch();
            this.updateUI();
        }, 1000);
    }

    // UI aktualisieren
    updateUI() {
        this.updateLiveScore();
        this.updateSchedule();
        this.updateStandingsDisplay();
    }

    // Live-Score aktualisieren
    updateLiveScore() {
        const matchTimeEl = document.getElementById('match-time');
        const matchPhaseEl = document.getElementById('match-phase');
        const team1NameEl = document.getElementById('team1-name');
        const team2NameEl = document.getElementById('team2-name');
        const team1ScoreEl = document.getElementById('team1-score');
        const team2ScoreEl = document.getElementById('team2-score');

        if (this.currentMatch) {
            const matchStart = new Date(this.currentMatch.actualTime || this.currentMatch.scheduledTime);
            const elapsed = Math.floor((this.currentTime - matchStart) / 1000 / 60);
            const remaining = TOURNAMENT_CONFIG.gameDuration - elapsed;
            if (matchTimeEl) matchTimeEl.textContent = `${Math.max(0, remaining)}:${String(Math.max(0, (remaining % 1) * 60)).padStart(2, '0')}`;
            if (matchPhaseEl) matchPhaseEl.textContent = this.currentMatch.round;
            if (team1NameEl) team1NameEl.textContent = this.currentMatch.team1;
            if (team2NameEl) team2NameEl.textContent = this.currentMatch.team2;
            if (team1ScoreEl) team1ScoreEl.textContent = this.currentMatch.score1 || 0;
            if (team2ScoreEl) team2ScoreEl.textContent = this.currentMatch.score2 || 0;
        } else {
            if (matchTimeEl) matchTimeEl.textContent = '--:--';
            if (matchPhaseEl) matchPhaseEl.textContent = 'Warte auf Start...';
            if (team1NameEl) team1NameEl.textContent = '--';
            if (team2NameEl) team2NameEl.textContent = '--';
            if (team1ScoreEl) team1ScoreEl.textContent = '0';
            if (team2ScoreEl) team2ScoreEl.textContent = '0';
        }
    }

    // Spielplan aktualisieren
    updateSchedule() {
        const scheduleList = document.getElementById('schedule-list');
        if (!scheduleList) return;

        scheduleList.innerHTML = '';
        
        this.matches.forEach(match => {
            const matchEl = document.createElement('div');
            matchEl.className = `schedule-item ${match.status}`;
            
            const time = new Date(match.scheduledTime).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const score = match.score1 !== null && match.score2 !== null 
                ? `${match.score1} - ${match.score2}`
                : 'vs';
            
            matchEl.innerHTML = `
                <div class="match-time">${time}</div>
                <div class="match-teams">${match.team1} vs ${match.team2}</div>
                <div class="match-score">${score}</div>
                <div class="match-status">${match.round}</div>
            `;
            
            scheduleList.appendChild(matchEl);
        });
    }

    // Tabelle anzeigen
    updateStandingsDisplay() {
        const tableBody = document.getElementById('group-a-teams');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        
        this.standings.forEach((team, index) => {
            const row = document.createElement('div');
            row.className = 'team-row';
            
            row.innerHTML = `
                <span>${index + 1}</span>
                <span>${team.name}</span>
                <span>${team.played}</span>
                <span>${team.points}</span>
                <span>${team.goalsFor - team.goalsAgainst}</span>
            `;
            
            tableBody.appendChild(row);
        });
    }

    // Verzögerung hinzufügen
    addDelay(minutes) {
        this.delays += minutes;
        // Alle nachfolgenden Spiele verschieben
        this.matches.forEach(match => {
            if (match.scheduledTime > this.currentTime) {
                match.scheduledTime.setMinutes(match.scheduledTime.getMinutes() + minutes);
            }
        });
    }
}

// Globale Instanz
window.tournamentManager = new TournamentManager(); 