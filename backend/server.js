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
    origin: 'https://turnierplan-frontend.onrender.com',
    credentials: true
}));
app.use(bodyParser.json());

const DATA_DIR = path.join(__dirname, 'data');
const TEAMS_JSON = path.join(DATA_DIR, 'teams.json');
const TEAMS_XLSX = path.join(__dirname, 'Teams.xlsx');
const MATCHES_JSON = path.join(DATA_DIR, 'matches.json');
const STANDINGS_JSON = path.join(DATA_DIR, 'standings.json');
const TIMER_JSON = path.join(DATA_DIR, 'timer.json');
const ADMIN_PASSWORD_HASH = '$2b$10$4rz9z6driUiMq2H7tcDAEOH7KevVmCGwS6CKsqn4UgXRwP8Ll/cfm'; // bcrypt hash für 'turnieradmin2025'
const JWT_SECRET = 'turniergeheimnis2025';
const SETTINGS_JSON = path.join(DATA_DIR, 'settings.json');

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
    const matches = { vorrunde: [], ko: [] };
    const n = teams.length;
    let matchNumber = 1;
    const startTime = new Date('2025-07-05T14:00:00');
    let currentTime = new Date(startTime);

    if (n === 10) {
        // Vorrunde: Logische Paarungen ohne direkte Wiederholungen
        // Jedes Team spielt genau 2 Spiele gegen verschiedene Gegner
        const vorrundenPaarungen = [
            // Runde 1
            [0, 1], [2, 3], [4, 5], [6, 7], [8, 9],
            // Runde 2  
            [0, 2], [1, 3], [4, 6], [5, 7], [8, 9]
        ];
        
        // Vorrunde: 10 Spiele mit Zeiten (8min Spiel + 4min Pause = 12min pro Spiel)
        vorrundenPaarungen.forEach((paarung, index) => {
            const matchStart = new Date(startTime.getTime() + index * 12 * 60 * 1000); // 12 Minuten Abstand
            const matchEnd = new Date(matchStart.getTime() + SPIELZEIT_MINUTEN * 60 * 1000); // 8 Minuten Spielzeit
            matches.vorrunde.push({
                id: `v${index + 1}`,
                phase: 'vorrunde',
                round: 'Vorrunde',
                team1: teams[paarung[0]].name,
                team2: teams[paarung[1]].name,
                score1: null,
                score2: null,
                status: 'geplant',
                startTime: `${matchStart.getHours().toString().padStart(2, '0')}:${matchStart.getMinutes().toString().padStart(2, '0')}`,
                endTime: `${matchEnd.getHours().toString().padStart(2, '0')}:${matchEnd.getMinutes().toString().padStart(2, '0')}`
            });
        });
        // Nach dem letzten Vorrundenspiel: 20 Minuten Pause (keine 4-Minuten-Pause mehr)
        let currentTime = new Date(startTime.getTime() + 9 * 12 * 60 * 1000); // Start letzter Vorrunde
        currentTime = new Date(currentTime.getTime() + SPIELZEIT_MINUTEN * 60 * 1000); // Ende letztes Vorrundenspiel
        const pause1Start = new Date(currentTime);
        const pause1End = new Date(pause1Start.getTime() + 20 * 60 * 1000);
        matches.ko.push({
            id: 'pause1',
            phase: 'pause',
            round: '20 Minuten Pause',
            team1: '',
            team2: '',
            status: 'pause',
            startTime: `${pause1Start.getHours().toString().padStart(2, '0')}:${pause1Start.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${pause1End.getHours().toString().padStart(2, '0')}:${pause1End.getMinutes().toString().padStart(2, '0')}`,
            pauseDuration: 20
        });
        currentTime = new Date(pause1End);

        // KO-Spiele erstellen entsprechend dem neuen Muster
        const koMatches = [
            { id: 'AF1', round: 'Achtelfinale 1', team1: 'Platz 7', team2: 'Platz 10' },
            { id: 'AF2', round: 'Achtelfinale 2', team1: 'Platz 8', team2: 'Platz 9' },
            { id: 'VF1', round: 'Viertelfinale 1', team1: 'Platz 3', team2: 'Platz 6' },
            { id: 'VF2', round: 'Viertelfinale 2', team1: 'Platz 4', team2: 'Platz 5' },
            { id: 'VF3', round: 'Viertelfinale 3', team1: 'Platz 2', team2: 'Sieger AF1' },
            { id: 'VF4', round: 'Viertelfinale 4', team1: 'Platz 1', team2: 'Sieger AF2' },
            { id: 'HF1', round: 'Halbfinale 1', team1: 'Sieger VF3', team2: 'Sieger VF1' },
            { id: 'HF2', round: 'Halbfinale 2', team1: 'Sieger VF4', team2: 'Sieger VF2' },
            { id: 'F1', round: 'Finale', team1: 'Sieger HF1', team2: 'Sieger HF2' }
        ];
        // KO-Spiele mit Pausen einfügen
        koMatches.forEach((match, idx) => {
            // Spiel einfügen
            const matchStart = new Date(currentTime);
            const matchEnd = new Date(matchStart.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
            matches.ko.push({
                id: match.id,
                phase: 'ko',
                round: match.round,
                team1: match.team1,
                team2: match.team2,
                score1: null,
                score2: null,
                status: 'wartend',
                startTime: `${matchStart.getHours().toString().padStart(2, '0')}:${matchStart.getMinutes().toString().padStart(2, '0')}`,
                endTime: `${matchEnd.getHours().toString().padStart(2, '0')}:${matchEnd.getMinutes().toString().padStart(2, '0')}`
            });
            // Nach jedem KO-Spiel außer nach VF4 und HF2: PAUSENZEIT_MINUTEN Minuten Pause
            if (match.id === 'VF4') {
                // Nach VF4: 10 Minuten Pause
                const pause2Start = new Date(matchEnd.getTime());
                const pause2End = new Date(pause2Start.getTime() + 10 * 60 * 1000);
                matches.ko.push({
                    id: 'pause2',
                    phase: 'pause',
                    round: '10 Minuten Pause',
                    team1: '',
                    team2: '',
                    status: 'pause',
                    startTime: `${pause2Start.getHours().toString().padStart(2, '0')}:${pause2Start.getMinutes().toString().padStart(2, '0')}`,
                    endTime: `${pause2End.getHours().toString().padStart(2, '0')}:${pause2End.getMinutes().toString().padStart(2, '0')}`,
                    pauseDuration: 10
                });
                currentTime = new Date(pause2End);
            } else if (match.id === 'HF2') {
                // Nach HF2: 10 Minuten Pause
                const pause3Start = new Date(matchEnd.getTime());
                const pause3End = new Date(pause3Start.getTime() + 10 * 60 * 1000);
                matches.ko.push({
                    id: 'pause3',
                    phase: 'pause',
                    round: '10 Minuten Pause',
                    team1: '',
                    team2: '',
                    status: 'pause',
                    startTime: `${pause3Start.getHours().toString().padStart(2, '0')}:${pause3Start.getMinutes().toString().padStart(2, '0')}`,
                    endTime: `${pause3End.getHours().toString().padStart(2, '0')}:${pause3End.getMinutes().toString().padStart(2, '0')}`,
                    pauseDuration: 10
                });
                currentTime = new Date(pause3End);
            } else {
                // Nach allen anderen KO-Spielen: PAUSENZEIT_MINUTEN Minuten Pause
                currentTime = new Date(matchEnd.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
            }
        });
        return matches;
    }

    if (n === 9) {
        // 3 Gruppen à 3 Teams
        const gruppen = [teams.slice(0, 3), teams.slice(3, 6), teams.slice(6, 9)];
        const gruppenNamen = ['A', 'B', 'C'];
        // Alle Gruppenspiele vorbereiten
        let gruppenSpiele = [];
        gruppen.forEach((gruppe, gIdx) => {
            // Jeder gegen jeden in der Gruppe (3 Spiele pro Gruppe)
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
        // ABCABCABC: Immer ein Spiel aus A, dann B, dann C, dann wieder A, B, C ...
        let vorrundenSpiele = [];
        for (let r = 0; r < 3; r++) { // 3 Runden pro Gruppe
            for (let g = 0; g < 3; g++) { // 3 Gruppen
                if (gruppenSpiele[g][r]) vorrundenSpiele.push(gruppenSpiele[g][r]);
            }
        }
        // Debug-Ausgabe
        console.log('Vorrunden-Spiele (ABCABCABC):', vorrundenSpiele.map(s => s.gruppe + ': ' + s.team1 + ' vs ' + s.team2));
        vorrundenSpiele.forEach((spiel, idx) => {
            const matchStart = new Date(currentTime.getTime() + idx * 12 * 60 * 1000);
            const matchEnd = new Date(matchStart.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
            matches.vorrunde.push({
                id: `g${spiel.gruppe}_${spiel.team1}_vs_${spiel.team2}`,
                phase: 'vorrunde',
                round: `Gruppe ${spiel.gruppe}`,
                team1: spiel.team1,
                team2: spiel.team2,
                score1: null,
                score2: null,
                status: 'geplant',
                startTime: `${matchStart.getHours().toString().padStart(2, '0')}:${matchStart.getMinutes().toString().padStart(2, '0')}`,
                endTime: `${matchEnd.getHours().toString().padStart(2, '0')}:${matchEnd.getMinutes().toString().padStart(2, '0')}`
            });
        });
        // Nach Vorrunde: 20 Minuten Pause
        let pauseStart = new Date(currentTime.getTime() + vorrundenSpiele.length * 12 * 60 * 1000);
        let pauseEnd = new Date(pauseStart.getTime() + 20 * 60 * 1000);
        matches.ko.push({
            id: 'pause1', phase: 'pause', round: '20 Minuten Pause', team1: '', team2: '', status: 'pause',
            startTime: `${pauseStart.getHours().toString().padStart(2, '0')}:${pauseStart.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${pauseEnd.getHours().toString().padStart(2, '0')}:${pauseEnd.getMinutes().toString().padStart(2, '0')}`,
            pauseDuration: 20
        });
        currentTime = new Date(pauseEnd);
        // Halbfinale 1
        let hf1Start = new Date(currentTime);
        let hf1End = new Date(hf1Start.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
        matches.ko.push({
            id: 'HF1', phase: 'ko', round: 'Halbfinale 1',
            team1: '1. Gruppe A', team2: '2. Gruppe B',
            score1: null, score2: null, status: 'wartend',
            startTime: `${hf1Start.getHours().toString().padStart(2, '0')}:${hf1Start.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${hf1End.getHours().toString().padStart(2, '0')}:${hf1End.getMinutes().toString().padStart(2, '0')}`
        });
        currentTime = new Date(hf1End.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
        // Halbfinale 2
        let hf2Start = new Date(currentTime);
        let hf2End = new Date(hf2Start.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
        matches.ko.push({
            id: 'HF2', phase: 'ko', round: 'Halbfinale 2',
            team1: '1. Gruppe B', team2: '2. Gruppe A',
            score1: null, score2: null, status: 'wartend',
            startTime: `${hf2Start.getHours().toString().padStart(2, '0')}:${hf2Start.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${hf2End.getHours().toString().padStart(2, '0')}:${hf2End.getMinutes().toString().padStart(2, '0')}`
        });
        currentTime = new Date(hf2End.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
        // Finale
        let f1Start = new Date(currentTime);
        let f1End = new Date(f1Start.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
        matches.ko.push({
            id: 'F1', phase: 'ko', round: 'Finale',
            team1: 'Sieger HF1', team2: 'Sieger HF2',
            score1: null, score2: null, status: 'wartend',
            startTime: `${f1Start.getHours().toString().padStart(2, '0')}:${f1End.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${f1End.getHours().toString().padStart(2, '0')}:${f1End.getMinutes().toString().padStart(2, '0')}`
        });
        return matches;
    }

    if (n === 8) {
        // 2 Gruppen à 4 Teams
        const gruppen = [teams.slice(0, 4), teams.slice(4, 8)];
        const gruppenNamen = ['A', 'B'];
        // Round-Robin-Paarungen für 4 Teams (ergibt 3 Spieltage à 2 Spiele pro Gruppe)
        function roundRobinBlockOrder(gruppe, teams) {
            // Für 4 Teams: 3 Spieltage, je 2 Spiele pro Spieltag
            // Spieltage:
            // 1: Team 1 vs Team 4, Team 2 vs Team 3
            // 2: Team 1 vs Team 3, Team 4 vs Team 2
            // 3: Team 1 vs Team 2, Team 3 vs Team 4
            return [
                [ { gruppe, team1: teams[0].name, team2: teams[3].name }, { gruppe, team1: teams[1].name, team2: teams[2].name } ],
                [ { gruppe, team1: teams[0].name, team2: teams[2].name }, { gruppe, team1: teams[3].name, team2: teams[1].name } ],
                [ { gruppe, team1: teams[0].name, team2: teams[1].name }, { gruppe, team1: teams[2].name, team2: teams[3].name } ]
            ];
        }
        const blocksA = roundRobinBlockOrder('A', gruppen[0]); // 3 Blöcke à 2 Spiele
        const blocksB = roundRobinBlockOrder('B', gruppen[1]);
        // Jetzt AABB-Muster blockweise zusammenfügen
        let vorrundenSpiele = [];
        for (let i = 0; i < 3; i++) {
            vorrundenSpiele.push(...blocksA[i]);
            vorrundenSpiele.push(...blocksB[i]);
        }
        // Debug-Ausgabe
        console.log('Vorrunden-Spiele (AABB, kein Team doppelt im Block):', vorrundenSpiele.map(s => s.gruppe + ': ' + s.team1 + ' vs ' + s.team2));
        vorrundenSpiele.forEach((spiel, idx) => {
            const matchStart = new Date(currentTime.getTime() + idx * 12 * 60 * 1000);
            const matchEnd = new Date(matchStart.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
            matches.vorrunde.push({
                id: `g${spiel.gruppe}_${spiel.team1}_vs_${spiel.team2}`,
                phase: 'vorrunde',
                round: `Gruppe ${spiel.gruppe}`,
                team1: spiel.team1,
                team2: spiel.team2,
                score1: null,
                score2: null,
                status: 'geplant',
                startTime: `${matchStart.getHours().toString().padStart(2, '0')}:${matchStart.getMinutes().toString().padStart(2, '0')}`,
                endTime: `${matchEnd.getHours().toString().padStart(2, '0')}:${matchEnd.getMinutes().toString().padStart(2, '0')}`
            });
        });
        // Nach Vorrunde: 20 Minuten Pause
        let pauseStart = new Date(currentTime.getTime() + vorrundenSpiele.length * 12 * 60 * 1000);
        let pauseEnd = new Date(pauseStart.getTime() + 20 * 60 * 1000);
        matches.ko.push({
            id: 'pause1', phase: 'pause', round: '20 Minuten Pause', team1: '', team2: '', status: 'pause',
            startTime: `${pauseStart.getHours().toString().padStart(2, '0')}:${pauseStart.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${pauseEnd.getHours().toString().padStart(2, '0')}:${pauseEnd.getMinutes().toString().padStart(2, '0')}`,
            pauseDuration: 20
        });
        currentTime = new Date(pauseEnd);
        // Halbfinale 1
        let hf1Start = new Date(currentTime);
        let hf1End = new Date(hf1Start.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
        matches.ko.push({
            id: 'HF1', phase: 'ko', round: 'Halbfinale 1',
            team1: '1. Gruppe A', team2: '2. Gruppe B',
            score1: null, score2: null, status: 'wartend',
            startTime: `${hf1Start.getHours().toString().padStart(2, '0')}:${hf1End.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${hf1End.getHours().toString().padStart(2, '0')}:${hf1End.getMinutes().toString().padStart(2, '0')}`
        });
        currentTime = new Date(hf1End.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
        // Halbfinale 2
        let hf2Start = new Date(currentTime);
        let hf2End = new Date(hf2Start.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
        matches.ko.push({
            id: 'HF2', phase: 'ko', round: 'Halbfinale 2',
            team1: '1. Gruppe B', team2: '2. Gruppe A',
            score1: null, score2: null, status: 'wartend',
            startTime: `${hf2Start.getHours().toString().padStart(2, '0')}:${hf2End.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${hf2End.getHours().toString().padStart(2, '0')}:${hf2End.getMinutes().toString().padStart(2, '0')}`
        });
        currentTime = new Date(hf2End.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
        // Finale
        let f1Start = new Date(currentTime);
        let f1End = new Date(f1Start.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
        matches.ko.push({
            id: 'F1', phase: 'ko', round: 'Finale',
            team1: 'Sieger HF1', team2: 'Sieger HF2',
            score1: null, score2: null, status: 'wartend',
            startTime: `${f1Start.getHours().toString().padStart(2, '0')}:${f1End.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${f1End.getHours().toString().padStart(2, '0')}:${f1End.getMinutes().toString().padStart(2, '0')}`
        });
        return matches;
    }

    // Fallback: Weniger als 8 Teams (nicht unterstützt)
    return matches;
}

// Beim ersten Start: Matches und Standings anlegen
async function ensureMatchesAndStandings() {
    const teams = await fs.readJson(TEAMS_JSON).catch(() => []);
    if (!fs.existsSync(MATCHES_JSON)) {
        const matches = await generateMatches(teams);
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    }
    if (!fs.existsSync(STANDINGS_JSON)) {
        const standings = teams.map(t => ({ name: t.name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }));
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });
    }
    
    // KO-Phase initial aktualisieren
    let standings = await fs.readJson(STANDINGS_JSON).catch(() => []);
    await updateKOMatches(standings);
}

// Hilfsfunktion: Standings komplett neu berechnen
async function recalculateStandings() {
    let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
    let teams = await fs.readJson(TEAMS_JSON).catch(() => []);
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
}

// --- KO-Logik für 9 Teams ---
async function updateKOMatches9Teams(standings, matches) {
    const gruppen = Object.keys(standings);
    const gruppeA = standings['A'];
    const gruppeB = standings['B'];
    const gruppeC = standings['C'];
    let sieger = [gruppeA[0], gruppeB[0], gruppeC[0]];
    let zweitplatzierte = [gruppeA[1], gruppeB[1], gruppeC[1]];
    sieger.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const diffA = a.goalsFor - a.goalsAgainst;
        const diffB = b.goalsFor - b.goalsAgainst;
        if (diffB !== diffA) return diffB - diffA;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name);
    });
    let besterZweiter = zweitplatzierte.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const diffA = a.goalsFor - a.goalsAgainst;
        const diffB = b.goalsFor - b.goalsAgainst;
        if (diffB !== diffA) return diffB - diffA;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name);
    })[0];
    // Prüfe, ob alle Gruppenspiele abgeschlossen sind UND ob die KO-Teams noch Platzhalter sind
    const alleGruppenFertig = gruppen.every(gruppe => {
        const groupMatches = (matches.vorrunde || []).filter(m => m.round && m.round.includes(gruppe));
        return groupMatches.every(m => m.status === 'completed');
    });
    if (alleGruppenFertig) {
        matches.ko.forEach(match => {
            if (match.phase !== 'ko') return;
            if (match.id === 'HF1') {
                match.team1 = sieger[0]?.name || 'Bester Gruppensieger';
                match.team2 = besterZweiter?.name || 'Bester Zweiter';
            }
            if (match.id === 'HF2') {
                match.team1 = sieger[1]?.name || '2. Gruppensieger';
                match.team2 = sieger[2]?.name || '3. Gruppensieger';
            }
            if (match.id === 'F1') {
                match.team1 = 'Sieger HF1';
                match.team2 = 'Sieger HF2';
            }
        });
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    }
}
// ... existing code ...
// --- KO-Logik für 10 Teams ---
async function updateKOMatches10Teams(standings, matches) {
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
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    }
}

async function advanceKOMatches10Teams(matches) {
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
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
}
// ... existing code ...
// updateKOMatches: jetzt getrennt für 8, 9, 10 Teams
async function updateKOMatches(standings) {
    let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
    const teams = await fs.readJson(TEAMS_JSON).catch(() => []);
    if (teams.length === 8 && standings && typeof standings === 'object' && !Array.isArray(standings)) {
        // Prüfe, ob alle Gruppenspiele abgeschlossen sind
        const gruppen = Object.keys(standings);
        let allGroupsCompleted = gruppen.every(gruppe => {
            const groupMatches = (matches.vorrunde || []).filter(m => m.round && m.round.includes(gruppe));
            return groupMatches.every(m => m.status === 'completed');
        });
        if (allGroupsCompleted) {
            // Setze die Teams für die KO-Spiele
            const gruppeA = standings['A'];
            const gruppeB = standings['B'];
            // Sortierung ist bereits korrekt (nach Punkten, Tordifferenz, Tore, Name)
            const HF1 = matches.ko.find(m => m.id === 'HF1');
            const HF2 = matches.ko.find(m => m.id === 'HF2');
            const F1 = matches.ko.find(m => m.id === 'F1');
            if (HF1) {
                HF1.team1 = gruppeA[0]?.name || '1. Gruppe A';
                HF1.team2 = gruppeB[1]?.name || '2. Gruppe B';
            }
            if (HF2) {
                HF2.team1 = gruppeB[0]?.name || '1. Gruppe B';
                HF2.team2 = gruppeA[1]?.name || '2. Gruppe A';
            }
            if (F1) {
                F1.team1 = 'Sieger HF1';
                F1.team2 = 'Sieger HF2';
            }
            await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        }
        return;
    }
    if (teams.length === 9 && standings && typeof standings === 'object' && !Array.isArray(standings)) {
        await updateKOMatches9Teams(standings, matches);
        return;
    }
    if (teams.length === 10 && Array.isArray(standings)) {
        await updateKOMatches10Teams(standings, matches);
        return;
    }
}
// ... existing code ...
// advanceKOMatches: jetzt getrennt für 8, 9, 10 Teams
async function advanceKOMatches() {
    let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
    const teams = await fs.readJson(TEAMS_JSON).catch(() => []);
    if (teams.length === 8) {
        // Nur Finale dynamisch setzen
        const HF1 = matches.ko.find(m => m.id === 'HF1');
        const HF2 = matches.ko.find(m => m.id === 'HF2');
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
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        return;
    }
    if (teams.length === 9) {
        // Nur Finale dynamisch setzen
        const HF1 = matches.ko.find(m => m.id === 'HF1');
        const HF2 = matches.ko.find(m => m.id === 'HF2');
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
        await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
        return;
    }
    if (teams.length === 10) {
        await advanceKOMatches10Teams(matches);
        return;
    }
}
// ... existing code ...

// Hilfsfunktion: Spielzeit und Pausenzeit laden
async function loadSettings() {
    try {
        const settings = await fs.readJson(SETTINGS_JSON);
        if (typeof settings.spielzeit === 'number') SPIELZEIT_MINUTEN = settings.spielzeit;
        if (typeof settings.pausenzeit === 'number') PAUSENZEIT_MINUTEN = settings.pausenzeit;
    } catch (e) {}
}

// Hilfsfunktion: Spielzeit und Pausenzeit speichern
async function saveSettings(newSettings) {
    let settings = {};
    try { settings = await fs.readJson(SETTINGS_JSON); } catch (e) {}
    settings = { ...settings, ...newSettings };
    await fs.writeJson(SETTINGS_JSON, settings, { spaces: 2 });
}

// Hilfsfunktion: Spielplan fortlaufend neu berechnen (Startzeiten, Endzeiten, Pausen)
async function recalculateMatchTimes(matches, startFromMatchId = null) {
    let allMatches = [...matches.vorrunde, ...matches.ko];
    allMatches.sort((a, b) => {
        if (a.phase !== b.phase) return a.phase === 'vorrunde' ? -1 : 1;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    // Wenn keine gezielte Neuberechnung: wie bisher
    if (!startFromMatchId) {
        let currentTime = new Date('2025-07-05T14:00:00');
        for (let i = 0; i < allMatches.length; i++) {
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
            const matchStart = new Date(currentTime);
            const matchEnd = new Date(matchStart.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
            m.startTime = `${matchStart.getHours().toString().padStart(2, '0')}:${matchStart.getMinutes().toString().padStart(2, '0')}`;
            m.endTime = `${matchEnd.getHours().toString().padStart(2, '0')}:${matchEnd.getMinutes().toString().padStart(2, '0')}`;
            currentTime = new Date(matchEnd.getTime());
            const next = allMatches[i + 1];
            if (next && next.phase === 'pause' && (next.id === 'pause1' || next.id === 'pause2' || next.id === 'pause3')) {
                continue;
            }
            if (i === allMatches.length - 1) break;
            currentTime = new Date(currentTime.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
        }
    }
    // Falls gezielte Neuberechnung ab bestimmtem Spiel
    else {
        // Finde Index des geänderten Spiels
        const idx = allMatches.findIndex(m => m.id === startFromMatchId);
        if (idx === -1) return matches;
        // Startzeit für das geänderte Spiel übernehmen
        let currentTime = new Date('2025-07-05T' + allMatches[idx].startTime + ':00');
        // Alle Spiele davor bleiben wie sie sind
        for (let i = idx; i < allMatches.length; i++) {
            let m = allMatches[i];
            if (m.phase === 'pause' && (m.id === 'pause1')) {
                let pauseLen = 20;
                const pauseStart = new Date(currentTime);
                const pauseEnd = new Date(pauseStart.getTime() + pauseLen * 60 * 1000);
                m.startTime = `${pauseStart.getHours().toString().padStart(2, '0')}:${pauseStart.getMinutes().toString().padStart(2, '0')}`;
                m.endTime = `${pauseEnd.getHours().toString().padStart(2, '0')}:${pauseEnd.getMinutes().toString().padStart(2, '0')}`;
                currentTime = new Date(pauseEnd.getTime());
                continue;
            }
            if (m.phase === 'pause' && (m.id === 'pause2' || m.id === 'pause3')) {
                let pauseLen = 10;
                const pauseStart = new Date(currentTime);
                const pauseEnd = new Date(pauseStart.getTime() + pauseLen * 60 * 1000);
                m.startTime = `${pauseStart.getHours().toString().padStart(2, '0')}:${pauseStart.getMinutes().toString().padStart(2, '0')}`;
                m.endTime = `${pauseEnd.getHours().toString().padStart(2, '0')}:${pauseEnd.getMinutes().toString().padStart(2, '0')}`;
                currentTime = new Date(pauseEnd.getTime());
                continue;
            }
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
            const matchStart = new Date(currentTime);
            const matchEnd = new Date(matchStart.getTime() + SPIELZEIT_MINUTEN * 60 * 1000);
            m.startTime = `${matchStart.getHours().toString().padStart(2, '0')}:${matchStart.getMinutes().toString().padStart(2, '0')}`;
            m.endTime = `${matchEnd.getHours().toString().padStart(2, '0')}:${matchEnd.getMinutes().toString().padStart(2, '0')}`;
            currentTime = new Date(matchEnd.getTime());
            const next = allMatches[i + 1];
            if (next && next.phase === 'pause' && (next.id === 'pause1' || next.id === 'pause2' || next.id === 'pause3')) {
                continue;
            }
            if (i === allMatches.length - 1) break;
            currentTime = new Date(currentTime.getTime() + PAUSENZEIT_MINUTEN * 60 * 1000);
        }
    }
    matches.vorrunde = allMatches.filter(m => m.phase === 'vorrunde');
    matches.ko = allMatches.filter(m => m.phase !== 'vorrunde');
    return matches;
}

// API: Spielzeit abfragen
app.get('/api/settings/spielzeit', async (req, res) => {
    await loadSettings();
    res.json({ spielzeit: SPIELZEIT_MINUTEN });
});

// API: Spielzeit setzen (Admin)
app.post('/api/settings/spielzeit', requireAuth, async (req, res) => {
    const { spielzeit } = req.body;
    if (typeof spielzeit !== 'number' || spielzeit < 1 || spielzeit > 60) {
        return res.status(400).json({ success: false, message: 'Ungültige Spielzeit' });
    }
    SPIELZEIT_MINUTEN = spielzeit;
    await saveSettings({ spielzeit });
    resetTimer();
    await saveTimerState();
    // Spielplan neu generieren (Teams bleiben erhalten)
    const teams = await fs.readJson(TEAMS_JSON).catch(() => []);
    let matches = await generateMatches(teams);
    matches = await recalculateMatchTimes(matches);
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    res.json({ success: true });
});

// API: Pausenzeit abfragen
app.get('/api/settings/pausenzeit', async (req, res) => {
    await loadSettings();
    res.json({ pausenzeit: PAUSENZEIT_MINUTEN });
});

// API: Pausenzeit setzen (Admin)
app.post('/api/settings/pausenzeit', requireAuth, async (req, res) => {
    const { pausenzeit } = req.body;
    if (typeof pausenzeit !== 'number' || pausenzeit < 1 || pausenzeit > 60) {
        return res.status(400).json({ success: false, message: 'Ungültige Pausenzeit' });
    }
    PAUSENZEIT_MINUTEN = pausenzeit;
    await saveSettings({ pausenzeit });
    // Spielplan neu generieren (Teams bleiben erhalten)
    const teams = await fs.readJson(TEAMS_JSON).catch(() => []);
    let matches = await generateMatches(teams);
    matches = await recalculateMatchTimes(matches);
    await fs.writeJson(MATCHES_JSON, matches, { spaces: 2 });
    res.json({ success: true });
});

// API: Teams abrufen
app.get('/api/teams', async (req, res) => {
    try {
        const teams = await Team.find().sort({ _id: 1 });
        res.json(teams);
    } catch (error) {
        res.status(500).json({ error: 'Fehler beim Laden der Teams' });
    }
});

// API: Matches abrufen
app.get('/api/matches', async (req, res) => {
    try {
        const all = await Match.find();
        res.json({
            vorrunde: all.filter(m => m.phase === 'vorrunde'),
            ko: all.filter(m => m.phase === 'ko' || m.phase === 'pause')
        });
    } catch (error) {
        res.status(500).json({ error: 'Fehler beim Laden der Matches' });
    }
});

// API: Standings abrufen (jetzt gruppenbasiert für 8/9 Teams)
app.get('/api/standings', async (req, res) => {
    try {
        const standings = await Standing.find();
        res.json(standings);
    } catch (error) {
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
    const { id } = req.params;
    let { score1, score2 } = req.body;
    try {
        // Match aus DB holen
        let match = await Match.findOne({ id });
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
        await match.save();
        // Standings aktualisieren
        await recalculateStandingsMongo();

        // === NEU: KO-Phase automatisch befüllen, wenn Vorrunde/Gruppen abgeschlossen ===
        const teams = await Team.find();
        const allMatches = await Match.find();
        if (teams.length === 10) {
            // Bei 10 Teams: alle Vorrundenspiele müssen abgeschlossen sein
            const vorrundeDone = allMatches.filter(m => m.phase === 'vorrunde').every(m => m.status === 'completed');
            if (vorrundeDone) {
                await updateKOMatchesMongo();
            }
        } else if (teams.length === 8 || teams.length === 9) {
            // Bei 8/9 Teams: alle Gruppenspiele müssen abgeschlossen sein
            // Gruppen werden über das Feld "round" erkannt (z.B. "Gruppe A")
            const gruppen = Array.from(new Set(allMatches.filter(m => m.phase === 'vorrunde' && m.round && m.round.match(/Gruppe ([A-Z])/)).map(m => m.round.match(/Gruppe ([A-Z])/)[1])));
            let allGroupsDone = true;
            for (const gruppe of gruppen) {
                const groupMatches = allMatches.filter(m => m.phase === 'vorrunde' && m.round && m.round.includes(gruppe));
                if (!groupMatches.every(m => m.status === 'completed')) {
                    allGroupsDone = false;
                    break;
                }
            }
            if (allGroupsDone && gruppen.length > 0) {
                await updateKOMatchesMongo();
            }
        }

        // KO-Phase ggf. weiterführen
        if (match.phase === 'ko' && match.status === 'completed') {
            await advanceKOMatchesMongo();
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Fehler beim Speichern', error: error.message });
    }
});

// Zeit-Update (Admin)
app.put('/api/matches/:id/time', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { time, pauseDuration } = req.body;
    try {
        let match = await Match.findOne({ id });
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
        await match.save();

        // === NEU: Spielplan ab diesem Spiel fortlaufend neu berechnen ===
        // Alle Matches laden und in vorrunde/ko gruppieren
        const allMatches = await Match.find();
        const matchesObj = {
            vorrunde: allMatches.filter(m => m.phase === 'vorrunde'),
            ko: allMatches.filter(m => m.phase !== 'vorrunde')
        };
        // Spielplan neu berechnen ab diesem Spiel
        const updated = await recalculateMatchTimes(matchesObj, id);
        // Änderungen in der DB speichern
        for (const m of [...updated.vorrunde, ...updated.ko]) {
            await Match.updateOne({ id: m.id }, { $set: { startTime: m.startTime, endTime: m.endTime, pauseDuration: m.pauseDuration } });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Fehler beim Speichern', error: error.message });
    }
});

// API: Match-Score für einzelnes Team (Admin)
app.post('/api/matches/:id/score', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { team, score } = req.body;
    let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
    
    // Spiel in Vorrunde oder K.o.-Phase finden
    let match = matches.vorrunde.find(m => m.id === id) || matches.ko.find(m => m.id === id);
    if (!match) return res.status(404).json({ message: 'Match nicht gefunden' });
    
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
        
        // Wenn es ein KO-Spiel ist, KO-Phase weiterführen
        if (match.phase === 'ko') {
            await advanceKOMatches();
        }
    }
    
    res.json({ success: true });
});

// API: KO-Phase manuell aktualisieren (Admin)
app.post('/api/ko/update', requireAuth, async (req, res) => {
    try {
        await updateKOMatchesMongo();
        await advanceKOMatchesMongo();
        res.json({ success: true, message: 'KO-Phase aktualisiert' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Aktualisieren der KO-Phase', error: error.message });
    }
});

// API: Teamnamen ändern (Admin)
app.put('/api/teams/:oldName', requireAuth, async (req, res) => {
    const { oldName } = req.params;
    const { newName } = req.body;
    if (!newName || typeof newName !== 'string' || !newName.trim()) {
        return res.status(400).json({ success: false, message: 'Neuer Name fehlt oder ungültig' });
    }
    try {
        // Teams.json aktualisieren
        let teams = await fs.readJson(TEAMS_JSON).catch(() => []);
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
        let matches = await fs.readJson(MATCHES_JSON).catch(() => ({ vorrunde: [], ko: [] }));
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
        let standings = await fs.readJson(STANDINGS_JSON).catch(() => []);
        standings.forEach(t => {
            if (t.name === oldName) t.name = newName;
        });
        await fs.writeJson(STANDINGS_JSON, standings, { spaces: 2 });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Umbenennen', error: error.message });
    }
});

// API: Turnier komplett zurücksetzen (Admin)
app.post('/api/reset', requireAuth, async (req, res) => {
    try {
        // Teams aus MongoDB laden
        const teams = await Team.find().sort({ _id: 1 });
        // Matches generieren
        const matches = await generateMatches(teams);
        // Alte Matches in MongoDB löschen
        await Match.deleteMany({});
        // Neue Matches in MongoDB speichern
        const allMatches = [...(matches.vorrunde || []), ...(matches.ko || [])];
        if (allMatches.length > 0) {
            await Match.insertMany(allMatches);
        }
        // Standings generieren und speichern
        await Standing.deleteMany({});
        const standings = teams.map(t => ({ name: t.name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }));
        if (standings.length > 0) {
            await Standing.insertMany(standings);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Zurücksetzen', error: error.message });
    }
});

// API: Team hinzufügen
app.post('/api/teams', requireAuth, async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Teamname fehlt oder ungültig' });
    }
    try {
        const exists = await Team.findOne({ name });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Teamname existiert bereits' });
        }
        await Team.create({ name });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Hinzufügen', error: error.message });
    }
});

// API: Team entfernen
app.delete('/api/teams/:name', requireAuth, async (req, res) => {
    const { name } = req.params;
    try {
        const result = await Team.deleteOne({ name });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Team nicht gefunden' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Entfernen', error: error.message });
    }
});

// API: Spielzeit (gameDuration) abfragen
app.get('/api/settings/gameDuration', async (req, res) => {
    try {
        const setting = await Setting.findOne({ key: 'gameDuration' });
        res.json({ value: setting ? setting.value : 8 });
    } catch (error) {
        res.status(500).json({ error: 'Fehler beim Laden der Spielzeit' });
    }
});

app.post('/api/settings/gameDuration', requireAuth, async (req, res) => {
    const { value } = req.body;
    if (typeof value !== 'number' || value < 1) {
        return res.status(400).json({ success: false, message: 'Ungültige Spielzeit' });
    }
    try {
        await Setting.findOneAndUpdate(
            { key: 'gameDuration' },
            { value },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fehler beim Speichern', error: error.message });
    }
});

// Serverstart
ensureTeamsJson().then(ensureMatchesAndStandings).then(loadTimerState).then(() => {
    app.listen(PORT, () => {
        console.log(`Backend läuft auf http://localhost:${PORT}`);
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

// MongoDB-Verbindung
mongoose.connect('mongodb+srv://marcm984:v6UwbqiptqxJMYRM@juxturnier.jau1q5e.mongodb.net/?retryWrites=true&w=majority&appName=Juxturnier', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('MongoDB verbunden!');
}).catch(err => {
    console.error('MongoDB Fehler:', err);
});

// Team-Modell
const teamSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }
});
const Team = mongoose.model('Team', teamSchema);

// Einstellungen-Modell
const settingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
});
const Setting = mongoose.model('Setting', settingsSchema);

// Match-Modell
const matchSchema = new mongoose.Schema({
    id: String,
    phase: String,
    round: String,
    team1: String,
    team2: String,
    score1: Number,
    score2: Number,
    status: String,
    startTime: String,
    endTime: String,
    gruppe: String
});
const Match = mongoose.model('Match', matchSchema);

// Standings-Modell
const standingSchema = new mongoose.Schema({
    name: String,
    played: Number,
    won: Number,
    drawn: Number,
    lost: Number,
    goalsFor: Number,
    goalsAgainst: Number,
    points: Number,
    gruppe: String
});
const Standing = mongoose.model('Standing', standingSchema);

// Hilfsfunktionen für Standings und KO-Phase mit MongoDB
async function recalculateStandingsMongo() {
    // Alle Matches laden
    const matches = await Match.find();
    const teams = await Team.find();
    // Standings neu berechnen
    let standings = teams.map(t => ({ name: t.name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }));
    // Nur Vorrunden-/Gruppenspiele zählen!
    matches.filter(m => m.phase === 'vorrunde').forEach(match => {
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
    // Standings in DB ersetzen
    await Standing.deleteMany({});
    await Standing.insertMany(standings);
}

async function updateKOMatchesMongo() {
    // Alle relevanten Daten laden
    const matches = await Match.find();
    const standingsArr = await Standing.find();
    const teams = await Team.find();
    // Gruppierte Standings für 8/9 Teams
    let standings = {};
    if (teams.length === 8 || teams.length === 9) {
        // Gruppieren nach Gruppe, falls vorhanden
        standingsArr.forEach(s => {
            if (s.gruppe) {
                if (!standings[s.gruppe]) standings[s.gruppe] = [];
                standings[s.gruppe].push(s);
            }
        });
    } else {
        standings = standingsArr;
    }
    // 10 Teams: Platzierungen sortieren
    if (teams.length === 10) {
        const sorted = [...standingsArr].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const diffA = a.goalsFor - a.goalsAgainst;
            const diffB = b.goalsFor - b.goalsAgainst;
            if (diffB !== diffA) return diffB - diffA;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return a.name.localeCompare(b.name);
        });
        // KO-Spiele setzen (exakt nach Turnierlogik)
        const koMatches = matches.filter(m => m.phase === 'ko');
        for (const match of koMatches) {
            if (match.id === 'AF1') {
                match.team1 = sorted[6]?.name || 'Platz 7'; // Platz 7
                match.team2 = sorted[9]?.name || 'Platz 10'; // Platz 10
            }
            if (match.id === 'AF2') {
                match.team1 = sorted[7]?.name || 'Platz 8'; // Platz 8
                match.team2 = sorted[8]?.name || 'Platz 9'; // Platz 9
            }
            if (match.id === 'VF1') {
                match.team1 = sorted[2]?.name || 'Platz 3'; // Platz 3
                match.team2 = sorted[5]?.name || 'Platz 6'; // Platz 6
            }
            if (match.id === 'VF2') {
                match.team1 = sorted[3]?.name || 'Platz 4'; // Platz 4
                match.team2 = sorted[4]?.name || 'Platz 5'; // Platz 5
            }
            if (match.id === 'VF3') {
                match.team1 = sorted[1]?.name || 'Platz 2'; // Platz 2
                match.team2 = 'Sieger AF1';
            }
            if (match.id === 'VF4') {
                match.team1 = sorted[0]?.name || 'Platz 1'; // Platz 1
                match.team2 = 'Sieger AF2';
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
            await match.save();
        }
    }
    // 8 Teams: Gruppenplatzierungen setzen
    if (teams.length === 8 && typeof standings === 'object' && !Array.isArray(standings)) {
        const gruppeA = standings['A'] || [];
        const gruppeB = standings['B'] || [];
        const koMatches = matches.filter(m => m.phase === 'ko');
        for (const match of koMatches) {
            if (match.id === 'HF1') {
                match.team1 = gruppeA[0]?.name || '1. Gruppe A';
                match.team2 = gruppeB[1]?.name || '2. Gruppe B';
            }
            if (match.id === 'HF2') {
                match.team1 = gruppeB[0]?.name || '1. Gruppe B';
                match.team2 = gruppeA[1]?.name || '2. Gruppe A';
            }
            if (match.id === 'F1') {
                match.team1 = 'Sieger HF1';
                match.team2 = 'Sieger HF2';
            }
            await match.save();
        }
    }
    // 9 Teams: Gruppenplatzierungen setzen (analog, falls benötigt)
    // ... ggf. weitere Logik für 9 Teams ...
    // 9 Teams: KO-Logik mit Viertelfinale
    if (teams.length === 9 && typeof standings === 'object' && !Array.isArray(standings)) {
        // Gruppen extrahieren
        const gruppeA = standings['A'] || [];
        const gruppeB = standings['B'] || [];
        const gruppeC = standings['C'] || [];
        // 1. und 2. jeder Gruppe
        let viertelfinalisten = [];
        if (gruppeA[0]) viertelfinalisten.push({ ...gruppeA[0], gruppe: 'A', platz: 1 });
        if (gruppeA[1]) viertelfinalisten.push({ ...gruppeA[1], gruppe: 'A', platz: 2 });
        if (gruppeB[0]) viertelfinalisten.push({ ...gruppeB[0], gruppe: 'B', platz: 1 });
        if (gruppeB[1]) viertelfinalisten.push({ ...gruppeB[1], gruppe: 'B', platz: 2 });
        if (gruppeC[0]) viertelfinalisten.push({ ...gruppeC[0], gruppe: 'C', platz: 1 });
        if (gruppeC[1]) viertelfinalisten.push({ ...gruppeC[1], gruppe: 'C', platz: 2 });
        // Alle Gruppendritten sammeln und sortieren
        let dritte = [];
        if (gruppeA[2]) dritte.push({ ...gruppeA[2], gruppe: 'A', platz: 3 });
        if (gruppeB[2]) dritte.push({ ...gruppeB[2], gruppe: 'B', platz: 3 });
        if (gruppeC[2]) dritte.push({ ...gruppeC[2], gruppe: 'C', platz: 3 });
        dritte.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const diffA = a.goalsFor - a.goalsAgainst;
            const diffB = b.goalsFor - b.goalsAgainst;
            if (diffB !== diffA) return diffB - diffA;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return a.name.localeCompare(b.name);
        });
        // Die 2 besten Gruppendritten
        if (dritte[0]) viertelfinalisten.push(dritte[0]);
        if (dritte[1]) viertelfinalisten.push(dritte[1]);
        // Jetzt 8 Teams für das Viertelfinale
        // UEFA-Schema: 1A-2B, 1B-2C, 1C-bester Dritter, 2A-zweitbester Dritter
        // Die besten Dritten werden so verteilt, dass keine Gruppe ein internes Duell hat
        // (vereinfachte Variante, ggf. nachbessern)
        const best3 = dritte[0];
        const second3 = dritte[1];
        // Zuordnung der besten Dritten zu VF3/VF4
        let vf3_team2 = best3?.name || 'Bester Dritter';
        let vf4_team2 = second3?.name || 'Zweitbester Dritter';
        // Falls best3 aus Gruppe C ist, dann 1C vs best3 vermeiden (dann 1C vs second3, 2A vs best3)
        if (best3 && best3.gruppe === 'C' && second3) {
            vf3_team2 = second3.name;
            vf4_team2 = best3.name;
        }
        const koMatches = matches.filter(m => m.phase === 'ko');
        for (const match of koMatches) {
            if (match.id === 'VF1') {
                match.team1 = gruppeA[0]?.name || '1. Gruppe A';
                match.team2 = gruppeB[1]?.name || '2. Gruppe B';
            }
            if (match.id === 'VF2') {
                match.team1 = gruppeB[0]?.name || '1. Gruppe B';
                match.team2 = gruppeC[1]?.name || '2. Gruppe C';
            }
            if (match.id === 'VF3') {
                match.team1 = gruppeC[0]?.name || '1. Gruppe C';
                match.team2 = vf3_team2;
            }
            if (match.id === 'VF4') {
                match.team1 = gruppeA[1]?.name || '2. Gruppe A';
                match.team2 = vf4_team2;
            }
            if (match.id === 'HF1') {
                match.team1 = 'Sieger VF1';
                match.team2 = 'Sieger VF3';
            }
            if (match.id === 'HF2') {
                match.team1 = 'Sieger VF2';
                match.team2 = 'Sieger VF4';
            }
            if (match.id === 'F1') {
                match.team1 = 'Sieger HF1';
                match.team2 = 'Sieger HF2';
            }
            await match.save();
        }
    }
}

async function advanceKOMatchesMongo() {
    // Alle Matches laden
    const matches = await Match.find();
    // Achtelfinale → Viertelfinale, Viertelfinale → Halbfinale, Halbfinale → Finale
    const AF1 = matches.find(m => m.id === 'AF1');
    const AF2 = matches.find(m => m.id === 'AF2');
    const VF3 = matches.find(m => m.id === 'VF3');
    const VF4 = matches.find(m => m.id === 'VF4');
    if (VF3 && AF1 && AF1.status === 'completed') {
        const winnerAF1 = AF1.score1 > AF1.score2 ? AF1.team1 : AF1.team2;
        VF3.team2 = winnerAF1;
        if (VF3.status !== 'completed') VF3.status = 'geplant';
        await VF3.save();
    } else if (VF3 && AF1) {
        VF3.team2 = 'Sieger AF1';
        await VF3.save();
    }
    if (VF4 && AF2 && AF2.status === 'completed') {
        const winnerAF2 = AF2.score1 > AF2.score2 ? AF2.team1 : AF2.team2;
        VF4.team2 = winnerAF2;
        if (VF4.status !== 'completed') VF4.status = 'geplant';
        await VF4.save();
    } else if (VF4 && AF2) {
        VF4.team2 = 'Sieger AF2';
        await VF4.save();
    }
    // Viertelfinale → Halbfinale
    const VF1 = matches.find(m => m.id === 'VF1');
    const VF2 = matches.find(m => m.id === 'VF2');
    const HF1 = matches.find(m => m.id === 'HF1');
    const HF2 = matches.find(m => m.id === 'HF2');
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
        await HF1.save();
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
        await HF2.save();
    }
    // Halbfinale → Finale
    const F1 = matches.find(m => m.id === 'F1');
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
        await F1.save();
    }
}
// ... bestehender Code ...