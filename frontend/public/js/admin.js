const API_URL = 'https://turnierplan-backend.onrender.com/api';
let adminToken = localStorage.getItem('adminToken') || '';

// Timer-Variablen
let timerInterval = null;
let currentTimerStatus = null;
let lastTimerSync = Date.now();

async function fetchData(endpoint, opts = {}) {
    const headers = opts.headers || {};
    if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
    
    try {
        const res = await fetch(`${API_URL}/${endpoint}`, { ...opts, headers });
        
        if (res.status === 401) {
            throw new Error('Nicht eingeloggt oder Session abgelaufen');
        }
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await res.json();
        } else {
            // Wenn keine JSON-Antwort, versuche trotzdem zu parsen
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch (parseError) {
                throw new Error(`Server-Antwort ist kein gültiges JSON: ${text.substring(0, 100)}...`);
            }
        }
    } catch (error) {
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            throw new Error('Server nicht erreichbar. Bitte starten Sie das Backend.');
        }
        throw error;
    }
}

// Timer-Funktionen
async function loadTimer() {
    try {
        const response = await fetch(`${API_URL}/timer`);
        const timerData = await response.json();
        updateAdminTimerDisplay(timerData);
        currentTimerStatus = timerData;
        lastTimerSync = Date.now();
    } catch (error) {
        console.error('Fehler beim Laden des Timers:', error);
    }
}

function updateAdminTimerDisplay(timerData) {
    const timerDisplay = document.getElementById('admin-timer-display');
    const timerStatus = document.getElementById('admin-timer-status');
    
    if (timerDisplay && timerStatus) {
        timerDisplay.textContent = timerData.displayTime;
        
        // Status und Button-States aktualisieren
        if (timerData.isRunning) {
            timerStatus.textContent = 'Läuft';
            document.getElementById('start-timer-btn').disabled = true;
            document.getElementById('pause-timer-btn').disabled = false;
            document.getElementById('reset-timer-btn').disabled = false;
        } else {
            timerStatus.textContent = timerData.timeLeft > 0 ? 'Pausiert' : 'Bereit';
            document.getElementById('start-timer-btn').disabled = false;
            document.getElementById('pause-timer-btn').disabled = true;
            document.getElementById('reset-timer-btn').disabled = false;
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
            const timerDisplay = document.getElementById('admin-timer-display');
            const timerStatus = document.getElementById('admin-timer-status');
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

// Timer-Steuerung
async function startTimer() {
    try {
        const response = await fetchData('timer/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.success) {
            await loadTimer();
            showMessage('Timer gestartet', 'success');
        } else {
            throw new Error(response.message || 'Fehler beim Starten');
        }
    } catch (error) {
        showMessage('Fehler beim Starten des Timers: ' + error.message, 'error');
    }
}

async function pauseTimer() {
    try {
        const response = await fetchData('timer/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.success) {
            await loadTimer();
            showMessage('Timer pausiert', 'success');
        } else {
            throw new Error(response.message || 'Fehler beim Pausieren');
        }
    } catch (error) {
        showMessage('Fehler beim Pausieren des Timers: ' + error.message, 'error');
    }
}

async function resetTimer() {
    try {
        const response = await fetchData('timer/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.success) {
            await loadTimer();
            showMessage('Timer zurückgesetzt', 'success');
        } else {
            throw new Error(response.message || 'Fehler beim Zurücksetzen');
        }
    } catch (error) {
        showMessage('Fehler beim Zurücksetzen des Timers: ' + error.message, 'error');
    }
}

// KO-Phase aktualisieren
async function updateKOMatches() {
    try {
        const response = await fetchData('ko/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.success) {
            await loadAdminData(); // Spielplan neu laden
            showMessage('KO-Phase erfolgreich aktualisiert', 'success');
        } else {
            throw new Error(response.message || 'Fehler beim Aktualisieren');
        }
    } catch (error) {
        showMessage('Fehler beim Aktualisieren der KO-Phase: ' + error.message, 'error');
    }
}

// Message-System
function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

function showLogin(show) {
    document.getElementById('login-section').style.display = show ? '' : 'none';
    document.getElementById('admin-panel').style.display = show ? 'none' : '';
}

async function handleLogin(e) {
    e.preventDefault();
    const pw = document.getElementById('admin-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        });
        const data = await res.json();
        if (data.success && data.token) {
            adminToken = data.token;
            localStorage.setItem('adminToken', adminToken);
            showLogin(false);
            loadAdminData();
        } else {
            errorEl.textContent = data.message || 'Login fehlgeschlagen';
            errorEl.style.display = '';
        }
    } catch (err) {
        errorEl.textContent = 'Server nicht erreichbar oder Fehler.';
        errorEl.style.display = '';
    }
}

function handleLogout() {
    adminToken = '';
    localStorage.removeItem('adminToken');
    showLogin(true);
}

// Navigation
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.admin-section');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetSection = btn.getAttribute('data-section');
            
            // Alle Buttons und Sections deaktivieren
            navBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            // Ziel-Section aktivieren
            btn.classList.add('active');
            document.getElementById(targetSection).classList.add('active');
        });
    });
}

document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('logout-btn').addEventListener('click', handleLogout);

// Timer-Event-Listener
document.getElementById('start-timer-btn').addEventListener('click', startTimer);
document.getElementById('pause-timer-btn').addEventListener('click', pauseTimer);
document.getElementById('reset-timer-btn').addEventListener('click', resetTimer);

// KO-Phase-Event-Listener
document.getElementById('update-ko-btn').addEventListener('click', updateKOMatches);

async function loadAdminData() {
    // Spielplan
    let matches = {};
    let teams = [];
    try {
        [matches, teams] = await Promise.all([
            fetchData('matches'),
            fetchData('teams')
        ]);
    } catch (e) {
        handleLogout();
        return;
    }

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
    
    const el = document.getElementById('admin-schedule-list');
    el.innerHTML = '';
    
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
            <div class="admin-header">
                <span>Gruppe</span>
                <span>Teams</span>
                <span>Ergebnis</span>
                <span>Startzeit</span>
                <span>Status</span>
                <span>Aktion</span>
            </div>
        `;
        
        matches.vorrunde.forEach(match => {
            const div = document.createElement('div');
            div.className = 'admin-match' + (match.status === 'completed' ? ' completed' : '');
            
            const score = match.score1 !== null && match.score2 !== null ? `${match.score1} : ${match.score2}` : '- : -';
            const status = match.status === 'completed' ? 'Abgeschlossen' : match.status === 'live' ? 'Läuft' : 'Geplant';
            // Gruppenspalte: bei 8/9 Teams Gruppe, sonst Spielnummer
            let gruppenLabel = '-';
            if (match.round && match.round.match(/Gruppe ([A-Z])/)) {
                gruppenLabel = match.round.match(/Gruppe ([A-Z])/)[1];
            } else if (match.gruppe) {
                gruppenLabel = match.gruppe;
            } else if (match.id && match.id.startsWith('v')) {
                gruppenLabel = match.id;
            }
            div.innerHTML = `
                <span class="match-group">${gruppenLabel}</span>
                <span class="teams">${getTeamName(match.team1)} vs ${getTeamName(match.team2)}</span>
                <span class="score-edit">
                    <input type="number" class="score-input" data-match="${match.id}" data-team="1" value="${match.score1 !== null ? match.score1 : ''}" min="0" max="99">
                    <span>:</span>
                    <input type="number" class="score-input" data-match="${match.id}" data-team="2" value="${match.score2 !== null ? match.score2 : ''}" min="0" max="99">
                </span>
                <span class="time-edit">
                    <input type="time" class="time-input" data-match="${match.id}" value="${match.startTime}" step="300">
                </span>
                <span class="status">${status}</span>
                <span class="action">
                    <button class="delete-btn" data-match="${match.id}" onclick="deleteResult('${match.id}')">🗑️</button>
                </span>
            `;
            vorrundeSection.appendChild(div);
        });
        
        el.appendChild(vorrundeSection);
    }
    
    // K.o.-Phase
    await loadKOMatchesAndRender(teams);
    
    // Teams
    const teamsEl = document.getElementById('admin-teams-list');
    if (teamsEl) {
        teamsEl.innerHTML = `
            <div class="teams-grid">
                ${teams.map((team, index) => `
                    <div class="team-card">
                        <div class="team-card-row">
                            <div class="team-number">${index + 1}</div>
                            <input type="text" class="team-name-input" data-old-name="${team.name}" value="${team.name}" style="width: 140px;">
                            <div class="team-card-actions">
                                <button class="save-team-name-btn" data-old-name="${team.name}">Speichern</button>
                                <button class="delete-team-btn" data-name="${team.name}">Entfernen</button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top:1rem;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <input type="text" id="new-team-name" placeholder="Neues Team" style="width:140px;">
                <button id="add-team-btn">Team hinzufügen</button>
            </div>
        `;
    }
    
    // Event-Listener für Team hinzufügen
    const addTeamBtn = document.getElementById('add-team-btn');
    if (addTeamBtn) {
        addTeamBtn.onclick = async () => {
            const input = document.getElementById('new-team-name');
            const name = input.value.trim();
            if (!name) return showMessage('Bitte Teamnamen eingeben', 'error');
            try {
                const response = await fetchData('teams', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                if (response.success) {
                    showMessage('Team hinzugefügt', 'success');
                    loadAdminData();
                    if (window.loadSchedule) loadSchedule();
                    if (window.loadStandings) loadStandings();
                    input.value = '';
                } else {
                    throw new Error(response.message || 'Fehler beim Hinzufügen');
                }
            } catch (error) {
                showMessage('Fehler beim Hinzufügen: ' + error.message, 'error');
            }
        };
    }
    // Event-Listener für Team entfernen
    teamsEl?.querySelectorAll('.delete-team-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const name = btn.getAttribute('data-name');
            if (!name) return;
            if (!confirm(`Team "${name}" wirklich entfernen?`)) return;
            try {
                const response = await fetchData(`teams/${encodeURIComponent(name)}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (response.success) {
                    showMessage('Team entfernt', 'success');
                    loadAdminData();
                    if (window.loadSchedule) loadSchedule();
                    if (window.loadStandings) loadStandings();
                } else {
                    throw new Error(response.message || 'Fehler beim Entfernen');
                }
            } catch (error) {
                showMessage('Fehler beim Entfernen: ' + error.message, 'error');
            }
        });
    });
    
    // Event-Listener für Score-Inputs
    let scoreUpdateTimeout = null;
    let pendingScoreUpdates = new Map(); // Speichert ausstehende Score-Updates pro Match
    
    document.querySelectorAll('.score-input').forEach(input => {
        // Keyboard-Navigation VOR dem input-Event registrieren
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                console.log('Enter pressed on score input'); // Debug
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                const matchId = this.getAttribute('data-match');
                const currentTeam = this.getAttribute('data-team');
                const isShiftPressed = e.shiftKey;
                
                console.log('Navigating from match:', matchId, 'team:', currentTeam, 'shift:', isShiftPressed); // Debug
                
                // Finde alle Score-Inputs für dieses Match
                const matchInputs = document.querySelectorAll(`.score-input[data-match="${matchId}"]`);
                const currentIndex = Array.from(matchInputs).findIndex(input => input.getAttribute('data-team') === currentTeam);
                
                if (matchInputs.length > 1) {
                    let nextIndex;
                    if (isShiftPressed) {
                        // Shift+Enter: Zurück zum vorherigen Input
                        nextIndex = currentIndex > 0 ? currentIndex - 1 : matchInputs.length - 1;
                    } else {
                        // Enter: Zum nächsten Input
                        nextIndex = currentIndex < matchInputs.length - 1 ? currentIndex + 1 : 0;
                    }
                    
                    console.log('Focusing next input in same match, index:', nextIndex); // Debug
                    // Fokussiere das nächste/vorherige Input-Feld
                    matchInputs[nextIndex].focus();
                    matchInputs[nextIndex].select(); // Markiere den Text für einfache Überschreibung
                } else {
                    // Falls nur ein Input vorhanden, springe zum nächsten Match
                    const allScoreInputs = document.querySelectorAll('.score-input');
                    const currentGlobalIndex = Array.from(allScoreInputs).findIndex(input => 
                        input.getAttribute('data-match') === matchId && 
                        input.getAttribute('data-team') === currentTeam
                    );
                    
                    let nextGlobalIndex;
                    if (isShiftPressed) {
                        // Shift+Enter: Zum vorherigen Match
                        nextGlobalIndex = currentGlobalIndex > 0 ? currentGlobalIndex - 1 : allScoreInputs.length - 1;
                    } else {
                        // Enter: Zum nächsten Match
                        nextGlobalIndex = currentGlobalIndex < allScoreInputs.length - 1 ? currentGlobalIndex + 1 : 0;
                    }
                    
                    console.log('Focusing next match, global index:', nextGlobalIndex); // Debug
                    allScoreInputs[nextGlobalIndex].focus();
                    allScoreInputs[nextGlobalIndex].select();
                }
                
                return false; // Verhindere weitere Event-Verarbeitung
            }
        }, true); // capture: true - Event wird in der Capture-Phase abgefangen
        
        input.addEventListener('input', (e) => {
            let val = e.target.value.trim();
            // Nur Zahlen von 0 bis 99 erlauben, leere Felder = null
            if (val === '') {
                e.target.value = '';
                e.target.classList.remove('input-error');
            } else if (!/^\d{1,2}$/.test(val)) {
                e.target.classList.add('input-error');
                return;
            } else {
                let num = parseInt(val, 10);
                if (isNaN(num) || num < 0 || num > 99) {
                    e.target.classList.add('input-error');
                    return;
                } else {
                    e.target.value = num;
                    e.target.classList.remove('input-error');
                    // Automatischer Sprung ins nächste Feld bei einstelliger Zahl (0-9)
                    if (val.length === 1 && document.activeElement === e.target) {
                        // Finde alle Score-Inputs für dieses Match
                        const matchId = e.target.getAttribute('data-match');
                        const matchInputs = Array.from(document.querySelectorAll(`.score-input[data-match="${matchId}"]`));
                        const currentIndex = matchInputs.indexOf(e.target);
                        // Prüfe, ob das andere Feld noch leer ist
                        const otherIndex = currentIndex === 0 ? 1 : 0;
                        if (matchInputs[otherIndex] && matchInputs[otherIndex].value === '') {
                            // Nur springen, wenn der Nutzer nicht gerade löscht
                            if (!e.inputType || (e.inputType !== 'deleteContentBackward' && e.inputType !== 'deleteContentForward')) {
                                matchInputs[otherIndex].focus();
                                matchInputs[otherIndex].select();
                            }
                        } else {
                            // Beide Felder ausgefüllt: Fokus entfernen
                            e.target.blur();
                        }
                    }
                }
            }
            const matchId = e.target.getAttribute('data-match');
            const team = e.target.getAttribute('data-team');
            const score = e.target.value === '' ? null : parseInt(e.target.value);
            // Speichere die Änderung in der Warteschlange
            if (!pendingScoreUpdates.has(matchId)) {
                pendingScoreUpdates.set(matchId, { score1: null, score2: null });
            }
            const update = pendingScoreUpdates.get(matchId);
            if (team === '1') update.score1 = score;
            if (team === '2') update.score2 = score;
            // Lösche vorherigen Timeout
            if (scoreUpdateTimeout) {
                clearTimeout(scoreUpdateTimeout);
            }
            // Setze neuen Timeout für verzögerte Speicherung
            scoreUpdateTimeout = setTimeout(async () => {
                try {
                    // Hole aktuelle Match-Daten
                    const matches = await fetchData('matches');
                    let match = (matches.vorrunde || []).find(m => m.id === matchId) || (matches.ko || []).find(m => m.id === matchId);
                    // Verwende die ausstehenden Updates oder aktuelle Werte
                    const update = pendingScoreUpdates.get(matchId);
                    let score1 = update.score1 !== null ? update.score1 : (match && match.score1 !== null ? match.score1 : null);
                    let score2 = update.score2 !== null ? update.score2 : (match && match.score2 !== null ? match.score2 : null);
                    // Nur speichern, wenn mindestens ein Score eingegeben wurde
                    if (score1 !== null || score2 !== null) {
                        const response = await fetchData(`matches/${matchId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ score1, score2 })
                        });
                        if (response.success) {
                            loadAdminData();
                            if (window.loadStandings) loadStandings();
                            if (window.loadSchedule) loadSchedule();
                            // Lösche ausstehende Updates nach erfolgreicher Speicherung
                            pendingScoreUpdates.delete(matchId);
                        } else {
                            throw new Error(response.message || 'Fehler beim Speichern');
                        }
                    }
                } catch (error) {
                    showMessage('Fehler beim Speichern: ' + error.message, 'error');
                }
            }, 1000); // 1 Sekunde Verzögerung nach der letzten Eingabe
        });
    });
    
    // Event-Listener für Time-Inputs
    document.querySelectorAll('.time-input').forEach(input => {
        input.addEventListener('change', async (e) => {
            const matchId = e.target.getAttribute('data-match');
            const time = e.target.value;
            try {
                // Sende neue Startzeit ans Backend, das daraufhin ALLE Zeiten fortlaufend neu berechnet
                const response = await fetchData(`matches/${matchId}/time`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ time })
                });
                if (response.success) {
                    // Nach erfolgreicher Änderung alles neu laden (Admin & Index)
                    await loadAdminData();
                    if (window.loadSchedule) loadSchedule();
                    if (window.loadStandings) loadStandings();
                } else {
                    throw new Error(response.message || 'Fehler beim Speichern');
                }
            } catch (error) {
                showMessage('Fehler beim Speichern: ' + error.message, 'error');
            }
        });
    });

    // Event-Listener für Pause-Inputs
    document.querySelectorAll('.pause-input').forEach(input => {
        input.addEventListener('change', async (e) => {
            const matchId = e.target.getAttribute('data-match');
            let pauseDuration = parseInt(e.target.value);
            if (isNaN(pauseDuration) || pauseDuration < 1) pauseDuration = 1;
            // Hole aktuelle Startzeit
            const timeInput = document.querySelector(`.time-input[data-match="${matchId}"]`);
            const time = timeInput ? timeInput.value : '00:00';
            try {
                // Sende Zeit-Update, Backend nimmt pauseDuration aus Objekt
                const response = await fetchData(`matches/${matchId}/time`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ time, pauseDuration })
                });
                if (response.success) {
                    loadAdminData();
                    if (window.loadSchedule) loadSchedule();
                } else {
                    throw new Error(response.message || 'Fehler beim Speichern');
                }
            } catch (error) {
                showMessage('Fehler beim Speichern: ' + error.message, 'error');
            }
        });
    });

    // Event-Listener für Teamnamen-Änderung
    document.querySelectorAll('.save-team-name-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const oldName = btn.getAttribute('data-old-name');
            const input = document.querySelector(`.team-name-input[data-old-name="${oldName}"]`);
            const newName = input.value.trim();
            if (!newName || newName === oldName) return;
            try {
                const response = await fetchData(`teams/${encodeURIComponent(oldName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newName })
                });
                if (response.success) {
                    showMessage('Teamname geändert', 'success');
                    loadAdminData();
                    if (window.loadSchedule) loadSchedule();
                    if (window.loadStandings) loadStandings();
                } else {
                    throw new Error(response.message || 'Fehler beim Umbenennen');
                }
            } catch (error) {
                showMessage('Fehler beim Umbenennen: ' + error.message, 'error');
            }
        });
    });

    renderKOModusSwitch(teams);
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

// === SPIELZEIT-EINSTELLUNG ===
async function loadSpielzeit() {
    try {
        const res = await fetchData('settings/spielzeit');
        if (res && typeof res.spielzeit === 'number') {
            document.getElementById('spielzeit-minuten').value = res.spielzeit;
        }
    } catch (e) {
        // Fallback: Standardwert
        document.getElementById('spielzeit-minuten').value = 8;
    }
}

document.getElementById('spielzeit-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const minuten = parseInt(document.getElementById('spielzeit-minuten').value, 10);
    if (isNaN(minuten) || minuten < 1 || minuten > 60) return;
    try {
        await fetchData('settings/spielzeit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spielzeit: minuten })
        });
        document.getElementById('spielzeit-success').style.display = 'inline';
        setTimeout(() => document.getElementById('spielzeit-success').style.display = 'none', 2000);
        showMessage('Spielzeit gespeichert. Spielplan und Timer werden angepasst.', 'success');
    } catch (e) {
        showMessage('Fehler beim Speichern der Spielzeit', 'error');
    }
});

// === PAUSENZEIT-EINSTELLUNG ===
async function loadPausenzeit() {
    try {
        const res = await fetchData('settings/pausenzeit');
        if (res && typeof res.pausenzeit === 'number') {
            document.getElementById('pausenzeit-minuten').value = res.pausenzeit;
        }
    } catch (e) {
        document.getElementById('pausenzeit-minuten').value = 4;
    }
}

document.getElementById('pausenzeit-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const minuten = parseInt(document.getElementById('pausenzeit-minuten').value, 10);
    if (isNaN(minuten) || minuten < 1 || minuten > 60) return;
    try {
        await fetchData('settings/pausenzeit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pausenzeit: minuten })
        });
        document.getElementById('pausenzeit-success').style.display = 'inline';
        setTimeout(() => document.getElementById('pausenzeit-success').style.display = 'none', 2000);
        showMessage('Pausenzeit gespeichert. Spielplan wird angepasst.', 'success');
    } catch (e) {
        showMessage('Fehler beim Speichern der Pausenzeit', 'error');
    }
});

// Initialisierung
async function init() {
    // Navigation initialisieren
    initNavigation();
    
    // Timer laden und starten
    await loadTimer();
    startTimerUpdate();
    
    // Timer alle 5 Sekunden neu laden
    setInterval(loadTimer, 5000);
    
    // Beim Laden prüfen, ob Token vorhanden
    if (adminToken) {
        showLogin(false);
        loadAdminData();
    } else {
        showLogin(true);
    }

    // Turnier zurücksetzen Button in die Einstellungen-Sektion einfügen
    const settingsGrid = document.querySelector('.settings-grid');
    if (settingsGrid && !document.getElementById('reset-tournament-btn')) {
        const resetBtn = document.createElement('button');
        resetBtn.id = 'reset-tournament-btn';
        resetBtn.className = 'btn btn-danger';
        resetBtn.style = 'margin-top: 1rem; width: 100%';
        resetBtn.textContent = 'Turnier zurücksetzen';
        resetBtn.onclick = async () => {
            if (!confirm('Wirklich das gesamte Turnier zurücksetzen? Alle Ergebnisse und Spielstände werden gelöscht!')) return;
            try {
                const response = await fetchData('reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (response.success) {
                    showMessage('Turnier wurde zurückgesetzt', 'success');
                    loadAdminData();
                    if (window.loadSchedule) loadSchedule();
                    if (window.loadStandings) loadStandings();
                } else {
                    throw new Error(response.message || 'Fehler beim Zurücksetzen');
                }
            } catch (error) {
                showMessage('Fehler beim Zurücksetzen: ' + error.message, 'error');
            }
        };
        // In eigene setting-card einfügen
        const resetCard = document.createElement('div');
        resetCard.className = 'setting-card';
        resetCard.innerHTML = '<h3>🗑️ Turnier zurücksetzen</h3>';
        resetCard.appendChild(resetBtn);
        settingsGrid.appendChild(resetCard);
    }

    // CSS für input-error (roter Rahmen)
    if (!document.getElementById('input-error-style')) {
        const style = document.createElement('style');
        style.id = 'input-error-style';
        style.innerHTML = `.input-error { border: 2px solid #e74c3c !important; background: #fff6f6 !important; }`;
        document.head.appendChild(style);
    }

    loadSpielzeit();
    loadPausenzeit();
}

// Beim Laden starten
document.addEventListener('DOMContentLoaded', init);

async function deleteResult(matchId) {
    if (!matchId) return;
    if (!confirm('Möchten Sie das Ergebnis wirklich löschen?')) return;
    try {
        // Ergebnis entfernen (score1/score2 auf null, Status wird im Backend gesetzt)
        const response = await fetchData(`matches/${matchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score1: null, score2: null })
        });
        // Nach erfolgreichem Löschen alles neu laden (Admin & Index)
        await loadAdminData();
        if (window.loadSchedule) loadSchedule();
        if (window.loadStandings) loadStandings();
        if (response.success) {
            showMessage('Ergebnis gelöscht und Status zurückgesetzt', 'success');
        } else {
            throw new Error(response.message || 'Fehler beim Löschen');
        }
    } catch (error) {
        showMessage('Fehler beim Löschen: ' + error.message, 'error');
    }
}

// Teams mischen
async function shuffleTeams() {
    try {
        // Teams laden
        let teams = await fetchData('teams');
        // Fisher-Yates Shuffle
        for (let i = teams.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [teams[i], teams[j]] = [teams[j], teams[i]];
        }
        // Alte Teams löschen
        for (const team of teams) {
            await fetchData(`teams/${encodeURIComponent(team.name)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
        }
        // Neue Reihenfolge speichern
        for (const team of teams) {
            await fetchData('teams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: team.name })
            });
        }
        // === NEU: Spielplan in der Datenbank neu generieren ===
        await fetchData('reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        // Ansicht und Spielplan neu laden
        await loadAdminData();
        showMessage('Teams erfolgreich gemischt, gespeichert und Spielplan neu generiert!', 'success');
    } catch (error) {
        showMessage('Fehler beim Mischen der Teams: ' + error.message, 'error');
    }
}

// Event-Listener für Shuffle-Button
window.shuffleTeams = shuffleTeams;

function renderKOModusSwitch(teams) {
    const settingsGrid = document.querySelector('.settings-grid');
    if (settingsGrid && teams && teams.length === 8 && !document.getElementById('ko-modus-switch')) {
        const div = document.createElement('div');
        div.className = 'setting-card';
        div.innerHTML = `
            <h3>KO-Modus bei 8 Teams</h3>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="ko-modus-switch" class="btn btn-primary">KO-Modus wechseln (Viertelfinale/Halbfinale)</button>
            </div>
            <p class="setting-description">Hier kannst du zwischen Viertelfinale und Direkt-Halbfinale umschalten. Nach dem Wechsel wird der Spielplan automatisch angepasst.</p>
        `;
        settingsGrid.appendChild(div);
        setTimeout(() => {
            const btn = document.getElementById('ko-modus-switch');
            if (btn) {
                btn.onclick = async () => {
                    try {
                        const response = await fetchData('ko-modus-8teams', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                        if (response && response.success) {
                            showMessage('KO-Modus gewechselt', 'success');
                            loadAdminData();
                        } else {
                            showMessage('Fehler beim Wechseln des KO-Modus', 'error');
                        }
                    } catch (e) {
                        showMessage('Fehler beim Wechseln des KO-Modus', 'error');
                    }
                };
            }
        }, 0);
    }
}

async function loadKOMatchesAndRender(teams) {
    let koMatches = [];
    try {
        if (teams.length === 8) {
            const res = await fetchData('ko-matches');
            if (res && res.success) {
                koMatches = res.koMatches;
            }
        } else {
            const matches = await fetchData('matches');
            koMatches = matches.ko || [];
        }
    } catch (e) {
        // Fallback: keine KO-Spiele
        koMatches = [];
    }
    renderKOSection(koMatches, teams);
}

function renderKOSection(koMatches, teams) {
    const el = document.getElementById('admin-schedule-list');
    // Entferne alte KO-Phasen-Abschnitte
    const oldSections = el.querySelectorAll('.phase-section.ko-section');
    oldSections.forEach(s => s.remove());
    if (!koMatches || koMatches.length === 0) return;
    const koSection = document.createElement('div');
    koSection.className = 'phase-section ko-section';
    koSection.innerHTML = `
        <div class="phase-header ko-header">
            <h3>⚔️ K.o.-Phase</h3>
        </div>
    `;
    // Gruppiere nach Runden
    const koRounds = {};
    koMatches.forEach(m => {
        let roundName = m.round || 'KO';
        if (!koRounds[roundName]) koRounds[roundName] = [];
        koRounds[roundName].push(m);
    });
    Object.entries(koRounds).forEach(([roundName, roundMatches]) => {
        if (roundMatches.length > 0) {
            const roundSection = document.createElement('div');
            roundSection.className = 'ko-round-section';
            roundSection.innerHTML = `
                <div class="ko-round-header">
                    <h4>${getRoundIcon(roundName)} ${roundName}</h4>
                    <span class="round-info">${roundMatches.length} Spiel${roundMatches.length > 1 ? 'e' : ''}</span>
                </div>
                <div class="admin-header">
                    <span>Spiel</span>
                    <span>Teams</span>
                    <span>Ergebnis</span>
                    <span>Startzeit</span>
                    <span>Status</span>
                    <span>Aktion</span>
                </div>
            `;
            roundMatches.forEach(match => {
                if (match.phase === 'pause') {
                    const div = document.createElement('div');
                    div.className = 'admin-match pause-match';
                    const timeSlot = `${match.startTime || ''}${match.endTime ? ' - ' + match.endTime : ''}`;
                    div.innerHTML = `
                        <span class="match-info">
                            <div class="match-id">${match.id}</div>
                            <div class="match-round">Pause</div>
                        </span>
                        <span class="teams" colspan="2">${match.round || 'Pause'}</span>
                        <span class="score-edit">-</span>
                        <span class="time-edit">
                            <input type="time" class="time-input" data-match="${match.id}" value="${match.startTime}" step="300">
                        </span>
                        <span class="status">Pause</span>
                        <span class="action"></span>
                    `;
                    roundSection.appendChild(div);
                } else {
                    const div = document.createElement('div');
                    div.className = 'admin-match ko-match' + (match.status === 'completed' ? ' completed' : '');
                    const score = match.score1 !== null && match.score2 !== null ? `${match.score1} : ${match.score2}` : '- : -';
                    const status = match.status === 'completed' ? 'Abgeschlossen' : match.status === 'live' ? 'Läuft' : 'Geplant';
                    div.innerHTML = `
                        <span class="match-info">
                            <div class="match-id">${match.id}</div>
                            <div class="match-round">${roundName}</div>
                        </span>
                        <span class="teams">${match.team1} vs ${match.team2}</span>
                        <span class="score-edit">
                            <input type="number" class="score-input" data-match="${match.id}" data-team="1" value="${match.score1 !== null ? match.score1 : ''}" min="0" max="99">
                            <span>:</span>
                            <input type="number" class="score-input" data-match="${match.id}" data-team="2" value="${match.score2 !== null ? match.score2 : ''}" min="0" max="99">
                        </span>
                        <span class="time-edit">
                            <input type="time" class="time-input" data-match="${match.id}" value="${match.startTime}" step="300">
                        </span>
                        <span class="status">${status}</span>
                        <span class="action">
                            <button class="delete-btn" data-match="${match.id}" onclick="deleteResult('${match.id}')">🗑️</button>
                        </span>
                    `;
                    roundSection.appendChild(div);
                }
            });
            koSection.appendChild(roundSection);
        }
    });
    el.appendChild(koSection);
} 