// How smooth is the walk? Runs idle -> walk -> turn -> stop in the physics sim and reports, per tracked point, the high-frequency
// acceleration (m/s^2, everything above ~6 Hz: gait clunks, impacts, jitter), plus foot touchdown speeds.
// usage: node tools/smooth-check.mjs [ragdoll] [sword] [trace]
import fs from 'node:fs';
import * as THREE from '#three';
import { Knight, LEG, FOOT, TORSO } from '../src/knight.js';
import { loadChar } from './rig-util.mjs';
for (const a of process.argv) { const m = /^(boost|ff)=(.+)$/.exec(a); if (m) LEG[m[1]] = +m[2]; const n = /^f(k|c|max)=(.+)$/.exec(a); if (n) FOOT[n[1]] = +n[2]; const q = /^(chest|head)(k|z)=(.+)$/.exec(a); if (q) TORSO[q[1]][q[2]] = +q[3]; }
import { worldPose } from '../src/ghost.js';

const rag = +(process.argv[2] && !isNaN(+process.argv[2]) ? process.argv[2] : 0.25), withSword = process.argv.includes('sword');
const V3 = THREE.Vector3, k = await loadChar(); k.ragdoll = rag;
if (process.argv.includes('nosc')) k.setSelfCollision(false);
const I = k.rig.idx, DT = 1 / 120, f = (x, d = 2) => x.toFixed(d);
const pts = { pelvis: 'pelvis', chest: 'chest', head: 'head', handL: 'handL', handR: 'handR', footL: 'footL', footR: 'footR', kneeL: 'shinL', kneeR: 'shinR' };
const rec = Object.fromEntries(Object.keys(pts).map((n) => [n, []])), rel = Object.fromEntries(Object.keys(pts).map((n) => [n, []]));
const phaseRec = [], rotRec = { pelvis: [], chest: [] }, mark = [], land = [], gh = { pelvis: [], footL: [], footR: [], handL: [], handR: [] }; // gh: the ghost's own targets
let t = 0;
const run = (sec, tag) => {
  for (let s = 0; s < sec * 120; s++, t += DT) {
    const sw0 = k.walk.foot ? { L: k.walk.foot.L.sw, R: k.walk.foot.R.sw } : null;
    k.step(); k.readState();
    for (const [n, b] of Object.entries(pts)) { const p = k.b[I[b]].p; rec[n].push(p.clone()); rel[n].push(p.clone().sub(k.b[0].p)); }
    { const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql); for (const n of Object.keys(gh)) gh[n].push(w.P[I[n]].clone()); }
    rotRec.pelvis.push(k.b[0].q.clone()); rotRec.chest.push(k.b[I.chest].q.clone());
    mark.push(tag); phaseRec.push(k.walk.foot ? k.walk.phaseOf('L') : 0);
    if (sw0 && k.walk.foot) for (const sd of ['L', 'R']) if (sw0[sd] && !k.walk.foot[sd].sw) land.push({ t, sd, i: rec.pelvis.length - 1 });
  }
};
run(1.5, 'idle');
if (withSword) { k.sword.request(true); run(3.2, 'draw'); }
const THR = +((process.argv.find((a) => a.startsWith('thr=')) ?? 'thr=1').slice(4));
k.walk.command(new V3(0, 0, 1), THR); run(7, 'walk');
k.walk.command(new V3(1, 0, 0), 1); run(3, 'turn');
k.walk.command(null, 0); run(3, 'stop');

// high-frequency acceleration: second difference minus its 0.15 s moving average
const hp = (arr, comp) => {
  const a = arr.map((_, i) => (i && i < arr.length - 1 ? (arr[i + 1][comp] - 2 * arr[i][comp] + arr[i - 1][comp]) / (DT * DT) : 0)), W = 9, out = [];
  for (let i = 0; i < a.length; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(a.length - 1, i + W); j++) { s += a[j]; n++; } out.push(a[i] - s / n); }
  return out;
};
const stat = (arr, from, to) => { // arr of V3 -> {rms, max, at}
  let ss = 0, n = 0, mx = 0, at = 0;
  const h = ['x', 'y', 'z'].map((c) => hp(arr, c));
  for (let i = from; i < to; i++) { const m = Math.hypot(h[0][i], h[1][i], h[2][i]); ss += m * m; n++; if (m > mx) { mx = m; at = i; } }
  return { rms: Math.sqrt(ss / n), max: mx, at: at * DT };
};
const i0 = mark.indexOf('walk'), i1 = mark.lastIndexOf('walk') + 1;
console.log(`walking segment ${f(i0 * DT, 1)}s..${f(i1 * DT, 1)}s  (ragdoll ${rag}${withSword ? ', sword drawn' : ''})`);
console.log('point        world: rms  max@t        |  pelvis-relative: rms  max@t');
for (const n of Object.keys(pts)) {
  const a = stat(rec[n], i0 + 120, i1), r = stat(rel[n], i0 + 120, i1);
  console.log(n.padEnd(8), `${f(a.rms, 1).padStart(8)} ${f(a.max, 0).padStart(6)}@${f(a.at, 2)}      | ${f(r.rms, 1).padStart(8)} ${f(r.max, 0).padStart(6)}@${f(r.at, 2)}`);
}
if (process.argv.includes('spikes')) { // the biggest pelvis spikes: when, how big, which part of the gait cycle
  const h3 = ['x', 'y', 'z'].map((c) => hp(rec.pelvis, c)), m = h3[0].map((_, i) => Math.hypot(h3[0][i], h3[1][i], h3[2][i])), top = [];
  for (let i = i0; i < i1; i++) if (m[i] > 12 && m[i] >= m[i - 1] && m[i] >= m[i + 1]) top.push([i, m[i]]);
  console.log('pelvis spikes >12 m/s^2:', top.map(([i, v]) => `${f(i * DT, 2)}s(${f(v, 0)}, phL ${f(phaseRec[i], 2)})`).join('  '));
}
if (process.argv.includes('spikes')) { // spikes of the ghost's own hand target
  const hg = ['x', 'y', 'z'].map((c) => hp(gh.handL, c)), mg = hg[0].map((_, i) => Math.hypot(hg[0][i], hg[1][i], hg[2][i])), top = [];
  for (let i = i0; i < i1; i++) if (mg[i] > 100) top.push([i, mg[i]]);
  console.log('ghost handL spikes >100 m/s^2:', top.slice(0, 12).map(([i, v]) => `${f(i * DT, 2)}s(${f(v, 0)}, ${mark[i]})`).join('  '));
}
// the ghost's own targets (if these are rough, the planner is the cause, not the physics)
console.log('ghost targets (world): ' + Object.keys(gh).map((n) => `${n} ${f(stat(gh[n], i0 + 120, i1).rms, 1)}`).join('  '));
// torso wobble while walking straight (steady part): side-to-side travel (cm p-p), roll and yaw (deg p-p) of pelvis / chest, head sway
{ const from = i0 + 240, ptp = (arr) => Math.max(...arr.slice(from, i1)) - Math.min(...arr.slice(from, i1));
  const roll = (q) => (Math.atan2(new V3(0, 1, 0).applyQuaternion(q).x, new V3(0, 1, 0).applyQuaternion(q).y) * 180) / Math.PI, yaw = (q) => (Math.atan2(new V3(0, 0, 1).applyQuaternion(q).x, new V3(0, 0, 1).applyQuaternion(q).z) * 180) / Math.PI;
  console.log(`wobble (steady walk, p-p): lateral cm pelvis ${f(ptp(rec.pelvis.map((p) => p.x)) * 100, 1)} chest ${f(ptp(rec.chest.map((p) => p.x)) * 100, 1)} head ${f(ptp(rec.head.map((p) => p.x)) * 100, 1)} | roll deg pelvis ${f(ptp(rotRec.pelvis.map(roll)), 1)} chest ${f(ptp(rotRec.chest.map(roll)), 1)} | yaw deg pelvis ${f(ptp(rotRec.pelvis.map(yaw)), 1)} chest ${f(ptp(rotRec.chest.map(yaw)), 1)} | head height cm ${f(ptp(rec.head.map((p) => p.y)) * 100, 1)}`); }
// how far the physical feet are from the ghost's feet (world, cm)
{ const e = ['L', 'R'].flatMap((s) => rec['foot' + s].slice(i0 + 120, i1).map((p, i) => p.distanceTo(gh['foot' + s][i0 + 120 + i]) * 100)); e.sort((x, y) => x - y);
  console.log(`foot error vs ghost: mean ${f(e.reduce((x, y) => x + y, 0) / e.length, 1)} cm, p90 ${f(e[Math.floor(e.length * 0.9)], 1)} cm, max ${f(e[e.length - 1], 1)} cm`); }
// foot touchdown: physical vertical speed of the foot in the 50 ms after the ghost's foot lands
const dts = [];
for (const e of land) { if (e.t < i0 * DT + 1) continue; const arr = rec['foot' + e.sd]; let vmin = 0; for (let j = e.i; j < Math.min(arr.length - 1, e.i + 6); j++) vmin = Math.min(vmin, (arr[j + 1].y - arr[j].y) / DT); dts.push(vmin); }
console.log(`touchdowns: ${dts.length}, downward foot speed at landing: mean ${f(-dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length), 2)} m/s, worst ${f(-Math.min(...dts), 2)} m/s`);
if (process.argv.includes('trace')) { // pelvis height + both ankle heights every 0.05 s during a gait cycle
  for (let i = i0 + 240; i < i0 + 240 + 130; i += 6) console.log(f(i * DT, 2), 'pelvis y', f(rec.pelvis[i].y, 3), 'footL y', f(rec.footL[i].y, 3), 'footR y', f(rec.footR[i].y, 3));
}
