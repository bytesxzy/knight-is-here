// Per-step cost of the physics + animation (ms), while walking. usage: node tools/perf.mjs [sword]
import fs from 'node:fs';
import * as THREE from '#three';
import { Knight } from '../src/knight.js';
import { loadChar } from './rig-util.mjs';
const k = await loadChar();
const V3 = THREE.Vector3;
if (process.argv.includes('sword')) { k.sword.act = 1; k.sword.p = 1; }
for (let i = 0; i < 240; i++) k.step();
k.walk.command(new V3(0, 0, 1), 1);
const ts = [];
for (let i = 0; i < 120 * 8; i++) { const t0 = performance.now(); k.step(); k.readState(); ts.push(performance.now() - t0); }
ts.sort((a, b) => a - b);
const q = (p) => ts[Math.floor(p * (ts.length - 1))].toFixed(2);
console.log(`step ms: mean ${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2)}  p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${q(1)}  (budget at 60 fps = 2 steps/frame -> ${(2 * ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1)} ms of 16.7)`);
