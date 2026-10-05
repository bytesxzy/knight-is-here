// How smooth are the turns? Walks, turns 45 / 90 / 180 degrees (and pivots from standing) in the physics sim and reports the heading dynamics
// (peak turn rate, peak turn acceleration, jerk), the speed dip, and how steadily the physical pelvis / chest yaw moves.
// usage: node tools/turn-check.mjs [rig]
import fs from 'node:fs';
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';

const k = await loadChar(process.argv[2] ?? 'knight'), V3 = THREE.Vector3, I = k.rig.idx, DT = 1 / 120, f = (x, d = 1) => x.toFixed(d);
const yawOf = (q) => Math.atan2(new V3(0, 0, 1).applyQuaternion(q).x, new V3(0, 0, 1).applyQuaternion(q).z);
function scenario(name, angDeg, startSpeed) {
  k.reset(); for (let i = 0; i < 120; i++) k.step();
  if (startSpeed) { k.walk.command(new V3(0, 0, 1), startSpeed, process.env.RUN === '1'); for (let i = 0; i < 120 * 4; i++) k.step(); }
  const a = (angDeg * Math.PI) / 180, dir = new V3(Math.sin(a), 0, Math.cos(a));
  k.walk.command(dir, 1, process.env.RUN === '1');
  const psi = [], vv = [], chestYaw = [], pelvYaw = [], t = [];
  for (let i = 0; i < 120 * 4; i++) { k.step(); k.readState(); psi.push(k.ghost.psi); vv.push(k.walk.v); chestYaw.push(yawOf(k.b[I.chest].q)); pelvYaw.push(yawOf(k.b[0].q)); t.push(i * DT); }
  const unwrap = (arr) => { const o = [arr[0]]; for (let i = 1; i < arr.length; i++) { let d = arr[i] - arr[i - 1]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; o.push(o[i - 1] + d); } return o; };
  const d1 = (arr) => arr.map((_, i) => (i ? (arr[i] - arr[i - 1]) / DT : 0)), P = unwrap(psi), w = d1(P), al = d1(w), jk = d1(al);
  const smooth = (arr, n = 12) => arr.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - n); j <= Math.min(arr.length - 1, i + n); j++) { s += arr[j]; c++; } return s / c; });
  const wChest = smooth(d1(unwrap(chestYaw))), wP = smooth(d1(unwrap(pelvYaw)));
  const done = P.findIndex((p, i) => Math.abs(p - P[P.length - 1]) < 0.05 && P.slice(i).every((q) => Math.abs(q - P[P.length - 1]) < 0.05));
  const hf = (arr) => { const lp = smooth(arr, 15); return Math.sqrt(arr.reduce((s, x, i) => s + (x - lp[i]) ** 2, 0) / arr.length); };
  const vmin = Math.min(...vv.slice(0, 360)), vmax = Math.max(...vv);
  console.log(`${name.padEnd(26)} turn ${f((P[P.length - 1] - P[0]) * 57.3, 0).padStart(4)}° done in ${f((done < 0 ? 4 : done * DT), 2)} s | peak rate ${f(Math.max(...w.map(Math.abs)), 2)} rad/s, peak accel ${f(Math.max(...smooth(al, 3).map(Math.abs)), 1)} rad/s², peak jerk ${f(Math.max(...smooth(jk, 6).map(Math.abs)), 0)} | speed ${f(startSpeed ? Math.max(...vv.slice(0, 20)) : 0, 2)} -> min ${f(vmin, 2)} | physical chest/pelvis rate peaks ${f(Math.max(...wChest.map(Math.abs)), 2)} / ${f(Math.max(...wP.map(Math.abs)), 2)} rad/s, chest rate wobble ${f(hf(wChest), 3)}`);
}
scenario('90° at full speed', 90, 1); scenario('45° at full speed', 45, 1); scenario('180° reversal at speed', 180, 1); scenario('90° at half speed', 90, 0.5); scenario('pivot 90° from standing', 90, 0); scenario('pivot 180° from standing', 180, 0);
