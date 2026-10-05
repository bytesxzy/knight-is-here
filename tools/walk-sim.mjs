// Headless physics run: stand -> walk -> turn -> stop (add `sword` to do it with the sword drawn, two hands). usage: node tools/walk-sim.mjs [ragdoll] [sword]
import fs from 'node:fs';
import * as THREE from '#three';
import { Knight } from '../src/knight.js';
import { loadChar } from './rig-util.mjs';

const rag = +(process.argv[2] && !isNaN(+process.argv[2]) ? process.argv[2] : 0.25), withSword = process.argv.includes('sword');
const V3 = THREE.Vector3, k = await loadChar(); k.ragdoll = rag;
const I = k.rig.idx, f = (x, d = 2) => x.toFixed(d);
let t = 0, maxTilt = 0, maxLag = 0, slipSum = 0, slipN = 0, minY = 9, last = null;
const run = (sec, label, every = 120) => {
  for (let s = 0; s < sec * 120; s++, t += 1 / 120) {
    k.step(); k.readState();
    const up = new V3(0, 1, 0).applyQuaternion(k.b[I.chest].q), tilt = Math.acos(Math.min(1, up.y)) * 57.3, P = k.b[0].p;
    if (label !== 'idle' && label !== 'draw') { maxTilt = Math.max(maxTilt, tilt); minY = Math.min(minY, P.y); }
    const g = k.ghost, hd = new V3(Math.sin(g.psi), 0, Math.cos(g.psi)), gp = g.origin.clone().addScaledVector(hd, k.walk.zp);
    const lag = Math.hypot(P.x - gp.x, P.z - gp.z); if (k.walk.v > 0.5) maxLag = Math.max(maxLag, lag);
    if (k.walk.v > 0.5) for (const sd of ['L', 'R']) { const fb = k.b[I['foot' + sd]], v = fb.rb.linvel(); if (fb.p.y < 0.11) { slipSum += Math.hypot(v.x, v.z); slipN++; } }
    if (s % every === 0) {
      const sp = last ? Math.hypot(P.x - last.x, P.z - last.z) / (every / 120) : 0; last = P.clone();
      console.log(`t=${f(t, 1).padStart(5)} ${label.padEnd(6)} ${k.state.padEnd(5)} walk=${k.walk.mode.padEnd(5)} ghost v=${f(k.walk.v)} phys v=${f(sp)} pelvis(${f(P.x)},${f(P.y)},${f(P.z)}) heading=${f((g.psi * 180) / Math.PI, 0).padStart(4)}° tilt=${f(tilt, 0).padStart(2)}° lag=${f(lag * 100, 0)}cm sword p=${f(k.sword.p)}`);
    }
  }
};
run(2, 'idle');
if (withSword) { console.log('draw ->', k.sword.request(true)); run(3.2, 'draw', 60); }
console.log('walk forward'); k.walk.command(new V3(0, 0, 1), 1); run(8, 'walk');
console.log('turn right (toward +x)'); k.walk.command(new V3(1, 0, 0), 1); run(4, 'turn');
console.log('stop'); k.walk.command(null, 0); run(4, 'stop', 60);
console.log(`summary: state=${k.state} maxTilt=${f(maxTilt, 0)}° minPelvisY=${f(minY)} maxLagBehindGhost=${f(maxLag * 100, 0)}cm meanFootSlipWhileInContact=${f(slipN ? slipSum / slipN : 0, 3)} m/s`);
