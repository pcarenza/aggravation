import { BoardView } from './scene.js';
import { SEATS, SEAT_COLORS, FIRST_HOME, BASE } from '/shared/board.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const board = new BoardView($('stage'));
// The token is read on every (re)connect: a first-time visitor only receives
// theirs after connecting, and must send it back if the connection drops.
// In the Android app the page is served locally and AGG_SERVER names the
// hosted game server; on the website it is unset and we use our own origin.
const SERVER = window.AGG_SERVER || '';
const SITE = SERVER || `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`.replace(/\/$/, '');
const socketOpts = { auth: (cb) => cb({ token: store.get('token') }) };
// The app connects cross-origin: start with a WebSocket (not subject to CORS)
// and only fall back to long-polling, which needs the server's CORS setting.
if (SERVER) socketOpts.transports = ['websocket', 'polling'];
const socket = SERVER ? io(SERVER, socketOpts) : io(socketOpts);

// Native extras when running inside the Android app (no-ops on the web).
const native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
const buzz = (style = 'MEDIUM') => { try { native?.Haptics?.impact({ style }); } catch {} };
const keepAwake = (on) => { try { on ? native?.KeepAwake?.keepAwake() : native?.KeepAwake?.allowSleep(); } catch {} };
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __board: board, __socket: socket }); // for automated tests
socket.on('token', (t) => store.set('token', t));

let room = null; // latest room state from the server
let shown = null; // the game state currently drawn on the board
let viewSeat = -2;
let gameoverDismissed = false;
const queue = [];
let busy = false;
let wantRoom = false; // true while we are (trying to be) in a room
let inRoomScreen = false;

// --------------------------------------------------------------- screens --
function screen(name) {
  $('welcome').hidden = name !== 'welcome';
  $('lobby').hidden = name !== 'lobby';
  $('hud').hidden = name !== 'game';
  $('toolbar').hidden = name === 'welcome';
  for (const b of document.querySelectorAll('#toolbar .game-only')) b.hidden = name !== 'game';
  inRoomScreen = name !== 'welcome';
  keepAwake(name === 'game');
  layoutChat();
}

$('name').value = store.get('name') || '';
const urlCode = new URLSearchParams(location.search).get('room');
if (urlCode) $('code').value = urlCode.toUpperCase();
screen('welcome');

function emit(ev, data, errEl) {
  return new Promise((resolve) => {
    socket.emit(ev, data, (res) => {
      if (res?.error) {
        if (errEl) errEl.textContent = res.error;
        else toast(res.error);
      } else if (errEl) errEl.textContent = '';
      resolve(res);
    });
  });
}

function myName() {
  const n = $('name').value.trim();
  if (n) store.set('name', n);
  return n;
}

$('create').onclick = async () => {
  sfx.unlock();
  if (!myName()) return ($('welcome-error').textContent = 'Please enter your name first.');
  wantRoom = true;
  const res = await emit('createRoom', { name: myName() }, $('welcome-error'));
  if (res?.ok) joined(res.code);
  else wantRoom = false;
};
async function join() {
  sfx.unlock();
  if (!myName()) return ($('welcome-error').textContent = 'Please enter your name first.');
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) return ($('welcome-error').textContent = 'Room codes are 4 letters.');
  wantRoom = true;
  const res = await emit('joinRoom', { code, name: myName() }, $('welcome-error'));
  if (res?.ok) joined(res.code);
  else wantRoom = false;
}
$('join').onclick = join;
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && join());

function joined(code) {
  store.set('room', code);
  history.replaceState(null, '', `?room=${code}`);
}

function leave() {
  wantRoom = false;
  socket.emit('leave');
  store.set('room', null);
  history.replaceState(null, '', location.pathname);
  room = null;
  shown = null;
  queue.length = 0;
  board.clearMoves();
  board.setMarbles(null);
  $('gameover').hidden = true;
  clearChat();
  screen('welcome');
}
$('leave').onclick = leave;
$('btn-quit').onclick = () => { if (confirm('Leave this game? A computer player will take your seat.')) leave(); };

// Rejoin automatically after a refresh or a dropped connection.
socket.on('connect', () => {
  const code = store.get('room');
  const name = store.get('name');
  if (code && name && (!urlCode || urlCode.toUpperCase() === code)) {
    wantRoom = true;
    emit('joinRoom', { code, name }).then((res) => {
      if (!res?.ok) { wantRoom = false; store.set('room', null); screen('welcome'); }
    });
  }
});
socket.on('disconnect', () => { toast('Connection lost — reconnecting…'); renderConnection(); });
// The free server sleeps when idle; the first connection can take up to a minute.
let connectFailures = 0;
function renderConnection() {
  const up = socket.connected;
  $('create').disabled = $('join').disabled = !up;
  $('conn').textContent = up ? ''
    : connectFailures > 12 ? "Can't reach the game server. Check your internet connection; still retrying…"
    : connectFailures ? 'Waking up the game server… this can take up to a minute.'
    : 'Connecting to the game server…';
}
socket.on('connect', () => { connectFailures = 0; renderConnection(); });
socket.on('connect_error', () => { connectFailures++; renderConnection(); });
renderConnection();

// ----------------------------------------------------------------- lobby --
$('copy-link').onclick = async () => {
  const url = `${SITE}/?room=${room.code}`;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
  catch { prompt('Share this link:', url); }
};
$('start').onclick = () => emit('start', null, $('lobby-error'));
$('again').onclick = () => emit('backToLobby');
$('gameover-close').onclick = () => { gameoverDismissed = true; $('gameover').hidden = true; };

function renderLobby() {
  const you = room.you;
  $('room-code').textContent = room.code;
  const ul = $('seats');
  ul.replaceChildren();
  room.seats.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="--c:${SEAT_COLORS[i].hex}"></span><span class="who"></span>`;
    const who = li.querySelector('.who');
    if (s) {
      who.textContent = s.name;
      if (s.bot) li.insertAdjacentHTML('beforeend', '<span class="tag">computer</span>');
      else if (!s.connected) li.insertAdjacentHTML('beforeend', '<span class="tag">away</span>');
      if (i === you.seat) {
        li.insertAdjacentHTML('beforeend', '<span class="tag">you</span>');
        li.append(btn('Stand up', () => emit('stand', null, $('lobby-error'))));
      } else if (you.isHost) {
        li.append(btn('Remove', () => emit('removeSeat', { seat: i }, $('lobby-error'))));
      }
    } else {
      who.textContent = `${SEAT_COLORS[i].name} — open`;
      who.classList.add('empty');
      li.append(btn(you.seat === -1 ? 'Sit here' : 'Move here', () => emit('sit', { seat: i }, $('lobby-error'))));
      if (you.isHost) li.append(btn('+ Computer', () => emit('addBot', { seat: i }, $('lobby-error'))));
    }
    ul.append(li);
  });
  $('spectators').textContent = room.spectators.length ? `Watching: ${room.spectators.join(', ')}` : '';
  const seated = room.seats.filter(Boolean).length;
  $('start').hidden = !you.isHost;
  $('start').disabled = seated < 2;
  $('lobby-hint').textContent = you.isHost
    ? seated < 2 ? 'Share the code with friends, or add computer players. You need at least 2 players.' : ''
    : `Waiting for ${room.hostName ?? 'the host'} to start the game…`;
}

function btn(label, fn) {
  const b = document.createElement('button');
  b.className = 'small';
  b.textContent = label;
  b.onclick = fn;
  return b;
}

// ------------------------------------------------------------------ game --
const nameOf = (seat) => room?.seats[seat]?.name ?? SEAT_COLORS[seat].name;
const isMine = (seat) => room && room.you.seat === seat;
const label = (seat) => (isMine(seat) ? 'You' : nameOf(seat));

function renderPlayers(g) {
  const el = $('players');
  el.replaceChildren();
  for (const s of g.order) {
    const seat = room.seats[s];
    const home = (g.marbles[s] ?? []).filter((p) => p >= FIRST_HOME && p !== 100).length;
    const div = document.createElement('div');
    div.className = 'pl' + (g.turn === s && g.phase !== 'over' ? ' turn' : '') + (seat && !seat.connected ? ' off' : '');
    div.innerHTML = `<span class="dot" style="--c:${SEAT_COLORS[s].hex}"></span><span class="name"></span><span class="home">${home}/4 home</span>`;
    div.querySelector('.name').textContent = (isMine(s) ? '★ ' : '') + (seat?.name ?? '?') + (seat?.bot ? ' 🤖' : seat && !seat.connected ? ' (away)' : '');
    el.append(div);
  }
}

function renderStatus(g) {
  const mine = isMine(g.turn);
  let msg;
  if (g.phase === 'over') msg = `${label(g.winner)} won!`;
  else if (g.phase === 'roll') msg = mine ? (g.last?.type === 'roll' && g.last.value === 6 && g.last.seat === g.turn ? 'Six! Roll again' : 'Your turn — roll the die') : `${nameOf(g.turn)} is rolling…`;
  else if (g.phase === 'move') msg = mine ? `You rolled ${g.die} — pick a marble` : `${nameOf(g.turn)} rolled ${g.die}…`;
  else if (g.phase === 'pass') msg = `${label(g.turn)} rolled ${g.die} — no moves`;
  $('status').textContent = msg;
  const canRoll = mine && g.phase === 'roll';
  if (canRoll && !board.canRoll) buzz('LIGHT'); // it just became your turn
  $('roll').disabled = !canRoll;
  board.canRoll = canRoll;
}

// ------------------------------------------------------------------ chat --
// One feed holds chat messages, join/leave notices and game events.
const chatState = { code: null, lastId: 0, unread: 0, open: false, peekTimer: null };
const compact = window.matchMedia('(max-width: 900px)');
try { chatState.open = store.get('chatOpen') !== '0' && !compact.matches; } catch {}

function addLine(node) {
  const log = $('log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.append(node);
  while (log.children.length > 150) log.firstChild.remove();
  if (atBottom || node.classList.contains('mine')) log.scrollTop = log.scrollHeight;
}

function addLog(html) {
  const div = document.createElement('div');
  div.className = 'ev';
  div.innerHTML = html;
  addLine(div);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const who = (seat) => `<span class="mini" style="--c:${SEAT_COLORS[seat].hex}"></span>${esc(label(seat))}`;

function addChatMessage(m, live) {
  if (m.id <= chatState.lastId) return;
  chatState.lastId = m.id;
  const div = document.createElement('div');
  if (m.system) {
    div.className = 'sys';
    div.textContent = m.text;
    addLine(div);
    return;
  }
  const mine = room && m.seat !== -1 ? m.seat === room.you.seat && m.name === room.you.name : m.name === store.get('name');
  div.className = 'msg' + (mine ? ' mine' : '');
  const dot = document.createElement('span');
  dot.className = 'mini';
  if (m.seat >= 0) dot.style.setProperty('--c', SEAT_COLORS[m.seat].hex);
  const name = document.createElement('b');
  name.textContent = `${m.name}: `;
  div.append(dot, name, document.createTextNode(m.text));
  addLine(div);
  if (live && !mine) notifyChat(m);
}

function notifyChat(m) {
  if (chatState.open && !document.hidden) return;
  chatState.unread++;
  renderUnread();
  sfx.pop();
  const peek = $('chat-peek');
  peek.textContent = `${m.name}: ${m.text}`;
  peek.hidden = false;
  clearTimeout(chatState.peekTimer);
  chatState.peekTimer = setTimeout(() => (peek.hidden = true), 4500);
}

function renderUnread() {
  const u = $('unread');
  u.hidden = !chatState.unread;
  u.textContent = chatState.unread > 9 ? '9+' : chatState.unread;
}

function setChatOpen(open) {
  chatState.open = open;
  if (!compact.matches) store.set('chatOpen', open ? '1' : '0');
  if (open) { chatState.unread = 0; renderUnread(); $('chat-peek').hidden = true; }
  layoutChat();
  if (open) $('log').scrollTop = $('log').scrollHeight;
}

function layoutChat() {
  const show = inRoomScreen && chatState.open;
  $('chatbox').hidden = !show;
  // On wide screens the chat is docked at the right; keep the board clear of it.
  board.setRightInset(show && !compact.matches ? $('chatbox').offsetWidth + 24 : 0);
}

function clearChat() {
  $('log').replaceChildren();
  chatState.lastId = 0;
  chatState.unread = 0;
  chatState.code = null;
  renderUnread();
  $('chat-peek').hidden = true;
}

socket.on('chatHistory', ({ code, messages }) => {
  if (!wantRoom) return;
  if (code !== chatState.code) { clearChat(); chatState.code = code; }
  for (const m of messages) addChatMessage(m, false);
});
socket.on('chat', (m) => { if (wantRoom) addChatMessage(m, true); });

function sendChat(text) {
  text = text.trim();
  if (!text) return;
  emit('chat', { text });
}
$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  sendChat($('chat').value);
  $('chat').value = '';
};
for (const r of ['😈', '😂', '😱', '👍', 'Nooo!', 'GG']) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = r;
  b.onclick = () => sendChat(r);
  $('reactions').append(b);
}
$('btn-chat').onclick = () => setChatOpen(!chatState.open);
$('chat-close').onclick = () => setChatOpen(false);
$('chat-peek').onclick = () => setChatOpen(true);
$('chat').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur(); });
compact.addEventListener('change', () => { if (compact.matches) setChatOpen(false); else layoutChat(); });

let toastTimer;
function toast(text, ms = 1600) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function roll() {
  if (!board.canRoll) return;
  sfx.unlock();
  board.canRoll = false;
  $('roll').disabled = true;
  emit('roll');
}
$('roll').onclick = roll;
board.onRollClick = roll;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); roll(); }
});

for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => $(b.dataset.open).showModal();
$('btn-view').onclick = () => board.setViewSeat(Math.max(0, room?.you.seat ?? 0));
const soundIcon = () => ($('btn-sound').textContent = sfx.muted ? '🔇' : '🔊');
soundIcon();
$('btn-sound').onclick = () => { sfx.muted = !sfx.muted; soundIcon(); };

// Describe an action in the log and with a toast where it matters.
function narrate(g) {
  const l = g.last;
  if (!l) return;
  if (l.type === 'roll') {
    addLog(`${who(l.seat)} rolled <b>${l.value}</b>${l.noMoves ? ' — no moves' : ''}`);
  } else if (l.type === 'move') {
    if (l.kind === 'enter') addLog(`${who(l.seat)} brought a marble out`);
    if (l.kind === 'center') addLog(`${who(l.seat)} cut across the centre!`);
    if (l.kind === 'home') addLog(`${who(l.seat)} moved a marble home`);
    if (l.capture) {
      addLog(`${who(l.seat)} aggravated ${who(l.capture.seat)}!`);
      if (isMine(l.capture.seat)) { toast(`${nameOf(l.seat)} aggravated you!`); buzz('HEAVY'); }
      else if (isMine(l.seat)) toast('Aggravated! 😈');
      else toast(`${nameOf(l.seat)} aggravated ${nameOf(l.capture.seat)}!`);
    }
  }
}

// Show the board for a game state, animating from the previous one if possible.
async function present(next) {
  const g = next.game;
  room = next;

  if (!g) {
    shown = null;
    gameoverDismissed = false;
    $('gameover').hidden = true;
    board.clearMoves();
    // Show seated players' marbles waiting in their bases.
    const m = {};
    next.seats.forEach((s, i) => { if (s) m[i] = Array(4).fill(BASE); });
    board.setMarbles(m);
    setView(next.you.seat);
    renderLobby();
    screen('lobby');
    return;
  }

  screen('game');
  setView(next.you.seat);
  if (shown && g.seq === shown.seq + 1 && g.last) {
    board.clearMoves();
    if (g.last.type === 'roll') {
      $('status').textContent = `${label(g.last.seat)} ${isMine(g.last.seat) ? 'roll' : 'rolls'}…`;
      await board.rollDie(g.last.value);
      if (g.last.value === 6 && !g.last.noMoves) toast(isMine(g.last.seat) ? 'Six! You go again after this' : 'Six!', 1200);
    } else {
      await board.animateMove(g.last);
    }
    narrate(g);
  } else if (!shown || g.seq !== shown.seq) {
    board.setMarbles(g.marbles);
    if (g.die) board.dieValue = g.die;
  }
  shown = g;
  renderPlayers(g);
  renderStatus(g);

  if (g.phase === 'move' && isMine(g.turn)) board.showMoves(g.moves, g.turn, (id) => emit('move', { id }));
  else board.clearMoves();

  if (g.phase === 'over') {
    if ($('gameover').hidden && !gameoverDismissed) {
      $('winner').textContent = isMine(g.winner) ? 'You won! 🎉' : `${nameOf(g.winner)} wins!`;
      $('gameover-sub').textContent = room.you.isHost ? 'Head back to the lobby to play again.' : 'Waiting for the host to start another round.';
      $('again').hidden = !room.you.isHost;
      $('gameover').hidden = false;
      sfx.chime();
    }
  } else {
    gameoverDismissed = false;
    $('gameover').hidden = true;
  }
}

function setView(seat) {
  const s = Math.max(0, seat);
  if (s !== viewSeat) { viewSeat = s; board.setViewSeat(s); }
}

socket.on('room', (r) => {
  if (!wantRoom) return; // we left
  queue.push(r);
  pump();
});

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const next = queue.shift();
      // Skip stale non-animating snapshots: only the newest one matters.
      if (queue.length && next.game && queue[0].game && next.game.seq === queue[0].game.seq && (!shown || next.game.seq === shown.seq)) {
        room = next;
        continue;
      }
      await present(next);
    }
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
  }
}
