// Debug: frenzy swings (while running / walking / standing: MODE=run|walk|stand) with torso angles, physical vs ghost, at fine time steps.
// RIG=skeleton [MODE=run] [LEAN=1] node tools/swing-debug.mjs [t0] [t1] [ragdoll] [variants: nosc,nospine,noarm,boost=1,handK=0,handMax=200]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';
const V3 = THREE.Vector3, k = await loadChar(); k.ragdoll = +(process.argv[4] ?? 0.25);
const t0 = +(process.argv[2] ?? 0), t1 = +(process.argv[3] ?? 2), I = k.rig.idx, W = k.walk, A = k.sword, f = (x, d = 1) => x.toFixed(d);
const tiltOf = (q) => Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(q).y)) * 57.3;
const lean = (q) => { const u = new V3(0, 1, 0).applyQuaternion(q); return Math.atan2(u.z, u.y) * 57.3; }; // + = leaning forward
for (let s = 0; s < 6 * 120; s++) k.step();
const MODE = process.env.MODE ?? 'run';
if (MODE !== 'stand') { W.command(new V3(0, 0, 1), 1, MODE === 'run'); for (let s = 0; s < 6 * 120; s++) k.step(); }
const variant = process.argv[5] ?? '';
if (variant.includes('nosc')) k.setSelfCollision(false);
if (variant.includes('nospine')) { A.spine = () => {}; A.spineW = () => 0; }
if (variant.includes('noarm')) { A.arm = () => null; A.armW = () => 0; }
for (const m of variant.split(',')) { const [key, val] = m.split('='); if (['boost', 'handK', 'handMax', 'torsoLag', 'worldW', 'torsoRelax'].includes(key)) A[key] = +val; }
A.frenzy = true;
for (let s = 0; s < t1 * 120; s++) {
  k.step(); k.readState();
  if (s >= t0 * 120 && s % (process.env.LEAN ? 3 : 6) === 0) {
    const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql);
    const sw = A.sw.map((x) => `${x.kind}${x.side}@${f(x.t, 2)}`).join(','), wv = k.b[I.chest].rb.angvel();
    if (process.env.LEAN) console.log(`t=${f(s / 120, 2)} [${sw.padEnd(14)}] lean(+fwd) chest ${f(lean(k.b[I.chest].q), 0).padStart(4)} (ghost ${f(lean(w.Q[I.chest]), 0).padStart(4)}) abd ${f(lean(k.b[I.abdomen].q), 0).padStart(4)} (${f(lean(w.Q[I.abdomen]), 0).padStart(4)}) pelvis ${f(lean(k.b[0].q), 0).padStart(3)} head ${f(lean(k.b[I.head].q), 0).padStart(4)} | chest w=(${wv.x.toFixed(1)},${wv.y.toFixed(1)},${wv.z.toFixed(1)}) upperArmR ${f(lean(k.b[I.upperArmR].q), 0)}`);
    else console.log(`t=${f(s / 120, 2)} [${sw.padEnd(16)}] tilt chest ${f(tiltOf(k.b[I.chest].q), 0).padStart(3)} (ghost ${f(tiltOf(w.Q[I.chest]), 0).padStart(3)}) abd ${f(tiltOf(k.b[I.abdomen].q), 0).padStart(3)} (${f(tiltOf(w.Q[I.abdomen]), 0).padStart(3)}) pelvis ${f(tiltOf(k.b[0].q), 0).padStart(3)} (${f(tiltOf(w.Q[0]), 0).padStart(3)}) y=${f(k.b[0].p.y, 2)} ghost y=${f(e.rootP.y, 2)} handR err ${f(k.b[I.handR].p.distanceTo(w.P[I.handR]) * 100, 0)}cm handL ${f(k.b[I.handL].p.distanceTo(w.P[I.handL]) * 100, 0)}cm`);
  }
}
