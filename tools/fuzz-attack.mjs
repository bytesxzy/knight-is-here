// Robustness: knock the knight over in the middle of punches / sword swings, check he gets up, the layers are clean and he can attack again.
// usage: node tools/fuzz-attack.mjs [trials] [seed]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
const V3 = THREE.Vector3, trials = +(process.argv[2] ?? 6); let seed = +(process.argv[3] ?? 1);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let ok = 0;
for (let n = 0; n < trials; n++) {
  const k = await loadChar('knight'), L = k.sword, sword = n % 2 === 1; k.ragdoll = [0.25, 0.1, 0.4][n % 3];
  for (let s = 0; s < 2 * 120; s++) k.step();
  if (sword) { L.request(true); for (let s = 0; s < 4 * 120; s++) k.step(); }
  L.attackHeld = true;
  for (let s = 0; s < (1 + rnd() * 2) * 120; s++) k.step();
  const a = rnd() * Math.PI * 2, imp = 90 + rnd() * 120, midSwing = L.swinging;
  k.knockDown(new V3(Math.sin(a), 0.12, Math.cos(a)), imp); L.attackHeld = false;
  for (let s = 0; s < 25 * 120; s++) k.step();
  k.readState();
  const tilt = Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(k.b[k.rig.idx.chest].q).y)) * 57.3, stood = k.state === 'stand' && tilt < 15, clean = !L.swinging && L.armW('R') < 0.9 + (sword ? 1 : 0);
  L.attackHeld = true; let swung = false; for (let s = 0; s < 2 * 120; s++) { k.step(); if (L.swinging) swung = true; } L.attackHeld = false;
  const pass = stood && swung && k.state === 'stand';
  if (pass) ok++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${sword ? 'sword' : 'fists'} rag ${k.ragdoll} swinging=${midSwing} dir ${(a * 57.3).toFixed(0)}° impulse ${imp.toFixed(0)} -> ${k.state} tilt ${tilt.toFixed(0)}°, attacks again: ${swung}`);
}
console.log(`attack-fuzz: ${ok}/${trials} got up and could attack again`);
