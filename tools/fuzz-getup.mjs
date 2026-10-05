// Robustness: knock the knight over in random directions / strengths (and, optionally, while walking or holding the sword) and check he
// ends up standing upright. usage: node tools/fuzz-getup.mjs [trials] [seed] [mode: plain|walk|sword]
import fs from 'node:fs';
import * as THREE from '#three';
import { Knight } from '../src/knight.js';
import { loadChar } from './rig-util.mjs';

const N = +(process.argv[2] ?? 8), mode = process.argv[4] ?? 'plain';
let seed = +(process.argv[3] ?? 1); const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const profile = JSON.parse(fs.readFileSync(new URL('../src/profile.json', import.meta.url))), V3 = THREE.Vector3;
let fails = 0;
for (let n = 0; n < N; n++) {
  const k = await loadChar(), I = k.rig.idx;
  k.ragdoll = [0.1, 0.25, 0.4][Math.floor(rnd() * 3)];
  const ang = rnd() * Math.PI * 2, imp = 90 + rnd() * 110, dir = new V3(Math.sin(ang), 0.05 + rnd() * 0.15, Math.cos(ang));
  for (let s = 0; s < 120; s++) k.step();
  if (mode === 'sword') { k.sword.request(true); for (let s = 0; s < 120 * (1 + rnd() * 3); s++) k.step(); }
  if (mode === 'walk') { k.walk.command(new V3(0, 0, 1), 1); for (let s = 0; s < 120 * (2 + rnd() * 2); s++) k.step(); }
  k.knockDown(dir, imp);
  for (let s = 0; s < 120 * 34; s++) k.step();
  k.readState();
  const up = new V3(0, 1, 0).applyQuaternion(k.b[I.chest].q), tilt = (Math.acos(Math.min(1, up.y)) * 180) / Math.PI, y = k.b[I.head].p.y;
  const ok = k.state === 'stand' && tilt < 12 && y > 1.25;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} rag ${k.ragdoll} dir ${((ang * 180) / Math.PI).toFixed(0).padStart(3)}° impulse ${imp.toFixed(0)} -> ${k.state} tilt ${tilt.toFixed(0)}° head ${y.toFixed(2)}`);
}
console.log(`${mode}: ${N - fails}/${N} stood up`);
