// Kinematic check of the walk (ghost only): foot reach errors, pelvis bob, planted-foot slip, stopping, turning.
import fs from 'node:fs';
import * as THREE from '#three';
import { loadRig } from './rig-util.mjs';
import { Ghost } from '../src/ghost.js';
import { Walker } from '../src/walk.js';

const { Vector3: V3 } = THREE;
const rig = loadRig().rig, ghost = new Ghost(rig), I = rig.idx;
const W = new Walker(ghost); ghost.walker = W; ghost.begin(null, new V3(), 0, 0);
const dt = 1 / 120, f = (x, d = 2) => x.toFixed(d);
const world = (g, i) => g.P[i].clone().applyQuaternion(ghost.R).add(ghost.origin);
const prev = {}; let maxErr = 0, minY = 9, maxY = 0, maxSlip = 0, t = 0;
const run = (sec, label, every = 60) => {
  for (let i = 0; i < sec * 120; i++, t += dt) {
    W.step(dt, null);
    if (i % 2 === 0) {
      const g = ghost.poseAt(ghost.duration + 1);
      if (W.v > 0.5) { maxErr = Math.max(maxErr, g.err[0], g.err[2]); minY = Math.min(minY, g.P[0].y); maxY = Math.max(maxY, g.P[0].y); }
      for (const s of ['L', 'R']) {
        const p = world(g, I['foot' + s]), f0 = W.foot?.[s];
        if (f0 && !f0.sw && prev[s] && prev[s].planted && W.mode === 'walk' && p.y < 0.1) maxSlip = Math.max(maxSlip, Math.hypot(p.x - prev[s].p.x, p.z - prev[s].p.z));
        prev[s] = { p, planted: f0 && !f0.sw };
      }
      if (i % every === 0) {
        const o = ghost.origin, hd = ((ghost.psi * 180) / Math.PI).toFixed(0);
        console.log(`t=${f(t, 1).padStart(4)} ${label.padEnd(6)} mode=${W.mode.padEnd(5)} v=${f(W.v)} w=${f(W.w)} T=${f(W.T)} origin(${f(o.x)},${f(o.z)}) heading=${hd}° pelvisY=${f(g.P[0].y, 3)} footErr L=${f(g.err[0], 3)} R=${f(g.err[2], 3)}`);
      }
    }
  }
};
W.command(new V3(0, 0, 1), 1); run(6, 'walk', 60);
console.log(`steady walk: foot reach error max ${f(maxErr * 100, 1)} cm, pelvis y ${f(minY, 3)}..${f(maxY, 3)} (bob ${f((maxY - minY) * 100, 1)} cm), max planted-foot slip per sample ${f(maxSlip * 1000, 1)} mm`);
W.command(new V3(1, 0, 0), 1); run(3, 'turn', 60);
W.command(null, 0); run(3.5, 'stop', 30);
