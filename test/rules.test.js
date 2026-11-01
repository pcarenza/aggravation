import test from 'node:test';
import assert from 'node:assert/strict';
import { newGameState, legalMoves, applyRoll, applyMove, applyPass } from '../shared/rules.js';
import { BASE, CENTER, TRACK, HOMES, absIndex, startIndex, homeEntryIndex, isStarIndex, STAR_PROGRESS } from '../shared/board.js';

const game = (seats = [0, 2]) => { const s = newGameState(seats); s.turn = seats[0]; return s; };

test('board geometry is consistent', () => {
  assert.equal(TRACK.length, 56);
  const keys = new Set(TRACK.map((p) => p.join(',')));
  assert.equal(keys.size, 56, 'track holes are unique');
  for (let i = 0; i < 56; i++) {
    const [a, b] = [TRACK[i], TRACK[(i + 1) % 56]];
    assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, `holes ${i} and ${i + 1} are adjacent`);
  }
  for (let s = 0; s < 4; s++) {
    assert.equal(absIndex(s, 55), homeEntryIndex(s));
    const [ex, ey] = TRACK[homeEntryIndex(s)];
    const [hx, hy] = HOMES[s][0];
    assert.equal(Math.abs(ex - hx) + Math.abs(ey - hy), 1, 'home row starts next to home entry');
    for (const p of STAR_PROGRESS) assert.ok(isStarIndex(absIndex(s, p)));
    assert.equal(absIndex(s, 0), startIndex(s));
  }
});

test('need 1 or 6 to leave base', () => {
  const s = game();
  for (const r of [2, 3, 4, 5]) assert.equal(legalMoves(s, 0, r).length, 0);
  assert.equal(legalMoves(s, 0, 1).length, 4);
  assert.equal(legalMoves(s, 0, 6).length, 4);
});

test('no move passes the turn, six rolls again', () => {
  const s = game();
  applyRoll(s, 3);
  assert.equal(s.phase, 'pass');
  applyPass(s);
  assert.equal(s.turn, 2);
  applyRoll(s, 6);
  applyMove(s, s.moves[0].id);
  assert.equal(s.turn, 2, 'six gives another roll');
  assert.equal(s.phase, 'roll');
});

test('no marble can be jumped; can land on opponents', () => {
  const s = game();
  s.marbles[0] = [0, 3, BASE, BASE];
  let m = legalMoves(s, 0, 5).filter((x) => x.i === 0);
  assert.equal(m.length, 0, 'blocked by own marble at 3');
  m = legalMoves(s, 0, 3).filter((x) => x.i === 0);
  assert.equal(m.length, 0, 'cannot land on own marble');
  // Opponent (seat 2) sits two holes ahead of seat 0's marble at 3.
  s.marbles[0] = [3, BASE, BASE, BASE];
  s.marbles[2] = [(absIndex(0, 5) - startIndex(2) + 56) % 56, BASE, BASE, BASE];
  m = legalMoves(s, 0, 4);
  assert.equal(m.length, 0, 'cannot jump an opponent');
  m = legalMoves(s, 0, 2);
  assert.deepEqual(m[0].capture, { seat: 2, i: 0 });
  applyRoll(s, 2);
  applyMove(s, s.moves[0].id);
  assert.equal(s.marbles[2][0], BASE, 'captured marble goes home to base');
});

test('entering onto start captures an opponent sitting there', () => {
  const s = game();
  s.marbles[2] = [(startIndex(0) - startIndex(2) + 56) % 56, BASE, BASE, BASE];
  const m = legalMoves(s, 0, 6);
  assert.deepEqual(m[0].capture, { seat: 2, i: 0 });
});

test('home row needs exact count', () => {
  const s = game();
  s.marbles[0] = [54, BASE, BASE, BASE];
  assert.equal(legalMoves(s, 0, 5)[0].to, 59);
  assert.equal(legalMoves(s, 0, 6).filter((m) => m.i === 0).length, 0);
  s.marbles[0] = [54, 58, BASE, BASE];
  assert.equal(legalMoves(s, 0, 5).filter((m) => m.i === 0).length, 0, 'cannot pass own marble in home');
});

const at = (seat, p) => (absIndex(0, p) - startIndex(seat) + 56) % 56; // seat's progress for seat 0's hole p
const dests = (moves) => moves.map((m) => m.to).sort((a, b) => a - b);
const centre = (s, roll, i = 0) => legalMoves(s, 0, roll).filter((m) => m.i === i && m.kind === 'center');
// Corners in owner progress: 6 = "6 o'clock", 20 = 9, 34 = 12, 48 = 3 (before home).

test('no hopping straight from corner to corner', () => {
  const s = game();
  s.marbles[0] = [6, BASE, BASE, BASE];
  for (const r of [1, 3, 4, 5]) {
    assert.deepEqual(dests(legalMoves(s, 0, r).filter((m) => m.i === 0)), [6 + r], `roll ${r}: only the normal move`);
  }
});

test('centre: exactly 2 from a corner reaches any corner further clockwise', () => {
  const s = game();
  s.marbles[0] = [6, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 2)), [8, 20, 34, 48], 'from 6: forward, or 9, 12, 3');
  assert.deepEqual(centre(s, 2).find((m) => m.to === 34).path, [CENTER, 34], 'always through the centre');
  s.marbles[0] = [20, BASE, BASE, BASE];
  assert.deepEqual(dests(centre(s, 2)), [34, 48], 'from 9: 12 or 3');
  s.marbles[0] = [34, BASE, BASE, BASE];
  assert.deepEqual(dests(centre(s, 2)), [48], 'from 12: 3 only, never back');
  s.marbles[0] = [48, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 2)), [50], "no shortcut from the 3 o'clock corner");
  s.marbles[0] = [20, BASE, BASE, BASE];
  assert.ok(legalMoves(s, 0, 1).every((m) => m.to !== CENTER), 'cannot stop in the centre');
});

test('reaching a corner part-way with exactly 2 left', () => {
  const s = game();
  s.marbles[0] = [5, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 3)), [8, 20, 34, 48], 'one before a corner, roll 3');
  assert.deepEqual(centre(s, 3).find((m) => m.to === 20).path, [6, CENTER, 20]);
  s.marbles[0] = [2, BASE, BASE, BASE];
  assert.deepEqual(dests(centre(s, 6)), [20, 34, 48], 'four before a corner, roll 6');
  assert.deepEqual(dests(centre(s, 5)), [], '3 left at the corner is not a shortcut');
  s.marbles[2] = [at(2, 6), BASE, BASE, BASE];
  assert.deepEqual(dests(centre(s, 6)), [], 'a marble on the corner blocks the way in');
  s.marbles[2] = [at(2, 4), BASE, BASE, BASE];
  assert.deepEqual(dests(centre(s, 6)), [], 'a marble before the corner blocks it too');
});

test('centre landing: own marble rules a corner out, an opponent is captured', () => {
  const s = game();
  s.marbles[0] = [6, 20, 59, 58];
  s.marbles[2] = [at(2, 48), BASE, BASE, BASE];
  const c = centre(s, 2);
  assert.deepEqual(dests(c), [34, 48], "own marble on 9 o'clock rules it out (and is not jumped: the route is via the centre)");
  assert.deepEqual(c.find((m) => m.to === 48).capture, { seat: 2, i: 0 });
});

test('win when all four are home', () => {
  const s = game();
  s.marbles[0] = [57, 58, 59, 55];
  applyRoll(s, 1);
  applyMove(s, s.moves[0].id);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
});
