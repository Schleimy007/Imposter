const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

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
        rooms[roomCode] = { players: [], gameActive: false, votes: {}, imposters: [], roundCount: 0 };
        
        rooms[roomCode].players.push({ id: socket.id, name: data.playerName, avatar: data.avatar, isHost: true, score: 0, isGhost: false });
        socket.join(roomCode);
        socket.emit('roomData', { roomCode, isHost: true });
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return socket.emit('errorMsg', 'Der Raum existiert nicht oder der Code ist falsch.');
        
        const isGhost = room.gameActive; 
        room.players.push({ id: socket.id, name: data.playerName, avatar: data.avatar, isHost: false, score: 0, isGhost: isGhost });
        
        socket.join(data.roomCode);
        socket.emit('roomData', { roomCode: data.roomCode, isHost: false });
        io.to(data.roomCode).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;
        const activePlayers = room.players.filter(p => !p.isGhost);
        
        // BEHOBEN: Hier wird jetzt direkt eine saubere Warnung an den Host gesendet.
        if (activePlayers.length < 3) {
            return socket.emit('errorMsg', 'Es werden mindestens 3 Spieler benötigt, um das Spiel zu starten!');
        }

        room.gameActive = true; room.votes = {}; room.imposters = []; room.roundCount++;
        
        let finalWord = data.customWord;
        let finalCat = "CUSTOM DATA";

        if(!finalWord) {
            let catKeys = Object.keys(dictionary);
            finalCat = (data.category === "Zufall") ? catKeys[Math.floor(Math.random() * catKeys.length)] : data.category;
            let words = dictionary[finalCat];
            finalWord = words[Math.floor(Math.random() * words.length)];
        }
        room.secretWord = finalWord;

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
        
        io.to(data.roomCode).emit('chatMessage', { sys: true, sender: 'System', msg: 'VERBINDUNG HERGESTELLT. CHAT AKTIV.' });
    });

    socket.on('typing', (data) => {
        socket.to(data.roomCode).emit('playerTyping');
    });

    socket.on('chatMessage', (data) => {
        const room = rooms[data.roomCode];
        if(room) {
            const player = room.players.find(p => p.id === socket.id);
            if(player && !player.isGhost) {
                io.to(data.roomCode).emit('chatMessage', { sys: false, sender: player.name, avatar: player.avatar, msg: data.msg });
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
                if(ejectedPlayer) ejectedPlayer.isGhost = true; 
                
                if(wasImposter) {
                    room.players.forEach(p => { if(!room.imposters.includes(p.id) && !p.isGhost) p.score += 1; }); 
                } else {
                    room.imposters.forEach(impId => { let imp = room.players.find(p => p.id === impId); if(imp) imp.score += 2; }); 
                }
            }

            io.to(data.roomCode).emit('gameOver', {
                ejectedName: ejectedPlayer ? ejectedPlayer.name : null,
                wasImposter: wasImposter, 
                word: room.secretWord,
                totalRounds: room.roundCount
            });
            room.gameActive = false;
        }
    });

    socket.on('playAgain', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            room.players.forEach(p => p.isGhost = false);
            io.to(data.roomCode).emit('roomData', { roomCode: data.roomCode, isHost: false });
            const host = room.players.find(p=>p.isHost);
            if(host) io.to(host.id).emit('roomData', { roomCode: data.roomCode, isHost: true }); 
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));