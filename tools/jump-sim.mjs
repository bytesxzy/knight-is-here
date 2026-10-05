// The robot's jumps in the physics sim. usage: RIG=robot node tools/jump-sim.mjs [up|leap|run|chain|turn] [verbose]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
import { worldPose } from '../src/ghost.js';
const mode = process.argv[2] ?? 'up', verbose = process.argv.includes('verbose'), V3 = THREE.Vector3, f = (x, d = 2) => x.toFixed(d);
const k = await loadChar('robot'), I = k.rig.idx, J = k.jump;
const gtilt = () => { const e = k.ghost.evaluate(k.tg), w = worldPose(k.rig, e.rootP, e.rootQ, e.ql); return Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(w.Q[I.chest]).y)) * 57.3; };
const lean = (q) => { const u = new V3(0, 1, 0).applyQuaternion(q); return Math.atan2(u.z, u.y) * 57.3; }; // + = leaning forward
const tilt = () => Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(k.b[I.chest].q).y)) * 57.3;
let t = 0, maxTilt = 0, maxY = 0, minFootY = 9, landings = 0, falls = 0, maxLag = 0, wasAir = false, phaseLog = '';
const run = (sec, tag) => {
  for (let s = 0; s < sec * 120; s++, t += 1 / 120) {
    k.step(); k.readState();
    if (k.state !== 'stand') { falls++; return false; }
    const P = k.b[0].p, g = k.ghost.evaluate(k.tg).rootP, lag = P.distanceTo(g);
    maxTilt = Math.max(maxTilt, tilt()); maxY = Math.max(maxY, P.y); maxLag = Math.max(maxLag, lag);
    const fy = Math.min(k.b[I.footL].p.y, k.b[I.footR].p.y); if (J.phase === 'air') minFootY = Math.min(minFootY, fy);
    const air = J.phase === 'air'; if (wasAir && !air) landings++; wasAir = air;
    if (verbose && s % 6 === 0) console.log(`t=${f(t)} ${tag.padEnd(5)} ${J.phase.padEnd(7)} ghost y=${f(g.y)} phys y=${f(P.y)} (lag ${f(lag * 100, 0)}cm) feet y=${f(k.b[I.footL].p.y)}/${f(k.b[I.footR].p.y)} v=(${f(k.b[0].rb.linvel().x, 1)},${f(k.b[0].rb.linvel().y, 1)},${f(k.b[0].rb.linvel().z, 1)}) tilt=${f(tilt(), 0)}° (ghost ${f(gtilt(), 0)}°) lean chest ${f(lean(k.b[I.chest].q), 0)} pelvis ${f(lean(k.b[0].q), 0)} abd ${f(lean(k.b[I.abdomen].q), 0)} head ${f(lean(k.b[I.head].q), 0)}`);
  }
  return true;
};
run(2, 'idle');
const dir = new V3(0, 0, 1);
if (mode === 'up') { console.log('jump up ->', J.request(null)); run(3.2, 'up'); }
else if (mode === 'leap') { console.log('leap forward ->', J.request(dir)); run(3.4, 'leap'); }
else if (mode === 'run') { k.walk.command(dir, 1, true); run(3, 'run'); console.log('running jump ->', J.request(null)); run(3.2, 'jump'); k.walk.command(null, 0); run(2, 'stop'); }
else if (mode === 'chain') { for (let i = 0; i < 4; i++) { console.log('jump', i, '->', J.request(i % 2 ? dir : new V3(1, 0, 0))); run(2.4, 'jump'); } }
else if (mode === 'turn') { k.walk.command(dir, 1); run(3, 'walk'); k.walk.command(new V3(1, 0, 0), 1); run(0.5, 'turn'); console.log('jump while turning ->', J.request(new V3(1, 0, 0))); run(3, 'jump'); k.walk.command(null, 0); run(2, 'stop'); }
const P = k.b[0].p;
console.log(`${mode}: state=${k.state}${falls ? ' (FELL)' : ''} landings=${landings} peak pelvis y=${f(maxY)} (standing ~0.95) lowest foot in the air=${f(minFootY)} max tilt=${f(maxTilt, 0)}° max pelvis lag behind the ghost=${f(maxLag * 100, 0)}cm final pelvis (${f(P.x)},${f(P.y)},${f(P.z)})`);
