// Foot speeds while running: the ghost's planned foot vs the physical foot (peak / 95th percentile / tracking error). RIG=skeleton node tools/foot-speed.mjs [ragdoll]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';
const V3 = THREE.Vector3, k = await loadChar(); k.ragdoll = +(process.argv[2] ?? 0.25);
const I = k.rig.idx, W = k.walk, gp = [], pp = [], err = [], y = { g: [], p: [] };
let prevG = null, prevP = null;
const go = (sec, rec) => { for (let s = 0; s < sec * 120; s++) {
  k.step(); k.readState();
  if (!rec) continue;
  const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql);
  for (const sd of ['L', 'R']) {
    const g = w.P[I['foot' + sd]], p = k.b[I['foot' + sd]].p;
    if (prevG) { gp.push(g.distanceTo(prevG[sd]) * 120); pp.push(p.distanceTo(prevP[sd]) * 120); }
    err.push(g.distanceTo(p)); y.g.push(g.y); y.p.push(p.y);
  }
  prevG = { L: w.P[I.footL].clone(), R: w.P[I.footR].clone() }; prevP = { L: k.b[I.footL].p.clone(), R: k.b[I.footR].p.clone() };
} };
go(2); W.command(new V3(0, 0, 1), 1, true); go(4); go(5, true);
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
const f = (x) => x.toFixed(2);
console.log(`ghost foot speed: p50 ${f(q(gp, 0.5))} p95 ${f(q(gp, 0.95))} max ${f(Math.max(...gp))} | physical: p50 ${f(q(pp, 0.5))} p95 ${f(q(pp, 0.95))} max ${f(Math.max(...pp))}`);
console.log(`foot tracking error: mean ${f(err.reduce((a, b) => a + b) / err.length * 100)} cm, p95 ${f(q(err, 0.95) * 100)} cm; foot height ghost max ${f(Math.max(...y.g) * 100)} cm physical max ${f(Math.max(...y.p) * 100)} cm`);
