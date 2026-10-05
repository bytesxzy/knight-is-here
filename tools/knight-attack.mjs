// The knight's attacks in the physics sim (no target): punches (sheathed) or sword swings (drawn), with the torso / hand tracking error and the ghost's reach.
// usage: [RIG=knight] node tools/knight-attack.mjs [punch|sword|heavy|chop] [seconds] [ragdoll] [walk] [verbose]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';
import { swordInHand, TIP } from '../src/sword.js';

const mode = process.argv[2] ?? 'punch', secs = +(process.argv[3] ?? 8), rag = +(process.argv[4] ?? 0.25), walk = process.argv.includes('walk'), verbose = process.argv.includes('verbose');
const V3 = THREE.Vector3, k = await loadChar(), I = k.rig.idx, L = k.sword, f = (x, d = 1) => x.toFixed(d);
k.ragdoll = rag;
for (const [key, v] of Object.entries({ boost: process.env.BOOST, swingHandK: process.env.HK, swingHandMax: process.env.HM, torsoRelax: process.env.TR, worldW: process.env.WW })) if (v !== undefined) L[key] = +v; // experiments
if (process.env.NOSC) k.setSelfCollision(false);
if (process.env.NOSPINE && L.fists) { L.fists.spine = () => {}; L.fists.spineW = () => 0; }
if (process.env.NOARM && L.fists) { const fa = L.fists.arm.bind(L.fists); L.fists.arm = () => null; L.fists.armW = () => 0; }
if (process.env.INERTIA) console.log(k.b.map((b) => b.d.name + ':' + (b.inertia.kind === 'capsule' ? [b.inertia.It, b.inertia.Ia] : b.inertia.kind === 'ball' ? [b.inertia.I] : b.inertia.I).map((x) => x.toFixed(3)).join('/')).join('  '));
const tilt = (q) => Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(q).y)) * 57.3;
for (let s = 0; s < 2 * 120; s++) k.step();
if (mode === 'sword' || mode === 'chop') { L.request(true); for (let s = 0; s < 4 * 120; s++) k.step(); console.log('drawn p =', f(L.p, 2), 'busy', L.busy); }
if (walk) { k.walk.command(new V3(0, 0, 1), 1); for (let s = 0; s < 3 * 120; s++) k.step(); }
let prevQ = null, maxGW = 0, maxGWpel = 0, prevP = null;
let maxTiltDev = 0, maxHand = 0, maxIK = 0, steps = 0, maxChestW = 0, falls = 0;
const heavy = mode === 'heavy' || mode === 'chop';
if (!heavy) L.attackHeld = true;
let nextHeavy = 0;
for (let s = 0; s < secs * 120; s++) {
  if (heavy && s >= nextHeavy) { L.attack(true); nextHeavy = s + 2.2 * 120; }
  k.step(); k.readState(); steps++;
  if (k.state !== 'stand') { falls++; break; }
  const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql), g = k.ghost.poseAt(k.tg);
  { const q = w.Q[I.chest].clone(), qp = w.Q[0].clone(); if (prevQ) { const d = q.clone().multiply(prevQ.clone().invert()), ang = 2 * Math.acos(Math.min(1, Math.abs(d.w))) * 120; maxGW = Math.max(maxGW, ang); if (ang > 15 && process.env.GSPIKE) console.log(`ghost chest spike ${f(ang)} rad/s at t=${f(steps / 120, 3)} swings ${[...(L.fists?.sw ?? []), ...L.swings].map((x) => x.kind + '@' + f(x.t, 3) + ' as=' + f(x.as, 2) + ' ws=' + f(x.ws, 2)).join(' ')}`); const dp = qp.clone().multiply(prevP.clone().invert()); maxGWpel = Math.max(maxGWpel, 2 * Math.acos(Math.min(1, Math.abs(dp.w))) * 120); } prevQ = q; prevP = qp; }
  if (process.env.SPINEDBG && steps > 0.7 * 120 && steps < 0.8 * 120) { const v = k.ghost.sample(k.tg); console.log(`t=${f(steps / 120, 3)} chestT ${f(v.chestT, 2)} abdT ${f(v.abdT, 2)} pyaw ${f(v.pyaw, 2)} chest ${f(v.chest, 2)} abd ${f(v.abd, 2)} headT ${f(v.headT, 2)} chestS ${f(v.chestS, 2)} abdS ${f(v.abdS, 2)} | ${[...(L.fists?.sw ?? [])].map((x) => x.kind + '@' + f(x.t, 3) + ' as=' + f(x.as, 3) + ' ws=' + f(x.ws, 3)).join(' ')}`); }
  const dev = Math.abs(tilt(k.b[I.chest].q) - tilt(w.Q[I.chest])), hR = k.b[I.handR].p.distanceTo(w.P[I.handR]) * 100, hL = k.b[I.handL].p.distanceTo(w.P[I.handL]) * 100;
  maxTiltDev = Math.max(maxTiltDev, dev); maxHand = Math.max(maxHand, hR, hL); maxIK = Math.max(maxIK, g.err[1] * 100, g.err[3] * 100);
  maxChestW = Math.max(maxChestW, k.b[I.chest].rb.angvel().x ** 2 + k.b[I.chest].rb.angvel().y ** 2 + k.b[I.chest].rb.angvel().z ** 2);
  if (verbose && s % (process.env.EVERY ? +process.env.EVERY : 6) === 0) {
    const sw = [...(L.fists?.sw ?? []), ...L.swings].map((x) => `${x.kind}@${f(x.t, 2)}`).join(',');
    const si = swordInHand(k.b[I.handR].p, k.b[I.handR].q), tip = si.pos.clone().addScaledVector(new V3(0, -1, 0).applyQuaternion(si.quat), TIP);
    const gsi = swordInHand(w.P[I.handR], w.Q[I.handR]), gb = new V3(0, -1, 0).applyQuaternion(gsi.quat), pb = new V3(0, -1, 0).applyQuaternion(si.quat), ang = Math.acos(Math.max(-1, Math.min(1, gb.dot(pb)))) * 57.3;
    if (process.env.BLADE) { console.log(`t=${f(s / 120, 2)} [${sw.padEnd(12)}] blade dir ghost (${f(gb.x, 2)},${f(gb.y, 2)},${f(gb.z, 2)}) physical (${f(pb.x, 2)},${f(pb.y, 2)},${f(pb.z, 2)}) off by ${f(ang, 0)}°`); continue; }
    console.log(`t=${f(s / 120, 2)} [${sw.padEnd(12)}] chest tilt ${f(tilt(k.b[I.chest].q), 0).padStart(3)} (ghost ${f(tilt(w.Q[I.chest]), 0).padStart(3)}) hand err R ${f(hR).padStart(5)} L ${f(hL).padStart(5)} cm | IK err R ${f(g.err[3] * 100)} L ${f(g.err[1] * 100)} | tip (${f(tip.x, 2)}, ${f(tip.y, 2)}, ${f(tip.z, 2)}) curl R ${f(L.curl('R'), 2)} L ${f(L.curl('L'), 2)}`);
  }
}
console.log(`ghost chest peak angular speed ${f(maxGW)} rad/s (pelvis ${f(maxGWpel)})`);
console.log(`${mode}${walk ? ' while walking' : ''}: ${steps / 120}s, state=${k.state}${falls ? ' (FELL)' : ''}, max chest tilt deviation ${f(maxTiltDev)}°, max hand tracking error ${f(maxHand)} cm, max ghost IK reach error ${f(maxIK)} cm, peak chest angular speed ${f(Math.sqrt(maxChestW))} rad/s`);
