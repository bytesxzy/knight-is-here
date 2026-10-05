// Robustness: knock the skeleton over while it runs and swings (random direction / strength / moment), check that it gets up and can run again.
// usage: RIG=skeleton node tools/fuzz-run.mjs [trials] [seed]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
const V3 = THREE.Vector3, trials = +(process.argv[2] ?? 6); let seed = +(process.argv[3] ?? 1);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let ok = 0;
for (let n = 0; n < trials; n++) {
  const k = await loadChar(); k.ragdoll = [0.25, 0.1, 0.4][n % 3];
  const A = k.sword; k.walk.command(new V3(0, 0, 1), 1, true); A.frenzy = n % 2 === 0;
  for (let s = 0; s < (3 + rnd() * 2) * 120; s++) k.step();
  const a = rnd() * Math.PI * 2, imp = 90 + rnd() * 120;
  k.knockDown(new V3(Math.sin(a), 0.12, Math.cos(a)), imp);
  A.frenzy = false; k.walk.command(null, 0);
  for (let s = 0; s < 25 * 120; s++) k.step();
  k.readState();
  const tilt = Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(k.b[k.rig.idx.chest].q).y)) * 57.3;
  const stood = k.state === 'stand' && tilt < 15;
  // and it runs again
  k.walk.command(new V3(0, 0, 1), 1, true); for (let s = 0; s < 4 * 120; s++) k.step();
  const v = k.walk.v, still = k.state === 'stand';
  if (stood && still && v > 2.5) ok++;
  console.log(`${stood && still && v > 2.5 ? 'ok  ' : 'FAIL'} rag ${k.ragdoll} frenzy ${n % 2 === 0} dir ${(a * 57.3).toFixed(0)}° impulse ${imp.toFixed(0)} -> ${k.state} tilt ${tilt.toFixed(0)}° then ran at ${v.toFixed(1)} m/s`);
}
console.log(`run-fuzz: ${ok}/${trials} got up and ran again`);
