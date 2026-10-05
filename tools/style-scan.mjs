// Try walk-style variants of a rig and print foot tracking error / touchdown speed / wobble for each. usage: RIG=robot node tools/style-scan.mjs 'mech=0.7,lift=0.06' 'mech=0.85' ...
import * as THREE from '#three';
import { loadChar, rigName } from './rig-util.mjs';
import { RIGS } from '../src/rigs.js';
import { worldPose } from '../src/ghost.js';
const V3 = THREE.Vector3, spec = RIGS[rigName()], base = { ...spec.style };
for (const arg of process.argv.slice(2)) {
  spec.style = { ...base };
  for (const kv of arg.split(',')) { const [k, v] = kv.split('='); if (k.startsWith('run.')) spec.style.run = { ...spec.style.run, [k.slice(4)]: +v }; else spec.style[k] = +v; }
  const k = await loadChar(), I = k.rig.idx; k.ragdoll = 0.25;
  for (let s = 0; s < 240; s++) k.step();
  k.walk.command(new V3(0, 0, 1), 1, process.env.RUN === '1');
  const err = [], land = [], gs = []; let prevSw = null, maxTilt = 0, prevG = null;
  for (let s = 0; s < 120 * 8; s++) {
    const sw0 = k.walk.foot ? { L: k.walk.foot.L.sw, R: k.walk.foot.R.sw } : null;
    k.step(); k.readState();
    if (s < 120 * 2) continue;
    const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql);
    for (const sd of ['L', 'R']) { const g = w.P[I['foot' + sd]]; if (prevG) gs.push(g.distanceTo(prevG[sd]) * 120); }
    prevG = { L: w.P[I.footL].clone(), R: w.P[I.footR].clone() };
    for (const sd of ['L', 'R']) err.push(w.P[I['foot' + sd]].distanceTo(k.b[I['foot' + sd]].p));
    if (sw0 && k.walk.foot) for (const sd of ['L', 'R']) if (sw0[sd] && !k.walk.foot[sd].sw) land.push(-k.b[I['foot' + sd]].rb.linvel().y);
    maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(k.b[I.chest].q).y)) * 57.3);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const p95 = [...gs].sort((a, b) => a - b)[Math.floor(gs.length * 0.95)];
  console.log(`${arg.padEnd(48)} foot error ${(mean(err) * 100).toFixed(1)} cm | ghost foot speed p95 ${p95.toFixed(1)} m/s | touchdown speed mean ${mean(land).toFixed(2)} max ${Math.max(...land).toFixed(2)} m/s | state ${k.state} tilt ${maxTilt.toFixed(0)}°`);
}
