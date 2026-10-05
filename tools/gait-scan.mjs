// Kinematic scan of the pelvis-bob parameters: knee flexion at heel strike, reach error, bob size, smoothness of the pelvis path.
import fs from 'node:fs';
import * as THREE from '#three';
import { loadRig } from './rig-util.mjs';
import { Ghost } from '../src/ghost.js';
import { Walker, WALK } from '../src/walk.js';
const rig = loadRig().rig, I = rig.idx, V3 = THREE.Vector3, h = 1 / 120;
const pitchOf = (q) => 2 * Math.atan2(q.x, q.w) * 57.3;
function run(over, vthr = 1) { // vthr: throttle 0..1 of the top speed
  Object.assign(WALK, { bobScale: 0.9, bobMin: 0.03, reachGeo: 1.0, geoMargin: 0.012, strideA: 0.3, strideB: 0.3, Tmin: 0.85, duty: 0.62, vMax: 1.25 }, over);
  const g = new Ghost(rig), W = new Walker(g); g.walker = W; g.begin(null, new V3(), 0, 0);
  W.command(new V3(0, 0, 1), vthr); for (let i = 0; i < 120 * 5; i++) W.step(h, null);
  const ys = [], zs = []; let kmin = 99, kmax = 0, err = 0;
  for (let i = 0; i < 240; i++) { W.step(h, null); const p = g.poseAt(g.duration + 1); ys.push(p.P[0].y); kmin = Math.min(kmin, pitchOf(p.ql[I.shinL]), pitchOf(p.ql[I.shinR])); kmax = Math.max(kmax, pitchOf(p.ql[I.shinL])); err = Math.max(err, p.err[0], p.err[2]); }
  const acc = ys.slice(1, -1).map((_, i) => (ys[i + 2] - 2 * ys[i + 1] + ys[i]) / (h * h));
  const rms = Math.sqrt(acc.reduce((a, b) => a + b * b, 0) / acc.length), mx = Math.max(...acc.map(Math.abs));
  return { bob: (Math.max(...ys) - Math.min(...ys)) * 100, kmin, err: err * 100, rms, mx, T: W.T };
}
const f = (x, d = 1) => x.toFixed(d).padStart(5);
if (process.argv[2] === 'scan') {
  for (const vMax of [1.15, 1.2, 1.25]) for (const strideB of [0.2, 0.25]) for (const duty of [0.58, 0.6]) {
    const r = run({ vMax, strideB, duty, bobScale: 1.0 });
    console.log(`vMax ${vMax} strideB ${strideB} duty ${duty} | T ${f(r.T, 2)} s (${f(120 / r.T, 0)} steps/min)  bob ${f(r.bob)} cm  knee min ${f(r.kmin, 0)}°  IK err ${f(r.err)} cm  acc rms ${f(r.rms)} max ${f(r.mx)}`);
  }
} else { const r = run({}); console.log(JSON.stringify(r)); }
