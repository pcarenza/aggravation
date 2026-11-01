// Pure game rules. The server owns state and calls these functions; nothing
// here touches the network or the DOM, so it is easy to unit test.
import {
  BASE, CENTER, EXIT_STAR, FIRST_HOME, LAST_HOME, MARBLES_PER_PLAYER,
  STAR_PROGRESS, holeKey,
} from './board.js';

export function newGameState(seats) {
  // seats: array of seat numbers taking part, e.g. [0, 2]
  const order = [...seats].sort((a, b) => a - b);
  const marbles = {};
  for (const s of order) marbles[s] = Array(MARBLES_PER_PLAYER).fill(BASE);
  return {
    order, // seats in turn order
    marbles, // seat -> [progress x4]
    turn: order[Math.floor(Math.random() * order.length)],
    phase: 'roll', // 'roll' | 'move' | 'over'
    die: null,
    moves: [],
    winner: null,
    seq: 0,
    last: null, // last action, used by clients to animate
  };
}

// Map of holeKey -> {seat, i} for every marble on the board.
function occupancy(state) {
  const occ = new Map();
  for (const s of state.order) {
    state.marbles[s].forEach((p, i) => {
      const k = holeKey(s, p);
      if (k) occ.set(k, { seat: s, i });
    });
  }
  return occ;
}

// All legal moves for `seat` with die value `roll`.
// Each move: { id, i, to, path:[progress...], kind, capture:{seat,i}|null }
export function legalMoves(state, seat, roll) {
  const occ = occupancy(state);
  const occupied = (p) => occ.has(holeKey(seat, p));
  const moves = [];
  const add = (i, path, kind) => {
    const to = path[path.length - 1];
    const hit = occ.get(holeKey(seat, to));
    if (hit && hit.seat === seat) return; // can never land on your own marble
    moves.push({ i, to, path, kind, capture: hit ? { seat: hit.seat, i: hit.i } : null });
  };

  state.marbles[seat].forEach((p, i) => {
    if (p === BASE) {
      if (roll === 1 || roll === 6) add(i, [0], 'enter');
      return;
    }
    // Ordinary move along the track / into the home row. No marble may be
    // jumped: any marble (yours or an opponent's) in the way blocks the move.
    if (p + roll <= LAST_HOME) {
      const path = [];
      for (let k = 1; k <= roll; k++) path.push(p + k);
      if (!path.slice(0, -1).some(occupied)) add(i, path, p + roll >= FIRST_HOME && p < FIRST_HOME ? 'home' : 'step');
    }
    // Shortcut through the centre. If the move reaches a corner star (the
    // marble starts on it, or gets there part-way along the track) with
    // exactly 2 pips left, it may cut through the centre (one pip; never a
    // stopping place) to any corner further clockwise (the second pip), up to
    // the player's exit corner. Corner-to-corner moves must go through the
    // centre, and the no-jump rule applies to every hole on the way.
    const q = p + roll - 2; // the corner the marble would leave the track at
    if (roll >= 2 && STAR_PROGRESS.includes(q) && q < EXIT_STAR) {
      const lead = [];
      for (let k = p + 1; k <= q; k++) lead.push(k);
      if (!lead.some(occupied) && !occupied(CENTER)) {
        for (const star of STAR_PROGRESS) if (star > q) add(i, [...lead, CENTER, star], 'center');
      }
    }
  });
  moves.forEach((m, id) => (m.id = id));
  return moves;
}

const nextSeat = (state, seat) => state.order[(state.order.indexOf(seat) + 1) % state.order.length];

// Roll for the current player. Returns the new state (mutates in place).
export function applyRoll(state, value) {
  if (state.phase !== 'roll') throw new Error('Not time to roll');
  state.die = value;
  state.moves = legalMoves(state, state.turn, value);
  state.seq++;
  state.last = { type: 'roll', seat: state.turn, value, seq: state.seq, noMoves: state.moves.length === 0 };
  state.phase = state.moves.length ? 'move' : 'pass';
  return state;
}

// When a roll produced no legal moves the server calls this after a short pause.
export function applyPass(state) {
  if (state.phase !== 'pass') throw new Error('Nothing to pass');
  endTurn(state);
  return state;
}

export function applyMove(state, moveId) {
  if (state.phase !== 'move') throw new Error('Not time to move');
  const m = state.moves.find((x) => x.id === moveId);
  if (!m) throw new Error('Illegal move');
  const seat = state.turn;
  const from = state.marbles[seat][m.i];
  state.marbles[seat][m.i] = m.to;
  if (m.capture) state.marbles[m.capture.seat][m.capture.i] = BASE;
  state.seq++;
  state.last = { type: 'move', seat, i: m.i, from, path: m.path, kind: m.kind, capture: m.capture, seq: state.seq };
  if (state.marbles[seat].every((p) => p >= FIRST_HOME && p <= LAST_HOME)) {
    state.phase = 'over';
    state.winner = seat;
    state.moves = [];
    return state;
  }
  endTurn(state);
  return state;
}

function endTurn(state) {
  // Rolling a 6 earns another roll.
  if (state.die !== 6) state.turn = nextSeat(state, state.turn);
  state.phase = 'roll';
  state.moves = [];
}

// Simple computer player: prefer finishing, capturing, escaping base, then
// shortcuts, then advancing the marble furthest behind it in danger.
export function chooseBotMove(state) {
  const seat = state.turn;
  let best = null;
  let bestScore = -Infinity;
  for (const m of state.moves) {
    const from = state.marbles[seat][m.i];
    let score = 0;
    if (m.to >= FIRST_HOME && m.to <= LAST_HOME) score += 50 + m.to;
    if (m.capture) score += 40;
    if (m.kind === 'enter') score += 30;
    const gain = m.to - (from === BASE ? 0 : from);
    if (m.kind === 'center' && gain > 0) score += 25;
    score += gain;
    score += Math.random() * 3;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
