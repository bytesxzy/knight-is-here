// The hand's turn about the forearm during the swings: twist angle of the wrist (ghost target vs physical), in degrees, per moment. usage: RIG=skeleton node tools/roll-check.mjs
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';
const V3 = THREE.Vector3, k = await loadChar(), I = k.rig.idx, L = k.sword, f = (x, d = 0) => x.toFixed(d);
const twist = (q) => { let a = 2 * Math.atan2(q.x, q.w) * 57.3; if (a > 180) a -= 360; if (a < -180) a += 360; return a; }; // about the x (limb) axis of the child frame
for (let s = 0; s < 2 * 120; s++) k.step();
if (k.sword.request && k.sword.fists) { /* knight: punches with the sheathed sword */ }
L.attackHeld = true;
for (let s = 0; s < 2.2 * 120; s++) {
  k.step(); k.readState();
  if (s % 8 !== 0) continue;
  const e = k.ghost.evaluate(k.tg), sw = [...(L.fists?.sw ?? []), ...(L.sw ?? [])].filter((x) => x.t < x.T).map((x) => `${x.kind}${x.side}@${f(x.t * 100)}`).join(',');
  const row = ['L', 'R'].map((S) => { const h = I['hand' + S], g = twist(e.ql[h]), p = twist(k.b[I['forearm' + S]].q.clone().invert().multiply(k.b[h].q)); return `${S}: ghost ${f(g).padStart(4)}° phys ${f(p).padStart(4)}° curl ${f(L.curl(S), 2)}`; });
  console.log(`t=${f(s / 120 * 100) / 100} [${sw.padEnd(16)}] ${row.join(' | ')}`);
}
