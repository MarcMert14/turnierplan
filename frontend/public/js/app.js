const API_URL = 'https://turnierplan-backend.onrender.com/api';

// Timer-Variablen
let timerInterval = null;
let currentTimerStatus = null;
let lastTimerSync = Date.now();

// Timer-Funktionen
async function loadTimer() {
    try {
        const response = await fetch(`${API_URL}/timer`);
        const timerData = await response.json();
        updateTimerDisplay(timerData);
        currentTimerStatus = timerData;
        lastTimerSync = Date.now();
    } catch (error) {
        console.error('Fehler beim Laden des Timers:', error);
    }
}

function updateTimerDisplay(timerData) {
    const timerDisplay = document.getElementById('timer-display');
    const timerStatus = document.getElementById('timer-status');
    
    if (timerDisplay && timerStatus) {
        timerDisplay.textContent = timerData.displayTime;
        
        // Status und Styling aktualisieren
        timerDisplay.className = 'timer-display';
        if (timerData.isRunning) {
            timerStatus.textContent = 'Läuft';
            timerDisplay.classList.add('running');
            
            // Warnung bei weniger als 1 Minute
            if (timerData.timeLeft <= 60) {
                timerDisplay.classList.add('warning');
            }
            
            // Beendet bei 0
            if (timerData.timeLeft <= 0) {
                timerDisplay.classList.remove('running', 'warning');
                timerDisplay.classList.add('finished');
                timerStatus.textContent = 'Beendet';
            }
        } else {
            timerStatus.textContent = timerData.timeLeft > 0 ? 'Pausiert' : 'Bereit';
        }
    }
}

function startTimerUpdate() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (currentTimerStatus) {
            let timeLeft = currentTimerStatus.timeLeft;
            let isRunning = currentTimerStatus.isRunning;
            let sinceSync = Math.floor((Date.now() - lastTimerSync) / 1000);
            if (isRunning) {
                timeLeft = Math.max(0, currentTimerStatus.timeLeft - sinceSync);
            }
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            const displayTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            const timerDisplay = document.getElementById('timer-display');
            const timerStatus = document.getElementById('timer-status');
            if (timerDisplay && timerStatus) {
                timerDisplay.textContent = displayTime;
                timerDisplay.className = 'timer-display';
                if (isRunning) {
                    timerStatus.textContent = 'Läuft';
                    timerDisplay.classList.add('running');
                    if (timeLeft <= 60 && timeLeft > 0) timerDisplay.classList.add('warning');
                    if (timeLeft <= 0) {
                        timerDisplay.classList.remove('running', 'warning');
                        timerDisplay.classList.add('finished');
                        timerStatus.textContent = 'Beendet';
                    }
                } else {
                    timerStatus.textContent = timeLeft > 0 ? 'Pausiert' : 'Bereit';
                }
            }
        }
    }, 100);
}

// Hauptfunktionen
async function loadSchedule() {
    try {
        const [matchesResponse, teamsResponse] = await Promise.all([
            fetch(`${API_URL}/matches`),
            fetch(`${API_URL}/teams`)
        ]);
        const matches = await matchesResponse.json();
        const teams = await teamsResponse.json();
        displaySchedule(matches, teams);
        displayCurrentAndNextMatch(matches, teams);
        await loadKOMatchesIndex();
    } catch (error) {
        console.error('Fehler beim Laden des Spielplans:', error);
        document.getElementById('schedule-list').innerHTML = '<div class="error">Fehler beim Laden des Spielplans</div>';
    }
}

async function loadStandings() {
    try {
        const response = await fetch(`${API_URL}/standings`);
        const standings = await response.json();
        displayStandings(standings);
    } catch (error) {
        console.error('Fehler beim Laden der Tabelle:', error);
        document.getElementById('standings-table').innerHTML = '<div class="error">Fehler beim Laden der Tabelle</div>';
    }
}

async function loadKOMatchesIndex() {
    try {
        const res = await fetch(`${API_URL}/ko-matches`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            if (data && data.success) {
                displayKOMatchesIndex(data.koMatches);
                return;
            }
        }
    } catch (e) {}
    // Fallback: alte Anzeige
    const matchesResponse = await fetch(`${API_URL}/matches`);
    const matches = await matchesResponse.json();
    displayKOMatchesIndex(matches.ko || []);
}

function displayKOMatchesIndex(koMatches) {
    const el = document.getElementById('ko-phase-list');
    if (!el) return;
    el.innerHTML = '';
    // Gruppiere nach KO-Runden wie im Adminbereich
    const koRounds = {
        'Achtelfinale': koMatches.filter(m => m.round && m.round.startsWith('Achtelfinale')),
        'Viertelfinale': koMatches.filter(m => m.round && m.round.startsWith('Viertelfinale')),
        'Halbfinale': koMatches.filter(m => m.round && m.round.startsWith('Halbfinale')),
        'Finale': koMatches.filter(m => m.round && m.round.startsWith('Finale'))
    };
    Object.entries(koRounds).forEach(([roundName, roundMatches]) => {
        if (roundMatches.length > 0) {
            const roundSection = document.createElement('div');
            roundSection.className = 'ko-round-section';
            roundSection.innerHTML = `
                <div class="ko-round-header">
                    <h4>${getRoundIcon(roundName)} ${roundName}</h4>
                    <span class="round-info">${roundMatches.length} Spiel${roundMatches.length > 1 ? 'e' : ''}</span>
                </div>
                <div class="ko-round-matches">
                    <div class="schedule-list">
                        <div class="header">
                            <span>Runde</span>
                            <span>Teams</span>
                            <span>Ergebnis</span>
                            <span>Zeit</span>
                            <span>Status</span>
                        </div>
                    </div>
                </div>
            `;
            const matchesContainer = roundSection.querySelector('.schedule-list');
            roundMatches.forEach(match => {
                if (match.phase === 'pause') return;
                const div = document.createElement('div');
                div.className = 'match ko-match' + (match.status === 'completed' ? ' completed' : '') + (match.status === 'live' ? ' live' : '');
                const score = match.score1 !== null && match.score2 !== null ? `${match.score1} : ${match.score2}` : '- : -';
                const status = match.status === 'completed' ? 'Abgeschlossen' : match.status === 'live' ? 'Läuft' : 'Geplant';
                const timeSlot = `${match.startTime} - ${match.endTime}`;
                div.innerHTML = `
                    <span>${match.round || match.id}</span>
                    <span>${match.team1} vs ${match.team2}</span>
                    <span>${score}</span>
                    <span>${timeSlot}</span>
                    <span>${status}</span>
                `;
                matchesContainer.appendChild(div);
            });
            el.appendChild(roundSection);
        }
    });
}

function displaySchedule(matches, teams = []) {
    console.log('Vorrunde laut Backend:', matches.vorrunde && matches.vorrunde.map(m => `${m.round} | ${m.team1} vs ${m.team2}`));
    const el = document.getElementById('schedule-list');
    if (!el) return;
    el.innerHTML = '';

    function getTeamName(name) {
        if (!teams || teams.length === 0) return name;
        const match = name.match(/^Team (\d+)$/);
        if (match) {
            const idx = parseInt(match[1], 10) - 1;
            if (teams[idx] && teams[idx].name) return teams[idx].name;
        }
        return name;
    }

    // Vorrunde
    if (matches.vorrunde && matches.vorrunde.length > 0) {
        const vorrundeSection = document.createElement('div');
        vorrundeSection.className = 'phase-section';
        // Gruppenerkennung für 8/9 Teams
        let gruppenSet = new Set();
        matches.vorrunde.forEach(m => {
            if (m.round && m.round.match(/Gruppe ([A-Z])/)) {
                gruppenSet.add(m.round.match(/Gruppe ([A-Z])/)[1]);
            }
        });
        const gruppen = Array.from(gruppenSet);
        let vorrundeHeader = '';
        if (gruppen.length > 0) {
            vorrundeHeader = `<span class="phase-info">Gruppen: ${gruppen.join(', ')}</span>`;
        } else {
            vorrundeHeader = `<span class="phase-info">10 Spiele • Jeder spielt 2x</span>`;
        }
        vorrundeSection.innerHTML = `
            <div class="phase-header vorrunde-header">
                <h3>🏆 Vorrunde</h3>
                ${vorrundeHeader}
            </div>
            <div class="phase-matches">
                <div class="schedule-list">
                    <div class="header">
                        <span>Gruppe</span>
                        <span>Teams</span>
                        <span>Ergebnis</span>
                        <span>Zeit</span>
                        <span>Status</span>
                    </div>
                </div>
            </div>
        `;
        const matchesContainer = vorrundeSection.querySelector('.schedule-list');
        matches.vorrunde.forEach(match => {
            const div = document.createElement('div');
            div.className = 'match' + (match.status === 'completed' ? ' completed' : '') + (match.status === 'live' ? ' live' : '');
            const score = match.score1 !== null && match.score2 !== null ? `${match.score1} : ${match.score2}` : '- : -';
            const status = match.status === 'completed' ? 'Abgeschlossen' : match.status === 'live' ? 'Läuft' : 'Geplant';
            const timeSlot = `${match.startTime} - ${match.endTime}`;
            // Gruppenspalte: bei 8/9 Teams Gruppe, sonst Spielnummer
            let gruppenLabel = '-';
            if (match.round && match.round.match(/Gruppe ([A-Z])/)) {
                gruppenLabel = match.round.match(/Gruppe ([A-Z])/)[1];
            } else if (match.gruppe) {
                gruppenLabel = match.gruppe;
            } else if (match.id && match.id.startsWith('v')) {
                gruppenLabel = match.id;
            }
            // Desktop-Ansicht: Spalten exakt wie Header
            div.innerHTML = `
                <span>${gruppenLabel}</span>
                <span>${getTeamName(match.team1)} vs ${getTeamName(match.team2)}</span>
                <span>${score}</span>
                <span>${timeSlot}</span>
                <span>${status}</span>
            `;
            matchesContainer.appendChild(div);
        });
        el.appendChild(vorrundeSection);
    }

    // K.o.-Phase
    if (matches.ko && matches.ko.length > 0) {
        console.log('KO-Spiele gefunden:', matches.ko);
        const koSection = document.createElement('div');
        koSection.className = 'phase-section';
        koSection.innerHTML = `
            <div class="phase-header ko-header">
                <h3>⚔️ K.o.-Phase</h3>
                <span class="phase-info">KO-Spiele</span>
            </div>
        `;
        const koRounds = {
            'Achtelfinale': matches.ko.filter(m => m.round && m.round.startsWith('Achtelfinale')),
            'Viertelfinale': matches.ko.filter(m => m.round && m.round.startsWith('Viertelfinale')),
            'Halbfinale': matches.ko.filter(m => m.round && m.round.startsWith('Halbfinale')),
            'Finale': matches.ko.filter(m => m.round && m.round.startsWith('Finale'))
        };
        console.log('KO-Runden gruppiert:', koRounds);
        Object.entries(koRounds).forEach(([roundName, roundMatches]) => {
            if (roundMatches.length > 0) {
                const roundSection = document.createElement('div');
                roundSection.className = 'ko-round-section';
                roundSection.innerHTML = `
                    <div class="ko-round-header">
                        <h4>${getRoundIcon(roundName)} ${roundName}</h4>
                        <span class="round-info">${roundMatches.length} Spiel${roundMatches.length > 1 ? 'e' : ''}</span>
                    </div>
                    <div class="ko-round-matches">
                        <div class="schedule-list">
                            <div class="header">
                                <span>Runde</span>
                                <span>Teams</span>
                                <span>Ergebnis</span>
                                <span>Zeit</span>
                                <span>Status</span>
                            </div>
                        </div>
                    </div>
                `;
                const matchesContainer = roundSection.querySelector('.schedule-list');
                roundMatches.forEach(match => {
                    if (match.phase === 'pause') {
                        // Pause optisch hervorheben
                        const pauseDiv = document.createElement('div');
                        pauseDiv.className = 'match pause-match';
                        pauseDiv.innerHTML = `
                            <span class="match-header"><div class="match-id">${match.id}</div><div class="match-round">Pause</div></span>
                            <span class="teams" colspan="2">${match.round || 'Pause'}</span>
                            <span class="score">-</span>
                            <span class="time">${match.startTime} - ${match.endTime}</span>
                            <span class="status">Pause</span>
                        `;
                        matchesContainer.appendChild(pauseDiv);
                    } else {
                        const div = document.createElement('div');
                        div.className = 'match ko-match' + (match.status === 'completed' ? ' completed' : '') + (match.status === 'live' ? ' live' : '');
                        const score = match.score1 !== null && match.score2 !== null ? `${match.score1} : ${match.score2}` : '- : -';
                        const status = match.status === 'completed' ? 'Abgeschlossen' : match.status === 'live' ? 'Läuft' : 'Geplant';
                        const timeSlot = `${match.startTime} - ${match.endTime}`;
                        div.innerHTML = `
                            <span>${match.round || match.id}</span>
                            <span>${getTeamName(match.team1)} vs ${getTeamName(match.team2)}</span>
                            <span>${score}</span>
                            <span>${timeSlot}</span>
                            <span>${status}</span>
                        `;
                        matchesContainer.appendChild(div);
                    }
                });
                koSection.appendChild(roundSection);
            }
        });
        el.appendChild(koSection);
    }
}

function displayStandings(standings) {
    console.log('DEBUG standings:', standings);
    const el = document.getElementById('standings-table');
    if (!el) {
        console.error('Element standings-table nicht gefunden!');
        return;
    }
    if (!Array.isArray(standings) || standings.length === 0) {
        el.innerHTML = '<div class="error">Keine Daten für die Tabelle vorhanden.</div>';
        return;
    }
    // Gruppentabellen für 8/9 Teams: Array mit Feld 'gruppe'
    if (Array.isArray(standings) && standings.length > 0 && standings[0].gruppe) {
        el.innerHTML = '';
        // Gruppen extrahieren und sortieren
        const gruppen = Array.from(new Set(standings.map(t => t.gruppe).filter(g => g))).sort();
        gruppen.forEach(gruppe => {
            const teams = standings.filter(t => t.gruppe === gruppe);
            el.innerHTML += `
                <div class="standings-group">
                    <h4>Gruppe ${gruppe}</h4>
                    <div class="standings-table">
                        <div class="header">
                            <span>Platz</span>
                            <span>Team</span>
                            <span>Sp</span>
                            <span>Pkt</span>
                            <span>Tordiff</span>
                            <span>Tore</span>
                        </div>
                        ${teams.map((team, index) => `
                            <div class="row">
                                <span>${index + 1}</span>
                                <span>${team.name}</span>
                                <span>${team.played}</span>
                                <span>${team.points}</span>
                                <span>${team.goalsFor - team.goalsAgainst}</span>
                                <span>${team.goalsFor}:${team.goalsAgainst}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });
        return;
    }
    // Einzel-Tabelle (10 Teams oder Fallback)
    standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const diffA = a.goalsFor - a.goalsAgainst;
        const diffB = b.goalsFor - b.goalsAgainst;
        if (diffB !== diffA) return diffB - diffA;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name);
    });
    el.innerHTML = `
        <div class="standings-table">
            <div class="header">
                <span>Platz</span>
                <span>Team</span>
                <span>Sp</span>
                <span>Pkt</span>
                <span>Tordiff</span>
                <span>Tore</span>
            </div>
            ${standings.map((team, index) => `
                <div class="row">
                    <span>${index + 1}</span>
                    <span>${team.name}</span>
                    <span>${team.played}</span>
                    <span>${team.points}</span>
                    <span>${team.goalsFor - team.goalsAgainst}</span>
                    <span>${team.goalsFor}:${team.goalsAgainst}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function getRoundIcon(roundName) {
    const icons = {
        'Achtelfinale': '⚔️',
        'Achtelfinale 1': '⚔️',
        'Achtelfinale 2': '⚔️',
        'Viertelfinale': '🏆',
        'Viertelfinale 1': '🏆',
        'Viertelfinale 2': '🏆',
        'Viertelfinale 3': '🏆',
        'Viertelfinale 4': '🏆',
        'Halbfinale': '🥇',
        'Halbfinale 1': '🥇',
        'Halbfinale 2': '🥇',
        'Finale': '👑'
    };
    return icons[roundName] || '⚔️';
}

// Tab-Funktionalität
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            // Alle Tabs deaktivieren
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            // Ziel-Tab aktivieren
            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });
}

// Funktion zum Anzeigen des aktuellen und nächsten Spiels
function displayCurrentAndNextMatch(matches, teams = []) {
    // Hilfsfunktion für Teamnamen
    function getTeamName(name) {
        if (!teams || teams.length === 0) return name;
        const match = name.match(/^Team (\d+)$/);
        if (match) {
            const idx = parseInt(match[1], 10) - 1;
            if (teams[idx] && teams[idx].name) return teams[idx].name;
        }
        return name;
    }

    // Alle Spiele in einem Array zusammenfassen und nach Zeit sortieren
    const allMatches = [...(matches.vorrunde || []), ...(matches.ko || [])];
    allMatches.sort((a, b) => {
        if (a.startTime && b.startTime) {
            return a.startTime.localeCompare(b.startTime);
        }
        return 0;
    });

    // Aktuelles Spiel finden (läuft oder als nächstes geplant)
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    let currentMatch = null;
    let nextMatch = null;
    
    // Finde das aktuelle Spiel (läuft oder als nächstes)
    for (let i = 0; i < allMatches.length; i++) {
        const match = allMatches[i];
        if (match.status === 'live') {
            currentMatch = match;
            nextMatch = allMatches[i + 1] || null;
            break;
        } else if (match.status === 'geplant' || match.status === 'wartend') {
            if (!currentMatch) {
                currentMatch = match;
                nextMatch = allMatches[i + 1] || null;
            }
        }
    }

    // Aktuelles Spiel anzeigen
    const currentMatchEl = document.getElementById('current-match');
    if (currentMatchEl) {
        if (currentMatch) {
            const status = currentMatch.status === 'live' ? 'LÄUFT JETZT' : 
                          currentMatch.status === 'completed' ? 'ABGESCHLOSSEN' : 'GEPLANT';
            const statusClass = currentMatch.status === 'live' ? 'live' : 
                               currentMatch.status === 'completed' ? 'completed' : 'planned';
            
            currentMatchEl.innerHTML = `
                <div class="match-info ${statusClass}">
                    <div class="match-header">
                        <div class="match-round">${currentMatch.round || 'Vorrunde'}</div>
                    </div>
                    <div class="match-teams">
                        <div class="team team1">${getTeamName(currentMatch.team1)}</div>
                        <div class="vs">vs</div>
                        <div class="team team2">${getTeamName(currentMatch.team2)}</div>
                    </div>
                    <div class="match-details">
                        <div class="match-time">${currentMatch.startTime} - ${currentMatch.endTime}</div>
                        <div class="match-status ${statusClass}">${status}</div>
                    </div>
                </div>
            `;
        } else {
            currentMatchEl.innerHTML = '<div class="no-match">Kein Spiel geplant</div>';
        }
    }

    // Nächstes Spiel anzeigen
    const nextMatchEl = document.getElementById('next-match');
    if (nextMatchEl) {
        if (nextMatch) {
            nextMatchEl.innerHTML = `
                <div class="match-info next">
                    <div class="match-header">
                        <div class="match-round">${nextMatch.round || 'Vorrunde'}</div>
                    </div>
                    <div class="match-teams">
                        <div class="team team1">${getTeamName(nextMatch.team1)}</div>
                        <div class="vs">vs</div>
                        <div class="team team2">${getTeamName(nextMatch.team2)}</div>
                    </div>
                    <div class="match-details">
                        <div class="match-time">${nextMatch.startTime} - ${nextMatch.endTime}</div>
                        <div class="match-status next">NÄCHSTES SPIEL</div>
                    </div>
                </div>
            `;
        } else {
            nextMatchEl.innerHTML = '<div class="no-match">Kein weiteres Spiel geplant</div>';
        }
    }
}

// Initialisierung
async function init() {
    // Timer laden und starten
    await loadTimer();
    startTimerUpdate();
    // Timer alle 5 Sekunden neu laden
    setInterval(loadTimer, 5000);
    // Daten laden
    await loadSchedule();
    await loadStandings();
    // Tabs initialisieren
    initTabs();
    // Alle 1 Sekunde Daten neu laden (fast live)
    setInterval(async () => {
        await loadSchedule();
        await loadStandings();
    }, 1000);
    // Nach Initialisierung: Live-Update für Spielplan
    setInterval(loadSchedule, 10000);
}

// Beim Laden starten
document.addEventListener('DOMContentLoaded', init); 