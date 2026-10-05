// Trace of the ghost's arm joints through one move (angular speed per step), to see where the pops come from.
// usage: [RIG=knight] node tools/arm-trace.mjs [kind=jab] [side=L] [from=0] [to=0.45]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';

const V3 = THREE.Vector3, kind = process.argv[2] ?? 'jab', S = process.argv[3] ?? 'L', t0 = +(process.argv[4] ?? 0), t1 = +(process.argv[5] ?? 0.45);
const k = await loadChar(), I = k.rig.idx, L = k.sword.fists ?? k.sword, f = (x, d = 2) => x.toFixed(d).padStart(d + 4), h = 1 / 120;
k.ragdoll = 0.25;
for (let s = 0; s < 240; s++) k.step();
L.swing(kind, S);
let prev = null, prevAng = null;
for (let s = 0; s < Math.round(t1 * 120); s++) {
  k.step(); k.readState();
  if (s < Math.round(t0 * 120)) { prev = null; continue; }
  const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql);
  const cur = ['upperArm', 'forearm', 'hand'].map((n) => e.ql[I[n + S]].clone()), pos = w.P[I['hand' + S]].clone();
  if (prev) {
    const ang = cur.map((q, i) => 2 * Math.acos(Math.min(1, Math.abs(prev[i].clone().invert().multiply(q).w))) / h);
    const sw = L.sw[0];
    const ex = k.ghost.poseAt(k.tg).err;
    console.log(`t=${f(s * h)} a=${sw ? f(sw.as, 2) : '  -  '} w=${sw ? f(sw.ws, 2) : '  -  '} | omega upper ${f(ang[0], 1)} fore ${f(ang[1], 1)} hand ${f(ang[2], 1)} | hand speed ${f(pos.distanceTo(prevPos) / h, 2)} | IK err ${f(ex[S === 'L' ? 1 : 3] * 100, 1)}cm`);
  }
  prev = cur; var prevPos = pos;
}
