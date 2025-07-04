const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const XLSX = require('xlsx');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const app = express();
const PORT = 3001;

app.use(cors({
    origin: [
        'https://turnierplan-frontend.onrender.com',
        'http://localhost:3000'
    ],
    credentials: true
}));
app.use(bodyParser.json());

// Statische Dateien ausliefern (Frontend)
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const TEAMS_JSON = path.join(DATA_DIR, 'teams.json');
const TEAMS_XLSX = path.join(__dirname, 'Teams.xlsx');
const MATCHES_JSON = path.join(DATA_DIR, 'matches.json');
const STANDINGS_JSON = path.join(DATA_DIR, 'standings.json');
const TIMER_JSON = path.join(DATA_DIR, 'timer.json');
const ADMIN_PASSWORD_HASH = '$2b$10$4rz9z6driUiMq2H7tcDAEOH7KevVmCGwS6CKsqn4UgXRwP8Ll/cfm'; // bcrypt hash für 'turnieradmin2025'
const JWT_SECRET = 'turniergeheimnis2025';
const SETTINGS_JSON = path.join(__dirname, 'data/settings.json');

// Zentrale Einstellung für die Spielzeit (in Minuten)
let SPIELZEIT_MINUTEN = 8;
// Zentrale Einstellung für die Pausenzeit (in Minuten)
let PAUSENZEIT_MINUTEN = 4;

// Timer-Variablen
let timerState = {
    isRunning: false,
    timeLeft: SPIELZEIT_MINUTEN * 60, // in Sekunden
    startTime: null,
    pausedTime: null
};

// Timer-Funktionen
function startTimer() {
    if (!timerState.isRunning) {
        timerState.isRunning = true;
        timerState.startTime = Date.now();
        timerState.pausedTime = null;
        console.log('Timer gestartet');
    }
}

function pauseTimer() {
    if (timerState.isRunning) {
        const elapsed = Math.floor((Date.now() - timerState.startTime) / 1000);
        timerState.timeLeft = Math.max(0, timerState.timeLeft - elapsed);
        timerState.isRunning = false;
        timerState.pausedTime = timerState.timeLeft;
        timerState.startTime = null;
        console.log('Timer pausiert');
    }
}

function resetTimer() {
    timerState.isRunning = false;
    timerState.timeLeft = SPIELZEIT_MINUTEN * 60; // zentrale Spielzeit
    timerState.startTime = null;
    timerState.pausedTime = null;
    console.log('Timer zurückgesetzt');
}

function getTimerStatus() {
    let currentTime = timerState.timeLeft;
    
    if (timerState.isRunning && timerState.startTime) {
        const elapsed = Math.floor((Date.now() - timerState.startTime) / 1000);
        currentTime = Math.max(0, timerState.timeLeft - elapsed);
        
        // Timer stoppen wenn er bei 0 ankommt
        if (currentTime <= 0) {
            timerState.isRunning = false;
            currentTime = 0;
        }
    }
    
    const minutes = Math.floor(currentTime / 60);
    const seconds = currentTime % 60;
    
    return {
        isRunning: timerState.isRunning,
        timeLeft: currentTime,
        displayTime: `${minutes}:${seconds.toString().padStart(2, '0')}`,
        timeLeftFormatted: `${minutes}:${seconds.toString().padStart(2, '0')}`
    };
}

// Timer-Status speichern
async function saveTimerState() {
    await fs.writeJson(TIMER_JSON, timerState, { spaces: 2 });
}

// Timer-Status laden
async function loadTimerState() {
    try {
        const savedState = await fs.readJson(TIMER_JSON);
        timerState = { ...timerState, ...savedState };
        console.log('Timer-Status geladen');
    } catch (error) {
        console.log('Kein gespeicherter Timer-Status gefunden, verwende Standard');
    }
}

// Hilfsfunktion: Teams aus Excel importieren
async function importTeamsFromExcel() {
    if (!fs.existsSync(TEAMS_XLSX)) return [];
    const workbook = XLSX.readFile(TEAMS_XLSX);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    // Teams ab Zeile 4, Teamname in Spalte 1 (Index 1), Dabei? in Spalte 5 (Index 5)
    const teams = rows
        .slice(3)
        .filter(r => r[5] && r[5].toString().toLowerCase() === 'ja')
        .map(r => ({ name: r[1] }))
        .filter(t => t.name);
    return teams;
}

// Beim ersten Start: Teams aus Excel importieren, falls teams.json nicht existiert
async function ensureTeamsJson() {
    await fs.ensureDir(DATA_DIR);
    if (!fs.existsSync(TEAMS_JSON)) {
        const teams = await importTeamsFromExcel();
        await fs.writeJson(TEAMS_JSON, teams, { spaces: 2 });
        console.log('Teams aus Excel importiert:', teams.map(t => t.name));
    }
}

// Hilfsfunktion: Matches generieren (neues Format: 2 Vorrundenspiele, dann K.o.-Phase)
async function generateMatches(teams) {
    console.log("generateMatches: Teamanzahl", teams.length);
    
    // Verwende die neue generateVorrundeAndKO Funktion
    const { vorrunde, ko } = generateVorrundeAndKO(teams);
    let matches = { vorrunde, ko };
    
    // Zeitberechnung für alle Spiele
    matches = await recalculateMatchTimesFile(matches);
    
    return matches;
}

// Beim ersten Start: Matches und Standings anlegen
async function ensureMatchesAndStandings() {
    try {
        const teams = await fs.readJson(TEAMS_JSON);
    if (!fs.existsSync(MATCHES_JSON)) {
        const matches = await generateMatches(teams);
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    }
    if (!fs.existsSync(STANDINGS_JSON)) {
        const standings = teams.map(t => ({ name: t.name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }));
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
    }
    
    // KO-Phase initial aktualisieren
        let standings = await fs.readJson(STANDINGS_JSON);
    await updateKOMatches(standings);
    } catch (error) {
        console.error('Fehler beim Initialisieren der Matches und Standings:', error);
    }
}

// Hilfsfunktion: Standings komplett neu berechnen
async function recalculateStandings() {
    try {
        let matches = await fs.readJson(MATCHES_JSON);
        let teams = await fs.readJson(TEAMS_JSON);
        
    // Gruppentabellen für 8/9 Teams
    if (teams.length === 8 || teams.length === 9) {
        let gruppen = {};
        if (teams.length === 8) {
            gruppen = { A: teams.slice(0, 4), B: teams.slice(4, 8) };
        } else if (teams.length === 9) {
            gruppen = { A: teams.slice(0, 3), B: teams.slice(3, 6), C: teams.slice(6, 9) };
        }
        let result = {};
        Object.entries(gruppen).forEach(([gruppe, groupTeams]) => {
            let standings = groupTeams.map(t => ({
                name: t.name,
                played: 0,
                won: 0,
                drawn: 0,
                lost: 0,
                goalsFor: 0,
                goalsAgainst: 0,
                points: 0
            }));
            const groupMatches = (matches.vorrunde || []).filter(m => m.round && m.round.includes(gruppe));
            groupMatches.forEach(match => {
                if (typeof match.score1 === 'number' && typeof match.score2 === 'number' && match.score1 !== null && match.score2 !== null) {
                    let t1 = standings.find(t => t.name === match.team1);
                    let t2 = standings.find(t => t.name === match.team2);
                    if (t1 && t2) {
                        t1.played++; t2.played++;
                        t1.goalsFor += match.score1; t1.goalsAgainst += match.score2;
                        t2.goalsFor += match.score2; t2.goalsAgainst += match.score1;
                        if (match.score1 > match.score2) { t1.won++; t1.points += 3; t2.lost++; }
                        else if (match.score1 < match.score2) { t2.won++; t2.points += 3; t1.lost++; }
                        else { t1.drawn++; t2.drawn++; t1.points++; t2.points++; }
                    }
                }
            });
            standings.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                const diffA = a.goalsFor - a.goalsAgainst;
                const diffB = b.goalsFor - b.goalsAgainst;
                if (diffB !== diffA) return diffB - diffA;
                if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                return a.name.localeCompare(b.name);
            });
            result[gruppe] = standings;
        });
            
            // Speichere gruppierte Standings
        await fs.writeJson(STANDINGS_JSON, result, { spaces: 2 });
        await updateKOMatches(result);
        return;
    }
        
    // Standard: Einzel-Tabelle für 10 Teams
    let standings = teams.map(t => ({
        name: t.name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0
    }));
    const vorrundeMatches = matches.vorrunde || [];
    vorrundeMatches.forEach(match => {
        if (typeof match.score1 === 'number' && typeof match.score2 === 'number' && match.score1 !== null && match.score2 !== null) {
            let t1 = standings.find(t => t.name === match.team1);
            let t2 = standings.find(t => t.name === match.team2);
            if (t1 && t2) {
                t1.played++; t2.played++;
                t1.goalsFor += match.score1; t1.goalsAgainst += match.score2;
                t2.goalsFor += match.score2; t2.goalsAgainst += match.score1;
                if (match.score1 > match.score2) { t1.won++; t1.points += 3; t2.lost++; }
                else if (match.score1 < match.score2) { t2.won++; t2.points += 3; t1.lost++; }
                else { t1.drawn++; t2.drawn++; t1.points++; t2.points++; }
            }
        }
    });
    standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const diffA = a.goalsFor - a.goalsAgainst;
        const diffB = b.goalsFor - b.goalsAgainst;
        if (diffB !== diffA) return diffB - diffA;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name);
    });
        
    await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
    await updateKOMatches(standings);
    } catch (error) {
        console.error('Fehler beim Neuberechnen der Standings:', error);
    }
}

// --- KO-Logik für 9 Teams ---
async function updateKOMatches9Teams(standings, matches) {
    try {
        const gruppeA = standings['A'];
        const gruppeB = standings['B'];
        const gruppeC = standings['C'];
        // Beste Dritte bestimmen
        const dritte = [gruppeA[2], gruppeB[2], gruppeC[2]];
        // Nach Punkten, Tordifferenz, Tore sortieren
        const sortFn = (a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const diffA = a.goalsFor - a.goalsAgainst;
            const diffB = b.goalsFor - b.goalsAgainst;
            if (diffB !== diffA) return diffB - diffA;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return a.name.localeCompare(b.name);
        };
        // Beste Dritte: Die zwei besten Dritten
        let besteDritte = [...dritte].sort(sortFn).slice(0, 2);
        // Prüfe, ob alle Gruppenspiele abgeschlossen sind
        const alleGruppenFertig = ['A','B','C'].every(gruppe => {
            const groupMatches = (matches.vorrunde || []).filter(m => m.round && m.round.includes(gruppe));
            return groupMatches.every(m => m.status === 'completed');
        });
        if (alleGruppenFertig) {
            matches.ko.forEach(match => {
                if (match.phase !== 'ko') return;
                if (match.id === 'VF1') {
                    match.team1 = gruppeA[0]?.name || '';
                    // Bester Dritter aus Gruppe B oder C
                    let kandidat = [gruppeB[2], gruppeC[2]].filter(t => besteDritte.includes(t)).sort(sortFn)[0];
                    match.team2 = kandidat?.name || '';
                }
                if (match.id === 'VF2') {
                    match.team1 = gruppeB[0]?.name || '';
                    // Bester Dritter aus Gruppe A oder C
                    let kandidat = [gruppeA[2], gruppeC[2]].filter(t => besteDritte.includes(t)).sort(sortFn)[0];
                    match.team2 = kandidat?.name || '';
                }
                if (match.id === 'VF3') {
                    match.team1 = gruppeC[0]?.name || '';
                    match.team2 = gruppeA[1]?.name || '';
                }
                if (match.id === 'VF4') {
                    match.team1 = gruppeB[1]?.name || '';
                    match.team2 = gruppeC[1]?.name || '';
                }
                // Nur setzen, wenn noch kein VF abgeschlossen ist
                const vfDone = [
                    matches.ko.find(m => m.id === 'VF1'),
                    matches.ko.find(m => m.id === 'VF2'),
                    matches.ko.find(m => m.id === 'VF3'),
                    matches.ko.find(m => m.id === 'VF4')
                ].some(m => m && m.status === 'completed');
                if (!vfDone) {
                    if (match.id === 'HF1') {
                        match.team1 = 'Sieger VF2';
                        match.team2 = 'Sieger VF3';
                    }
                    if (match.id === 'HF2') {
                        match.team1 = 'Sieger VF1';
                        match.team2 = 'Sieger VF4';
                    }
                }
            });
            await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        }
    } catch (error) {
        console.error('Fehler beim Update der KO-Matches für 9 Teams:', error);
    }
}
// ... existing code ...
// --- KO-Logik für 10 Teams ---
async function updateKOMatches10Teams(standings, matches) {
    try {
    // Prüfe, ob alle Vorrundenspiele abgeschlossen sind UND ob die KO-Teams noch Platzhalter sind
    const alleVorrundeFertig = (matches.vorrunde || []).every(m => m.status === 'completed');
    if (alleVorrundeFertig) {
        // Sortiere Standings nach Punkten, Tordifferenz, Tore
        const sorted = [...standings].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const diffA = a.goalsFor - a.goalsAgainst;
            const diffB = b.goalsFor - b.goalsAgainst;
            if (diffB !== diffA) return diffB - diffA;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return a.name.localeCompare(b.name);
        });
        // Achtelfinale, Viertelfinale, Halbfinale, Finale setzen
        matches.ko.forEach(match => {
            if (match.phase !== 'ko') return;
            if (match.id === 'AF1' && match.team1.startsWith('Platz')) {
                match.team1 = sorted[6]?.name || 'Platz 7';
                match.team2 = sorted[9]?.name || 'Platz 10';
            }
            if (match.id === 'AF2' && match.team1.startsWith('Platz')) {
                match.team1 = sorted[7]?.name || 'Platz 8';
                match.team2 = sorted[8]?.name || 'Platz 9';
            }
            if (match.id === 'VF1' && match.team1.startsWith('Platz')) {
                match.team1 = sorted[2]?.name || 'Platz 3';
                match.team2 = sorted[5]?.name || 'Platz 6';
            }
            if (match.id === 'VF2' && match.team1.startsWith('Platz')) {
                match.team1 = sorted[3]?.name || 'Platz 4';
                match.team2 = sorted[4]?.name || 'Platz 5';
            }
            if (match.id === 'VF3') {
                match.team1 = sorted[1]?.name || 'Platz 2';
                // team2 wird durch Sieger AF1 ersetzt
            }
            if (match.id === 'VF4') {
                match.team1 = sorted[0]?.name || 'Platz 1';
                // team2 wird durch Sieger AF2 ersetzt
            }
            if (match.id === 'HF1') {
                // team1 wird durch Sieger VF3 ersetzt
                // team2 wird durch Sieger VF1 ersetzt
            }
            if (match.id === 'HF2') {
                // team1 wird durch Sieger VF4 ersetzt
                // team2 wird durch Sieger VF2 ersetzt
            }
            if (match.id === 'F1') {
                match.team1 = 'Sieger HF1';
                match.team2 = 'Sieger HF2';
            }
        });
            
            // Speichere aktualisierte Matches
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        }
    } catch (error) {
        console.error('Fehler beim Update der KO-Matches für 10 Teams:', error);
    }
}

async function advanceKOMatches10Teams(matches) {
    try {
    // Achtelfinale → Viertelfinale
    const AF1 = matches.ko.find(m => m.id === 'AF1');
    const AF2 = matches.ko.find(m => m.id === 'AF2');
    const VF3 = matches.ko.find(m => m.id === 'VF3');
    const VF4 = matches.ko.find(m => m.id === 'VF4');
    if (VF3 && AF1 && AF1.status === 'completed') {
        const winnerAF1 = AF1.score1 > AF1.score2 ? AF1.team1 : AF1.team2;
        VF3.team2 = winnerAF1;
        if (VF3.status !== 'completed') VF3.status = 'geplant';
    } else if (VF3 && AF1) {
        VF3.team2 = 'Sieger AF1';
    }
    if (VF4 && AF2 && AF2.status === 'completed') {
        const winnerAF2 = AF2.score1 > AF2.score2 ? AF2.team1 : AF2.team2;
        VF4.team2 = winnerAF2;
        if (VF4.status !== 'completed') VF4.status = 'geplant';
    } else if (VF4 && AF2) {
        VF4.team2 = 'Sieger AF2';
    }
    // Viertelfinale → Halbfinale
    const VF1 = matches.ko.find(m => m.id === 'VF1');
    const VF2 = matches.ko.find(m => m.id === 'VF2');
    const HF1 = matches.ko.find(m => m.id === 'HF1');
    const HF2 = matches.ko.find(m => m.id === 'HF2');
    if (HF1) {
        if (VF3 && VF3.status === 'completed') {
            const winnerVF3 = VF3.score1 > VF3.score2 ? VF3.team1 : VF3.team2;
            HF1.team1 = winnerVF3;
        } else {
            HF1.team1 = 'Sieger VF3';
        }
        if (VF1 && VF1.status === 'completed') {
            const winnerVF1 = VF1.score1 > VF1.score2 ? VF1.team1 : VF1.team2;
            HF1.team2 = winnerVF1;
        } else {
            HF1.team2 = 'Sieger VF1';
        }
        if (HF1.status !== 'completed') HF1.status = 'geplant';
    }
    if (HF2) {
        if (VF4 && VF4.status === 'completed') {
            const winnerVF4 = VF4.score1 > VF4.score2 ? VF4.team1 : VF4.team2;
            HF2.team1 = winnerVF4;
        } else {
            HF2.team1 = 'Sieger VF4';
        }
        if (VF2 && VF2.status === 'completed') {
            const winnerVF2 = VF2.score1 > VF2.score2 ? VF2.team1 : VF2.team2;
            HF2.team2 = winnerVF2;
        } else {
            HF2.team2 = 'Sieger VF2';
        }
        if (HF2.status !== 'completed') HF2.status = 'geplant';
    }
    // Halbfinale → Finale
    const F1 = matches.ko.find(m => m.id === 'F1');
    if (F1) {
        if (HF1 && HF1.status === 'completed') {
            const winnerHF1 = HF1.score1 > HF1.score2 ? HF1.team1 : HF1.team2;
            F1.team1 = winnerHF1;
        } else {
            F1.team1 = 'Sieger HF1';
        }
        if (HF2 && HF2.status === 'completed') {
            const winnerHF2 = HF2.score1 > HF2.score2 ? HF2.team1 : HF2.team2;
            F1.team2 = winnerHF2;
        } else {
            F1.team2 = 'Sieger HF2';
        }
        if (F1.status !== 'completed') F1.status = 'geplant';
    }
        
        // Speichere aktualisierte Matches
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    } catch (error) {
        console.error('Fehler beim Advance der KO-Matches für 10 Teams:', error);
    }
}
// ... existing code ...
// updateKOMatches: jetzt getrennt für 8, 9, 10 Teams
async function updateKOMatches(standings) {
    try {
        if (!standings || typeof standings !== 'object') {
            console.error("updateKOMatches: Ungültige Standings übergeben!", standings);
            return;
        }
        let matches = await fs.readJson(MATCHES_JSON);
        const teams = await fs.readJson(TEAMS_JSON);
        const settings = await fs.readJson(SETTINGS_JSON).catch(() => ({ koModus8Teams: 'viertelfinale' }));
        if (teams.length === 8 && standings && typeof standings === 'object' && !Array.isArray(standings)) {
            if (settings.koModus8Teams === 'halbfinale') {
                // Nur Halbfinale/Finale pflegen, keine Platzhalter!
                const gruppen = Object.keys(standings);
                let allGroupsCompleted = gruppen.every(gruppe => {
                    const groupMatches = (matches.vorrunde || []).filter(m => m.round && m.round.includes(gruppe));
                    return groupMatches.every(m => m.status === 'completed');
                });
                if (allGroupsCompleted) {
                    const gruppeA = standings['A'];
                    const gruppeB = standings['B'];
                    const HF1 = matches.ko.find(m => m.id === 'HF1');
                    const HF2 = matches.ko.find(m => m.id === 'HF2');
                    const F1 = matches.ko.find(m => m.id === 'F1');
                    if (HF1 && (!HF1.team1 || !HF1.team2 || HF1.team1.startsWith('1.') || HF1.team2.startsWith('2.'))) {
                        HF1.team1 = gruppeA[0]?.name || '1. Gruppe A';
                        HF1.team2 = gruppeB[1]?.name || '2. Gruppe B';
                    }
                    if (HF2 && (!HF2.team1 || !HF2.team2 || HF2.team1.startsWith('1.') || HF2.team2.startsWith('2.'))) {
                        HF2.team1 = gruppeB[0]?.name || '1. Gruppe B';
                        HF2.team2 = gruppeA[1]?.name || '2. Gruppe A';
                    }
                    if (F1 && (!F1.team1 || !F1.team2 || F1.team1.startsWith('Sieger') || F1.team2.startsWith('Sieger'))) {
                        F1.team1 = 'Sieger HF1';
                        F1.team2 = 'Sieger HF2';
                    }
                    // Ergebnisse und Zeiten NICHT überschreiben!
                    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
                }
                return;
            }
            // Standard: Viertelfinale-Modus wie gehabt
            // ... bestehende Logik ...
        }
        // ... bestehende Logik für 9/10 Teams ...
    } catch (error) {
        console.error('Fehler in updateKOMatches:', error);
    }
}

async function advanceKOMatches() {
    try {
        let matches = await fs.readJson(MATCHES_JSON);
        const teams = await fs.readJson(TEAMS_JSON);
        const settings = await fs.readJson(SETTINGS_JSON).catch(() => ({ koModus8Teams: 'viertelfinale' }));
        if (teams.length === 8) {
            // Viertelfinal-Modus
            if (settings.koModus8Teams === 'viertelfinale') {
                const VF1 = matches.ko.find(m => m.id === 'VF1');
                const VF2 = matches.ko.find(m => m.id === 'VF2');
                const VF3 = matches.ko.find(m => m.id === 'VF3');
                const VF4 = matches.ko.find(m => m.id === 'VF4');
                const HF1 = matches.ko.find(m => m.id === 'HF1');
                const HF2 = matches.ko.find(m => m.id === 'HF2');
                const F1 = matches.ko.find(m => m.id === 'F1');
                // HF1: Sieger VF2 vs Sieger VF3
                if (HF1) {
                    HF1.team1 = (VF2 && VF2.status === 'completed') ? (VF2.score1 > VF2.score2 ? VF2.team1 : VF2.team2) : 'Sieger VF2';
                    HF1.team2 = (VF3 && VF3.status === 'completed') ? (VF3.score1 > VF3.score2 ? VF3.team1 : VF3.team2) : 'Sieger VF3';
                }
                // HF2: Sieger VF1 vs Sieger VF4
                if (HF2) {
                    HF2.team1 = (VF1 && VF1.status === 'completed') ? (VF1.score1 > VF1.score2 ? VF1.team1 : VF1.team2) : 'Sieger VF1';
                    HF2.team2 = (VF4 && VF4.status === 'completed') ? (VF4.score1 > VF4.score2 ? VF4.team1 : VF4.team2) : 'Sieger VF4';
                }
                // Finale: Sieger HF1 vs Sieger HF2
                if (F1) {
                    F1.team1 = (HF1 && HF1.status === 'completed') ? (HF1.score1 > HF1.score2 ? HF1.team1 : HF1.team2) : 'Sieger HF1';
                    F1.team2 = (HF2 && HF2.status === 'completed') ? (HF2.score1 > HF2.score2 ? HF2.team1 : HF2.team2) : 'Sieger HF2';
                }
                await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
                return;
            }
            // Halbfinal-Modus
            if (settings.koModus8Teams === 'halbfinale') {
                const HF1 = matches.ko.find(m => m.id === 'HF1');
                const HF2 = matches.ko.find(m => m.id === 'HF2');
                const F1 = matches.ko.find(m => m.id === 'F1');
                // Finale: Sieger HF1 vs Sieger HF2
                if (F1) {
                    F1.team1 = (HF1 && HF1.status === 'completed') ? (HF1.score1 > HF1.score2 ? HF1.team1 : HF1.team2) : 'Sieger HF1';
                    F1.team2 = (HF2 && HF2.status === 'completed') ? (HF2.score1 > HF2.score2 ? HF2.team1 : HF2.team2) : 'Sieger HF2';
                }
                await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
                return;
            }
        }
        if (teams.length === 9) {
            const VF1 = matches.ko.find(m => m.id === 'VF1');
            const VF2 = matches.ko.find(m => m.id === 'VF2');
            const VF3 = matches.ko.find(m => m.id === 'VF3');
            const VF4 = matches.ko.find(m => m.id === 'VF4');
            const HF1 = matches.ko.find(m => m.id === 'HF1');
            const HF2 = matches.ko.find(m => m.id === 'HF2');
            const F1 = matches.ko.find(m => m.id === 'F1');
            // HF1: Sieger VF2 vs Sieger VF3
            if (HF1) {
                HF1.team1 = (VF2 && VF2.status === 'completed') ? (VF2.score1 > VF2.score2 ? VF2.team1 : VF2.team2) : 'Sieger VF2';
                HF1.team2 = (VF3 && VF3.status === 'completed') ? (VF3.score1 > VF3.score2 ? VF3.team1 : VF3.team2) : 'Sieger VF3';
            }
            // HF2: Sieger VF1 vs Sieger VF4
            if (HF2) {
                HF2.team1 = (VF1 && VF1.status === 'completed') ? (VF1.score1 > VF1.score2 ? VF1.team1 : VF1.team2) : 'Sieger VF1';
                HF2.team2 = (VF4 && VF4.status === 'completed') ? (VF4.score1 > VF4.score2 ? VF4.team1 : VF4.team2) : 'Sieger VF4';
            }
            // Finale: Sieger HF1 vs Sieger HF2
            if (F1) {
                F1.team1 = (HF1 && HF1.status === 'completed') ? (HF1.score1 > HF1.score2 ? HF1.team1 : HF1.team2) : 'Sieger HF1';
                F1.team2 = (HF2 && HF2.status === 'completed') ? (HF2.score1 > HF2.score2 ? HF2.team1 : HF2.team2) : 'Sieger HF2';
            }
            await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
            return;
        }
        // ... bestehende Logik für 9, 10 Teams ...
    } catch (error) {
        console.error('Fehler in advanceKOMatches:', error);
    }
}
// ... existing code ...

// Hilfsfunktion: Spielzeit und Pausenzeit laden
async function loadSettings() {
    try {
        const settings = await fs.readJson(SETTINGS_JSON);
        if (typeof settings.spielzeit === 'number') SPIELZEIT_MINUTEN = settings.spielzeit;
        if (typeof settings.pausenzeit === 'number') PAUSENZEIT_MINUTEN = settings.pausenzeit;
    } catch (e) {
        // Standardwerte verwenden, falls keine Settings-Datei existiert
        SPIELZEIT_MINUTEN = 8;
        PAUSENZEIT_MINUTEN = 4;
    }
}

// Hilfsfunktion: Spielzeit und Pausenzeit speichern
async function saveSettings(newSettings) {
    try {
    let settings = {};
        try { 
            settings = await fs.readJson(SETTINGS_JSON); 
        } catch (e) {
            settings = { spielzeit: 8, pausenzeit: 4 };
        }
    settings = { ...settings, ...newSettings };
    await fs.writeJson(SETTINGS_JSON, settings, { spaces: 2 });
    } catch (error) {
        console.error('Fehler beim Speichern der Settings:', error);
    }
}

// Hilfsfunktion: Spielplan fortlaufend neu berechnen (Startzeiten, Endzeiten, Pausen)
async function recalculateMatchTimes(matches, startFromMatchId = null) {
    try {
        let allMatches = [...matches.vorrunde, ...matches.ko];
        let currentTime = new Date('2025-07-05T14:00:00');
        let startIndex = 0;
        if (startFromMatchId) {
            startIndex = allMatches.findIndex(m => m.id === startFromMatchId);
            if (startIndex < 0) startIndex = 0;
            // Hole ggf. die manuell gesetzte Startzeit
            const manualStart = allMatches[startIndex].startTime;
            if (manualStart) {
                const [h, m] = manualStart.split(':').map(Number);
                currentTime = new Date('2025-07-05T' + h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0') + ':00');
            }
        }
        // Spiele vor dem gewählten Startpunkt behalten ihre Startzeit
        for (let i = 0; i < allMatches.length; i++) {
            if (startFromMatchId && i < startIndex) continue;
            let m = allMatches[i];
            // Pause nach Vorrunde/letztem Gruppenspiel
            if (m.phase === 'pause' && (m.id === 'pause1')) {
                let pauseLen = 20;
                const pauseStart = new Date(currentTime);
                const pauseEnd = new Date(pauseStart.getTime() + pauseLen * 60 * 1000);
                m.startTime = `${pauseStart.getHours().toString().padStart(2, '0')}:${pauseStart.getMinutes().toString().padStart(2, '0')}`;
                m.endTime = `${pauseEnd.getHours().toString().padStart(2, '0')}:${pauseEnd.getMinutes().toString().padStart(2, '0')}`;
                currentTime = new Date(pauseEnd.getTime());
                continue;
            }
            // Pause vor Finale (immer 10 Minuten)
            if (m.phase === 'pause' && (m.id === 'pause2' || m.id === 'pause3')) {
                let pauseLen = 10;
                const pauseStart = new Date(currentTime);
                const pauseEnd = new Date(pauseStart.getTime() + pauseLen * 60 * 1000);
                m.startTime = `${pauseStart.getHours().toString().padStart(2, '0')}:${pauseStart.getMinutes().toString().padStart(2, '0')}`;
                m.endTime = `${pauseEnd.getHours().toString().padStart(2, '0')}:${pauseEnd.getMinutes().toString().padStart(2, '0')}`;
                currentTime = new Date(pauseEnd.getTime());
                continue;
            }
            // Normale Pause
            if (m.phase === 'pause') {
                let pauseLen = PAUSENZEIT_MINUTEN;
                const pauseStart = new Date(currentTime);
                const pauseEnd = new Date(pauseStart.getTime() + pauseLen * 60 * 1000);
                m.startTime = `${pauseStart.getHours().toString().padStart(2, '0')}:${pauseStart.getMinutes().toString().padStart(2, '0')}`;
                m.endTime = `${pauseEnd.getHours().toString().padStart(2, '0')}:${pauseEnd.getMinutes().toString().padStart(2, '0')}`;
                currentTime = new Date(pauseEnd.getTime());
                continue;
            }
            // Spiel
            m.startTime = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;
            const matchEnd = new Date(currentTime.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
            m.endTime = `${matchEnd.getHours().toString().padStart(2, '0')}:${matchEnd.getMinutes().toString().padStart(2, '0')}`;
            currentTime = new Date(matchEnd.getTime());
            // Nach jedem Spiel: Pause, außer nach dem letzten
            const next = allMatches[i + 1];
            if (next && next.phase === 'pause' && (next.id === 'pause1' || next.id === 'pause2' || next.id === 'pause3')) {
                continue;
            }
            if (i === allMatches.length - 1) break;
            currentTime = new Date(currentTime.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
        }
        matches.vorrunde = allMatches.filter(m => m.phase === 'vorrunde');
        matches.ko = allMatches.filter(m => m.phase !== 'vorrunde');
        // Speichere aktualisierte Matches
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        return matches;
    } catch (error) {
        console.error('Fehler beim Neuberechnen der Spielzeiten:', error);
        return matches;
    }
}

// API: Spielzeit abfragen
app.get('/api/settings/spielzeit', async (req, res) => {
    await loadSettings();
    res.json({ spielzeit: SPIELZEIT_MINUTEN });
});

// API: Spielzeit setzen (Admin)
app.post('/api/settings/spielzeit', requireAuth, async (req, res) => {
    try {
    const { spielzeit } = req.body;
    if (typeof spielzeit !== 'number' || spielzeit < 1 || spielzeit > 60) {
        return res.status(400).json({ success: false, message: 'Ungültige Spielzeit' });
    }
    SPIELZEIT_MINUTEN = spielzeit;
    await saveSettings({ spielzeit });
    resetTimer();
    await saveTimerState();
        // === NEU: Spielplan neu berechnen und in Datei speichern ===
        const matches = await fs.readJson(MATCHES_JSON);
        const updated = await recalculateMatchTimes(matches);
    res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Setzen der Spielzeit:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Setzen der Spielzeit' });
    }
});

// API: Pausenzeit abfragen
app.get('/api/settings/pausenzeit', async (req, res) => {
    await loadSettings();
    res.json({ pausenzeit: PAUSENZEIT_MINUTEN });
});

// API: Pausenzeit setzen (Admin)
app.post('/api/settings/pausenzeit', requireAuth, async (req, res) => {
    try {
    const { pausenzeit } = req.body;
    if (typeof pausenzeit !== 'number' || pausenzeit < 1 || pausenzeit > 60) {
        return res.status(400).json({ success: false, message: 'Ungültige Pausenzeit' });
    }
    PAUSENZEIT_MINUTEN = pausenzeit;
    await saveSettings({ pausenzeit });
        // === NEU: Spielplan neu berechnen und in Datei speichern ===
        const matches = await fs.readJson(MATCHES_JSON);
        const updated = await recalculateMatchTimes(matches);
    res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Setzen der Pausenzeit:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Setzen der Pausenzeit' });
    }
});

// API: Teams abrufen
app.get('/api/teams', async (req, res) => {
    try {
        const teams = await fs.readJson(TEAMS_JSON);
        res.json(teams);
    } catch (error) {
        console.error('Fehler beim Laden der Teams:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Teams' });
    }
});

// API: Matches abrufen
app.get('/api/matches', async (req, res) => {
    try {
        const matches = await fs.readJson(MATCHES_JSON);
        res.json({
            vorrunde: matches.vorrunde || [],
            ko: (matches.ko || []).filter(m => m.phase === 'ko' || m.phase === 'pause')
        });
    } catch (error) {
        console.error('Fehler beim Laden der Matches:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Matches' });
    }
});

// API: Standings abrufen (jetzt gruppenbasiert für 8/9 Teams)
app.get('/api/standings', async (req, res) => {
    try {
        const teams = await fs.readJson(TEAMS_JSON);
        let standings = await fs.readJson(STANDINGS_JSON);
        // Format prüfen und ggf. automatisch reparieren
        if (
            (teams.length === 8 && (!standings.A || !standings.B)) ||
            (teams.length === 9 && (!standings.A || !standings.B || !standings.C)) ||
            (teams.length === 10 && !Array.isArray(standings))
        ) {
            // Automatisch neu generieren
            await regenerateScheduleAndStandings();
            standings = await fs.readJson(STANDINGS_JSON);
        }
        // Gruppierte Standings für 8/9 Teams
        if (teams.length === 8 || teams.length === 9) {
            // Gruppenzuordnung NUR anhand der Vorrundenspiele
            const matches = await fs.readJson(MATCHES_JSON);
            let standingsWithGroup = [];
            Object.entries(standings).forEach(([gruppe, groupStandings]) => {
                if (Array.isArray(groupStandings)) {
                    groupStandings.forEach(s => {
                        standingsWithGroup.push({ ...s, gruppe });
                    });
                }
            });
            // Sortiere: erst nach Gruppe (A, B, C), dann nach Punkten, Tordifferenz, Tore, Name
            const groupOrder = ['A', 'B', 'C'];
            standingsWithGroup.sort((a, b) => {
                const ga = groupOrder.indexOf(a.gruppe);
                const gb = groupOrder.indexOf(b.gruppe);
                if (ga !== gb) return ga - gb;
                    if (b.points !== a.points) return b.points - a.points;
                    const diffA = a.goalsFor - a.goalsAgainst;
                    const diffB = b.goalsFor - b.goalsAgainst;
                    if (diffB !== diffA) return diffB - diffA;
                    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                    return a.name.localeCompare(b.name);
                });
            res.json(standingsWithGroup);
            return;
        } else {
            // Für 10 Teams: Einzel-Tabelle (Array)
            res.json(standings);
        }
    } catch (error) {
        console.error('Fehler beim Laden der Tabelle:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Tabelle' });
    }
});

// Timer-API-Endpunkte
app.get('/api/timer', (req, res) => {
    const status = getTimerStatus();
    res.json(status);
});

app.post('/api/timer/start', requireAuth, async (req, res) => {
    try {
        startTimer();
        await saveTimerState();
        res.json({ success: true, message: 'Timer gestartet' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Starten des Timers' });
    }
});

app.post('/api/timer/pause', requireAuth, async (req, res) => {
    try {
        pauseTimer();
        await saveTimerState();
        res.json({ success: true, message: 'Timer pausiert' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Pausieren des Timers' });
    }
});

app.post('/api/timer/reset', requireAuth, async (req, res) => {
    try {
        resetTimer();
        await saveTimerState();
        res.json({ success: true, message: 'Timer zurückgesetzt' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Zurücksetzen des Timers' });
    }
});

// API: Admin-Login
app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (valid) {
        const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Falsches Passwort' });
    }
});

// Middleware: Authentifizierung für Admin-Endpunkte
function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: 'Nicht eingeloggt' });
    try {
        const token = auth.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.admin) return next();
        return res.status(401).json({ message: 'Nicht berechtigt' });
    } catch {
        return res.status(401).json({ message: 'Nicht berechtigt' });
    }
}

// API: Match-Ergebnis eintragen (Admin)
app.put('/api/matches/:id', requireAuth, async (req, res) => {
    try {
    const { id } = req.params;
    let { score1, score2 } = req.body;
        
        // Matches aus Datei laden
        let matches = await fs.readJson(MATCHES_JSON);
        let allMatches = [...(matches.vorrunde || []), ...(matches.ko || [])];
        let match = allMatches.find(m => m.id === id);
        
    if (!match) return res.status(404).json({ message: 'Match nicht gefunden' });
    
        // Ergebnis setzen
    match.score1 = score1;
    match.score2 = score2;
    if (score1 === null && score2 === null) {
        match.status = 'geplant';
    } else if (score1 !== null && score2 !== null) {
        match.status = 'completed';
    } else {
        match.status = 'geplant';
    }
        
        // Matches speichern
        matches.vorrunde = allMatches.filter(m => m.phase === 'vorrunde');
        matches.ko = allMatches.filter(m => m.phase !== 'vorrunde');
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });

    // Standings aktualisieren
        await calculateStandingsFile();
        
        // === NEU: KO-Phase automatisch befüllen, wenn Vorrunde/Gruppen abgeschlossen ===
        const teams = await fs.readJson(TEAMS_JSON);
        if (teams.length === 10) {
            // Bei 10 Teams: alle Vorrundenspiele müssen abgeschlossen sein
            const vorrundeDone = (matches.vorrunde || []).every(m => m.status === 'completed');
            if (vorrundeDone) {
                await fillKOMatchesFromStandingsFile();
            }
        } else if (teams.length === 8 || teams.length === 9) {
            // Bei 8/9 Teams: alle Gruppenspiele müssen abgeschlossen sein
            // Gruppen werden über das Feld "round" erkannt (z.B. "Gruppe A")
            const gruppen = Array.from(new Set((matches.vorrunde || []).filter(m => m.round && m.round.match(/Gruppe ([A-Z])/)).map(m => m.round.match(/Gruppe ([A-Z])/)[1])));
            let allGroupsDone = true;
            for (const gruppe of gruppen) {
            const groupMatches = (matches.vorrunde || []).filter(m => m.round && m.round.includes(gruppe));
                if (!groupMatches.every(m => m.status === 'completed')) {
                    allGroupsDone = false;
                    break;
                }
            }
            if (allGroupsDone && gruppen.length > 0) {
                await fillKOMatchesFromStandingsFile();
            }
        }

        // KO-Phase ggf. weiterführen
    if (match.phase === 'ko' && match.status === 'completed') {
        await advanceKOMatches();
    }
    
    res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Speichern:', error);
        res.status(500).json({ message: 'Fehler beim Speichern', error: error.message });
    }
});

// Zeit-Update (Admin)
app.put('/api/matches/:id/time', requireAuth, async (req, res) => {
    try {
    const { id } = req.params;
    const { time, pauseDuration } = req.body;
        
        // Matches aus Datei laden
        let matches = await fs.readJson(MATCHES_JSON);
        let allMatches = [...(matches.vorrunde || []), ...(matches.ko || [])];
        let match = allMatches.find(m => m.id === id);
        
        if (!match) return res.status(404).json({ message: 'Match nicht gefunden' });
        
        // Zeit setzen
        match.startTime = time;
        if (match.phase === 'pause' && pauseDuration) {
            match.pauseDuration = pauseDuration;
            // Endzeit berechnen
            const [h, m] = time.split(':').map(Number);
            const start = new Date(2025, 6, 5, h, m, 0);
            const end = new Date(start.getTime() + pauseDuration * 60 * 1000);
            match.endTime = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
    } else {
            // Endzeit für normales Spiel
            const [h, m] = time.split(':').map(Number);
            const start = new Date(2025, 6, 5, h, m, 0);
            const end = new Date(start.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
            match.endTime = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
        }
        
        // Matches speichern
    matches.vorrunde = allMatches.filter(m => m.phase === 'vorrunde');
    matches.ko = allMatches.filter(m => m.phase !== 'vorrunde');
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });

        // === NEU: Spielplan ab diesem Spiel fortlaufend neu berechnen ===
        const updated = await recalculateMatchTimes(matches, id);

    res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Zeit-Update:', error);
        res.status(500).json({ message: 'Fehler beim Speichern', error: error.message });
    }
});

// API: Match-Score für einzelnes Team (Admin)
app.post('/api/matches/:id/score', requireAuth, async (req, res) => {
    try {
    const { id } = req.params;
    const { team, score } = req.body;
        
        // Matches aus Datei laden
        let matches = await fs.readJson(MATCHES_JSON);
        let allMatches = [...(matches.vorrunde || []), ...(matches.ko || [])];
        let match = allMatches.find(m => m.id === id);
        
        if (!match) {
            return res.status(404).json({ message: 'Match nicht gefunden (nach Reset?)' });
        }
    
    // Score für das entsprechende Team setzen
    if (team === '1') {
        match.score1 = score;
    } else if (team === '2') {
        match.score2 = score;
    } else {
        return res.status(400).json({ message: 'Ungültiges Team' });
    }
    
    // Status basierend auf Ergebnis setzen
    if (match.score1 !== null && match.score2 !== null) {
        match.status = 'completed';
    } else {
        match.status = 'geplant';
    }
    
        // Matches speichern
        matches.vorrunde = allMatches.filter(m => m.phase === 'vorrunde');
        matches.ko = allMatches.filter(m => m.phase !== 'vorrunde');
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    
    // Standings aktualisieren (nur wenn beide Ergebnisse vorhanden sind)
    if (match.score1 !== null && match.score2 !== null) {
            await calculateStandingsFile();
        
        // Wenn es ein KO-Spiel ist, KO-Phase weiterführen
        if (match.phase === 'ko') {
            await advanceKOMatches();
        }
            
            // NEU: Nach jedem abgeschlossenen Gruppenspiel automatisch KO-Phase befüllen
            if (match.phase === 'vorrunde' && match.score1 !== null && match.score2 !== null) {
                await fillKOMatchesFromStandingsFile();
        }
    }
    
    res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Speichern des Scores:', error);
        res.status(500).json({ message: 'Fehler beim Speichern', error: error.message });
    }
});

// API: KO-Phase manuell aktualisieren (Admin)
app.post('/api/ko/update', requireAuth, async (req, res) => {
    try {
        await fillKOMatchesFromStandingsFile();
        await advanceKOMatches();
        res.json({ success: true, message: 'KO-Phase aktualisiert' });
    } catch (error) {
        console.error('Fehler beim Aktualisieren der KO-Phase:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Aktualisieren der KO-Phase', error: error.message });
    }
});

// API: Teamnamen ändern (Admin)
app.put('/api/teams/:oldName', requireAuth, async (req, res) => {
    try {
    const { oldName } = req.params;
    const { newName } = req.body;
    if (!newName || typeof newName !== 'string' || !newName.trim()) {
        return res.status(400).json({ success: false, message: 'Neuer Name fehlt oder ungültig' });
    }
        
        // Teams.json aktualisieren
        let teams = await fs.readJson(TEAMS_JSON);
        let changed = false;
        teams.forEach(t => {
            if (t.name === oldName) {
                t.name = newName;
                changed = true;
            }
        });
        if (!changed) return res.status(404).json({ success: false, message: 'Team nicht gefunden' });
        await fs.writeJson(TEAMS_JSON, teams, { spaces: 2 });

        // Matches.json aktualisieren
        let matches = await fs.readJson(MATCHES_JSON);
        ['vorrunde', 'ko'].forEach(phase => {
            if (matches[phase]) {
                matches[phase].forEach(m => {
                    if (m.team1 === oldName) m.team1 = newName;
                    if (m.team2 === oldName) m.team2 = newName;
                });
            }
        });
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });

        // Standings.json aktualisieren
        let standings = await fs.readJson(STANDINGS_JSON);
        if (Array.isArray(standings)) {
            // Für 10 Teams: Array
        standings.forEach(t => {
            if (t.name === oldName) t.name = newName;
        });
        } else {
            // Für 8/9 Teams: Objekt mit Gruppen
            Object.values(standings).forEach(groupStandings => {
                groupStandings.forEach(t => {
                    if (t.name === oldName) t.name = newName;
                });
            });
        }
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });

        res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Umbenennen:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Umbenennen', error: error.message });
    }
});

// API: Turnier komplett zurücksetzen (Admin)
app.post('/api/reset', async (req, res) => {
    try {
        let teams = await fs.readJson(TEAMS_JSON).catch(() => []);
        const { vorrunde, ko } = generateVorrundeAndKO(teams);
        let matches = { vorrunde, ko };
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        let standings = teams.map(t => ({
            name: t.name, played: 0, won: 0, drawn: 0, lost: 0,
            goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: null
        }));
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Zurücksetzen', error: error.message });
    }
});

// API: Team hinzufügen
app.post('/api/teams', async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Teamname fehlt oder ungültig' });
    }
        let teams = await fs.readJson(TEAMS_JSON).catch(() => []);
        if (teams.find(t => t.name === name)) {
            return res.status(400).json({ success: false, message: 'Teamname existiert bereits' });
        }
        teams.push({ name });
        await fs.writeJson(TEAMS_JSON, teams, { spaces: 2 });
    // Nach Teamänderung: Spielplan und Standings neu generieren
    await regenerateScheduleAndStandings();
        res.json({ success: true });
});

// API: Team entfernen
app.delete('/api/teams/:name', async (req, res) => {
    const { name } = req.params;
        let teams = await fs.readJson(TEAMS_JSON).catch(() => []);
        const newTeams = teams.filter(t => t.name !== name);
        if (newTeams.length === teams.length) {
            return res.status(404).json({ success: false, message: 'Team nicht gefunden' });
        }
        await fs.writeJson(TEAMS_JSON, newTeams, { spaces: 2 });
    // Nach Teamänderung: Spielplan und Standings neu generieren
    await regenerateScheduleAndStandings();
        res.json({ success: true });
});

// API: Spielzeit (gameDuration) abfragen
app.get('/api/settings/gameDuration', async (req, res) => {
    try {
        await loadSettings();
        res.json({ value: SPIELZEIT_MINUTEN });
    } catch (error) {
        console.error('Fehler beim Laden der Spielzeit:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Spielzeit' });
    }
});

app.post('/api/settings/gameDuration', requireAuth, async (req, res) => {
    try {
        const { value } = req.body;
        if (typeof value !== 'number' || value < 1) {
            return res.status(400).json({ success: false, message: 'Ungültige Spielzeit' });
        }
        await saveSettings({ spielzeit: value });
        SPIELZEIT_MINUTEN = value;
        res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Speichern der Spielzeit:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Speichern', error: error.message });
    }
});

// Hauptseite ausliefern
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
});

// Serverstart
ensureTeamsJson().then(ensureMatchesAndStandings).then(loadTimerState).then(() => {
    app.listen(PORT, () => {
        console.log(`Backend läuft auf http://localhost:${PORT}`);
        console.log(`Frontend verfügbar auf http://localhost:${PORT}`);
    });
}); 

// ... existing code ...
console.log('SERVER STARTED - DEBUG TEST');

// Beim Serverstart: matches.json löschen, damit der Spielplan immer neu generiert wird
try {
    if (fs.existsSync(MATCHES_JSON)) {
        fs.unlinkSync(MATCHES_JSON);
        console.log('matches.json gelöscht, Spielplan wird neu generiert!');
    }
} catch (e) {
    console.log('Fehler beim Löschen von matches.json:', e.message);
}
// ... existing code ... 

// Nach Serverstart: Teams und Vorrunden-Spiele debuggen
fs.readJson(TEAMS_JSON).then(teams => {
    console.log('Teams gefunden:', teams.map(t => t.name));
    if (teams.length === 8) {
        generateMatches(teams).then(matches => {
            console.log('Vorrunden-Spiele:', matches.vorrunde.map(s => s.round + ': ' + s.team1 + ' vs ' + s.team2));
        });
    }
});
// ... existing code ... 

// Hilfsfunktion zum Gruppieren der Standings für 8 und 9 Teams
function groupStandings(standings, teamsLength) {
    if (teamsLength === 8) {
        return {
            A: standings.filter(t => t.gruppe === 'A'),
            B: standings.filter(t => t.gruppe === 'B')
        };
    } else if (teamsLength === 9) {
        return {
            A: standings.filter(t => t.gruppe === 'A'),
            B: standings.filter(t => t.gruppe === 'B'),
            C: standings.filter(t => t.gruppe === 'C')
        };
    }
    return standings;
}

// NEUE Turnierlogik für 8, 9, 10 Teams
function generateVorrundeAndKO(teams) {
    const n = teams.length;
    let vorrunde = [];
    let ko = [];
    // Prüfe, ob ein spezieller Modus für 8 Teams gewählt wurde
    let settings = {};
    try {
        settings = require('fs').existsSync(SETTINGS_JSON) ? require('fs').readFileSync(SETTINGS_JSON, 'utf-8') : '{}';
        settings = JSON.parse(settings);
    } catch (e) { settings = {}; }
    const koModus8Teams = settings.koModus8Teams || 'viertelfinale';
    if (n === 8 && koModus8Teams === 'halbfinale') {
        // NEUER MODUS: 2 Gruppen à 4 Teams, jeder gegen jeden in der Gruppe, nie zweimal nacheinander
        const gruppen = [teams.slice(0, 4), teams.slice(4, 8)];
        const gruppenNamen = ['A', 'B'];
        // Alle Paarungen in jeder Gruppe (6 Spiele pro Gruppe)
        const paarungen = [
            [0, 1], [2, 3],
            [0, 2], [1, 3],
            [0, 3], [1, 2]
        ];
        // Blockweise: 2 Spiele aus A, dann 2 aus B, dann wieder A, B ...
        for (let block = 0; block < 3; block++) {
            for (let g = 0; g < 2; g++) {
                for (let p = 0; p < 2; p++) {
                    const idx = block * 2 + p;
                    const gruppe = gruppen[g];
                    const gruppeName = gruppenNamen[g];
                    const [i, j] = paarungen[idx];
                    vorrunde.push({
                        id: `g${gruppeName}_${gruppe[i].name}_vs_${gruppe[j].name}`,
                        phase: 'vorrunde',
                        round: `Gruppe ${gruppeName}`,
                        team1: gruppe[i].name,
                        team2: gruppe[j].name,
                        score1: null, score2: null, status: 'geplant', startTime: null, endTime: null
                    });
                }
            }
        }
        // KO-Spiele: nur Halbfinale und Finale
        ko = [
            { id: 'pause1', phase: 'pause', round: '20 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 20 },
            { id: 'HF1', phase: 'ko', round: 'Halbfinale 1', team1: '1. Gruppe A', team2: '2. Gruppe B', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'HF2', phase: 'ko', round: 'Halbfinale 2', team1: '1. Gruppe B', team2: '2. Gruppe A', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'pause2', phase: 'pause', round: '10 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 10 },
            { id: 'F1', phase: 'ko', round: 'Finale', team1: 'Sieger HF1', team2: 'Sieger HF2', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null }
        ];
        return { vorrunde, ko };
    }
    if (n === 8 && koModus8Teams === 'viertelfinale') {
        // 2 Gruppen à 4 Teams
        const gruppen = [teams.slice(0, 4), teams.slice(4, 8)];
        const gruppenNamen = ['A', 'B'];
        // Klassische Reihenfolge für 4er-Gruppen: 1-2, 3-4, 1-3, 2-4, 4-1, 2-3
        const paarungen = [
            [0, 1], [2, 3],
            [0, 2], [1, 3],
            [3, 0], [1, 2]
        ];
        // Blöcke: immer 2 Spiele aus A, dann 2 aus B, dann wieder A, B ...
        for (let block = 0; block < 3; block++) {
            for (let g = 0; g < 2; g++) {
                for (let p = 0; p < 2; p++) {
                    const idx = block * 2 + p;
                    const gruppe = gruppen[g];
                    const gruppeName = gruppenNamen[g];
                    const [i, j] = paarungen[idx];
                    vorrunde.push({
                        id: `g${gruppeName}_${gruppe[i].name}_vs_${gruppe[j].name}`,
                        phase: 'vorrunde',
                        round: `Gruppe ${gruppeName}`,
                        team1: gruppe[i].name,
                        team2: gruppe[j].name,
                        score1: null, score2: null, status: 'geplant', startTime: null, endTime: null
                    });
                }
            }
        }
        // KO-Spiele: 4 Viertelfinale, 2 Halbfinale, Finale
        ko = [
            { id: 'pause1', phase: 'pause', round: '20 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 20 },
            { id: 'VF1', phase: 'ko', round: 'Viertelfinale 1', team1: '1. Gruppe A', team2: '4. Gruppe B', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF2', phase: 'ko', round: 'Viertelfinale 2', team1: '2. Gruppe A', team2: '3. Gruppe B', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF3', phase: 'ko', round: 'Viertelfinale 3', team1: '1. Gruppe B', team2: '4. Gruppe A', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF4', phase: 'ko', round: 'Viertelfinale 4', team1: '2. Gruppe B', team2: '3. Gruppe A', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'pause2', phase: 'pause', round: '10 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 10 },
            { id: 'HF1', phase: 'ko', round: 'Halbfinale 1', team1: 'Sieger VF2', team2: 'Sieger VF3', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'HF2', phase: 'ko', round: 'Halbfinale 2', team1: 'Sieger VF1', team2: 'Sieger VF4', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'pause3', phase: 'pause', round: '10 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 10 },
            { id: 'F1', phase: 'ko', round: 'Finale', team1: 'Sieger HF1', team2: 'Sieger HF2', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null }
        ];
    } else if (n === 9) {
        // 3 Gruppen à 3 Teams
        const gruppen = [teams.slice(0, 3), teams.slice(3, 6), teams.slice(6, 9)];
        const gruppenNamen = ['A', 'B', 'C'];
        let gruppenSpiele = [];
        gruppen.forEach((gruppe, gIdx) => {
            let spiele = [];
            for (let i = 0; i < 3; i++) {
                for (let j = i + 1; j < 3; j++) {
                    spiele.push({
                        gruppe: gruppenNamen[gIdx],
                        team1: gruppe[i].name,
                        team2: gruppe[j].name
                    });
                }
            }
            gruppenSpiele.push(spiele);
        });
        // ABCABCABC: immer ein Spiel aus A, dann B, dann C, dann wieder A, B, C ...
        for (let r = 0; r < 3; r++) {
            for (let g = 0; g < 3; g++) {
                if (gruppenSpiele[g][r]) vorrunde.push({
                    id: `g${gruppenNamen[g]}_${gruppenSpiele[g][r].team1}_vs_${gruppenSpiele[g][r].team2}`,
                    phase: 'vorrunde',
                    round: `Gruppe ${gruppenNamen[g]}`,
                    team1: gruppenSpiele[g][r].team1,
                    team2: gruppenSpiele[g][r].team2,
                    score1: null, score2: null, status: 'geplant', startTime: null, endTime: null
                });
            }
        }
        // KO-Spiele: 4 Viertelfinale, 2 Halbfinale, Finale mit festen Platzhaltern
        ko = [
            { id: 'pause1', phase: 'pause', round: '20 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 20 },
            { id: 'VF1', phase: 'ko', round: 'Viertelfinale 1', team1: '1. Gruppe A', team2: 'Bester 3. Gruppe B/C', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF2', phase: 'ko', round: 'Viertelfinale 2', team1: '1. Gruppe B', team2: 'Bester 3. Gruppe A/C', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF3', phase: 'ko', round: 'Viertelfinale 3', team1: '1. Gruppe C', team2: '2. Gruppe A', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF4', phase: 'ko', round: 'Viertelfinale 4', team1: '2. Gruppe B', team2: '2. Gruppe C', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'pause2', phase: 'pause', round: '10 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 10 },
            { id: 'HF1', phase: 'ko', round: 'Halbfinale 1', team1: 'Sieger VF2', team2: 'Sieger VF3', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'HF2', phase: 'ko', round: 'Halbfinale 2', team1: 'Sieger VF1', team2: 'Sieger VF4', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'pause3', phase: 'pause', round: '10 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 10 },
            { id: 'F1', phase: 'ko', round: 'Finale', team1: 'Sieger HF1', team2: 'Sieger HF2', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null }
        ];
    } else if (n === 10) {
        // 1 Gruppe mit 10 Teams, jeder spielt 2 Vorrundenspiele
        const vorrundenPaarungen = [
            [0, 1], [2, 3], [4, 5], [6, 7], [8, 9],
            [0, 2], [1, 3], [4, 6], [5, 7], [8, 9]
        ];
        vorrundenPaarungen.forEach((paarung, idx) => {
            vorrunde.push({
                id: `v${idx + 1}`,
                phase: 'vorrunde',
                round: 'Vorrunde',
                team1: teams[paarung[0]].name,
                team2: teams[paarung[1]].name,
                score1: null, score2: null, status: 'geplant', startTime: null, endTime: null
            });
        });
        // KO-Spiele: 2 Achtelfinale, 4 Viertelfinale, 2 Halbfinale, Finale mit Platzhaltern
        ko = [
            { id: 'pause1', phase: 'pause', round: '20 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 20 },
            { id: 'AF1', phase: 'ko', round: 'Achtelfinale 1', team1: 'Platz 7', team2: 'Platz 10', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'AF2', phase: 'ko', round: 'Achtelfinale 2', team1: 'Platz 8', team2: 'Platz 9', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF1', phase: 'ko', round: 'Viertelfinale 1', team1: 'Platz 3', team2: 'Platz 6', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF2', phase: 'ko', round: 'Viertelfinale 2', team1: 'Platz 4', team2: 'Platz 5', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF3', phase: 'ko', round: 'Viertelfinale 3', team1: 'Platz 2', team2: 'Sieger AF1', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'VF4', phase: 'ko', round: 'Viertelfinale 4', team1: 'Platz 1', team2: 'Sieger AF2', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'pause2', phase: 'pause', round: '10 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 10 },
            { id: 'HF1', phase: 'ko', round: 'Halbfinale 1', team1: 'Sieger VF3', team2: 'Sieger VF1', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'HF2', phase: 'ko', round: 'Halbfinale 2', team1: 'Sieger VF4', team2: 'Sieger VF2', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null },
            { id: 'pause3', phase: 'pause', round: '10 Minuten Pause', team1: '', team2: '', status: 'pause', startTime: null, endTime: null, pauseDuration: 10 },
            { id: 'F1', phase: 'ko', round: 'Finale', team1: 'Sieger HF1', team2: 'Sieger HF2', score1: null, score2: null, status: 'wartend', startTime: null, endTime: null }
        ];
    }
    return { vorrunde, ko };
}

app.post('/api/matches/:id/score', async (req, res) => {
    const { id } = req.params;
    const { team, score } = req.body;
    let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
    let match = matches.vorrunde.find(m => m.id === id) || matches.ko.find(m => m.id === id);
    if (!match) return res.status(404).json({ message: 'Match nicht gefunden' });
    // Score setzen
    if (team === '1') {
        match.score1 = score;
    } else if (team === '2') {
        match.score2 = score;
    } else {
        return res.status(400).json({ message: 'Ungültiges Team' });
    }
    // Status setzen
    if (match.score1 !== null && match.score2 !== null) {
        match.status = 'completed';
    } else {
        match.status = 'geplant';
    }
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    // Standings aktualisieren (nur wenn beide Ergebnisse vorhanden sind)
    if (match.score1 !== null && match.score2 !== null) {
        let standings = await fs.readJson(STANDINGS_JSON).catch(() => []);
        let t1 = standings.find(t => t.name === match.team1);
        let t2 = standings.find(t => t.name === match.team2);
        if (t1 && t2) {
            t1.played++; t2.played++;
            t1.goalsFor += match.score1; t1.goalsAgainst += match.score2;
            t2.goalsFor += match.score2; t2.goalsAgainst += match.score1;
            if (match.score1 > match.score2) { t1.won++; t1.points += 3; t2.lost++; }
            else if (match.score1 < match.score2) { t2.won++; t2.points += 3; t1.lost++; }
            else { t1.drawn++; t2.drawn++; t1.points++; t2.points++; }
        }
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
        // KO-Phase ggf. automatisch befüllen (Logik nach Bedarf einfügen)
    }
    res.json({ success: true });
});

// Standings berechnen (nur Vorrunde)
async function calculateStandingsFile() {
    try {
        let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
        let teams = await fs.readJson(TEAMS_JSON).catch(() => []);
        
        if (teams.length === 8 || teams.length === 9) {
            // Gruppierte Standings für 8/9 Teams
            let gruppen = {};
            if (teams.length === 8) {
                gruppen = { A: teams.slice(0, 4), B: teams.slice(4, 8) };
            } else if (teams.length === 9) {
                gruppen = { A: teams.slice(0, 3), B: teams.slice(3, 6), C: teams.slice(6, 9) };
            }
            
            let result = {};
            Object.entries(gruppen).forEach(([gruppe, groupTeams]) => {
                let standings = groupTeams.map(t => ({
                    name: t.name,
                    played: 0,
                    won: 0,
                    drawn: 0,
                    lost: 0,
                    goalsFor: 0,
                    goalsAgainst: 0,
                    points: 0,
                    gruppe: gruppe
                }));
                
                const groupMatches = (matches.vorrunde || []).filter(m => m.round && m.round.includes(gruppe));
                groupMatches.forEach(match => {
                    if (typeof match.score1 === 'number' && typeof match.score2 === 'number' && match.score1 !== null && match.score2 !== null) {
                        let t1 = standings.find(t => t.name === match.team1);
                        let t2 = standings.find(t => t.name === match.team2);
                        if (t1 && t2) {
                            t1.played++; t2.played++;
                            t1.goalsFor += match.score1; t1.goalsAgainst += match.score2;
                            t2.goalsFor += match.score2; t2.goalsAgainst += match.score1;
                            if (match.score1 > match.score2) { t1.won++; t1.points += 3; t2.lost++; }
                            else if (match.score1 < match.score2) { t2.won++; t2.points += 3; t1.lost++; }
                            else { t1.drawn++; t2.drawn++; t1.points++; t2.points++; }
                        }
                    }
                });
                
                standings.sort((a, b) => {
                    if (b.points !== a.points) return b.points - a.points;
                    const diffA = a.goalsFor - a.goalsAgainst;
                    const diffB = b.goalsFor - b.goalsAgainst;
                    if (diffB !== diffA) return diffB - diffA;
                    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                    return a.name.localeCompare(b.name);
                });
                
                result[gruppe] = standings;
            });
            
            await fs.writeJson(STANDINGS_JSON, result, { spaces: 2 });
            return result;
        } else {
            // Einzel-Tabelle für 10 Teams
            let standings = teams.map(t => ({
                name: t.name, played: 0, won: 0, drawn: 0, lost: 0,
                goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: null
            }));
            
            // Statistiken
            (matches.vorrunde || []).forEach(match => {
                if (typeof match.score1 === 'number' && typeof match.score2 === 'number' && match.score1 !== null && match.score2 !== null) {
                    let t1 = standings.find(t => t.name === match.team1);
                    let t2 = standings.find(t => t.name === match.team2);
                    if (t1 && t2) {
                        t1.played++; t2.played++;
                        t1.goalsFor += match.score1; t1.goalsAgainst += match.score2;
                        t2.goalsFor += match.score2; t2.goalsAgainst += match.score1;
                        if (match.score1 > match.score2) { t1.won++; t1.points += 3; t2.lost++; }
                        else if (match.score1 < match.score2) { t2.won++; t2.points += 3; t1.lost++; }
                        else { t1.drawn++; t2.drawn++; t1.points++; t2.points++; }
                    }
                }
            });
            
            standings.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                const diffA = a.goalsFor - a.goalsAgainst;
                const diffB = b.goalsFor - b.goalsAgainst;
                if (diffB !== diffA) return diffB - diffA;
                if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                return a.name.localeCompare(b.name);
            });
            
            await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
            return standings;
        }
    } catch (error) {
        console.error('Fehler beim Berechnen der Standings:', error);
        return [];
    }
}

// KO-Befüllung nach Vorrunde (Datei)
async function fillKOMatchesFromStandingsFile() {
    try {
        let teams = await fs.readJson(TEAMS_JSON).catch(() => []);
        let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
        let standings = await fs.readJson(STANDINGS_JSON).catch(() => []);
        let settings = await fs.readJson(SETTINGS_JSON).catch(() => ({ koModus8Teams: 'viertelfinale' }));
        // --- NEU: Bei 8 Teams und Moduswechsel KO-Phase komplett neu generieren ---
        if (teams.length === 8) {
            const oldKO = matches.ko || [];
            const { ko } = generateVorrundeAndKO(teams);
            // Übernehme Ergebnisse und Zeiten aus alten KO-Spielen, wenn id identisch ist (egal welche Teams)
            ko.forEach(newMatch => {
                const oldMatch = oldKO.find(m => m.id === newMatch.id);
                if (oldMatch) {
                    newMatch.score1 = oldMatch.score1;
                    newMatch.score2 = oldMatch.score2;
                    newMatch.startTime = oldMatch.startTime;
                    newMatch.endTime = oldMatch.endTime;
                    newMatch.status = oldMatch.status;
                }
            });
            matches.ko = ko;
            // Die Teams in die KO-Spiele eintragen wie gehabt:
            const gruppeA = (standings.A || []).sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name));
            const gruppeB = (standings.B || []).sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name));
            let HF1 = matches.ko.find(m => m.id === 'HF1');
            let HF2 = matches.ko.find(m => m.id === 'HF2');
            let F1 = matches.ko.find(m => m.id === 'F1');
            if (settings.koModus8Teams === 'viertelfinale') {
                let VF1 = matches.ko.find(m => m.id === 'VF1');
                let VF2 = matches.ko.find(m => m.id === 'VF2');
                let VF3 = matches.ko.find(m => m.id === 'VF3');
                let VF4 = matches.ko.find(m => m.id === 'VF4');
                if (VF1 && (!VF1.team1 || !VF1.team2 || VF1.team1.startsWith('1.') || VF1.team2.startsWith('4.'))) {
                    VF1.team1 = gruppeA[0]?.name || '1. Gruppe A';
                    VF1.team2 = gruppeB[3]?.name || '4. Gruppe B';
                }
                if (VF2 && (!VF2.team1 || !VF2.team2 || VF2.team1.startsWith('2.') || VF2.team2.startsWith('3.'))) {
                    VF2.team1 = gruppeA[1]?.name || '2. Gruppe A';
                    VF2.team2 = gruppeB[2]?.name || '3. Gruppe B';
                }
                if (VF3 && (!VF3.team1 || !VF3.team2 || VF3.team1.startsWith('1.') || VF3.team2.startsWith('4.'))) {
                    VF3.team1 = gruppeB[0]?.name || '1. Gruppe B';
                    VF3.team2 = gruppeA[3]?.name || '4. Gruppe A';
                }
                if (VF4 && (!VF4.team1 || !VF4.team2 || VF4.team1.startsWith('2.') || VF4.team2.startsWith('3.'))) {
                    VF4.team1 = gruppeB[1]?.name || '2. Gruppe B';
                    VF4.team2 = gruppeA[2]?.name || '3. Gruppe A';
                }
                if (HF1 && (!HF1.team1 || !HF1.team2 || HF1.team1.startsWith('Sieger') || HF1.team2.startsWith('Sieger'))) {
                    HF1.team1 = 'Sieger VF2';
                    HF1.team2 = 'Sieger VF3';
                }
                if (HF2 && (!HF2.team1 || !HF2.team2 || HF2.team1.startsWith('Sieger') || HF2.team2.startsWith('Sieger'))) {
                    HF2.team1 = 'Sieger VF1';
                    HF2.team2 = 'Sieger VF4';
                }
                if (F1 && (!F1.team1 || !F1.team2 || F1.team1.startsWith('Sieger') || F1.team2.startsWith('Sieger'))) {
                    F1.team1 = 'Sieger HF1';
                    F1.team2 = 'Sieger HF2';
                }
            } else if (settings.koModus8Teams === 'halbfinale') {
                if (HF1 && (!HF1.team1 || !HF1.team2 || HF1.team1.startsWith('1.') || HF1.team2.startsWith('2.'))) {
                    HF1.team1 = gruppeA[0]?.name || '1. Gruppe A';
                    HF1.team2 = gruppeB[1]?.name || '2. Gruppe B';
                }
                if (HF2 && (!HF2.team1 || !HF2.team2 || HF2.team1.startsWith('1.') || HF2.team2.startsWith('2.'))) {
                    HF2.team1 = gruppeB[0]?.name || '1. Gruppe B';
                    HF2.team2 = gruppeA[1]?.name || '2. Gruppe A';
                }
                if (F1 && (!F1.team1 || !F1.team2 || F1.team1.startsWith('Sieger') || F1.team2.startsWith('Sieger'))) {
                    F1.team1 = 'Sieger HF1';
                    F1.team2 = 'Sieger HF2';
                }
            }
            // Nach dem Setzen der KO-Phase: Zeiten für alle Spiele neu berechnen
            matches = await recalculateMatchTimesFile(matches);
            await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
            return;
        }
        // ... bestehende Logik für 9/10 Teams ...
    } catch (error) {
        console.error('Fehler beim Befüllen der KO-Matches:', error);
    }
}

// 2. Automatische Zeitberechnung für alle Spiele
async function recalculateMatchTimesFile(matches, startFromMatchId = null) {
    try {
        let allMatches = [...(matches.vorrunde || []), ...(matches.ko || [])];
        // Startzeit immer 14:00 Uhr
        let currentTime = new Date('2025-07-05T14:00:00');
        let startIndex = 0;
        if (startFromMatchId) {
            // Finde das Spiel, ab dem angepasst werden soll
            startIndex = allMatches.findIndex(m => m.id === startFromMatchId);
            if (startIndex < 0) startIndex = 0;
            // Hole ggf. die manuell gesetzte Startzeit
            const manualStart = allMatches[startIndex].startTime;
            if (manualStart) {
                const [h, m] = manualStart.split(':').map(Number);
                currentTime = new Date('2025-07-05T' + h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0') + ':00');
            }
        }
        for (let i = startIndex; i < allMatches.length; i++) {
            let m = allMatches[i];
            // Pausenspiel: Pause mit individueller Dauer
            if (m.phase === 'pause' && m.pauseDuration) {
                m.startTime = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0');
                currentTime = new Date(currentTime.getTime() + m.pauseDuration * 60 * 1000);
                m.endTime = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0');
            } else {
                // Normales Spiel
                m.startTime = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0');
                currentTime = new Date(currentTime.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
                m.endTime = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0');
                // Nach jedem Spiel (außer letztem oder wenn nächstes ein Pausenspiel ist): Standardpause
                const next = allMatches[i + 1];
                if (next && !(next.phase === 'pause' && next.pauseDuration)) {
                    currentTime = new Date(currentTime.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
                }
            }
        }
        // Schreibe die neuen Zeiten zurück in die Struktur
        matches.vorrunde = allMatches.filter(m => m.phase === 'vorrunde');
        matches.ko = allMatches.filter(m => m.phase !== 'vorrunde');
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        return matches;
    } catch (error) {
        console.error('Fehler bei der Zeitberechnung:', error);
        return matches;
    }
}

// 3. Nach jedem Vorrundenspiel: Standings und KO prüfen
// (In /api/matches/:id/score nach dem Speichern und vor res.json)
// await calculateStandingsFile();
// await fillKOMatchesFromStandingsFile();
// await recalculateMatchTimesFile(matches);

// Hilfsskript: Standings automatisch generieren
if (require.main === module && process.argv[2] === 'generate-standings') {
    (async () => {
        const teams = await fs.readJson(TEAMS_JSON);
        let standings;
        if (teams.length === 8) {
            standings = {
                A: teams.slice(0, 4).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'A' })),
                B: teams.slice(4, 8).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'B' }))
            };
        } else if (teams.length === 9) {
            standings = {
                A: teams.slice(0, 3).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'A' })),
                B: teams.slice(3, 6).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'B' })),
                C: teams.slice(6, 9).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'C' }))
            };
        } else {
            standings = teams.map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: null }));
        }
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
        console.log('standings.json wurde für', teams.length, 'Teams generiert!');
    })();
}

// Hilfsfunktion: Spielplan und Standings neu generieren
async function regenerateScheduleAndStandings() {
    const teams = await fs.readJson(TEAMS_JSON);
    // Spielplan generieren
    const { vorrunde, ko } = generateVorrundeAndKO(teams);
    let matches = { vorrunde, ko };
    matches = await recalculateMatchTimesFile(matches);
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    // Standings generieren
    if (teams.length === 8) {
        const standings = {
            A: teams.slice(0, 4).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'A' })),
            B: teams.slice(4, 8).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'B' }))
        };
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
    } else if (teams.length === 9) {
        const standings = {
            A: teams.slice(0, 3).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'A' })),
            B: teams.slice(3, 6).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'B' })),
            C: teams.slice(6, 9).map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: 'C' }))
        };
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
    } else {
        const standings = teams.map(t => ({ ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, gruppe: null }));
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
    }
}

// ... existing code ...
// API: Startzeit für das erste Spiel setzen
app.post('/api/startzeit', requireAuth, async (req, res) => {
    try {
        const { zeit } = req.body;
        if (!zeit || !/^[0-2][0-9]:[0-5][0-9]$/.test(zeit)) {
            return res.status(400).json({ success: false, message: 'Ungültige Zeit' });
        }
        let matches = await fs.readJson(MATCHES_JSON);
        // Setze die Startzeit des ersten Spiels
        let allMatches = [...(matches.vorrunde || []), ...(matches.ko || [])];
        if (allMatches.length === 0) return res.status(400).json({ success: false, message: 'Kein Spielplan vorhanden' });
        allMatches[0].startTime = zeit;
        // Zeitplan ab erstem Spiel neu berechnen
        matches.vorrunde = allMatches.filter(m => m.phase === 'vorrunde');
        matches.ko = allMatches.filter(m => m.phase !== 'vorrunde');
        await recalculateMatchTimesFile(matches, allMatches[0].id);
        res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Setzen der Startzeit:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Setzen der Startzeit', error: error.message });
    }
});
// ... existing code ... 

// ... existing code ...
// API: KO-Modus bei 8 Teams explizit setzen
app.post('/api/ko-modus-8teams', requireAuth, async (req, res) => {
    try {
        const { modus } = req.body;
        const erlaubteModi = ['viertelfinale', 'halbfinale'];
        let settings = await fs.readJson(SETTINGS_JSON).catch(() => ({ koModus8Teams: 'viertelfinale' }));
        if (!erlaubteModi.includes(modus)) {
            return res.status(400).json({ success: false, message: 'Ungültiger Modus', erlaubteModi, aktuellerModus: settings.koModus8Teams });
        }
        settings.koModus8Teams = modus;
        await fs.writeJson(SETTINGS_JSON, settings, { spaces: 2 });
        res.json({ success: true, koModus8Teams: settings.koModus8Teams });
    } catch (error) {
        console.error('Fehler beim Setzen des KO-Modus:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Setzen des KO-Modus', error: error.message });
    }
});
// ... existing code ... 

// ... existing code ...
app.get('/api/ko-matches', requireAuth, async (req, res) => {
    try {
        const teams = await fs.readJson(TEAMS_JSON);
        const settings = await fs.readJson(SETTINGS_JSON).catch(() => ({ koModus8Teams: 'viertelfinale', spielzeit: 8, pausenzeit: 4 }));
        const matches = await fs.readJson(MATCHES_JSON);
        let koMatches = [];
        // Prüfe, ob Admin-Ansicht (Query-Parameter ?admin=1)
        const isAdmin = req.query.admin === '1' || req.query.admin === 1;
        if (teams.length === 8) {
            if (isAdmin) {
                // Für Admin immer alle KO-Spiele (VF, HF, F)
                koMatches = (matches.ko || []).filter(m => m.id.startsWith('VF') || m.id.startsWith('HF') || m.id.startsWith('F'));
            } else if (settings.koModus8Teams === 'viertelfinale') {
                koMatches = (matches.ko || []).filter(m => m.id.startsWith('VF') || m.id.startsWith('HF') || m.id.startsWith('F'));
            } else {
                // Nur Halbfinale/Finale aus matches.json zurückgeben (inkl. Teams/Ergebnisse)
                koMatches = (matches.ko || []).filter(m => m.id.startsWith('HF') || m.id.startsWith('F'));
            }
        } else {
            koMatches = matches.ko || [];
        }
        res.json({ success: true, koMatches });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Laden der KO-Spiele', error: error.message });
    }
});
// ... existing code ... 

// ... existing code ...
// API: Einstellungen abrufen
app.get('/api/settings', requireAuth, async (req, res) => {
    try {
        const settings = await fs.readJson(SETTINGS_JSON).catch(() => ({}));
        res.json(settings);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Laden der Einstellungen', error: error.message });
    }
});
// ... existing code ... 