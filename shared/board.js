// Board geometry shared by the server (rules) and the client (rendering).
// Coordinates are in "hole units" on a grid; the board centre is (0, 0),
// +x is east, +y is north (towards the far side of the board for seat 0).
//
// Layout: a cross-shaped track of 56 holes, 14 per arm. Each seat owns one arm:
//   seat 0 = south, seat 1 = west, seat 2 = north, seat 3 = east.
// Marbles travel clockwise (seen from above), so turn order follows the same way.

export const TRACK_LEN = 56;
export const ARM_LEN = 14;
export const HOME_LEN = 4;
export const MARBLES_PER_PLAYER = 4;
export const SEATS = 4;

// Progress values for a single marble, relative to its owner:
//   -1        in base
//   0..55     on the track (0 = start hole, 55 = the hole in front of home)
//   56..59    in the home row
// CENTER is never a resting place; it only appears in move paths when a
// marble cuts through the middle from one star to the opposite star.
export const BASE = -1;
export const LAST_TRACK = TRACK_LEN - 1; // 55
export const FIRST_HOME = TRACK_LEN; // 56
export const LAST_HOME = TRACK_LEN + HOME_LEN - 1; // 59
export const CENTER = 100;

// Shortcut ("star") holes sit at the four inner corners of the cross.
// In owner-relative progress they are at 6, 20, 34 and 48. 48 is the
// owner's exit star, the last star before their home row; shortcuts never
// go beyond it.
export const STAR_PROGRESS = [6, 20, 34, 48];
export const EXIT_STAR = 48;

export const SEAT_COLORS = [
  { name: 'Red', hex: '#d32222' },
  { name: 'Blue', hex: '#1f5fd6' },
  { name: 'Green', hex: '#169a3c' },
  { name: 'Yellow', hex: '#f2c21b' },
];

// Rotate a point by k quarter-turns clockwise (seen from above).
function rot([x, y], k) {
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, y] = [y, -x];
  return [x, y];
}

// The south arm in travel order, starting at the south-east star hole.
const SOUTH_ARM = [
  [1, -1], // star (inner corner)
  [1, -2], [1, -3], [1, -4], [1, -5], [1, -6],
  [1, -7], [0, -7], [-1, -7], // tip; [0,-7] is the home entry, [-1,-7] is start
  [-1, -6], [-1, -5], [-1, -4], [-1, -3], [-1, -2],
];
const SOUTH_HOME = [[0, -6], [0, -5], [0, -4], [0, -3]];
const SOUTH_BASE = [[-5, -4.5], [-4, -4.5], [-5, -5.5], [-4, -5.5]];

export const TRACK = [];
for (let s = 0; s < SEATS; s++) for (const p of SOUTH_ARM) TRACK.push(rot(p, s));

export const HOMES = [];
export const BASES = [];
for (let s = 0; s < SEATS; s++) {
  HOMES.push(SOUTH_HOME.map((p) => rot(p, s)));
  BASES.push(SOUTH_BASE.map((p) => rot(p, s)));
}

export const CENTER_POS = [0, 0];

export const startIndex = (seat) => seat * ARM_LEN + 8;
export const homeEntryIndex = (seat) => seat * ARM_LEN + 7;
export const isStarIndex = (abs) => abs % ARM_LEN === 0;

// Absolute track index (0..55) for an owner-relative track progress.
export const absIndex = (seat, p) => (startIndex(seat) + p) % TRACK_LEN;

// Unique key for whatever hole a marble occupies (null when in base).
export function holeKey(seat, p) {
  if (p === BASE) return null;
  if (p === CENTER) return 'C';
  if (p >= FIRST_HOME) return `H${seat}-${p - FIRST_HOME}`;
  return `T${absIndex(seat, p)}`;
}

// Board-space position for a marble of `seat`, index `i`, at progress `p`.
export function positionFor(seat, i, p) {
  if (p === BASE) return BASES[seat][i];
  if (p === CENTER) return CENTER_POS;
  if (p >= FIRST_HOME) return HOMES[seat][p - FIRST_HOME];
  return TRACK[absIndex(seat, p)];
}
