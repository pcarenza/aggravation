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

## Hosting it for friends (Render, free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/pcarenza/aggravation)

1. Click the button above (or in Render: **New → Blueprint** and pick this repo).
   Sign in with GitHub and allow Render to read the repository.
2. Click **Deploy Blueprint**. `render.yaml` sets everything up: Node 22,
   `npm ci`, `npm start`, free plan. The first build takes a couple of minutes.
3. Open the `https://aggravation-xxxx.onrender.com` URL Render shows you, create a
   game, and send friends the **Copy invite link** link from the lobby.

Every push to the branch redeploys automatically.

Free-plan notes: the server goes to sleep after about 15 minutes with no
visitors, and the first visit afterwards takes up to a minute to wake it.
Games are kept in memory, so a redeploy or restart ends games in progress.
A paid instance ($7/month) stays awake.

Any other Node host with WebSocket support works too (Railway, Fly.io, a VM):
run `npm ci && npm start` with `PORT` set.

## Android app

Every push builds an APK with GitHub Actions (`.github/workflows/android.yml`)
and publishes it as **aggravation.apk** on the
[android-latest release](https://github.com/pcarenza/aggravation/releases/tag/android-latest).
Direct download link to share:
`https://github.com/pcarenza/aggravation/releases/download/android-latest/aggravation.apk`

- The app is a [Capacitor](https://capacitorjs.com) wrapper: the client files
  are bundled inside it and it plays on the hosted server
  (`https://aggravation.onrender.com`, set `AGG_SERVER` when building to change it).
  App players and website players share the same rooms.
- Install: open the APK on the phone and allow installs from that app when asked.
  New builds install over the old one.
- Signing: add two repository secrets (Settings → Secrets and variables →
  Actions): `ANDROID_KEYSTORE_BASE64` (the keystore file, base64-encoded) and
  `ANDROID_KEYSTORE_PASSWORD`, key alias `aggravation`. Then every build is
  signed with the same key and installs over the previous one. Without them the
  workflow signs with a throwaway key, so updating means uninstalling first.
  Never commit keystores (`*.keystore` is git-ignored).
- Extras in the app: the screen stays on during a game, and the phone buzzes
  when it's your turn or someone aggravates you.
- Build locally (needs Android SDK + JDK 21): `npm run build:app`, then
  `cd android && ./gradlew assembleRelease`.
- Rule changes only need a server deploy. Changes to the client (`public/`,
  `shared/`) need a new APK, which the workflow builds automatically.

## How to play

- Roll a **1** or **6** to move a marble from your base onto your start hole.
- Move clockwise by the exact roll. No jumping: if any marble is in the way, that marble can't make the move.
- Land exactly on an opponent to **aggravate** them: their marble goes back to base.
- A **6** gives you another roll.
- Get all four marbles into your home row (exact count needed) to win.
- **Shortcut through the centre:** the gold stars are the four inner corners.
  From your side of the board call them 6, 9, 12 and 3 o'clock, in the order a
  marble reaches them; 3 o'clock is the corner just before your home. If a move
  reaches a corner (the marble starts there or gets there part-way) with
  exactly **2** pips left, it may go through the centre (1 pip) to any corner
  further clockwise (the 2nd pip), your choice.
- You can never stop in the centre, and you can't hop straight from corner to
  corner: every shortcut goes through the centre.
- Shortcuts only go forward, never past the 3 o'clock corner, and obey the
  no-jump rule.

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
