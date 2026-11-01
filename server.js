import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomInt, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SEATS, SEAT_COLORS } from './shared/board.js';
import { newGameState, applyRoll, applyMove, applyPass, chooseBotMove } from './shared/rules.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.get('/healthz', (_req, res) => res.send('ok'));
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three/build', express.static(path.join(root, 'node_modules/three/build')));
app.use('/vendor/three/addons', express.static(path.join(root, 'node_modules/three/examples/jsm')));

const http = createServer(app);
const io = new Server(http);

/** @type {Map<string, Room>} */
const rooms = new Map();
const ROOM_IDLE_MS = 30 * 60 * 1000;
// Testing aid: AGG_FORCE_ROLLS=6,1,3 makes the die cycle through those values.
const forced = (process.env.AGG_FORCE_ROLLS || '').split(',').map(Number).filter((n) => n >= 1 && n <= 6);
let forcedAt = 0;
const rollDie = () => (forced.length ? forced[forcedAt++ % forced.length] : randomInt(1, 7));
const BOT_NAMES = ['Marbles McGee', 'Captain Clack', 'Dame Dice', 'Sir Rolls-a-lot'];

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do code = Array.from({ length: 4 }, () => letters[randomInt(letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // token -> {token, name, socketId, connected}
    this.seats = Array(SEATS).fill(null); // {token, name, bot}
    this.host = null;
    this.game = null;
    this.timer = null;
    this.chat = [];
    this.touched = Date.now();
  }

  seatOf(token) {
    return this.seats.findIndex((s) => s && s.token === token);
  }

  publicState() {
    return {
      code: this.code,
      seats: this.seats.map((s, i) => s && {
        name: s.name,
        bot: !!s.bot,
        connected: s.bot || !!this.players.get(s.token)?.connected,
        color: SEAT_COLORS[i],
      }),
      spectators: [...this.players.values()].filter((p) => p.connected && this.seatOf(p.token) === -1).map((p) => p.name),
      hostName: this.players.get(this.host)?.name ?? null,
      game: this.game,
      chat: this.chat.slice(-30),
    };
  }

  broadcast() {
    this.touched = Date.now();
    const state = this.publicState();
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      io.to(p.socketId).emit('room', { ...state, you: { seat: this.seatOf(p.token), isHost: p.token === this.host, name: p.name } });
    }
  }

  // Whether the current turn should be played automatically.
  autoTurn() {
    const seat = this.seats[this.game.turn];
    if (!seat) return true;
    return seat.bot || !this.players.get(seat.token)?.connected;
  }

  schedule() {
    clearTimeout(this.timer);
    const g = this.game;
    if (!g || g.phase === 'over') return;
    // Give clients time to animate the last action before acting again.
    const last = g.last;
    const animMs = !last ? 300 : last.type === 'roll' ? 1500 : 450 + 220 * last.path.length + (last.capture ? 700 : 0);
    if (g.phase === 'pass') {
      this.timer = setTimeout(() => { applyPass(g); this.after(); }, animMs + 500);
    } else if (this.autoTurn()) {
      this.timer = setTimeout(() => {
        if (g.phase === 'roll') applyRoll(g, rollDie());
        else if (g.phase === 'move') applyMove(g, chooseBotMove(g).id);
        this.after();
      }, animMs + 250 + randomInt(400));
    }
  }

  after() {
    this.broadcast();
    this.schedule();
  }

  addChat(name, text, system = false) {
    this.chat.push({ name, text: String(text).slice(0, 200), system, t: Date.now() });
    if (this.chat.length > 100) this.chat.shift();
  }
}

io.on('connection', (socket) => {
  // Each browser keeps a random token so it can reconnect to its seat.
  let token = String(socket.handshake.auth?.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) token = randomBytes(16).toString('hex');
  socket.emit('token', token);
  let room = null;

  const fail = (ack, msg) => typeof ack === 'function' && ack({ error: msg });
  const ok = (ack, data = {}) => typeof ack === 'function' && ack({ ok: true, ...data });

  function enter(r, name) {
    if (room && room !== r) leave();
    room = r;
    socket.join(r.code);
    const existing = r.players.get(token);
    if (existing) {
      existing.socketId = socket.id;
      existing.connected = true;
      if (name) existing.name = name;
    } else {
      r.players.set(token, { token, name, socketId: socket.id, connected: true });
      r.addChat(null, `${name} joined`, true);
    }
    const seat = r.seatOf(token);
    if (seat !== -1) r.seats[seat].name = r.players.get(token).name;
    if (!r.host || !r.players.get(r.host)?.connected) r.host = token;
    r.after();
  }

  function leave() {
    const r = room;
    if (!r) return;
    room = null;
    socket.leave(r.code);
    const p = r.players.get(token);
    r.players.delete(token);
    const seat = r.seatOf(token);
    if (seat !== -1) {
      // Mid-game a computer takes over the seat; in the lobby it simply frees up.
      if (r.game && r.game.order.includes(seat)) r.seats[seat] = { token: `bot-${seat}`, name: `${p?.name ?? 'Player'} (bot)`, bot: true };
      else r.seats[seat] = null;
    }
    if (p) r.addChat(null, `${p.name} left`, true);
    if (r.host === token) r.host = [...r.players.values()].find((x) => x.connected)?.token ?? null;
    if (r.players.size === 0) { clearTimeout(r.timer); rooms.delete(r.code); return; }
    r.after();
  }

  socket.on('createRoom', ({ name } = {}, ack) => {
    const r = new Room(newCode());
    rooms.set(r.code, r);
    r.host = token;
    enter(r, cleanName(name));
    const free = r.seats.findIndex((s) => !s);
    r.seats[free] = { token, name: cleanName(name) };
    r.broadcast();
    ok(ack, { code: r.code });
  });

  socket.on('joinRoom', ({ code, name } = {}, ack) => {
    const r = rooms.get(String(code ?? '').toUpperCase().trim());
    if (!r) return fail(ack, 'No room with that code.');
    enter(r, cleanName(name));
    // Seat newcomers automatically while the game hasn't started.
    if (!r.game && r.seatOf(token) === -1) {
      const free = r.seats.findIndex((s) => !s);
      if (free !== -1) { r.seats[free] = { token, name: cleanName(name) }; r.broadcast(); }
    }
    ok(ack, { code: r.code });
  });

  // Inside a room
  const inLobby = () => room && !room.game;
  const isHost = () => room && room.host === token;

  socket.on('sit', ({ seat } = {}, ack) => {
    if (!inLobby()) return fail(ack, 'Game already started.');
    if (!(seat >= 0 && seat < SEATS) || room.seats[seat]) return fail(ack, 'Seat taken.');
    const cur = room.seatOf(token);
    if (cur !== -1) room.seats[cur] = null;
    room.seats[seat] = { token, name: room.players.get(token).name };
    room.broadcast();
    ok(ack);
  });

  socket.on('stand', (_, ack) => {
    if (!inLobby()) return fail(ack, 'Game already started.');
    const cur = room.seatOf(token);
    if (cur !== -1) room.seats[cur] = null;
    room.broadcast();
    ok(ack);
  });

  socket.on('addBot', ({ seat } = {}, ack) => {
    if (!inLobby() || !isHost()) return fail(ack, 'Only the host can add computer players.');
    if (!(seat >= 0 && seat < SEATS) || room.seats[seat]) return fail(ack, 'Seat taken.');
    room.seats[seat] = { token: `bot-${seat}`, name: BOT_NAMES[seat], bot: true };
    room.broadcast();
    ok(ack);
  });

  socket.on('removeSeat', ({ seat } = {}, ack) => {
    if (!inLobby() || !isHost()) return fail(ack, 'Only the host can do that.');
    if (room.seats[seat]?.token === token) return fail(ack, 'Use "stand up" for yourself.');
    room.seats[seat] = null;
    room.broadcast();
    ok(ack);
  });

  socket.on('start', (_, ack) => {
    if (!inLobby() || !isHost()) return fail(ack, 'Only the host can start.');
    const seated = room.seats.map((s, i) => (s ? i : -1)).filter((i) => i !== -1);
    if (seated.length < 2) return fail(ack, 'Need at least 2 players.');
    room.game = newGameState(seated);
    room.addChat(null, 'Game started!', true);
    room.after();
    ok(ack);
  });

  socket.on('roll', (_, ack) => {
    const g = room?.game;
    if (!g || g.phase !== 'roll' || room.seatOf(token) !== g.turn) return fail(ack, 'Not your roll.');
    applyRoll(g, rollDie());
    room.after();
    ok(ack);
  });

  socket.on('move', ({ id } = {}, ack) => {
    const g = room?.game;
    if (!g || g.phase !== 'move' || room.seatOf(token) !== g.turn) return fail(ack, 'Not your move.');
    if (!g.moves.some((m) => m.id === id)) return fail(ack, 'Illegal move.');
    applyMove(g, id);
    room.after();
    ok(ack);
  });

  socket.on('backToLobby', (_, ack) => {
    if (!room?.game || !isHost()) return fail(ack, 'Only the host can do that.');
    if (room.game.phase !== 'over') return fail(ack, 'Game still in progress.');
    clearTimeout(room.timer);
    room.game = null;
    room.after();
    ok(ack);
  });

  socket.on('chat', ({ text } = {}) => {
    if (!room || !String(text ?? '').trim()) return;
    room.addChat(room.players.get(token)?.name ?? '?', String(text).trim());
    room.broadcast();
  });

  socket.on('leave', (_, ack) => { leave(); ok(ack); });

  socket.on('disconnect', () => {
    const r = room;
    if (!r) return;
    const p = r.players.get(token);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      if (r.host === token) r.host = [...r.players.values()].find((x) => x.connected)?.token ?? r.host;
      // Players keep their seat so they can reconnect; mid-game the computer
      // plays for them until they come back.
      r.after();
    }
  });
});

// Drop rooms nobody has touched in a while.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = [...r.players.values()].some((p) => p.connected);
    if (!anyone && now - r.touched > ROOM_IDLE_MS) { clearTimeout(r.timer); rooms.delete(code); }
  }
}, 60 * 1000).unref();

const PORT = Number(process.env.PORT) || 3000;
http.listen(PORT, () => console.log(`Aggravation server listening on http://localhost:${PORT}`));
