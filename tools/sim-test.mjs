// Headless run of the whole scenario. usage: node tools/sim-test.mjs [forward|back|side] [ragdoll 0..1] [seconds]
import fs from 'node:fs';
import * as THREE from '#three';
import { Knight, STEP } from '../src/knight.js';
import { loadChar } from './rig-util.mjs';

const [, , dirName = 'forward', rag = '0.25', secs = '34'] = process.argv;
const profile = JSON.parse(fs.readFileSync(new URL('../src/profile.json', import.meta.url)));
const knight = await loadChar();
knight.ragdoll = +rag;
if (process.argv.includes('nosc')) knight.setSelfCollision(false);
const dirs = { forward: [0, 0.12, 1], back: [0, 0.12, -1], side: [1, 0.1, 0.3] };
const I = knight.rig.idx, f = (x, d = 2) => x.toFixed(d);
let lo = { kneeL: 9, kneeR: 9, elbL: 9, elbR: 9 }, hi = { kneeL: -9, kneeR: -9, elbL: -9, elbR: -9 }, maxV = 0, maxW = 0, nan = false;
const hinge = (n, ax) => { const b = knight.b[I[n]], a = knight.b[b.parent]; const q = a.q.clone().invert().multiply(b.q); let g = 2 * Math.atan2(q.x * ax[0] + q.y * ax[1] + q.z * ax[2], q.w); return g > Math.PI ? g - 2 * Math.PI : g; };
let knocked = false;
for (let step = 0, t = 0; t < +secs; step++, t = step * STEP) {
  if (!knocked && t >= 1.0) { knight.knockDown(new THREE.Vector3(...dirs[dirName]), 130); knocked = true; }
  knight.step();
  knight.readState();
  for (const [k, n, ax] of [['kneeL', 'shinL', [1, 0, 0]], ['kneeR', 'shinR', [1, 0, 0]], ['elbL', 'forearmL', [0, 1, 0]], ['elbR', 'forearmR', [0, 1, 0]]]) {
    const a = hinge(n, ax); lo[k] = Math.min(lo[k], a); hi[k] = Math.max(hi[k], a);
  }
  for (const b of knight.b) { const v = b.rb.linvel(), w = b.rb.angvel(); maxV = Math.max(maxV, Math.hypot(v.x, v.y, v.z)); maxW = Math.max(maxW, Math.hypot(w.x, w.y, w.z)); if (!Number.isFinite(b.p.x)) nan = true; }
  if (step % 60 === 0) {
    const P = knight.b[0].p, chest = knight.b[I.chest], head = knight.b[I.head];
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(chest.q), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chest.q);
    const tilt = Math.acos(clamp(up.y)) * 180 / Math.PI;
    console.log(`t=${f(t, 1).padStart(5)} ${knight.state.padEnd(5)} tg=${f(knight.tg, 1).padStart(5)} pelvis(${f(P.x)},${f(P.y)},${f(P.z)}) chestY=${f(chest.p.y)} headY=${f(head.p.y)} tilt=${f(tilt, 0).padStart(3)}° chestFacing=${fwd.y > 0.3 ? 'UP' : fwd.y < -0.3 ? 'DOWN' : 'side'} maxV=${f(maxV, 1)} maxW=${f(maxW, 1)}`);
    maxV = 0; maxW = 0;
  }
}
const clampf = (x) => x;
console.log('joint ranges (rad):', Object.keys(lo).map((k) => `${k}[${f(lo[k])},${f(hi[k])}]`).join(' '), nan ? ' NAN!' : '');
function clamp(x) { return Math.min(1, Math.max(-1, x)); }
