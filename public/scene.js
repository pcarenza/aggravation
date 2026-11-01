// Three.js rendering of the board, marbles and die.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  TRACK, HOMES, BASES, CENTER_POS, SEATS, SEAT_COLORS, MARBLES_PER_PLAYER,
  BASE, positionFor, startIndex, homeEntryIndex, isStarIndex,
} from '/shared/board.js';
import { sfx } from './sfx.js';

const HALF = 8.6; // half the board width, in hole units
const HOLE_R = 0.28;
const MARBLE_R = 0.33;
const SLAB_H = 0.45; // base slab (hole bottoms)
const PLATE_DEPTH = 0.25;
const BEVEL = 0.04;
const TOP = SLAB_H + PLATE_DEPTH + 2 * BEVEL; // height of the playing surface
const REST_Y = TOP + 0.12; // marble centre when sitting in a hole
const DIE_SIZE = 0.85;
// Die face values for BoxGeometry material groups: +x, -x, +y, -y, +z, -z.
const DIE_FACES = [3, 4, 1, 6, 2, 5];
const DIE_NORMALS = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];

// Board coordinates (x east, y north) -> world (x, z), y up.
const world = ([x, y], h = REST_Y) => new THREE.Vector3(x, h, -y);

// ---------------------------------------------------------------- noise ---
function makeNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const p = [...Array(256).keys()].sort(() => rnd() - 0.5);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (x, y) => perm[(x & 255) + perm[y & 255]] / 255;
  const fade = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x, y, oct = 3) => {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { sum += amp * noise(x * f, y * f); amp *= 0.5; f *= 2.03; }
    return sum / (1 - Math.pow(0.5, oct));
  };
}

// Procedural wood grain running along x.
function woodCanvas(size, { light, dark, seed, ringScale = 22, warp = 2.2 }) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const fbm = makeNoise(seed);
  const k = 1024 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = x * k, Y = y * k;
      const w = fbm(X / 300, Y / 45, 3);
      let g = (Y / ringScale + w * warp) % 1;
      const ring = Math.pow(g, 4) * 0.7 + Math.pow(1 - g, 18) * 0.3;
      const fibre = fbm(X / 3, Y / 90, 2) * 0.22;
      const blotch = fbm(X / 500 + 7, Y / 160, 2) * 0.35;
      const t = Math.min(1, ring * 0.55 + fibre + blotch * 0.5);
      const i = (y * size + x) * 4;
      img.data[i] = light[0] + (dark[0] - light[0]) * t;
      img.data[i + 1] = light[1] + (dark[1] - light[1]) * t;
      img.data[i + 2] = light[2] + (dark[2] - light[2]) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function canvasTexture(canvas, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  return t;
}

// ------------------------------------------------------ board artwork ----
function paintBoard(woodSrc) {
  const N = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  ctx.drawImage(woodSrc, 0, 0, N, N);
  const S = N / (2 * HALF);
  const P = ([x, y]) => [(x + HALF) * S, (HALF - y) * S];

  // Worn, slightly translucent paint.
  const paint = (fn, alpha = 0.82) => { ctx.save(); ctx.globalAlpha = alpha; fn(); ctx.restore(); };

  // Routed groove connecting the track.
  paint(() => {
    ctx.strokeStyle = 'rgba(70,40,15,0.55)';
    ctx.lineWidth = 0.13 * S;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    TRACK.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.stroke();
  }, 1);

  for (let s = 0; s < SEATS; s++) {
    const col = SEAT_COLORS[s].hex;
    // Home lane: a coloured capsule from the home entry to the last home hole.
    paint(() => {
      const a = P(TRACK[homeEntryIndex(s)]);
      const b = P(HOMES[s][3]);
      ctx.strokeStyle = col;
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.78 * S;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    });
    paint(() => {
      const a = P(TRACK[homeEntryIndex(s)]);
      const b = P(HOMES[s][3]);
      ctx.strokeStyle = '#f6e7c4';
      ctx.lineWidth = 0.05 * S;
      ctx.setLineDash([0.12 * S, 0.08 * S]);
      // pinstripe outline
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = (-dy / len) * 0.46 * S, ny = (dx / len) * 0.46 * S;
      ctx.beginPath(); ctx.moveTo(a[0] + nx, a[1] + ny); ctx.lineTo(b[0] + nx, b[1] + ny); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a[0] - nx, a[1] - ny); ctx.lineTo(b[0] - nx, b[1] - ny); ctx.stroke();
    }, 0.6);

    // Base: rounded square around the four waiting holes.
    paint(() => {
      const pts = BASES[s].map(P);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs) - 0.75 * S, y0 = Math.min(...ys) - 0.75 * S;
      const w = Math.max(...xs) - Math.min(...xs) + 1.5 * S, h = Math.max(...ys) - Math.min(...ys) + 1.5 * S;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 0.45 * S); ctx.fill();
      ctx.strokeStyle = '#f6e7c4'; ctx.lineWidth = 0.06 * S;
      ctx.beginPath(); ctx.roundRect(x0 + 0.12 * S, y0 + 0.12 * S, w - 0.24 * S, h - 0.24 * S, 0.35 * S); ctx.stroke();
    });

    // Start hole ring + arrow.
    paint(() => {
      const [x, y] = P(TRACK[startIndex(s)]);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 0.47 * S, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f6e7c4'; ctx.lineWidth = 0.05 * S;
      ctx.beginPath(); ctx.arc(x, y, 0.4 * S, 0, Math.PI * 2); ctx.stroke();
    }, 0.9);
  }

  // Shortcut stars.
  const star = (cx, cy, rOut, rIn, points, fill, stroke) => {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? rIn : rOut;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.035 * S; ctx.stroke(); }
  };
  TRACK.forEach((p, i) => {
    if (!isStarIndex(i)) return;
    const [x, y] = P(p);
    paint(() => star(x, y, 0.68 * S, 0.3 * S, 5, '#d9a520', '#7a4e10'), 0.92);
  });

  // Centre medallion.
  paint(() => {
    const [x, y] = P(CENTER_POS);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 0.95 * S);
    g.addColorStop(0, '#f0c75a'); g.addColorStop(1, '#a8741c');
    star(x, y, 1.0 * S, 0.42 * S, 8, g, '#6b430c');
    ctx.strokeStyle = '#6b430c'; ctx.lineWidth = 0.04 * S;
    ctx.beginPath(); ctx.arc(x, y, 0.5 * S, 0, Math.PI * 2); ctx.stroke();
  }, 0.95);

  // Border inlay.
  paint(() => {
    ctx.strokeStyle = '#3b2210'; ctx.lineWidth = 0.08 * S;
    const m = 0.45 * S;
    ctx.beginPath(); ctx.roundRect(m, m, N - 2 * m, N - 2 * m, 0.9 * S); ctx.stroke();
    ctx.strokeStyle = '#e8c98a'; ctx.lineWidth = 0.03 * S;
    ctx.beginPath(); ctx.roundRect(m + 0.12 * S, m + 0.12 * S, N - 2 * m - 0.24 * S, N - 2 * m - 0.24 * S, 0.8 * S); ctx.stroke();
  }, 0.85);

  // Darkened, burnished rims around every hole.
  const allHoles = [...TRACK, ...HOMES.flat(), ...BASES.flat(), CENTER_POS];
  for (const h of allHoles) {
    const [x, y] = P(h);
    const g = ctx.createRadialGradient(x, y, HOLE_R * S * 0.9, x, y, HOLE_R * S * 1.6);
    g.addColorStop(0, 'rgba(40,20,5,0.55)'); g.addColorStop(1, 'rgba(40,20,5,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, HOLE_R * S * 1.6, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function roundedRectShape(h, r) {
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

// --------------------------------------------------------------- die ----
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function dieFace(n, bump = false) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  if (bump) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
  } else {
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
    g.addColorStop(0, '#fbf7ec'); g.addColorStop(1, '#e9e1cc');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }
  const r = n === 1 ? S * 0.11 : S * 0.085;
  for (const [x, y] of PIPS[n]) {
    const cx = x * S, cy = y * S;
    if (bump) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.15);
      g.addColorStop(0, '#000'); g.addColorStop(0.75, '#222'); g.addColorStop(1, '#fff');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, n === 1 ? '#b0141a' : '#3a3a3a');
      g.addColorStop(1, n === 1 ? '#5a0508' : '#0b0b0b');
      ctx.fillStyle = g;
    }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  if (!bump) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Quaternion that puts `value` face up, with a given yaw.
function dieRestQuat(value, yaw) {
  const face = DIE_FACES.indexOf(value);
  const q = new THREE.Quaternion().setFromUnitVectors(DIE_NORMALS[face], new THREE.Vector3(0, 1, 0));
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return qy.multiply(q);
}

// ------------------------------------------------------------ easing ----
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class BoardView {
  constructor(container) {
    this.container = container;
    this.tweens = new Set();
    this.viewSeat = 0;
    this.onPick = null; // (moveId) => void
    this.moves = [];
    this.selected = null;
    this.marbles = {}; // seat -> [Mesh]
    this.positions = {}; // seat -> [progress]

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    container.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#1b120c');
    scene.fog = new THREE.Fog('#1b120c', 32, 70);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 40;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.target.set(0, TOP, 0);

    this.#lights();
    this.#table();
    this.#board();
    this.#marbles();
    this.#die();
    this.#markers();
    this.#picking();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setViewSeat(0, false);
    r.setAnimationLoop(() => this.#frame());
  }

  // ---------------------------------------------------------- setup ----
  #lights() {
    const hemi = new THREE.HemisphereLight('#fff1dc', '#3a2410', 0.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight('#fff4e2', 2.4);
    key.position.set(-8, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -16; sc.right = sc.top = 16; sc.near = 5; sc.far = 50;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.scene.add(key);
    // Warm lamp overhead for a pool of light on the table.
    const lamp = new THREE.SpotLight('#ffd9a0', 70, 60, Math.PI / 4.5, 0.7, 1.6);
    lamp.position.set(2, 20, 2);
    lamp.target.position.set(0, 0, 0);
    this.scene.add(lamp, lamp.target);
  }

  #table() {
    const tex = canvasTexture(woodCanvas(512, { light: [92, 54, 32], dark: [42, 22, 12], seed: 7, ringScale: 30, warp: 3 }), { repeat: 17 });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0 });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  #board() {
    const wood = woodCanvas(1024, { light: [208, 160, 98], dark: [138, 84, 38], seed: 3 });
    const top = canvasTexture(paintBoard(wood));
    const plain = canvasTexture(wood);
    for (const t of [top, plain]) { t.repeat.set(1 / (2 * HALF), 1 / (2 * HALF)); t.offset.set(0.5, 0.5); }

    const topMat = new THREE.MeshPhysicalMaterial({ map: top, roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.35 });
    const sideMat = new THREE.MeshPhysicalMaterial({ map: plain, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, color: '#d9c2a2' });
    const bottomMat = new THREE.MeshStandardMaterial({ color: '#2b1a0e', roughness: 0.9 });

    const outline = roundedRectShape(HALF, 1.1);
    const plate = outline.clone();
    plate.holes = [];
    for (const [x, y] of [...TRACK, ...HOMES.flat(), ...BASES.flat()]) {
      const h = new THREE.Path();
      h.absarc(x, y, HOLE_R, 0, Math.PI * 2, true);
      plate.holes.push(h);
    }
    const c = new THREE.Path();
    c.absarc(CENTER_POS[0], CENTER_POS[1], HOLE_R * 1.15, 0, Math.PI * 2, true);
    plate.holes.push(c);

    const plateGeo = new THREE.ExtrudeGeometry(plate, {
      depth: PLATE_DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.035, bevelSegments: 3, curveSegments: 20,
    });
    plateGeo.rotateX(-Math.PI / 2);
    const plateMesh = new THREE.Mesh(plateGeo, [topMat, sideMat]);
    plateMesh.position.y = SLAB_H + BEVEL;
    plateMesh.castShadow = plateMesh.receiveShadow = true;

    const slabGeo = new THREE.ExtrudeGeometry(roundedRectShape(HALF - 0.02, 1.08), {
      depth: SLAB_H - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 16,
    });
    slabGeo.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, [bottomMat, sideMat]);
    slab.position.y = 0.03;
    slab.castShadow = slab.receiveShadow = true;

    this.scene.add(plateMesh, slab);
  }

  #marbles() {
    const geo = new THREE.SphereGeometry(MARBLE_R, 48, 32);
    const core = new THREE.SphereGeometry(MARBLE_R * 0.55, 24, 16);
    for (let s = 0; s < SEATS; s++) {
      const col = new THREE.Color(SEAT_COLORS[s].hex);
      const glass = new THREE.MeshPhysicalMaterial({
        color: col, roughness: 0.04, metalness: 0, transmission: 0.82, thickness: 0.6, ior: 1.52,
        attenuationColor: col, attenuationDistance: 0.35, clearcoat: 1, clearcoatRoughness: 0.03,
        specularIntensity: 1, envMapIntensity: 0.45,
      });
      // An opaque swirl inside makes the marble read clearly against the wood.
      const coreMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.35, emissive: col, emissiveIntensity: 0.12 });
      this.marbles[s] = [];
      this.positions[s] = Array(MARBLES_PER_PLAYER).fill(BASE);
      for (let i = 0; i < MARBLES_PER_PLAYER; i++) {
        const m = new THREE.Mesh(geo, glass);
        m.castShadow = true;
        const inner = new THREE.Mesh(core, coreMat);
        inner.scale.set(1, 0.35, 1.4);
        inner.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        m.add(inner);
        m.userData = { seat: s, i };
        m.visible = false;
        m.position.copy(world(BASES[s][i]));
        this.scene.add(m);
        this.marbles[s].push(m);
      }
    }
  }

  #die() {
    const mats = DIE_FACES.map((n) => new THREE.MeshPhysicalMaterial({
      map: dieFace(n), bumpMap: dieFace(n, true), bumpScale: 2.5, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2,
    }));
    this.die = new THREE.Mesh(new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 5, 0.13), mats);
    this.die.castShadow = true;
    this.die.receiveShadow = true;
    this.scene.add(this.die);

    // Felt-lined dice tray beside the board.
    const tray = new THREE.Group();
    const felt = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 4.2), new THREE.MeshStandardMaterial({ color: '#0f4a2c', roughness: 1 }));
    felt.position.y = 0.04;
    felt.receiveShadow = true;
    tray.add(felt);
    const rimMat = new THREE.MeshPhysicalMaterial({ color: '#6b3f1f', roughness: 0.45, clearcoat: 0.5 });
    for (const [w, d, x, z] of [[4.6, 0.2, 0, 2.2], [4.6, 0.2, 0, -2.2], [0.2, 4.6, 2.2, 0], [0.2, 4.6, -2.2, 0]]) {
      const rim = new THREE.Mesh(new RoundedBoxGeometry(w, 0.45, d, 2, 0.06), rimMat);
      rim.position.set(x, 0.225, z);
      rim.castShadow = rim.receiveShadow = true;
      tray.add(rim);
    }
    this.tray = tray;
    this.scene.add(tray);
    this.dieValue = 6;
  }

  #markers() {
    // Pulsing ring under marbles that can move.
    this.ringGeo = new THREE.TorusGeometry(0.42, 0.045, 12, 48);
    this.ringGeo.rotateX(Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.9, toneMapped: false });
    this.destMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    this.destGeo = new THREE.SphereGeometry(MARBLE_R * 0.95, 24, 16);
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
  }

  #picking() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = this.renderer.domElement;
    let down = null;
    const hit = (e) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const targets = [...this.markerGroup.children.filter((o) => o.userData.pick), ...this.#movableMarbles(), this.die];
      return ray.intersectObjects(targets, false)[0]?.object ?? null;
    };
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointermove', (e) => {
      const o = hit(e);
      el.style.cursor = o && (o !== this.die || this.canRoll) ? 'pointer' : 'grab';
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; // was a drag
      const o = hit(e);
      if (!o) return;
      if (o === this.die) { if (this.canRoll) this.onRollClick?.(); return; }
      if (o.userData.moveId !== undefined) { this.#choose(o.userData.moveId); return; }
      if (o.userData.seat !== undefined) this.#select(o.userData.i);
    });
  }

  // ------------------------------------------------------------ view ----
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    // When a panel is docked on the right (chat), frame the scene in the space
    // left of it; the canvas still covers the full width so the table shows
    // underneath the panel.
    const inset = Math.min(this.rightInset || 0, w * 0.5);
    const we = w - inset;
    const aspect = we / h;
    this.camera.aspect = aspect;
    if (aspect < 1) {
      // Widen the view on narrow screens so the whole board fits.
      this.camera.fov = Math.min(70, 38 / Math.max(aspect, 0.55));
    } else {
      // Keep the board and dice tray in frame as the view gets narrower.
      const k = Math.max(1, 1.5 / aspect);
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) * k));
    }
    if (inset) this.camera.setViewOffset(we, h, 0, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    // On tall screens the dice tray goes in front of the board instead of beside it.
    const portrait = aspect < 0.9;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      if (this.tray) this.setViewSeat(this.viewSeat, false);
    }
  }

  // Reserve `px` on the right edge of the screen for an overlay panel.
  setRightInset(px) {
    if ((this.rightInset || 0) === px) return;
    this.rightInset = px;
    this.resize();
  }

  // Rotate the view so `seat`'s arm is nearest the viewer.
  setViewSeat(seat, animate = true) {
    this.viewSeat = seat;
    const ang = (seat * Math.PI) / 2; // seat 0 looks from +z
    const dir = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
    const right = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    let camPos, target, trayPos;
    if (this.portrait) {
      // Tray in front of the board; look a little more from above.
      trayPos = dir.clone().multiplyScalar(HALF + 3);
      target = new THREE.Vector3(0, TOP, 0).add(dir.clone().multiplyScalar(2));
      camPos = target.clone().add(dir.clone().multiplyScalar(12)).add(new THREE.Vector3(0, 30, 0));
    } else {
      // Tray to the viewer's right, slightly forward.
      trayPos = right.clone().multiplyScalar(HALF + 3).add(dir.clone().multiplyScalar(2.5));
      target = new THREE.Vector3(0, TOP, 0).add(right.clone().multiplyScalar(1.5));
      camPos = target.clone().add(dir.clone().multiplyScalar(20)).add(new THREE.Vector3(0, 24, 0));
    }
    this.tray.position.copy(trayPos);
    this.tray.rotation.y = -ang;
    this.trayDir = dir;
    this.trayRight = right;
    this.die.position.set(trayPos.x, 0.08 + DIE_SIZE / 2, trayPos.z);
    this.die.quaternion.copy(dieRestQuat(this.dieValue, Math.random() * 6));
    if (!animate) {
      this.camera.position.copy(camPos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    this.#tween(900, (t) => {
      const e = easeInOut(t);
      this.camera.position.lerpVectors(p0, camPos, e);
      this.controls.target.lerpVectors(t0, target, e);
    });
  }

  // ---------------------------------------------------------- marbles ---
  // Snap marbles to a game state without animation.
  setMarbles(marbles) {
    for (let s = 0; s < SEATS; s++) {
      const list = marbles?.[s];
      this.marbles[s].forEach((m, i) => {
        m.visible = !!list;
        if (!list) return;
        this.positions[s][i] = list[i];
        m.position.copy(world(positionFor(s, i, list[i])));
      });
    }
  }

  // Animate a move: hop along the path, then knock a captured marble home.
  async animateMove(last) {
    const m = this.marbles[last.seat][last.i];
    for (const p of last.path) {
      const to = world(positionFor(last.seat, last.i, p));
      const dist = m.position.distanceTo(to);
      await this.#hop(m, to, Math.min(650, 150 + dist * 55), 0.3 + dist * 0.12);
      sfx.click(0.6);
    }
    this.positions[last.seat][last.i] = last.path[last.path.length - 1];
    if (last.capture) {
      const { seat, i } = last.capture;
      const c = this.marbles[seat][i];
      sfx.knock();
      await this.#hop(c, world(BASES[seat][i]), 750, 3.2);
      sfx.click(0.8);
      this.positions[seat][i] = BASE;
    }
  }

  #hop(mesh, to, ms, height) {
    const from = mesh.position.clone();
    const axis = new THREE.Vector3().subVectors(to, from).cross(new THREE.Vector3(0, -1, 0)).normalize();
    const roll = from.distanceTo(to) / MARBLE_R;
    const q0 = mesh.quaternion.clone();
    return this.#tween(ms, (t) => {
      const e = easeInOut(t);
      mesh.position.lerpVectors(from, to, e);
      mesh.position.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * t) * height;
      if (axis.lengthSq() > 0) mesh.quaternion.copy(q0).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -roll * e));
    });
  }

  // -------------------------------------------------------------- die ---
  async rollDie(value) {
    this.dieValue = value;
    const tp = this.tray.position;
    const end = new THREE.Vector3(tp.x, 0.08 + DIE_SIZE / 2, tp.z)
      .add(this.trayRight.clone().multiplyScalar((Math.random() - 0.5) * 1.6))
      .add(this.trayDir.clone().multiplyScalar((Math.random() - 0.5) * 1.6));
    const start = end.clone().add(this.trayDir.clone().multiplyScalar(2.2)).add(this.trayRight.clone().multiplyScalar(-1.2));
    start.y = 2.6;
    const qEnd = dieRestQuat(value, Math.random() * Math.PI * 2);
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).normalize();
    const spins = Math.PI * 2 * (2 + Math.random() * 1.5);
    const restY = end.y;
    sfx.rattle();
    let bounced = 0;
    await this.#tween(1350, (t) => {
      const e = easeOutCubic(t);
      this.die.position.lerpVectors(start, end, e);
      // Drop with three decaying bounces.
      const fall = Math.max(0, 1 - t / 0.28);
      const b = t < 0.28 ? 0 : Math.abs(Math.sin(((t - 0.28) / 0.72) * Math.PI * 3)) * Math.pow(1 - (t - 0.28) / 0.72, 2.4) * 0.9;
      this.die.position.y = restY + (start.y - restY) * fall * fall + b;
      const n = t < 0.28 ? 0 : Math.floor(((t - 0.28) / 0.72) * 3);
      if (n > bounced && n < 3) { bounced = n; sfx.click(0.5 / n); }
      const spin = spins * Math.pow(1 - e, 1.6);
      this.die.quaternion.copy(qEnd).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, spin));
    });
    sfx.click(0.35);
  }

  set canRoll(v) {
    this._canRoll = v;
    if (!v) this.die.position.y = 0.08 + DIE_SIZE / 2;
  }
  get canRoll() { return this._canRoll; }

  // ------------------------------------------------------- move picking --
  // Offer a set of legal moves to the local player.
  showMoves(moves, seat, onPick) {
    this.moves = moves;
    this.moveSeat = seat;
    this.onPick = onPick;
    this.selected = null;
    const marbles = [...new Set(moves.map((m) => m.i))];
    if (marbles.length === 1) this.#select(marbles[0]);
    else this.#renderMarkers();
  }

  clearMoves() {
    this.moves = [];
    this.selected = null;
    this.onPick = null;
    this.#renderMarkers();
  }

  #movableMarbles() {
    if (!this.moves.length) return [];
    return [...new Set(this.moves.map((m) => m.i))].map((i) => this.marbles[this.moveSeat][i]);
  }

  #select(i) {
    const mine = this.moves.filter((m) => m.i === i);
    if (!mine.length) return;
    // A marble with only one possible move moves straight away once clicked;
    // when it is auto-selected we still wait for the click.
    if (this.selected === i && mine.length === 1) return this.#choose(mine[0].id);
    this.selected = i;
    this.#renderMarkers();
  }

  #choose(id) {
    const cb = this.onPick;
    this.clearMoves();
    cb?.(id);
  }

  #renderMarkers() {
    this.markerGroup.clear();
    if (!this.moves.length) return;
    for (const m of this.#movableMarbles()) {
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      ring.position.set(m.position.x, TOP + 0.03, m.position.z);
      ring.userData.pulse = true;
      this.markerGroup.add(ring);
    }
    if (this.selected === null) return;
    for (const mv of this.moves.filter((m) => m.i === this.selected)) {
      const p = world(positionFor(this.moveSeat, mv.i, mv.to));
      const ghost = new THREE.Mesh(this.destGeo, this.destMat);
      ghost.position.copy(p);
      ghost.userData = { moveId: mv.id, pick: true };
      this.markerGroup.add(ghost);
      const ring = new THREE.Mesh(this.ringGeo, mv.capture ? new THREE.MeshBasicMaterial({ color: '#ff5040', toneMapped: false }) : this.ringMat);
      ring.position.set(p.x, TOP + 0.03, p.z);
      this.markerGroup.add(ring);
    }
  }

  // ------------------------------------------------------------ loop ----
  #tween(ms, fn) {
    return new Promise((resolve) => {
      this.tweens.add({ start: performance.now(), ms, fn, resolve });
    });
  }

  #frame() {
    const now = performance.now();
    for (const tw of [...this.tweens]) {
      const t = Math.min(1, (now - tw.start) / tw.ms);
      tw.fn(t);
      if (t >= 1) { this.tweens.delete(tw); tw.resolve(); }
    }
    const pulse = 0.55 + 0.45 * Math.sin(now / 220);
    this.ringMat.opacity = 0.35 + 0.6 * pulse;
    this.destMat.opacity = 0.25 + 0.3 * pulse;
    for (const o of this.markerGroup.children) if (o.userData.pulse) o.scale.setScalar(0.95 + 0.1 * pulse);
    if (this.canRoll) this.die.position.y = 0.08 + DIE_SIZE / 2 + 0.05 + 0.05 * Math.sin(now / 200);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
