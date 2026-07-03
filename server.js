const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ordner "public" für alle Spieler freigeben (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Datenbank für laufende Spiele (Speichert Lobbys und Spieler)
const rooms = {};

// Unsere Wörter-Liste
const wordList = ["Apfel", "Krankenhaus", "Laptop", "Pizza", "Fahrrad", "Schule", "Kino", "Hund", "Kaffee", "Schwimmbad"];

io.on('connection', (socket) => {
    console.log('Ein Spieler hat sich verbunden:', socket.id);

    // 1. Raum erstellen
    socket.on('createRoom', (data) => {
        // Generiere 4-stelligen Code
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        rooms[roomCode] = {
            players: [{ id: socket.id, name: data.playerName, isHost: true }],
            gameActive: false,
            votes: {}
        };
        
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode });
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    // 2. Raum beitreten
    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return socket.emit('errorMsg', 'Raum nicht gefunden!');
        if (room.gameActive) return socket.emit('errorMsg', 'Spiel läuft bereits!');

        room.players.push({ id: socket.id, name: data.playerName, isHost: false });
        socket.join(data.roomCode);
        socket.emit('roomJoined', { roomCode: data.roomCode });
        io.to(data.roomCode).emit('updatePlayers', room.players);
    });

    // 3. Spiel starten
    socket.on('startGame', (data) => {
        const room = rooms[data.roomCode];
        if (!room || room.players.length < 3) {
            return socket.emit('errorMsg', 'Ihr braucht mindestens 3 Spieler!');
        }

        room.gameActive = true;
        room.votes = {}; // Votes zurücksetzen

        // Wort und Imposter auswählen
        const secretWord = wordList[Math.floor(Math.random() * wordList.length)];
        const imposterIndex = Math.floor(Math.random() * room.players.length);
        room.imposterId = room.players[imposterIndex].id;

        // Jedem Spieler seine Rolle heimlich schicken
        room.players.forEach(p => {
            const isImposter = (p.id === room.imposterId);
            io.to(p.id).emit('gameStarted', {
                role: isImposter ? 'imposter' : 'crewmate',
                word: secretWord // Der Imposter bekommt im echten Spiel natürlich nicht das Wort, aber für die Logik der Anzeige schicken wir es mit. In app.js wird es überschrieben!
            });
        });
        
        // Speichere das geheime Wort im Raum für die spätere Auflösung
        room.secretWord = secretWord;
    });

    // 4. Abstimmung starten
    socket.on('startVoting', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            io.to(data.roomCode).emit('votingStarted', room.players);
        }
    });

    // 5. Stimme abgeben
    socket.on('submitVote', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        room.votes[socket.id] = data.voteFor;

        // Haben alle abgestimmt?
        if (Object.keys(room.votes).length === room.players.length) {
            // Stimmen auszählen
            const voteCounts = {};
            Object.values(room.votes).forEach(votedId => {
                voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
            });

            // Wer hat die meisten Stimmen?
            let ejectedId = Object.keys(voteCounts).reduce((a, b) => voteCounts[a] > voteCounts[b] ? a : b);
            let ejectedPlayer = room.players.find(p => p.id === ejectedId);
            let wasImposter = (ejectedId === room.imposterId);

            io.to(data.roomCode).emit('gameOver', {
                ejectedName: ejectedPlayer.name,
                wasImposter: wasImposter,
                word: room.secretWord
            });
            
            room.gameActive = false;
        }
    });

    // 6. Neue Runde (Zurück in die Lobby)
    socket.on('playAgain', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            io.to(data.roomCode).emit('roomJoined', { roomCode: data.roomCode });
            io.to(data.roomCode).emit('updatePlayers', room.players);
        }
    });

    // Spieler verlässt das Spiel (Verbindung bricht ab)
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                io.to(code).emit('updatePlayers', room.players);
                // Wenn der Raum leer ist, löschen wir ihn
                if (room.players.length === 0) delete rooms[code];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft! Öffne http://localhost:${PORT} in deinem Browser.`);
});