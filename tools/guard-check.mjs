// Where are the hands in the guard? Ghost target vs the physical hand, in the chest frame relative to each shoulder (x inward = the table's x), plus the elbow angle.
// usage: [RIG=knight|skeleton|robot] node tools/guard-check.mjs [seconds=2]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion, k = await loadChar(), I = k.rig.idx, L = k.sword.fists ?? k.sword, f = (x, d = 3) => x.toFixed(d), secs = +(process.argv[2] ?? 2);
k.ragdoll = 0.25;
for (let s = 0; s < 240; s++) k.step();
if (process.env.GUARD) { const h = process.env.GUARD.split(',').map(Number); for (const S of ['L', 'R']) L.style.guard[S].hand = h; } // GUARD=x,y,z tries a hand position
L.pin = true; L.engage();
for (let s = 0; s < secs * 120; s++) k.step();
k.readState();
const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql);
for (const S of ['L', 'R']) {
  const m = S === 'L' ? -1 : 1, cq = k.b[I.chest].q.clone().invert(), gq = w.Q[I.chest].clone().invert();
  const phys = k.b[I['hand' + S]].p.clone().sub(k.b[I['upperArm' + S]].p).applyQuaternion(cq), gh = w.P[I['hand' + S]].clone().sub(w.P[I['upperArm' + S]]).applyQuaternion(gq);
  const el = (P, Qq) => { const a = P[I['forearm' + S]].clone().sub(P[I['upperArm' + S]]), b = P[I['hand' + S]].clone().sub(P[I['forearm' + S]]); return 180 - Math.acos(Math.min(1, Math.max(-1, a.normalize().dot(b.normalize())))) * 57.3; };
  console.log(`${S}: ghost hand (in ${f(m * gh.x)}, up ${f(gh.y)}, fwd ${f(gh.z)}) physical (in ${f(m * phys.x)}, up ${f(phys.y)}, fwd ${f(phys.z)})  err ${f(k.b[I['hand' + S]].p.distanceTo(w.P[I['hand' + S]]) * 100, 1)} cm  elbow interior angle ghost ${f(el(w.P), 0)}° physical ${f(el(k.b.map((b) => b.p)), 0)}°`);
}
console.log(`engaged ${f(L.eng, 2)} guard own ${L.style.guard?.own} state ${k.state}`);
