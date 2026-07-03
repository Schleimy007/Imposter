document.addEventListener('DOMContentLoaded', () => {
    const socket = typeof io !== 'undefined' ? io() : null;

    let currentRoom = null;
    let myName = '';
    let myAvatar = '👽';
    let isHost = false;
    let myRole = null;
    let secretWord = '';
    let categoryHint = '';
    let roundTimer = null;
    let voteTimer = null;

    const screens = {
        start: document.getElementById('screen-start'), lobby: document.getElementById('screen-lobby'),
        role: document.getElementById('screen-role'), game: document.getElementById('screen-game'),
        voting: document.getElementById('screen-voting'), result: document.getElementById('screen-result')
    };

    // --- Custom Modal Logic ---
    function showModal(title, msg) {
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = msg;
        document.getElementById('custom-modal').classList.add('active');
    }
    
    document.getElementById('btn-close-modal').onclick = () => {
        document.getElementById('custom-modal').classList.remove('active');
    };

    // --- Theme Switcher ---
    document.getElementById('btn-theme-gta').onclick = () => setTheme('gta');
    document.getElementById('btn-theme-apple').onclick = () => setTheme('apple');
    
    function setTheme(theme) {
        document.body.className = `theme-${theme}`;
        document.getElementById('btn-theme-gta').classList.toggle('active', theme === 'gta');
        document.getElementById('btn-theme-apple').classList.toggle('active', theme === 'apple');
    }

    // --- Avatar Selection ---
    const avatars = ['👽', '💀', '🤖', '👻', '🤡', '🦊', '🐱', '🦄'];
    const avatarContainer = document.getElementById('avatar-container');
    avatars.forEach(av => {
        const btn = document.createElement('button');
        btn.className = `avatar-btn ${av === myAvatar ? 'selected' : ''}`;
        btn.innerText = av;
        btn.onclick = () => {
            document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            myAvatar = av;
        };
        avatarContainer.appendChild(btn);
    });

    function showScreen(name) {
        Object.values(screens).forEach(s => { 
            s.classList.remove('active'); 
            s.classList.add('hidden'); 
        });
        setTimeout(() => {
            screens[name].classList.remove('hidden'); 
            screens[name].classList.add('active');
        }, 10);
    }

    function smoothDecryption(element, finalWord, isImposter) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let iter = 0;
        element.classList.remove('hidden');
        element.style.color = isImposter ? 'var(--gta-pink)' : 'var(--text-pure)';
        
        const interval = setInterval(() => {
            element.innerText = finalWord.split("").map((letter, i) => {
                if(i < iter) return letter;
                return chars[Math.floor(Math.random() * chars.length)];
            }).join("");
            if(iter >= finalWord.length) clearInterval(interval);
            iter += 1/4;
        }, 30);
    }

    // --- Button Events ---
    document.getElementById('btn-create-room').onclick = () => {
        myName = document.getElementById('player-name').value.trim();
        if(!myName) return showModal("IDENTITÄT FEHLT", "Bitte wähle einen Alias aus, bevor du den Raum erstellst.");
        socket.emit('createRoom', { playerName: myName, avatar: myAvatar });
    };

    document.getElementById('btn-join-room').onclick = () => {
        myName = document.getElementById('player-name').value.trim();
        const code = document.getElementById('room-code-input').value.trim().toUpperCase();
        if(!myName || code.length !== 4) return showModal("DATEN UNVOLLSTÄNDIG", "Bitte überprüfe deinen Alias und stelle sicher, dass der Code 4 Zeichen lang ist.");
        socket.emit('joinRoom', { playerName: myName, avatar: myAvatar, roomCode: code });
    };

    document.getElementById('btn-start-game').onclick = () => {
        const cat = document.getElementById('category-select').value;
        const custom = document.getElementById('custom-word').value.trim();
        socket.emit('startGame', { roomCode: currentRoom, category: cat, customWord: custom });
    };

    document.getElementById('secret-card').onclick = () => {
        if(document.getElementById('secret-card').classList.contains('revealed')) return;
        document.getElementById('secret-card').classList.add('revealed');
        document.getElementById('role-title').innerText = myRole === 'imposter' ? 'STATUS: IMPOSTER' : 'STATUS: CREWMATE';
        
        smoothDecryption(document.getElementById('secret-word'), myRole === 'imposter' ? 'CLASSIFIED' : secretWord, myRole === 'imposter');
        
        if(myRole === 'imposter') {
            document.getElementById('lifesaver-text').classList.remove('hidden');
            document.getElementById('category-hint').innerText = categoryHint;
            
            const fakes = ["Behaupte, du kennst ein ähnliches Wort.", "Warte ab, was die anderen sagen.", "Nutze ein sehr allgemeines Adjektiv."];
            document.getElementById('fake-task-list').innerText = fakes[Math.floor(Math.random()*fakes.length)];
            document.getElementById('fake-tasks').classList.remove('hidden');
        }
        document.getElementById('btn-ready').classList.remove('hidden');
    };

    document.getElementById('btn-ready').onclick = () => {
        socket.emit('playerReady', { roomCode: currentRoom });
        document.getElementById('chat-messages').innerHTML = ''; 
        showScreen('game');
        startTimer(180);
    };

    // --- Chat Logic ---
    const chatInput = document.getElementById('chat-input');
    document.getElementById('btn-send-chat').onclick = sendChat;
    chatInput.onkeypress = (e) => { if(e.key === 'Enter') sendChat(); };
    chatInput.oninput = () => socket.emit('typing', { roomCode: currentRoom });
    
    function sendChat() {
        if(chatInput.value.trim() && myRole !== 'ghost') {
            socket.emit('chatMessage', { roomCode: currentRoom, msg: chatInput.value.trim(), avatar: myAvatar });
            chatInput.value = '';
        }
    }

    let typingTimeout;
    socket.on('playerTyping', () => {
        const ind = document.getElementById('typing-indicator');
        ind.classList.remove('hidden');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => ind.classList.add('hidden'), 2000);
    });

    document.getElementById('btn-end-round').onclick = () => {
        socket.emit('startVoting', { roomCode: currentRoom });
    };

    document.getElementById('btn-skip-vote').onclick = () => submitVote(null);
    document.getElementById('btn-play-again').onclick = () => {
        socket.emit('playAgain', { roomCode: currentRoom });
    };

    // --- Socket Events ---
    if (socket) {
        socket.on('errorMsg', (msg) => {
            showModal("SYSTEM MELDUNG", msg);
        });

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
                list.innerHTML += `<li class="${p.isGhost ? 'ghost-mode' : ''}">
                    <span>${p.avatar} ${p.name} ${p.isHost ? '👑' : ''}</span> 
                    <span class="small-text">SCORE: ${p.score}</span>
                </li>`;
            });
        });

        socket.on('gameStarted', (data) => {
            myRole = data.role; secretWord = data.word; categoryHint = data.category;
            
            document.getElementById('secret-card').classList.remove('revealed');
            document.getElementById('role-title').innerText = 'DECRYPTING...';
            document.getElementById('secret-word').innerText = '***';
            document.getElementById('secret-word').style.color = 'var(--text-pure)';
            document.getElementById('lifesaver-text').classList.add('hidden');
            document.getElementById('fake-tasks').classList.add('hidden');
            document.getElementById('btn-ready').classList.add('hidden');
            
            const isGhost = myRole === 'ghost';
            chatInput.disabled = isGhost;
            document.getElementById('btn-send-chat').disabled = isGhost;
            document.getElementById('btn-end-round').disabled = isGhost;
            document.getElementById('game-status-title').innerText = isGhost ? "SPECTATOR MODE" : "PHASE: DISKUSSION";
            
            showScreen('role');
        });

        socket.on('chatMessage', (data) => {
            const box = document.getElementById('chat-messages');
            if(data.sys) {
                box.innerHTML += `<div class="chat-msg system">${data.msg}</div>`;
            } else {
                box.innerHTML += `<div class="chat-msg"><b>${data.avatar} ${data.sender}:</b> ${data.msg}</div>`;
            }
            box.scrollTop = box.scrollHeight;
        });

        socket.on('votingStarted', (alivePlayers) => {
            clearInterval(roundTimer);
            const list = document.getElementById('voting-list'); list.innerHTML = '';
            document.getElementById('sus-fill').style.width = Math.floor(Math.random() * 60 + 20) + '%'; 
            
            if(myRole === 'ghost') {
                list.innerHTML = '<p class="small-text text-center" style="margin-top: 15px;">GHOSTS KÖNNEN NICHT ABSTIMMEN.</p>';
                document.getElementById('btn-skip-vote').classList.add('hidden');
                startVoteTimer(30, true);
            } else {
                document.getElementById('btn-skip-vote').classList.remove('hidden');
                alivePlayers.forEach(p => {
                    if (p.id !== socket.id) {
                        const btn = document.createElement('button');
                        btn.className = 'clean-btn vote-btn'; 
                        btn.innerText = `VOTE: ${p.avatar} ${p.name}`;
                        btn.onclick = () => submitVote(p.id);
                        list.appendChild(btn);
                    }
                });
                startVoteTimer(30, false);
            }
            showScreen('voting');
        });

        socket.on('gameOver', (data) => {
            clearInterval(voteTimer);
            document.getElementById('result-message').innerText = data.ejectedName ? `${data.ejectedName} WURDE ELIMINIERT.` : 'SKIP. NIEMAND ELIMINIERT.';
            
            const rev = document.getElementById('imposter-reveal');
            if(data.wasImposter) {
                rev.innerText = "IMPOSTER ENTDECKT"; rev.style.color = "var(--text-pure)";
            } else if (data.ejectedName) {
                rev.innerText = "UNSCHULDIG"; rev.style.color = "var(--gta-pink)";
            } else {
                rev.innerText = "IMPOSTER VERBORGEN"; rev.style.color = "var(--gta-pink)";
            }
            
            document.getElementById('reveal-word').innerText = data.word;

            document.getElementById('stats-grid').innerHTML = `
                <div class="stat-box"><span class="small-text">ROUNDS</span><span class="stat-val">${data.totalRounds}</span></div>
                <div class="stat-box"><span class="small-text">WINNER</span><span class="stat-val">${data.wasImposter ? 'CREW' : 'IMPOSTER'}</span></div>
            `;
            showScreen('result');
        });
    }

    function submitVote(targetId) {
        clearInterval(voteTimer);
        document.getElementById('voting-list').innerHTML = '<p class="small-text text-center" style="margin-top: 15px;">STIMME REGISTRIERT. WARTE AUF SERVER...</p>';
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
                if(!isGhost) submitVote(null); 
            }
            timeLeft--;
        }, 1000);
    }
});