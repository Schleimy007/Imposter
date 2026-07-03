const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 10 Kategorien, 100 Wörter
const dictionary = {
    "Tiere": ["Elefant", "Pinguin", "Känguru", "Schlange", "Papagei", "Delfin", "Krokodil", "Fledermaus", "Faultier", "Eisbär"],
    "Essen": ["Pizza", "Sushi", "Hamburger", "Spaghetti", "Pfannkuchen", "Döner", "Schokolade", "Käse", "Eiscreme", "Salat"],
    "Technik": ["Smartphone", "Laptop", "Kopfhörer", "Drohne", "Fernseher", "Tastatur", "Smartwatch", "Drucker", "Router", "Kamera"],
    "Berufe": ["Arzt", "Lehrer", "Polizist", "Feuerwehrmann", "Astronaut", "Koch", "Pilot", "Programmierer", "Anwalt", "Friseur"],
    "Sport": ["Fußball", "Tennis", "Schwimmen", "Basketball", "Boxen", "Klettern", "Skifahren", "Volleyball", "Golf", "Tauchen"],
    "Filme & Serien": ["Titanic", "Star Wars", "Harry Potter", "Matrix", "Avengers", "Herr der Ringe", "Jurassic Park", "Avatar", "Inception", "Batman"],
    "Geografie": ["Eiffelturm", "Mount Everest", "Sahara", "Nordpol", "Grand Canyon", "Amazonas", "Pyramiden", "Freiheitsstatue", "Vulkan", "Insel"],
    "Zuhause": ["Sofa", "Bett", "Kühlschrank", "Badewanne", "Spiegel", "Teppich", "Staubsauger", "Mikrowelle", "Zahnbürste", "Balkon"],
    "Fahrzeuge": ["Fahrrad", "Hubschrauber", "U-Boot", "Traktor", "Motorrad", "Flugzeug", "Kreuzfahrtschiff", "Bagger", "Zug", "Rakete"],
    "Kleidung": ["Socken", "Jeans", "Jacke", "Schuhe", "Mütze", "Schal", "Handschuhe", "Gürtel", "Sonnenbrille", "Unterhose"]
};

const rooms = {};

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = { players: [], gameActive: false, votes: {}, imposters: [] };
        
        rooms[roomCode].players.push({ id: socket.id, name: data.playerName, isHost: true, score: 0, isGhost: false });
        socket.join(roomCode);
        socket.emit('roomData', { roomCode, isHost: true });
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return socket.emit('errorMsg', 'Raum nicht gefunden!');
        
        const isGhost = room.gameActive; // Später Beigetretene sind direkt Ghosts
        room.players.push({ id: socket.id, name: data.playerName, isHost: false, score: 0, isGhost: isGhost });
        
        socket.join(data.roomCode);
        socket.emit('roomData', { roomCode: data.roomCode, isHost: false });
        io.to(data.roomCode).emit('updatePlayers', room.players);
        
        if(isGhost) socket.emit('errorMsg', 'Spiel läuft schon. Du schaust als Ghost zu!');
    });

    socket.on('startGame', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;
        const activePlayers = room.players.filter(p => !p.isGhost);
        if (activePlayers.length < 3) return socket.emit('errorMsg', 'Mindestens 3 Spieler benötigt!');

        room.gameActive = true; room.votes = {}; room.imposters = [];
        
        // Wortauswahl Logik
        let finalWord = data.customWord;
        let finalCat = "Eigenes Wort";

        if(!finalWord) {
            let catKeys = Object.keys(dictionary);
            finalCat = (data.category === "Zufall") ? catKeys[Math.floor(Math.random() * catKeys.length)] : data.category;
            let words = dictionary[finalCat];
            finalWord = words[Math.floor(Math.random() * words.length)];
        }
        room.secretWord = finalWord;

        // Double Trouble (2 Imposter ab 7 Spielern)
        let numImposters = activePlayers.length > 6 ? 2 : 1;
        let shuffled = activePlayers.sort(() => 0.5 - Math.random());
        for(let i=0; i<numImposters; i++) room.imposters.push(shuffled[i].id);

        room.players.forEach(p => {
            if(p.isGhost) {
                io.to(p.id).emit('gameStarted', { role: 'ghost', word: finalWord, category: finalCat });
            } else {
                const isImp = room.imposters.includes(p.id);
                io.to(p.id).emit('gameStarted', { role: isImp ? 'imposter' : 'crewmate', word: finalWord, category: finalCat });
            }
        });
        
        io.to(data.roomCode).emit('chatMessage', { sys: true, sender: 'System', msg: 'Die Runde beginnt. Wer ist sus?' });
    });

    socket.on('chatMessage', (data) => {
        const room = rooms[data.roomCode];
        if(room) {
            const player = room.players.find(p => p.id === socket.id);
            if(player && !player.isGhost) {
                io.to(data.roomCode).emit('chatMessage', { sys: false, sender: player.name, msg: data.msg });
            }
        }
    });

    socket.on('startVoting', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            const alive = room.players.filter(p => !p.isGhost);
            io.to(data.roomCode).emit('votingStarted', alive);
        }
    });

    socket.on('submitVote', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        // null = Skip
        room.votes[socket.id] = data.voteFor;

        const aliveCount = room.players.filter(p => !p.isGhost).length;
        if (Object.keys(room.votes).length === aliveCount) {
            
            const voteCounts = {};
            Object.values(room.votes).forEach(v => { if(v) voteCounts[v] = (voteCounts[v] || 0) + 1; });

            let ejectedId = null; let maxVotes = 0; let tie = false;
            for(let vid in voteCounts) {
                if(voteCounts[vid] > maxVotes) { maxVotes = voteCounts[vid]; ejectedId = vid; tie = false; }
                else if (voteCounts[vid] === maxVotes) { tie = true; }
            }

            let ejectedPlayer = null; let wasImposter = false;
            
            if(ejectedId && !tie) {
                ejectedPlayer = room.players.find(p => p.id === ejectedId);
                wasImposter = room.imposters.includes(ejectedId);
                if(ejectedPlayer) ejectedPlayer.isGhost = true; // Stirbt und wird Ghost
                
                // Score System
                if(wasImposter) {
                    room.players.forEach(p => { if(!room.imposters.includes(p.id) && !p.isGhost) p.score += 1; }); // Crew +1
                } else {
                    room.imposters.forEach(impId => { let imp = room.players.find(p => p.id === impId); if(imp) imp.score += 2; }); // Imposter +2
                }
            }

            io.to(data.roomCode).emit('gameOver', {
                ejectedName: ejectedPlayer ? ejectedPlayer.name : null,
                wasImposter: wasImposter, word: room.secretWord
            });
            room.gameActive = false;
        }
    });

    socket.on('playAgain', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            // Tote werden wieder lebendig
            room.players.forEach(p => p.isGhost = false);
            io.to(data.roomCode).emit('roomData', { roomCode: data.roomCode, isHost: false }); // Löst UI reset bei Crew aus
            const host = room.players.find(p=>p.isHost);
            if(host) io.to(host.id).emit('roomData', { roomCode: data.roomCode, isHost: true }); // Gibt Host die Buttons
            io.to(data.roomCode).emit('updatePlayers', room.players);
        }
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                io.to(code).emit('updatePlayers', room.players);
                if (room.players.length === 0) delete rooms[code];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}!`));