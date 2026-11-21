const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (useful for Render / Railway)
app.get('/health', (_req, res) => res.json({ status: 'ok', rooms: rooms.size }));

const rooms = new Map();

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function createInitialGameState(p0Name, p1Name) {
  return {
    round: 1,
    maxRounds: 18,
    step: 1, // 1: dealer reveal, 2: contester pick, 3: bettor bet, 4: reveal/result, 5: game over
    players: [
      {
        name: p0Name,
        chips: 10,
        cards: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        dealerDeck: shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        stats: { contesterWins: 0, bettorWins: 0, chipsWon: 0, betsPlaced: 0 }
      },
      {
        name: p1Name,
        chips: 10,
        cards: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        dealerDeck: shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        stats: { contesterWins: 0, bettorWins: 0, chipsWon: 0, betsPlaced: 0 }
      }
    ],
    dealerCard: null,
    contesterCard: null, // Strictly hidden from Bettor until step 4!
    betChoice: null,     // 'BIG' | 'SMALL'
    betAmount: 0,
    lastResult: null,
    history: [],
    winnerIdx: null,     // 0, 1, or -1 for tie
    endReason: null
  };
}

function getRoles(round) {
  const contesterIdx = (round - 1) % 2;
  const bettorIdx = 1 - contesterIdx;
  return { contesterIdx, bettorIdx };
}

/**
 * Build a sanitized view of the room state for a specific player index (0 or 1).
 * SECURITY: Never expose opponent's remaining card values if undesired, and
 * NEVER expose contesterCard to the Bettor before step 4 (reveal).
 */
function buildPlayerView(room, viewerIdx) {
  const g = room.game;
  const { contesterIdx, bettorIdx } = getRoles(g.round);
  const canSeeContesterCard = g.step >= 4 || viewerIdx === contesterIdx;

  return {
    code: room.code,
    status: room.status, // 'waiting' | 'playing' | 'finished'
    youIdx: viewerIdx,
    round: g.round,
    maxRounds: g.maxRounds,
    step: g.step,
    contesterIdx,
    bettorIdx,
    dealerCard: g.dealerCard,
    contesterCardLocked: g.contesterCard !== null,
    contesterCard: canSeeContesterCard ? g.contesterCard : null,
    betChoice: g.betChoice,
    betAmount: g.betAmount,
    lastResult: g.lastResult,
    history: g.history,
    winnerIdx: g.winnerIdx,
    endReason: g.endReason,
    rematchVotes: Array.from(room.rematchVotes),
    players: g.players.map((p, idx) => ({
      name: p.name,
      chips: p.chips,
      cards: p.cards, // Remaining public card pool (both players can track played cards)
      dealerRemaining: p.dealerDeck.length,
      stats: p.stats,
      connected: Boolean(room.sockets[idx])
    }))
  };
}

function broadcastRoom(room) {
  room.sockets.forEach((sock, idx) => {
    if (sock) {
      sock.emit('room_state', buildPlayerView(room, idx));
    }
  });
}

function startDealerStep(room) {
  const g = room.game;
  const { contesterIdx } = getRoles(g.round);
  g.step = 1;
  g.dealerCard = null;
  g.contesterCard = null;
  g.betChoice = null;
  g.betAmount = 0;
  g.lastResult = null;
  broadcastRoom(room);

  // Draw the next card from the Contester's dedicated 1-9 dealer deck
  setTimeout(() => {
    if (!rooms.has(room.code) || room.status !== 'playing') return;
    const deck = g.players[contesterIdx].dealerDeck;
    if (deck.length === 0) return;
    g.dealerCard = deck.pop();
    g.step = 2; // Move to Contester selection
    broadcastRoom(room);
  }, 1100);
}

io.on('connection', (socket) => {
  let currentRoomCode = null;
  let playerIdx = null;

  socket.on('create_room', ({ playerName }) => {
    const name = String(playerName || 'Archmage').trim().slice(0, 18) || 'Archmage';
    const code = generateRoomCode();
    const room = {
      code,
      status: 'waiting',
      sockets: [socket, null],
      names: [name, 'Waiting...'],
      game: createInitialGameState(name, 'Waiting...'),
      rematchVotes: new Set()
    };
    rooms.set(code, room);
    currentRoomCode = code;
    playerIdx = 0;
    socket.join(code);
    socket.emit('room_created', { code, youIdx: 0 });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ code, playerName }) => {
    const cleanCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(cleanCode);
    if (!room) {
      return socket.emit('error_msg', 'Table not found. Check the room code and try again.');
    }
    if (room.sockets[1] && room.sockets[0]) {
      return socket.emit('error_msg', 'This table is already full (2/2 players).');
    }

    const name = String(playerName || 'Challenger').trim().slice(0, 18) || 'Challenger';
    const slot = room.sockets[0] ? 1 : 0;
    room.sockets[slot] = socket;
    room.names[slot] = name;
    currentRoomCode = cleanCode;
    playerIdx = slot;
    socket.join(cleanCode);

    if (room.sockets[0] && room.sockets[1]) {
      room.status = 'playing';
      room.rematchVotes.clear();
      room.game = createInitialGameState(room.names[0], room.names[1]);
      socket.emit('room_joined', { code: cleanCode, youIdx: slot });
      startDealerStep(room);
    } else {
      socket.emit('room_joined', { code: cleanCode, youIdx: slot });
      broadcastRoom(room);
    }
  });

  // STEP 2: Contester secretly selects a card
  socket.on('select_card', ({ cardValue }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'playing') return;
    const g = room.game;
    const { contesterIdx } = getRoles(g.round);

    if (g.step !== 2 || playerIdx !== contesterIdx) {
      return socket.emit('error_msg', 'Not your turn to select a card.');
    }

    const val = Number(cardValue);
    const hand = g.players[contesterIdx].cards;
    const cardPos = hand.indexOf(val);
    if (cardPos === -1) {
      return socket.emit('error_msg', 'That card is no longer available.');
    }

    // Permanently remove used card
    hand.splice(cardPos, 1);
    g.contesterCard = val;
    g.step = 3; // Move to Bettor prediction & wager
    broadcastRoom(room);
  });

  // STEP 3: Bettor predicts BIG/SMALL and places wager
  socket.on('place_bet', ({ choice, amount }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'playing') return;
    const g = room.game;
    const { contesterIdx, bettorIdx } = getRoles(g.round);

    if (g.step !== 3 || playerIdx !== bettorIdx) {
      return socket.emit('error_msg', 'Not your turn to place a bet.');
    }
    if (choice !== 'BIG' && choice !== 'SMALL') {
      return socket.emit('error_msg', 'Invalid prediction. Choose BIG or SMALL.');
    }

    const bettor = g.players[bettorIdx];
    const wager = Math.floor(Number(amount));
    if (!Number.isFinite(wager) || wager < 1 || wager > bettor.chips) {
      return socket.emit('error_msg', `Invalid wager. Choose between 1 and ${bettor.chips} chips.`);
    }

    g.betChoice = choice;
    g.betAmount = wager;
    bettor.stats.betsPlaced += 1;

    // STEP 4: Calculate strictly separated Contester and Bettor scoring
    const cCard = g.contesterCard;
    const dCard = g.dealerCard;
    const contester = g.players[contesterIdx];

    let contesterDelta = 0;
    let bettorDelta = 0;
    let outcome = 'DRAW'; // 'CONTESTER_HIGHER' | 'CONTESTER_LOWER' | 'DRAW'
    let bettorCorrect = null;

    if (cCard > dCard) {
      outcome = 'CONTESTER_HIGHER';
      contesterDelta = cCard - dCard; // Exact formula: Contester card - Dealer card
      contester.stats.contesterWins += 1;
      contester.stats.chipsWon += contesterDelta;

      if (choice === 'BIG') {
        bettorCorrect = true;
        bettorDelta = wager;
        bettor.stats.bettorWins += 1;
        bettor.stats.chipsWon += wager;
      } else {
        bettorCorrect = false;
        bettorDelta = -wager;
      }
    } else if (cCard < dCard) {
      outcome = 'CONTESTER_LOWER';
      contesterDelta = 0;

      if (choice === 'SMALL') {
        bettorCorrect = true;
        bettorDelta = wager;
        bettor.stats.bettorWins += 1;
        bettor.stats.chipsWon += wager;
      } else {
        bettorCorrect = false;
        bettorDelta = -wager;
      }
    } else {
      // Exact Draw: nobody gains chips, Bettor's wager is returned
      outcome = 'DRAW';
      contesterDelta = 0;
      bettorDelta = 0;
      bettorCorrect = null;
    }

    // Apply deltas independently
    contester.chips = Math.max(0, contester.chips + contesterDelta);
    bettor.chips = Math.max(0, bettor.chips + bettorDelta);

    const roundSummary = {
      round: g.round,
      contesterIdx,
      bettorIdx,
      contesterName: contester.name,
      bettorName: bettor.name,
      dealerCard: dCard,
      contesterCard: cCard,
      betChoice: choice,
      betAmount: wager,
      outcome,
      bettorCorrect,
      contesterDelta,
      bettorDelta,
      chipsAfter: [g.players[0].chips, g.players[1].chips]
    };

    g.lastResult = roundSummary;
    g.history.push(roundSummary);
    g.step = 4; // Trigger dramatic countdown & reveal on both clients

    // Check game-end condition (applied when advancing from Step 4 or flagged now)
    if (g.players[0].chips <= 0 || g.players[1].chips <= 0 || g.round >= g.maxRounds) {
      if (g.players[0].chips <= 0 || g.players[1].chips <= 0) {
        g.endReason = 'A player ran out of chips!';
      } else {
        g.endReason = 'All 18 rounds completed!';
      }
      if (g.players[0].chips > g.players[1].chips) g.winnerIdx = 0;
      else if (g.players[1].chips > g.players[0].chips) g.winnerIdx = 1;
      else g.winnerIdx = -1;
    }

    broadcastRoom(room);
  });

  // Advance from Step 4 to Next Round (or Game Over)
  socket.on('next_round', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'playing') return;
    const g = room.game;
    if (g.step !== 4) return;

    if (g.winnerIdx !== null) {
      g.step = 5;
      room.status = 'finished';
      broadcastRoom(room);
      return;
    }

    g.round += 1;
    startDealerStep(room);
  });

  // Quick table emotes
  socket.on('send_emote', ({ text }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || playerIdx === null) return;
    const safe = String(text || '').slice(0, 40);
    io.to(room.code).emit('emote_received', {
      fromIdx: playerIdx,
      fromName: room.names[playerIdx],
      text: safe
    });
  });

  // Rematch vote
  socket.on('request_rematch', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || playerIdx === null) return;
    room.rematchVotes.add(playerIdx);
    if (room.rematchVotes.size === 2 && room.sockets[0] && room.sockets[1]) {
      room.status = 'playing';
      room.rematchVotes.clear();
      room.game = createInitialGameState(room.names[0], room.names[1]);
      startDealerStep(room);
    } else {
      broadcastRoom(room);
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    if (playerIdx !== null) {
      room.sockets[playerIdx] = null;
    }
    const otherIdx = playerIdx === 0 ? 1 : 0;
    if (room.sockets[otherIdx]) {
      room.sockets[otherIdx].emit('opponent_left', {
        name: room.names[playerIdx] || 'Opponent'
      });
      broadcastRoom(room);
    } else {
      rooms.delete(currentRoomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✨ ARCANA GAMBIT Server running on http://localhost:${PORT}\n`);
});
