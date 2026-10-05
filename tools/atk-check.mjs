// Kinematic check of the attack moves: for each move at several moments, the ghost's hand IK reach error and which joint targets violate the joint limits.
// usage: [RIG=skeleton] node tools/atk-check.mjs [kind ...]   (kinds: slash back chop jab cross hook haymaker smash; default = all the character has)
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { env } from '../src/attack.js';
import { SWORD_SWINGS } from '../src/sword.js';

const V3 = THREE.Vector3, k = await loadChar(), L = k.sword, I = k.rig.idx, out = new V3(), f = (x, d = 1) => x.toFixed(d);
for (let s = 0; s < 2 * 120; s++) k.step();
const kinds = process.argv.slice(2).filter((a) => !a.includes('='));
const sword = ['slash', 'back', 'chop'], fists = L.fists ? Object.keys(L.fists.table) : Object.keys(L.table ?? {});
if ((kinds.length ? kinds : sword).some((x) => sword.includes(x)) && L.request) { L.request(true); for (let s = 0; s < 4 * 120; s++) k.step(); }
if (process.env.ROLL) for (const K of Object.values(SWORD_SWINGS)) K.nRoll = +process.env.ROLL;
for (const kind of kinds.length ? kinds : [...(L.swordQueue ? sword : []), ...fists]) {
  const isSword = sword.includes(kind), layer = isSword ? L : L.fists ?? L;
  const rows = [];
  for (const u of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.6, 2.0]) { // u = fraction of the way through the swing's (wind-up + strike) time
    layer.swings?.splice?.(0); layer.sw?.splice?.(0);
    if (isSword) L.swordSwing(kind); else layer.swing(kind);
    const s = (isSword ? L.swings : layer.sw)[0], tt = u * (s.d[0] + s.d[1]);
    s.t = tt; const e = env(s); s.as = e.a; s.ws = e.w;
    const g = k.ghost.poseAt(k.tg), ev = k.ghost.evaluate(k.tg), viol = [];
    k.b.forEach((b, i) => { if (!i || !b.d.joint || b.d.joint.type === 'hinge') return; const v = k.limitError(b, ev.ql[i], out); if (v > 0.02) viol.push(`${b.d.name} ${f(v * 57.3, 0)}°`); });
    rows.push(`  t=${f(tt, 2)} a=${f(e.a, 2)} IK err R ${f(g.err[3] * 100)} L ${f(g.err[1] * 100)} cm${viol.length ? ' | limits: ' + viol.join(', ') : ''}`);
  }
  console.log(kind + ':\n' + rows.join('\n'));
}

if (process.env.COUNT) { }
