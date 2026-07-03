document.addEventListener('DOMContentLoaded', () => {
    const socket = typeof io !== 'undefined' ? io() : null;

    // State
    let currentRoom = null;
    let myName = '';
    let isHost = false;
    let myRole = null; // 'imposter', 'crewmate', 'ghost'
    let secretWord = '';
    let categoryHint = '';
    let roundTimer = null;
    let voteTimer = null;
    let audioCtx = null;

    // Audio Engine (Generiert SFX ohne Dateien)
    function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    function playBeep() {
        if(!audioCtx) return;
        const osc = audioCtx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    }
    function playWush() {
        if(!audioCtx) return;
        const osc = audioCtx.createOscillator(); osc.type = 'triangle'; 
        osc.frequency.setValueAtTime(200, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.3);
        osc.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    }
    function playDrop() {
        if(!audioCtx) return;
        const osc = audioCtx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 1);
        osc.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 1);
    }

    // Screens & UI
    const screens = {
        start: document.getElementById('screen-start'), lobby: document.getElementById('screen-lobby'),
        role: document.getElementById('screen-role'), game: document.getElementById('screen-game'),
        voting: document.getElementById('screen-voting'), result: document.getElementById('screen-result')
    };

    function showScreen(name) {
        Object.values(screens).forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
        screens[name].classList.remove('hidden'); screens[name].classList.add('active');
    }

    // Hacker Animation
    function hackerDecryption(element, finalWord, isImposter) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*!?";
        let iter = 0;
        element.classList.remove('hidden');
        element.style.color = isImposter ? 'var(--neon-red)' : 'var(--neon-cyan)';
        element.style.textShadow = isImposter ? '0 0 10px var(--neon-red)' : '0 0 10px var(--neon-cyan)';
        
        const interval = setInterval(() => {
            element.innerText = finalWord.split("").map((letter, i) => {
                if(i < iter) return letter;
                return chars[Math.floor(Math.random() * chars.length)];
            }).join("");
            if(iter >= finalWord.length) clearInterval(interval);
            iter += 1/3;
        }, 30);
    }

    // UI Events
    document.getElementById('btn-create-room').onclick = () => {
        initAudio(); myName = document.getElementById('player-name').value.trim();
        if(!myName) return alert('Name fehlt!');
        socket.emit('createRoom', { playerName: myName });
    };

    document.getElementById('btn-join-room').onclick = () => {
        initAudio(); myName = document.getElementById('player-name').value.trim();
        const code = document.getElementById('room-code-input').value.trim().toUpperCase();
        if(!myName || code.length !== 4) return alert('Daten unvollständig!');
        socket.emit('joinRoom', { playerName: myName, roomCode: code });
    };

    document.getElementById('btn-start-game').onclick = () => {
        playBeep();
        const cat = document.getElementById('category-select').value;
        const custom = document.getElementById('custom-word').value.trim();
        socket.emit('startGame', { roomCode: currentRoom, category: cat, customWord: custom });
    };

    document.getElementById('secret-card').onclick = () => {
        if(document.getElementById('secret-card').classList.contains('revealed')) return;
        playWush();
        document.getElementById('secret-card').classList.add('revealed');
        document.getElementById('role-title').innerText = myRole === 'imposter' ? 'Du bist der' : 'Dein Wort ist:';
        
        hackerDecryption(document.getElementById('secret-word'), myRole === 'imposter' ? 'IMPOSTER' : secretWord, myRole === 'imposter');
        
        if(myRole === 'imposter') {
            document.getElementById('lifesaver-text').classList.remove('hidden');
            document.getElementById('category-hint').innerText = categoryHint;
        }
        document.getElementById('btn-ready').classList.remove('hidden');
    };

    document.getElementById('btn-ready').onclick = () => {
        playBeep(); socket.emit('playerReady', { roomCode: currentRoom });
        document.getElementById('chat-messages').innerHTML = ''; // Clear chat
        showScreen('game');
        startTimer(180);
    };

    // Chat Logic
    document.getElementById('btn-send-chat').onclick = sendChat;
    document.getElementById('chat-input').onkeypress = (e) => { if(e.key === 'Enter') sendChat(); };
    
    function sendChat() {
        const inp = document.getElementById('chat-input');
        if(inp.value.trim() && myRole !== 'ghost') {
            socket.emit('chatMessage', { roomCode: currentRoom, msg: inp.value.trim() });
            inp.value = '';
        }
    }

    document.getElementById('btn-end-round').onclick = () => {
        playBeep(); socket.emit('startVoting', { roomCode: currentRoom });
    };

    document.getElementById('btn-skip-vote').onclick = () => submitVote(null);
    document.getElementById('btn-play-again').onclick = () => {
        playBeep(); socket.emit('playAgain', { roomCode: currentRoom });
    };

    // Socket Events
    if (socket) {
        socket.on('roomData', (data) => {
            currentRoom = data.roomCode;
            isHost = data.isHost;
            document.getElementById('display-room-code').innerText = currentRoom;
            
            if(isHost) {
                document.getElementById('host-settings').classList.remove('hidden');
                document.getElementById('btn-start-game').classList.remove('hidden');
                document.getElementById('wait-msg').classList.add('hidden');
                document.getElementById('btn-play-again').classList.remove('hidden');
                document.getElementById('result-wait-msg').classList.add('hidden');
            }
            showScreen('lobby');
        });

        socket.on('updatePlayers', (players) => {
            const list = document.getElementById('player-list'); list.innerHTML = '';
            players.forEach(p => {
                list.innerHTML += `<li><span>${p.name} ${p.isHost ? '👑' : ''} ${p.isGhost ? '👻' : ''}</span> <span>🏆 ${p.score}</span></li>`;
            });
        });

        socket.on('gameStarted', (data) => {
            myRole = data.role; secretWord = data.word; categoryHint = data.category;
            
            // Reset Card UI
            document.getElementById('secret-card').classList.remove('revealed');
            document.getElementById('role-title').innerText = 'HACKING...';
            document.getElementById('secret-word').innerText = '***';
            document.getElementById('secret-word').style = '';
            document.getElementById('lifesaver-text').classList.add('hidden');
            document.getElementById('btn-ready').classList.add('hidden');
            
            // Ghost restrictions
            const isGhost = myRole === 'ghost';
            document.getElementById('chat-input').disabled = isGhost;
            document.getElementById('btn-send-chat').disabled = isGhost;
            document.getElementById('btn-end-round').disabled = isGhost;
            document.getElementById('game-status-title').innerText = isGhost ? "Zuschauer-Modus 👻" : "Diskussion";
            
            showScreen('role');
        });

        socket.on('chatMessage', (data) => {
            const box = document.getElementById('chat-messages');
            box.innerHTML += `<div class="chat-msg ${data.sys ? 'system' : ''}"><b>${data.sender}:</b> ${data.msg}</div>`;
            box.scrollTop = box.scrollHeight;
        });

        socket.on('votingStarted', (alivePlayers) => {
            clearInterval(roundTimer); playAlarm();
            const list = document.getElementById('voting-list'); list.innerHTML = '';
            
            if(myRole === 'ghost') {
                list.innerHTML = '<p class="text-center">Ghosts dürfen nicht abstimmen.</p>';
                document.getElementById('btn-skip-vote').classList.add('hidden');
                startVoteTimer(30, true);
            } else {
                document.getElementById('btn-skip-vote').classList.remove('hidden');
                alivePlayers.forEach(p => {
                    if (p.id !== socket.id) {
                        const btn = document.createElement('button');
                        btn.className = 'vote-btn'; btn.innerText = `Stimme für ${p.name}`;
                        btn.onclick = () => submitVote(p.id);
                        list.appendChild(btn);
                    }
                });
                startVoteTimer(30, false);
            }
            showScreen('voting');
        });

        socket.on('gameOver', (data) => {
            clearInterval(voteTimer); playDrop();
            document.getElementById('result-message').innerText = data.ejectedName ? `${data.ejectedName} wurde rausgeworfen.` : 'Niemand wurde rausgeworfen (Skip).';
            
            const rev = document.getElementById('imposter-reveal');
            if(data.wasImposter) {
                rev.innerText = "Ein Imposter wurde erwischt!"; rev.className = "glow-text";
            } else if (data.ejectedName) {
                rev.innerText = "Falsche Wahl! Unschuldig."; rev.className = "glow-red";
            } else {
                rev.innerText = "Die Imposter sind noch da."; rev.className = "glow-red";
            }
            
            document.getElementById('reveal-word').innerText = data.word;
            showScreen('result');
        });

        socket.on('errorMsg', (msg) => alert("Fehler: " + msg));
    }

    function submitVote(targetId) {
        clearInterval(voteTimer);
        document.getElementById('voting-list').innerHTML = '<p class="text-center">Stimme abgegeben...</p>';
        document.getElementById('btn-skip-vote').classList.add('hidden');
        if(socket) socket.emit('submitVote', { roomCode: currentRoom, voteFor: targetId });
    }

    function startTimer(seconds) {
        const display = document.getElementById('timer-display');
        let timeLeft = seconds; clearInterval(roundTimer);
        roundTimer = setInterval(() => {
            let m = Math.floor(timeLeft / 60); let s = timeLeft % 60;
            display.innerText = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
            if (timeLeft <= 0) clearInterval(roundTimer);
            timeLeft--;
        }, 1000);
    }

    function startVoteTimer(seconds, isGhost) {
        const display = document.getElementById('voting-timer');
        let timeLeft = seconds; clearInterval(voteTimer);
        voteTimer = setInterval(() => {
            display.innerText = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(voteTimer);
                if(!isGhost) submitVote(null); // Auto-Skip wenn Zeit abgelaufen
            }
            timeLeft--;
        }, 1000);
    }

    function playAlarm() {
        if(!audioCtx) return;
        let count = 0;
        let int = setInterval(() => {
            const osc = audioCtx.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.1);
            count++; if(count > 4) clearInterval(int);
        }, 200);
    }
});