// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch {}

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// A short, bright "tick" like glass on wood.
function tick(gain = 0.5, freq = 2400, decay = 0.05, when = 0) {
  const a = !muted && ac();
  if (!a) return;
  const t = a.currentTime + when;
  const len = Math.floor(a.sampleRate * decay * 2);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (a.sampleRate * decay * 0.25));
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 3;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  click: (g = 0.5) => tick(g, 2600 + Math.random() * 800, 0.04),
  knock: () => { tick(0.9, 900, 0.08); tick(0.6, 1800, 0.05, 0.05); },
  rattle: () => { for (let i = 0; i < 7; i++) tick(0.25 + Math.random() * 0.2, 1400 + Math.random() * 1200, 0.03, i * 0.045 + Math.random() * 0.02); },
  chime: () => {
    const a = !muted && ac();
    if (!a) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.value = f;
      const t = a.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.7);
    });
  },
  // Soft blip for an incoming chat message.
  pop: () => {
    const a = !muted && ac();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    const t = a.currentTime;
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.2);
  },
  unlock: () => ac(),
  get muted() { return muted; },
  set muted(v) { muted = v; try { localStorage.setItem('muted', v ? '1' : '0'); } catch {} },
};
