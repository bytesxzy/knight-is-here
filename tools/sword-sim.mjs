// Headless physics run of draw -> hold -> sheathe (+ optional knock-down mid-draw). usage: node tools/sword-sim.mjs [ragdoll] [interrupt]
import fs from 'node:fs';
import * as THREE from '#three';
import { Knight } from '../src/knight.js';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';

const rag = +(process.argv[2] ?? 0.25), interrupt = process.argv[3] === 'interrupt';
const k = await loadChar(); k.ragdoll = rag;
const I = k.rig.idx, f = (x, d = 2) => x.toFixed(d);
let t = 0, maxErr = { R: 0, L: 0 };
const run = (sec, label, every = 30) => {
  for (let s = 0; s < sec * 120; s++, t += 1 / 120) {
    if (interrupt && label === 'draw' && Math.abs(t - 4.6) < 1 / 240) k.knockDown(new THREE.Vector3(0, 0.1, 1), 130);
    k.step();
    if (s % every === 0) {
      k.readState();
      const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql);
      const eR = k.b[I.handR].p.distanceTo(w.P[I.handR]), eL = k.b[I.handL].p.distanceTo(w.P[I.handL]);
      if (k.sword.p > 0.2 && k.state === 'stand') { maxErr.R = Math.max(maxErr.R, eR); maxErr.L = Math.max(maxErr.L, eL); }
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(k.b[I.chest].q), P = k.b[0].p;
      console.log(`t=${f(t, 1).padStart(5)} ${label.padEnd(7)} ${k.state.padEnd(5)} p=${f(k.sword.p)} act=${f(k.sword.act)} pelvisY=${f(P.y)} tilt=${f(Math.acos(Math.min(1, up.y)) * 57.3, 0).padStart(3)}° handErr R=${f(eR * 100, 1)}cm L=${f(eL * 100, 1)}cm`);
    }
  }
};
run(3, 'idle', 120);
console.log('request draw ->', k.sword.request(true));
run(2.4, 'draw', 15);
run(1.5, 'hold', 60);
if (!interrupt) { console.log('request sheathe ->', k.sword.request(false)); run(3.0, 'sheathe', 15); run(1, 'idle', 60); }
else run(14, 'after', 120);
console.log(`max physical-vs-ghost hand error while drawing: right ${f(maxErr.R * 100, 1)} cm, left ${f(maxErr.L * 100, 1)} cm; final p=${f(k.sword.p)} state=${k.state}`);
