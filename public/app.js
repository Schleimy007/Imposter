document.addEventListener('DOMContentLoaded', () => {
    // ==================== 1. VARIABLEN & SETUP ====================
    // Verbindung zum (späteren) Server aufbauen
    // (Wird einen Fehler werfen, wenn kein Server läuft - das ist okay für den Moment!)
    const socket = typeof io !== 'undefined' ? io() : null;

    // Spiel-Status speichern
    let currentRoom = null;
    let myName = '';
    let isHost = false;
    let myRole = null;
    let secretWord = '';
    let roundTimer = null;

    // ==================== 2. DOM ELEMENTE SAMMELN ====================
    // Screens
    const screens = {
        start: document.getElementById('screen-start'),
        lobby: document.getElementById('screen-lobby'),
        role: document.getElementById('screen-role'),
        game: document.getElementById('screen-game'),
        voting: document.getElementById('screen-voting'),
        result: document.getElementById('screen-result')
    };

    // Inputs & Buttons
    const inputName = document.getElementById('player-name');
    const inputRoom = document.getElementById('room-code-input');
    const btnCreate = document.getElementById('btn-create-room');
    const btnJoin = document.getElementById('btn-join-room');
    const btnStartGame = document.getElementById('btn-start-game');
    const secretCard = document.getElementById('secret-card');
    const btnReady = document.getElementById('btn-ready');
    const btnEndRound = document.getElementById('btn-end-round');
    const btnPlayAgain = document.getElementById('btn-play-again');

    // ==================== 3. HILFSFUNKTIONEN ====================
    // Wechselt geschmeidig zwischen den Bildschirmen
    function showScreen(screenName) {
        Object.values(screens).forEach(screen => {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        });
        screens[screenName].classList.remove('hidden');
        screens[screenName].classList.add('active');
    }

    // Zeigt Benachrichtigungen an (z.B. wenn Code falsch ist)
    function showError(msg) {
        alert("Fehler: " + msg); // Später können wir das durch ein cooles UI-Popup ersetzen
    }

    // ==================== 4. UI EVENT LISTENERS (Klicks) ====================
    
    // Raum erstellen (Host)
    btnCreate.addEventListener('click', () => {
        myName = inputName.value.trim();
        if (!myName) return showError('Bitte gib einen Namen ein!');
        if (socket) socket.emit('createRoom', { playerName: myName });
    });

    // Raum beitreten
    btnJoin.addEventListener('click', () => {
        myName = inputName.value.trim();
        const code = inputRoom.value.trim().toUpperCase();
        if (!myName) return showError('Bitte gib einen Namen ein!');
        if (code.length !== 4) return showError('Code muss 4 Zeichen haben!');
        if (socket) socket.emit('joinRoom', { playerName: myName, roomCode: code });
    });

    // Spiel aus der Lobby heraus starten
    btnStartGame.addEventListener('click', () => {
        if (socket && currentRoom) socket.emit('startGame', { roomCode: currentRoom });
    });

    // Karte antippen um Rolle zu sehen
    secretCard.addEventListener('click', () => {
        secretCard.classList.add('revealed');
        document.getElementById('role-title').innerText = myRole === 'imposter' ? 'Du bist der' : 'Das geheime Wort ist';
        document.getElementById('secret-word').innerText = myRole === 'imposter' ? 'IMPOSTER' : secretWord;
        document.getElementById('secret-word').classList.remove('hidden');
        
        if (myRole === 'imposter') {
            document.getElementById('secret-word').style.color = 'var(--neon-red)';
            document.getElementById('secret-word').style.textShadow = '0 0 10px var(--neon-red)';
        }

        btnReady.classList.remove('hidden');
    });

    // Spieler ist bereit nach dem Kartenlesen
    btnReady.addEventListener('click', () => {
        if (socket) socket.emit('playerReady', { roomCode: currentRoom });
        showScreen('game');
        startTimer(180); // 3 Minuten Timer
    });

    // Abstimmung einleiten
    btnEndRound.addEventListener('click', () => {
        clearInterval(roundTimer);
        if (socket) socket.emit('startVoting', { roomCode: currentRoom });
    });

    // Neue Runde
    btnPlayAgain.addEventListener('click', () => {
        if (socket) socket.emit('playAgain', { roomCode: currentRoom });
    });


    // ==================== 5. SOCKET EVENTS (Antworten vom Server) ====================
    if (socket) {
        // Wenn Raum erfolgreich erstellt wurde
        socket.on('roomCreated', (data) => {
            currentRoom = data.roomCode;
            isHost = true;
            document.getElementById('display-room-code').innerText = currentRoom;
            btnStartGame.classList.remove('hidden'); // Host darf starten
            showScreen('lobby');
        });

        // Wenn Raum erfolgreich betreten wurde
        socket.on('roomJoined', (data) => {
            currentRoom = data.roomCode;
            document.getElementById('display-room-code').innerText = currentRoom;
            showScreen('lobby');
        });

        // Wenn jemand der Lobby beitritt oder sie verlässt
        socket.on('updatePlayers', (players) => {
            const list = document.getElementById('player-list');
            list.innerHTML = ''; // Liste leeren
            players.forEach(p => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${p.name}</span> ${p.isHost ? '👑' : ''}`;
                list.appendChild(li);
            });
        });

        // Server sagt: Spiel geht los!
        socket.on('gameStarted', (data) => {
            myRole = data.role;
            secretWord = data.word;
            
            // Karte zurücksetzen
            secretCard.classList.remove('revealed');
            document.getElementById('role-title').innerText = 'Tippen zum Aufdecken';
            document.getElementById('secret-word').classList.add('hidden');
            document.getElementById('secret-word').style = ''; // Styles resetten
            btnReady.classList.add('hidden');
            
            showScreen('role');
        });

        // Server sagt: Es wird abgestimmt!
        socket.on('votingStarted', (players) => {
            clearInterval(roundTimer);
            const list = document.getElementById('voting-list');
            list.innerHTML = '';
            
            players.forEach(p => {
                if (p.name !== myName) { // Man kann nicht für sich selbst stimmen
                    const btn = document.createElement('button');
                    btn.className = 'vote-btn';
                    btn.innerText = `Stimme für ${p.name}`;
                    btn.onclick = () => {
                        socket.emit('submitVote', { roomCode: currentRoom, voteFor: p.id });
                        list.innerHTML = '<p class="text-center">Stimme abgegeben. Warte auf andere...</p>';
                    };
                    list.appendChild(btn);
                }
            });
            showScreen('voting');
        });

        // Server verkündet das Ergebnis
        socket.on('gameOver', (data) => {
            document.getElementById('result-message').innerText = `${data.ejectedName} wurde rausgeworfen.`;
            const revealText = document.getElementById('imposter-reveal');
            
            if (data.wasImposter) {
                revealText.innerText = "Er war der Imposter! Die Crew gewinnt.";
                revealText.style.color = "var(--neon-cyan)";
            } else {
                revealText.innerText = "Er war unschuldig! Der Imposter gewinnt.";
                revealText.style.color = "var(--neon-red)";
            }
            
            document.getElementById('reveal-word').innerText = data.word;
            showScreen('result');
        });

        // Server meldet einen Fehler
        socket.on('errorMsg', (msg) => {
            showError(msg);
        });
    }

    // ==================== 6. TIMER LOGIK ====================
    function startTimer(seconds) {
        const display = document.getElementById('timer-display');
        let timeLeft = seconds;
        
        clearInterval(roundTimer);
        roundTimer = setInterval(() => {
            let m = Math.floor(timeLeft / 60);
            let s = timeLeft % 60;
            display.innerText = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
            
            if (timeLeft <= 0) {
                clearInterval(roundTimer);
                display.innerText = "00:00";
            }
            timeLeft--;
        }, 1000);
    }
});