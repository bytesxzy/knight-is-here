// Headless physics run of the running gait (RIG=skeleton): stand -> run -> (swing) -> turn -> stop. usage: RIG=skeleton node tools/run-sim.mjs [ragdoll] [swing] [verbose]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
const rag = +(process.argv[2] && !isNaN(+process.argv[2]) ? process.argv[2] : 0.25), swing = process.argv.includes('swing'), verbose = process.argv.includes('verbose');
const V3 = THREE.Vector3, k = await loadChar(); k.ragdoll = rag;
const I = k.rig.idx, f = (x, d = 2) => x.toFixed(d), W = k.walk, A = k.sword;
let t = 0, maxTilt = 0, minY = 9, maxY = 0, maxFootV = 0, maxLag = 0, capHits = 0, last = null;
const run = (sec, label, every = 60) => {
  for (let s = 0; s < sec * 120; s++, t += 1 / 120) {
    k.step(); k.readState();
    const up = new V3(0, 1, 0).applyQuaternion(k.b[I.chest].q), tilt = Math.acos(Math.min(1, up.y)) * 57.3, P = k.b[0].p;
    if (label !== 'idle') { maxTilt = Math.max(maxTilt, tilt); minY = Math.min(minY, P.y); maxY = Math.max(maxY, P.y); }
    for (const b of k.b) { const v = b.rb.linvel(), sp = Math.hypot(v.x, v.y, v.z); if (sp > 11.5) capHits++; }
    for (const sd of ['L', 'R']) { const v = k.b[I['foot' + sd]].rb.linvel(); maxFootV = Math.max(maxFootV, Math.hypot(v.x, v.y, v.z)); }
    const g = k.ghost, hd = new V3(Math.sin(g.psi), 0, Math.cos(g.psi)), gp = g.origin.clone().addScaledVector(hd, W.zp);
    if (W.v > 0.5) maxLag = Math.max(maxLag, Math.hypot(P.x - gp.x, P.z - gp.z));
    if (verbose && s % every === 0) {
      const sp = last ? Math.hypot(P.x - last.x, P.z - last.z) / (every / 120) : 0; last = P.clone();
      console.log(`t=${f(t, 1).padStart(5)} ${label.padEnd(6)} ${k.state.padEnd(5)} gait=${f(W.gait)} v=${f(W.v)} phys v=${f(sp)} pelvis y=${f(P.y)} tilt=${f(tilt, 0).padStart(2)}° lag=${f(Math.hypot(P.x - gp.x, P.z - gp.z) * 100, 0)}cm`);
    }
  }
};
run(2, 'idle');
console.log('run forward'); W.command(new V3(0, 0, 1), 1, true); run(7, 'run');
if (swing) { console.log('frenzy on'); A.frenzy = true; run(6, 'swing'); A.frenzy = false; run(1, 'swing'); }
console.log('turn right (toward +x) while running'); W.command(new V3(1, 0, 0), 1, true); run(4, 'turn');
console.log('stop'); W.command(null, 0); run(4, 'stop');
console.log(`summary: state=${k.state} maxTilt=${f(maxTilt, 0)}° pelvisY ${f(minY)}..${f(maxY)} maxFootSpeed=${f(maxFootV)} m/s maxLagBehindGhost=${f(maxLag * 100, 0)}cm speedCapHits=${capHits} gait=${f(W.gait)}`);
