// Searches the sword design parameters (holder placement on the belt, draw direction, torso offsets, ready guard, left-hand rest) so that
// both hands reach, the arm joints stay inside their limits, NO body part ends up inside another (self-collision proxies), and the blade,
// the scabbard and the hilt stay out of the body. Prints the best set + a per-p table.
// usage: node tools/sword-tune.mjs [iterations] [seed]       env: START=<json TUNE override>
import fs from 'node:fs';
import RAPIER from '#rapier';
import * as THREE from '#three';
import { buildRig, groupOf, collides } from '../src/humanoid.js';
import { Ghost } from '../src/ghost.js';
import { SwordLayer, TUNE, rebuild, swordInHand, TIP } from '../src/sword.js';

await RAPIER.init();
const { Vector3: V3, Quaternion: Q } = THREE;
const rig = buildRig(JSON.parse(fs.readFileSync(new URL('../src/profile.json', import.meta.url)))), ghost = new Ghost(rig), I = rig.idx, B = rig.bodies;
const layer = new SwordLayer(); ghost.layer = layer; layer.act = 1; ghost.begin(null, new V3(), 0, 0);
const P_LIST = Array.from({ length: 21 }, (_, k) => k / 20);
if (process.env.START) Object.assign(TUNE, JSON.parse(process.env.START));

// ---- proxies as Rapier shapes
const shapeOf = (f) => (f.shape === 'capsule' ? new RAPIER.Capsule(f.hh, f.r) : f.shape === 'ball' ? new RAPIER.Ball(f.r) : new RAPIER.RoundCuboid(f.h[0] - f.r, f.h[1] - f.r, f.h[2] - f.r, f.r));
const shapes = B.map((b) => shapeOf(b.prox)), loc = B.map((b) => ({ c: new V3(...b.prox.c), q: b.prox.shape === 'capsule' ? new Q(...b.prox.q) : new Q() }));
const pairs = [];
for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) if (collides(groupOf(B[i].name), groupOf(B[j].name))) pairs.push([i, j]);
const wq = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const dist = (sa, pa, qa, sb, pb, qb) => { const c = sa.contactShape(pa, wq(qa), sb, pb, wq(qb), 0.2); return c ? c.distance : 0.2; };
const MARGIN = 0.004;
const pen = (d) => Math.max(0, MARGIN - d);
const holding = new Set(['handR', 'forearmR', 'handL', 'forearmL'].map((n) => I[n]));
const blade = new RAPIER.Capsule((TIP - 0.07) / 2 - 0.02, 0.02), scab = new RAPIER.Capsule(0.36, 0.034), hilt = new RAPIER.Capsule(0.07, 0.026);
const capAlong = (origin, dirUp, off, len) => ({ pos: origin.clone().addScaledVector(dirUp, off), len }); // helper (unused shapes keep their own half-length)
const Yq = (dir) => new Q().setFromUnitVectors(new V3(0, 1, 0), dir);

// joint limit excess (rad), same maths as the controller
const hinge = (q, a) => { let g = 2 * Math.atan2(q.x * a[0] + q.y * a[1] + q.z * a[2], q.w); return g > Math.PI ? g - 2 * Math.PI : g < -Math.PI ? g + 2 * Math.PI : g; };
function excess(def, rel) {
  const j = def.joint;
  if (j.type === 'hinge') { const a = hinge(rel, j.axis); return Math.max(0, j.lim[0] - a, a - j.lim[1]); }
  const refQ = new Q(...j.ref), n = new V3(...j.limb).applyQuaternion(refQ).normalize();
  const d = rel.clone().multiply(refQ.clone().invert()); if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
  const p = d.x * n.x + d.y * n.y + d.z * n.z, tw = new Q(n.x * p, n.y * p, n.z * p, d.w);
  if (tw.length() < 1e-6) tw.set(0, 0, 0, 1); else tw.normalize();
  const sq = d.clone().multiply(tw.clone().invert()); if (sq.w < 0) { sq.x = -sq.x; sq.y = -sq.y; sq.z = -sq.z; sq.w = -sq.w; }
  const sl = Math.hypot(sq.x, sq.y, sq.z), sv = sl < 1e-9 ? new V3() : new V3(sq.x, sq.y, sq.z).multiplyScalar((2 * Math.atan2(sl, sq.w)) / sl);
  let ex = 0;
  for (const k of ['x', 'y', 'z']) { const lim = j.sw[k]; if (lim) ex += Math.max(0, lim[0] - sv[k], sv[k] - lim[1]) ** 2; }
  const ta = 2 * Math.atan2(p, d.w); ex += Math.max(0, j.tw[0] - ta, ta - j.tw[1]) ** 2;
  return Math.sqrt(ex);
}

function evaluate(detail = false) {
  rebuild();
  let cost = 0, rows = [];
  for (const p of P_LIST) {
    layer.p = p; layer.walkW = 0;
    const g = ghost.poseAt(ghost.duration + 1);
    const eL = g.err[1], eR = g.err[3];
    let viol = 0;
    for (const n of ['upperArmR', 'forearmR', 'handR', 'upperArmL', 'forearmL', 'handL', 'abdomen', 'chest', 'head']) viol += excess(B[I[n]], g.ql[I[n]]) ** 2;
    // body parts inside each other
    const pos = B.map((_, i) => loc[i].c.clone().applyQuaternion(g.Qw[i]).add(g.P[i])), rot = B.map((_, i) => g.Qw[i].clone().multiply(loc[i].q));
    let self = 0, worst = 0, worstPair = '';
    for (const [i, j] of pairs) { const d = dist(shapes[i], pos[i], rot[i], shapes[j], pos[j], rot[j]), e = pen(d); if (e > 0) { self += e * e; if (e > worst) { worst = e; worstPair = B[i].name + '/' + B[j].name; } } }
    // the sword: blade (in the hand), or scabbard + hilt (hanging)
    let sw = 0, swWorst = 0, swPair = '';
    const hp = layer.hp, test = (shape, P0, Q0, skip, tag, allow = 0) => { for (let i = 0; i < B.length; i++) { if (skip.has(i)) continue; const d = dist(shape, P0, Q0, shapes[i], pos[i], rot[i]), e = Math.max(0, MARGIN - allow - d); if (e > 0) { sw += e * e; if (e > swWorst) { swWorst = e; swPair = tag + '/' + B[i].name; } } } };
    if (p > 0.3) { // sword in the right hand (before: still on the holder axis, same maths through dbg)
      const s = layer.dbg ?? swordInHand(g.P[I.handR], g.Qw[I.handR]), up = new V3(0, 1, 0).applyQuaternion(s.quat);
      test(blade, s.pos.clone().addScaledVector(up, -(TIP / 2 + 0.03)), s.quat, holding, 'blade');
    }
    if (p < 0.62) { // scabbard hanging off the belt (+ the hilt above its mouth while the sword is still in)
      const ax = hp.axis, skipS = new Set([I.pelvis]), q = Yq(ax);
      test(scab, hp.mouth.clone().addScaledVector(ax, -0.39), q, new Set([I.pelvis, I.handL, I.forearmL]), 'scabbard', 0.022); // (skirt cloth and hip plates give way a little)
      if (p < 0.3) test(hilt, hp.mouth.clone().addScaledVector(ax, 0.13), q, new Set([I.pelvis, I.handL, I.forearmL, I.handR, I.forearmR]), 'hilt');
    }
    cost += 4000 * (eL * eL + eR * eR) + 40 * viol + 8000 * (self + sw);
    if (detail) rows.push(`${p.toFixed(2)}  errL ${eL.toFixed(3)} errR ${eR.toFixed(3)}  limitExcess ${Math.sqrt(viol).toFixed(2)} rad  overlap ${(worst * 100).toFixed(1)} cm ${worstPair}  sword ${(swWorst * 100).toFixed(1)} cm ${swPair}`);
  }
  const s = TUNE.spine; cost += 0.002 * (s.abdT + s.chestT + s.abd + s.chest + Math.abs(s.abdS) + Math.abs(s.chestS) + s.head);
  const rb = TUNE.readyB; cost += 1.5 * (rb[0] / Math.hypot(...rb)) ** 2 + 3 * (TUNE.readyGrip[0] + 0.1) ** 2; // prefer a centred guard
  const rbn = new V3(...TUNE.readyB).normalize(); cost += 30 * Math.max(0, 0.25 - rbn.z) ** 2 + 10 * Math.max(0, 0.45 - rbn.y) ** 2; // the guard points up and forward, never back over the head
  cost += 0.2 * (TUNE.grab[0] ** 2 + TUNE.grab[1] ** 2 + TUNE.grab[2] ** 2) + 0.01 * (TUNE.back - 28) ** 2 / 100 + 0.01 * (TUNE.out - 9) ** 2 / 100; // modest carrying of the holder, natural hang (a scabbard hangs close to the vertical)
  return detail ? { cost, rows } : cost;
}

// ---- hill climbing over the parameters (bounds keep it plausible)
const SPEC = [['mouth.0', 0.17, 0.27], ['mouth.1', 0.04, 0.2], ['mouth.2', -0.05, 0.12], ['back', 15, 40], ['out', 2, 16],
  ['grab.0', -0.2, 0.1], ['grab.1', -0.15, 0.15], ['grab.2', -0.1, 0.2],
  ['gripRoll', +(process.env.ROLL_LO ?? -180), +(process.env.ROLL_HI ?? 180)],
  ['drawDir.0', -0.95, 0.2], ['drawDir.1', 0.1, 0.95], ['drawDir.2', -0.4, 0.95], ['drawDir2.0', -0.95, 0.4], ['drawDir2.1', 0.1, 0.95], ['drawDir2.2', -0.4, 0.95],
  ['readyB.0', -0.6, 0.6], ['readyB.1', 0.2, 1], ['readyB.2', -0.2, 1], ['readyGrip.0', -0.3, 0.1], ['readyGrip.1', 0.2, 0.5], ['readyGrip.2', 0.12, 0.45],
  ['arc.0', -0.25, 0.1], ['arc.1', 0, 0.3], ['arc.2', 0, 0.3],
  ['spine.abdT', 0, 30], ['spine.chestT', 0, 40], ['spine.abd', 0, 20], ['spine.chest', 0, 25], ['spine.abdS', -12, 12], ['spine.chestS', -12, 12], ['spine.head', 0, 20],
  ['leftHold.0', -0.1, 0.1], ['leftHold.1', -0.05, 0.12], ['leftHold.2', 0, 0.1], ['rest.0', 0.06, 0.24], ['rest.1', -0.06, 0.08], ['rest.2', -0.08, 0.08]];
const get = (path) => path.split('.').reduce((o, k) => o[k], TUNE);
const set = (path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], TUNE)[last] = v; };
for (const o of (process.env.BOUNDS ?? '').split(',').filter(Boolean)) { const [k, lo, hi] = o.split(':'), e = SPEC.find((x) => x[0] === k); e[1] = +lo; e[2] = +hi; } // BOUNDS="mouth.2:-0.02:0.07,..."
SPEC.forEach(([p, lo, hi]) => set(p, Math.min(hi, Math.max(lo, get(p))))); // start inside the bounds
let seed = +(process.argv[3] ?? 7); const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
let best = evaluate(), bestVals = SPEC.map(([p]) => get(p));
console.log('start cost', best.toFixed(2));
const N = +(process.argv[2] ?? 1500);
for (let it = 0; it < N; it++) {
  const nPar = 1 + Math.floor(rnd() * 3), old = SPEC.map(([p]) => get(p));
  for (let k = 0; k < nPar; k++) { const [p, lo, hi] = SPEC[Math.floor(rnd() * SPEC.length)]; set(p, Math.min(hi, Math.max(lo, get(p) + gauss() * (hi - lo) * 0.12))); }
  const c = evaluate();
  if (c < best) { best = c; bestVals = SPEC.map(([p]) => get(p)); } else SPEC.forEach(([p], i) => set(p, old[i]));
  if (it % 250 === 249) console.log('iter', it + 1, 'cost', best.toFixed(2));
}
SPEC.forEach(([p], i) => set(p, bestVals[i]));
const r = evaluate(true);
console.log('\nBEST cost', r.cost.toFixed(2)); console.log(JSON.stringify(TUNE)); console.log(r.rows.join('\n'));
