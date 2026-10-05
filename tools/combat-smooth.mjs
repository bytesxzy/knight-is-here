// How smooth is the combat? Runs scripted fights (a held light attack, heavy attacks, optional walking) in the physics sim and measures, per physics step,
//  - the GHOST (the animation as authored): hand targets and joint rotations -> "pops" = velocity / acceleration jumps in a single step
//  - the PHYSICAL body (what is drawn): jitter of the hands / chest / head / pelvis (acceleration above ~6 Hz) and the hands' error against the ghost
// usage: [RIG=knight|skeleton|robot] node tools/combat-smooth.mjs [fists|sword|heavy|walk|mixed|special] [seconds] [verbose]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion, mode = process.argv[2] ?? 'fists', secs = +(process.argv[3] ?? 8), verbose = process.argv.includes('verbose');
const k = await loadChar(), I = k.rig.idx, L = k.sword, h = 1 / 120, f = (x, d = 1) => x.toFixed(d);
k.ragdoll = 0.25;
for (let s = 0; s < 240; s++) k.step();
if (mode === 'sword' && L.request) { L.request(true); for (let s = 0; s < 5 * 120; s++) k.step(); }
const names = ['handL', 'handR', 'forearmL', 'forearmR', 'upperArmL', 'upperArmR', 'chest', 'abdomen', 'head'];
const joints = ['upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR', 'chest', 'abdomen', 'head'];
const hist = []; // per step: ghost world positions of the hands / angular velocities of the joints / physical positions
let prev = null, prevW = null;
const stat = { pops: [], gj: {}, ph: {} };
const series = (o, key, v) => (o[key] ??= []).push(v);
const sw = (c) => [...(c.fists?.sw ?? []), ...(c.swings ?? []), ...(c.sw ?? [])].map((s) => `${s.kind}@${s.t.toFixed(2)}`).join(',');
let nextHeavy = 1.0, t = 0, nextSp = 0.8, spI = 0; const SPK = process.env.KEYS ? process.env.KEYS.split('') : ['Q', 'R', 'F'];
if (mode === 'walk') k.walk.command(new V3(0, 0, 1), 1, !!k.walk.canRun && !!process.env.RUN);
const total = Math.round(secs * 120);
for (let s = 0; s < total; s++, t += h) {
  const heavy = mode === 'heavy' || mode === 'mixed';
  if (mode !== 'heavy' && mode !== 'special') L.attackHeld = true;
  if (mode === 'special' && t >= nextSp) { L.special(SPK[spI++ % SPK.length]); nextSp = t + 1.5; }
  if (heavy && t >= nextHeavy) { L.attack(true); nextHeavy = t + (mode === 'mixed' ? 2.6 : 1.6); }
  k.step(); k.readState();
  if (k.state !== 'stand') { console.log(`FELL at t=${f(t, 2)}`); break; }
  const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql);
  const cur = { P: {}, R: {}, ph: {}, sw: sw(L) };
  for (const n of names) cur.P[n] = w.P[I[n]].clone();
  for (const n of joints) cur.R[n] = e.ql[I[n]].clone();
  for (const n of ['handL', 'handR', 'chest', 'head', 'pelvis']) cur.ph[n] = (n === 'pelvis' ? k.b[0] : k.b[I[n]]).p.clone();
  cur.herr = ['L', 'R'].map((S) => k.b[I['hand' + S]].p.distanceTo(w.P[I['hand' + S]]));
  if (prev) {
    const v = {}, ang = {};
    for (const n of names) v[n] = cur.P[n].clone().sub(prev.P[n]).divideScalar(h);
    for (const n of joints) { const d = prev.R[n].clone().invert().multiply(cur.R[n]); let a = 2 * Math.acos(Math.min(1, Math.abs(d.w))); ang[n] = a / h; }
    const pv = {};
    for (const n of Object.keys(cur.ph)) pv[n] = cur.ph[n].clone().sub(prev.ph[n]).divideScalar(h);
    cur.v = v; cur.ang = ang; cur.pv = pv;
    if (prev.v) {
      for (const n of ['handL', 'handR', 'chest', 'head']) { const a = v[n].clone().sub(prev.v[n]).divideScalar(h).length(); series(stat.gj, 'a_' + n, a); if (a > 2500) stat.pops.push(`t=${f(t, 2)} ${n} ghost accel ${f(a, 0)} m/s² [${cur.sw}]`); }
      for (const n of joints) { const da = Math.abs(ang[n] - prev.ang[n]) / h; series(stat.gj, 'w_' + n, da); if (da > 900) stat.pops.push(`t=${f(t, 2)} ${n} ghost angular accel ${f(da, 0)} rad/s² [${cur.sw}]`); }
      for (const n of ['handL', 'handR', 'chest', 'head', 'pelvis']) { const a = pv[n].clone().sub(prev.pv[n]).divideScalar(h); series(stat.ph, n, a); }
    }
  }
  prevW = prev; prev = cur;
  if (cur.herr) series(stat.ph, 'herr', Math.max(...cur.herr));
  if (verbose && s % 6 === 0) console.log(`t=${f(t, 2)} ${cur.sw.padEnd(22)} hand err ${f(Math.max(...cur.herr) * 100)} cm  handR speed ${f(prev.v?.handR.length() ?? 0)} m/s`);
}
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)] ?? 0;
const hp = (arr) => { // acceleration above ~6 Hz: subtract a 1/12 s moving average, magnitude
  const n = 10, out = [];
  for (let i = n; i < arr.length - n; i++) { const m = new V3(); for (let j = -n; j <= n; j++) m.add(arr[i + j]); m.divideScalar(2 * n + 1); out.push(arr[i].clone().sub(m).length()); }
  return out;
};
console.log(`== ${process.env.RIG ?? 'knight'} ${mode} ${secs}s (state ${k.state})`);
console.log('GHOST (the authored animation)      p99 / max');
for (const n of ['handL', 'handR', 'chest', 'head']) { const a = stat.gj['a_' + n]; if (a) console.log(`  ${n.padEnd(10)} accel m/s²   ${f(q(a, 0.99), 0).padStart(6)} / ${f(Math.max(...a), 0).padStart(6)}`); }
for (const n of joints) { const a = stat.gj['w_' + n]; if (a) console.log(`  ${n.padEnd(10)} ang acc rad/s² ${f(q(a, 0.99), 0).padStart(6)} / ${f(Math.max(...a), 0).padStart(6)}`); }
console.log('PHYSICAL (what you see)             jitter p99 / max (m/s², >6 Hz)');
for (const n of ['handL', 'handR', 'chest', 'head', 'pelvis']) { const a = stat.ph[n]; if (a) { const j = hp(a); console.log(`  ${n.padEnd(10)} ${f(q(j, 0.99), 1).padStart(7)} / ${f(Math.max(...j), 1).padStart(7)}`); } }
console.log(`  hand error vs ghost: mean ${f(stat.ph.herr.reduce((a, b) => a + b, 0) / stat.ph.herr.length * 100)} cm, p95 ${f(q(stat.ph.herr, 0.95) * 100)} cm, max ${f(Math.max(...stat.ph.herr) * 100)} cm`);
console.log(`POPS (ghost accel > 2500 m/s² or angular accel > 900 rad/s²): ${stat.pops.length}`);
const big = stat.pops.map((p) => ({ p, v: +p.match(/accel (\d+)/)[1], t: +p.match(/t=([\d.]+)/)[1] })).filter((x) => x.t > (+process.env.AFTER || 0.4)).sort((a, b) => b.v - a.v).slice(0, +(process.env.TOP || 8));
console.log(`  worst after t=${process.env.AFTER || 0.4}:`); for (const x of big) console.log('  ' + x.p);
