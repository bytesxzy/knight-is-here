// Print the layer's output around a moment (to find what makes a pop): node tools/pop-trace.mjs <t0> <t1> [side=R] [mode=fists]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';

const V3 = THREE.Vector3, t0 = +process.argv[2], t1 = +process.argv[3], S = process.argv[4] ?? 'R', k = await loadChar(), I = k.rig.idx, L = k.sword, A = L.fists ?? L, h = 1 / 120, f = (x, d = 2) => (x >= 0 ? ' ' : '') + x.toFixed(d);
k.ragdoll = 0.25;
for (let s = 0; s < 240; s++) k.step();
let prev = null, t = 0;
for (let s = 0; s < Math.round(t1 * 120); s++, t += h) {
  L.attackHeld = true; k.step(); k.readState();
  if (t < t0) continue;
  const e = k.ghost.evaluate(k.tg), q = e.ql[I['upperArm' + S]], fq = e.ql[I['forearm' + S]];
  const o = A.out[S], ang = prev ? 2 * Math.acos(Math.min(1, Math.abs(prev.clone().invert().multiply(q).w))) / h : 0;
  const sw = A.sw.filter((x) => A.has(x, S)).map((x) => { const en = (x.t < x.d[0] ? 0 : 1); return `${x.kind}@${x.t.toFixed(2)}`; }).join(' ');
  console.log(`t=${t.toFixed(3)} omega ${f(ang, 1)} | W ${f(o.W)} off (${f(o.off.x)},${f(o.off.y)},${f(o.off.z)}) pole (${f(o.pole.x)},${f(o.pole.y)},${f(o.pole.z)}) roll ${f(o.roll)} | q (${f(q.x)},${f(q.y)},${f(q.z)},${f(q.w)}) | ${sw}`);
  prev = q.clone();
}
