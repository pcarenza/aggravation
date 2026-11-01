# Aggravation

A browser-based, real-time multiplayer version of the classic marble race game,
played on a 3D wooden board with glass marbles and a rolling die.

- 2–4 players per room, with a 4-letter room code or invite link
- Computer players can fill empty seats. If someone disconnects, a computer
  plays for them until they come back (refreshing the page reconnects you).
- The server is authoritative: it rolls the die and checks every move.

## Running it

```bash
npm install
npm start          # http://localhost:3000  (set PORT to change)
npm test           # rules engine tests
```

To play with friends, run the server on a machine they can reach (for example
a small cloud VM or any Node host such as Render, Railway or Fly.io) and share
the invite link from the lobby.

## How to play

- Roll a **1** or **6** to move a marble from your base onto your start hole.
- Move clockwise by the exact roll. You can jump other players' marbles but not your own.
- Land exactly on an opponent to **aggravate** them: their marble goes back to base.
- A **6** gives you another roll.
- Get all four marbles into your home row (exact count needed) to win.
- **Shortcuts:** a marble that starts its turn on a gold star (the inner corners)
  may hop star-to-star, one star per pip, up to the star just before its home.
  From a star a **1** drops into the centre hole, and a **1** takes it back out
  onto your home-side star.

Controls: click a glowing marble, then a glowing hole. Drag to rotate, scroll or
pinch to zoom. Press Space or click the die to roll.

## Layout

| Path | What |
| --- | --- |
| `server.js` | Express + Socket.IO server: rooms, seats, bots, turn timing |
| `shared/board.js` | Board geometry (hole coordinates), shared by server and client |
| `shared/rules.js` | Pure rules engine: legal moves, captures, shortcuts, bot choice |
| `public/scene.js` | Three.js scene: procedural wood board, marbles, die, animations |
| `public/main.js` | Lobby/HUD UI and the client side of the socket protocol |
| `test/` | `node --test` tests for the rules |

For automated testing, `AGG_FORCE_ROLLS=6,1,3` makes the server's die cycle
through fixed values, and `?debug` in the page URL exposes the board view as
`window.__board`.
