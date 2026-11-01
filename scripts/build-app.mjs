// Assemble the web client into www/ for the Android app (Capacitor).
// The app bundles everything it needs and talks to the hosted game server.
//   AGG_SERVER=https://example.com node scripts/build-app.mjs
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
const server = (process.env.AGG_SERVER || 'https://aggravation.onrender.com').replace(/\/+$/, '');
const from = (p) => path.join(root, p);
const to = (p) => path.join(out, p);
const copy = (src, dest) => { mkdirSync(path.dirname(to(dest)), { recursive: true }); cpSync(from(src), to(dest), { recursive: true }); };

rmSync(out, { recursive: true, force: true });
copy('public', '.');
copy('shared', 'shared');
copy('node_modules/three/build/three.module.js', 'vendor/three/build/three.module.js');
copy('node_modules/three/build/three.core.js', 'vendor/three/build/three.core.js');
for (const f of ['controls/OrbitControls.js', 'environments/RoomEnvironment.js', 'geometries/RoundedBoxGeometry.js']) {
  copy(`node_modules/three/examples/jsm/${f}`, `vendor/three/addons/${f}`);
}
copy('node_modules/socket.io/client-dist/socket.io.min.js', 'socket.io/socket.io.js');

// Point the client at the hosted server.
const indexPath = to('index.html');
const html = readFileSync(indexPath, 'utf8');
const tag = '<script src="/socket.io/socket.io.js"></script>';
if (!html.includes(tag)) throw new Error('index.html: socket.io script tag not found');
writeFileSync(indexPath, html.replace(tag, `<script>window.AGG_SERVER = ${JSON.stringify(server)};</script>\n  ${tag}`));
console.log(`Built www/ for ${server}`);
