// Admin JavaScript
class AdminManager {
    constructor() {
        this.currentMatch = null;
        this.modals = {};
        this.init();
    }

    init() {
        this.setupNavigation();
        this.setupModals();
        this.setupEventListeners();
        this.loadMatches();
        this.loadTeams();
        this.loadSchedule();
        this.setupAutoSave();
    }

    // Navigation Setup
    setupNavigation() {
        const navButtons = document.querySelectorAll('.nav-btn');
        const sections = document.querySelectorAll('.admin-section');

        navButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetSection = button.getAttribute('data-section');
                
                // Navigation aktualisieren
                navButtons.forEach(btn => btn.classList.remove('active'));
                sections.forEach(section => section.classList.remove('active'));
                
                button.classList.add('active');
                document.getElementById(targetSection).classList.add('active');
            });
        });
    }

    // Modals Setup
    setupModals() {
        // Score Modal
        this.modals.score = document.getElementById('score-modal');
        this.modals.delay = document.getElementById('delay-modal');

        // Close buttons
        document.getElementById('close-modal').addEventListener('click', () => {
            this.closeModal('score');
        });

        document.getElementById('close-delay-modal').addEventListener('click', () => {
            this.closeModal('delay');
        });

        // Cancel buttons
        document.getElementById('cancel-score').addEventListener('click', () => {
            this.closeModal('score');
        });

        document.getElementById('cancel-delay').addEventListener('click', () => {
            this.closeModal('delay');
        });

        // Close on outside click
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id.replace('-modal', ''));
            }
        });
    }

    // Event Listeners Setup
    setupEventListeners() {
        // Score form
        document.getElementById('score-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveScore();
        });

        // Delay form
        document.getElementById('delay-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addDelay();
        });

        // Add delay button
        document.getElementById('add-delay').addEventListener('click', () => {
            this.openModal('delay');
        });

        // Reset schedule
        document.getElementById('reset-schedule').addEventListener('click', () => {
            this.resetSchedule();
        });

        // Add team form
        document.getElementById('add-team-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTeam();
        });

        // Time settings
        document.getElementById('time-settings').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTimeSettings();
        });

        // Tournament controls
        document.getElementById('start-tournament').addEventListener('click', () => {
            this.startTournament();
        });

        document.getElementById('pause-tournament').addEventListener('click', () => {
            this.pauseTournament();
        });

        document.getElementById('reset-tournament').addEventListener('click', () => {
            this.resetTournament();
        });

        // Export/Import
        document.getElementById('export-data').addEventListener('click', () => {
            this.exportData();
        });

        document.getElementById('import-data').addEventListener('click', () => {
            document.getElementById('import-file').click();
        });

        document.getElementById('import-file').addEventListener('change', (e) => {
            this.importData(e.target.files[0]);
        });
    }

    // Modal Functions
    openModal(type) {
        this.modals[type].style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    closeModal(type) {
        this.modals[type].style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    // Load Matches
    loadMatches() {
        if (!window.tournamentManager) return;

        const groupMatches = document.getElementById('group-matches');
        const knockoutMatches = document.getElementById('knockout-matches');

        groupMatches.innerHTML = '';
        knockoutMatches.innerHTML = '';

        window.tournamentManager.matches.forEach(match => {
            const matchEl = this.createMatchElement(match);
            
            if (match.phase === 'group') {
                groupMatches.appendChild(matchEl);
            } else {
                knockoutMatches.appendChild(matchEl);
            }
        });
    }

    // Create Match Element
    createMatchElement(match) {
        const matchEl = document.createElement('div');
        matchEl.className = 'match-item';
        matchEl.dataset.matchId = match.id;

        const time = new Date(match.scheduledTime).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const score = match.score1 !== null && match.score2 !== null 
            ? `${match.score1} - ${match.score2}`
            : 'vs';

        matchEl.innerHTML = `
            <div class="match-info">
                <div class="match-teams">${match.team1} vs ${match.team2}</div>
                <div class="match-time">${time} - ${match.round}</div>
            </div>
            <div class="match-score">${score}</div>
            <div class="match-actions">
                <button class="btn btn-primary btn-small" onclick="adminManager.editScore('${match.id}')">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-secondary btn-small" onclick="adminManager.viewMatch('${match.id}')">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        `;

        return matchEl;
    }

    // Edit Score
    editScore(matchId) {
        const match = window.tournamentManager.matches.find(m => m.id === matchId);
        if (!match) return;

        this.currentMatch = match;
        
        document.getElementById('modal-title').textContent = `Spielstand: ${match.team1} vs ${match.team2}`;
        document.getElementById('team1-label').textContent = match.team1;
        document.getElementById('team2-label').textContent = match.team2;
        document.getElementById('team1-score').value = match.score1 || 0;
        document.getElementById('team2-score').value = match.score2 || 0;

        this.openModal('score');
    }

    // Save Score
    saveScore() {
        if (!this.currentMatch) return;

        const score1 = parseInt(document.getElementById('team1-score').value);
        const score2 = parseInt(document.getElementById('team2-score').value);

        if (isNaN(score1) || isNaN(score2)) {
            this.showMessage('Bitte geben Sie gültige Zahlen ein.', 'error');
            return;
        }

        window.tournamentManager.updateScore(this.currentMatch.id, score1, score2);
        this.loadMatches();
        this.closeModal('score');
        this.showMessage('Spielstand erfolgreich gespeichert!', 'success');
    }

    // View Match
    viewMatch(matchId) {
        const match = window.tournamentManager.matches.find(m => m.id === matchId);
        if (!match) return;

        // Hier könnte eine detaillierte Match-Ansicht implementiert werden
        alert(`Match Details:\n${match.team1} vs ${match.team2}\nZeit: ${new Date(match.scheduledTime).toLocaleString('de-DE')}\nStatus: ${match.status}`);
    }

    // Load Teams
    loadTeams() {
        const teamsList = document.getElementById('teams-list');
        teamsList.innerHTML = '';

        TOURNAMENT_CONFIG.teams.forEach(team => {
            const teamEl = document.createElement('div');
            teamEl.className = 'team-card';
            teamEl.innerHTML = `
                <h4>${team}</h4>
                <button class="btn btn-danger btn-small" onclick="adminManager.removeTeam('${team}')">
                    <i class="fas fa-trash"></i> Entfernen
                </button>
            `;
            teamsList.appendChild(teamEl);
        });
    }

    // Add Team
    addTeam() {
        const teamName = document.getElementById('new-team-name').value.trim();
        if (!teamName) {
            this.showMessage('Bitte geben Sie einen Team-Namen ein.', 'error');
            return;
        }

        if (TOURNAMENT_CONFIG.teams.includes(teamName)) {
            this.showMessage('Dieses Team existiert bereits.', 'error');
            return;
        }

        TOURNAMENT_CONFIG.teams.push(teamName);
        this.loadTeams();
        document.getElementById('new-team-name').value = '';
        this.showMessage(`Team "${teamName}" erfolgreich hinzugefügt!`, 'success');
    }

    // Remove Team
    removeTeam(teamName) {
        if (confirm(`Möchten Sie das Team "${teamName}" wirklich entfernen?`)) {
            const index = TOURNAMENT_CONFIG.teams.indexOf(teamName);
            if (index > -1) {
                TOURNAMENT_CONFIG.teams.splice(index, 1);
                this.loadTeams();
                this.showMessage(`Team "${teamName}" erfolgreich entfernt!`, 'success');
            }
        }
    }

    // Load Schedule
    loadSchedule() {
        const timeline = document.getElementById('schedule-timeline');
        timeline.innerHTML = '';

        if (!window.tournamentManager) return;

        window.tournamentManager.matches.forEach(match => {
            const timelineEl = document.createElement('div');
            timelineEl.className = `timeline-item ${match.status}`;
            
            const time = new Date(match.scheduledTime).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit'
            });

            timelineEl.innerHTML = `
                <div class="timeline-info">
                    <div class="timeline-time">${time}</div>
                    <div class="timeline-match">${match.team1} vs ${match.team2}</div>
                    <div class="timeline-round">${match.round}</div>
                </div>
                <div class="timeline-status">
                    <span class="status-badge ${match.status}">${match.status}</span>
                </div>
            `;

            timeline.appendChild(timelineEl);
        });
    }

    // Add Delay
    addDelay() {
        const minutes = parseInt(document.getElementById('delay-minutes').value);
        const reason = document.getElementById('delay-reason').value;

        if (isNaN(minutes) || minutes < 1) {
            this.showMessage('Bitte geben Sie eine gültige Verzögerung ein.', 'error');
            return;
        }

        window.tournamentManager.addDelay(minutes);
        this.loadSchedule();
        this.closeModal('delay');
        
        const message = reason 
            ? `Verzögerung von ${minutes} Minuten hinzugefügt. Grund: ${reason}`
            : `Verzögerung von ${minutes} Minuten hinzugefügt.`;
        
        this.showMessage(message, 'success');
    }

    // Reset Schedule
    resetSchedule() {
        if (confirm('Möchten Sie den Spielplan wirklich zurücksetzen? Alle Spielstände gehen verloren.')) {
            window.tournamentManager.matches.forEach(match => {
                match.score1 = null;
                match.score2 = null;
                match.status = 'scheduled';
                match.actualTime = null;
            });
            
            this.loadMatches();
            this.loadSchedule();
            this.showMessage('Spielplan erfolgreich zurückgesetzt!', 'success');
        }
    }

    // Save Time Settings
    saveTimeSettings() {
        const gameDuration = parseInt(document.getElementById('game-duration').value);
        const breakDuration = parseInt(document.getElementById('break-duration').value);

        if (isNaN(gameDuration) || isNaN(breakDuration)) {
            this.showMessage('Bitte geben Sie gültige Zeiten ein.', 'error');
            return;
        }

        TOURNAMENT_CONFIG.gameDuration = gameDuration;
        TOURNAMENT_CONFIG.breakDuration = breakDuration;
        TOURNAMENT_CONFIG.totalDuration = gameDuration + breakDuration;

        this.showMessage('Spielzeiten erfolgreich gespeichert!', 'success');
    }

    // Tournament Controls
    startTournament() {
        if (confirm('Möchten Sie das Turnier starten?')) {
            window.tournamentManager.isTournamentStarted = true;
            this.showMessage('Turnier gestartet!', 'success');
        }
    }

    pauseTournament() {
        if (confirm('Möchten Sie das Turnier pausieren?')) {
            window.tournamentManager.isTournamentStarted = false;
            this.showMessage('Turnier pausiert!', 'warning');
        }
    }

    resetTournament() {
        if (confirm('Möchten Sie das Turnier wirklich zurücksetzen? Alle Daten gehen verloren.')) {
            location.reload();
        }
    }

    // Export Data
    exportData() {
        const data = {
            config: TOURNAMENT_CONFIG,
            matches: window.tournamentManager.matches,
            standings: window.tournamentManager.standings,
            timestamp: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `juxturnier-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showMessage('Daten erfolgreich exportiert!', 'success');
    }

    // Import Data
    importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.config && data.matches) {
                    Object.assign(TOURNAMENT_CONFIG, data.config);
                    window.tournamentManager.matches = data.matches;
                    window.tournamentManager.standings = data.standings || [];
                    
                    this.loadMatches();
                    this.loadTeams();
                    this.loadSchedule();
                    
                    this.showMessage('Daten erfolgreich importiert!', 'success');
                } else {
                    this.showMessage('Ungültige Datei.', 'error');
                }
            } catch (error) {
                this.showMessage('Fehler beim Importieren der Datei.', 'error');
            }
        };
        reader.readAsText(file);
    }

    // Show Message
    showMessage(text, type = 'info') {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        messageEl.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${text}</span>
        `;

        // Remove existing messages
        document.querySelectorAll('.message').forEach(msg => msg.remove());

        // Add new message
        const container = document.querySelector('.container');
        container.insertBefore(messageEl, container.firstChild);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        }, 5000);
    }

    // Auto Save
    setupAutoSave() {
        setInterval(() => {
            if (window.tournamentManager) {
                localStorage.setItem('juxturnier-data', JSON.stringify({
                    config: TOURNAMENT_CONFIG,
                    matches: window.tournamentManager.matches,
                    standings: window.tournamentManager.standings
                }));
            }
        }, 30000); // Every 30 seconds
    }

    // Load from localStorage
    loadFromStorage() {
        const saved = localStorage.getItem('juxturnier-data');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                Object.assign(TOURNAMENT_CONFIG, data.config);
                if (window.tournamentManager) {
                    window.tournamentManager.matches = data.matches;
                    window.tournamentManager.standings = data.standings;
                }
            } catch (error) {
                console.error('Error loading saved data:', error);
            }
        }
    }
}

// SheetJS laden (CDN)
(function() {
    if (!window.XLSX) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        script.onload = function() {
            adminManager && adminManager.setupExcelImport();
        };
        document.head.appendChild(script);
    }
})();

AdminManager.prototype.setupExcelImport = function() {
    const importBtn = document.getElementById('import-teams-excel');
    const fileInput = document.getElementById('excel-file-input');
    if (!importBtn || !fileInput) return;

    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                // Annahme: Teams stehen ab Zeile 4, Teamname in Spalte B (Index 1), 'Dabei?' in Spalte F (Index 5)
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                const teamNames = rows
                    .slice(3)
                    .filter(r => r[5] && r[5].toString().toLowerCase() === 'ja')
                    .map(r => r[1])
                    .filter(Boolean);
                if (teamNames.length === 0) {
                    this.showMessage('Keine Teamnamen mit "Ja" in der Excel-Datei gefunden.', 'error');
                    return;
                }
                TOURNAMENT_CONFIG.teams = teamNames;
                // Spielplan und Manager komplett neu erzeugen
                window.tournamentManager = new TournamentManager();
                this.loadTeams();
                this.showMessage('Teams und Spielplan erfolgreich aus Excel importiert!', 'success');
            } catch (err) {
                this.showMessage('Fehler beim Einlesen der Excel-Datei.', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    });
};

// Initialize Admin Manager
let adminManager;
document.addEventListener('DOMContentLoaded', () => {
    adminManager = new AdminManager();
    adminManager.loadFromStorage();
    if (window.XLSX) adminManager.setupExcelImport();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
            case 's':
                e.preventDefault();
                if (adminManager.currentMatch) {
                    adminManager.saveScore();
                }
                break;
            case 'e':
                e.preventDefault();
                adminManager.exportData();
                break;
            case 'i':
                e.preventDefault();
                document.getElementById('import-file').click();
                break;
        }
    }
    
    // Escape to close modals
    if (e.key === 'Escape') {
        Object.keys(adminManager.modals).forEach(type => {
            adminManager.closeModal(type);
        });
    }
}); 