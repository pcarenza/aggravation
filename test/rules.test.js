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

const shortcuts = (s, roll, i = 0) => legalMoves(s, 0, roll).filter((m) => m.i === i && m.kind !== 'step');
const at = (seat, p) => (absIndex(0, p) - startIndex(seat) + 56) % 56; // seat's progress for seat 0's hole p

test('star hops from a star', () => {
  const s = game();
  s.marbles[0] = [6, BASE, BASE, BASE];
  assert.deepEqual(legalMoves(s, 0, 3).map((m) => m.to).sort((a, b) => a - b), [9, 48], 'forward or hop');
  assert.deepEqual(shortcuts(s, 3)[0].path, [20, 34, 48]);
  assert.equal(shortcuts(s, 4).length, 0, 'cannot hop past exit star');
  s.marbles[2] = [at(2, 20), BASE, BASE, BASE];
  assert.equal(shortcuts(s, 3).length, 0, 'cannot hop over an opponent');
  assert.deepEqual(shortcuts(s, 1)[0].capture, { seat: 2, i: 0 });
});

const dests = (moves) => moves.map((m) => m.to).sort((a, b) => a - b);

test('a move that reaches a star part-way may continue as a shortcut', () => {
  const s = game();
  s.marbles[0] = [4, BASE, BASE, BASE];
  // Roll 4: 2 steps to the star at 6, then 2 left: hop two stars, or cross the centre.
  const m = shortcuts(s, 4);
  assert.deepEqual(dests(m), [20, 34, 48], 'each destination offered once');
  assert.deepEqual(m.find((x) => x.to === 34).path, [5, 6, 20, 34], 'star hop wins the tie for 34');
  assert.deepEqual(m.find((x) => x.to === 48).path, [5, 6, CENTER, 48]);
  assert.deepEqual(dests(legalMoves(s, 0, 3)), [7, 20], 'forward, or 1 hop');
  s.marbles[2] = [at(2, 5), BASE, BASE, BASE];
  assert.equal(shortcuts(s, 4).length, 0, 'blocked on the way to the star');
});

test('centre: exactly 2 from a corner reaches any corner further clockwise, never stops', () => {
  // Corners in owner progress: 6 = "6 o'clock", 20 = 9, 34 = 12, 48 = 3 (before home).
  const s = game();
  s.marbles[0] = [6, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 2).filter((m) => m.kind !== 'step')), [20, 34, 48], 'from 6: 9, 12 or 3');
  s.marbles[0] = [20, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 2).filter((m) => m.kind !== 'step')), [34, 48], 'from 9: 12 or 3');
  s.marbles[0] = [34, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 2)), [36, 48], 'from 12: forward or 3, never back');
  assert.deepEqual(legalMoves(s, 0, 2).find((m) => m.to === 48).path, [CENTER, 48]);
  s.marbles[0] = [48, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 2)), [50], 'no shortcut from the 3 o\'clock corner');
  s.marbles[0] = [34, BASE, BASE, BASE];
  assert.ok(legalMoves(s, 0, 1).every((m) => m.to !== CENTER), 'cannot stop in the centre');
  assert.ok(legalMoves(s, 0, 3).every((m) => m.kind !== 'center'), 'needs exactly 2');
  // Own marble on a corner rules it out; an opponent there is captured.
  s.marbles[0] = [6, 20, 59, 58];
  s.marbles[2] = [at(2, 48), BASE, BASE, BASE];
  const c = legalMoves(s, 0, 2).filter((m) => m.i === 0 && m.kind === 'center');
  assert.deepEqual(dests(c), [34, 48], 'centre route passes the blocked 9 o\'clock corner');
  assert.deepEqual(c.find((m) => m.to === 48).capture, { seat: 2, i: 0 });
});

test('one space before a corner, a 3 gives the centre choices', () => {
  const s = game();
  s.marbles[0] = [5, BASE, BASE, BASE];
  assert.deepEqual(dests(legalMoves(s, 0, 3)), [8, 20, 34, 48]);
});

test('win when all four are home', () => {
  const s = game();
  s.marbles[0] = [57, 58, 59, 55];
  applyRoll(s, 1);
  applyMove(s, s.moves[0].id);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
});
