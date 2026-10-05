// Who torques the chest? Sums the torque impulses applied to the chest body per step, by source (its own joint to the abdomen, the head / arm joints pushing
// back on it, the hand-of-god holds), and prints the steps where its angular speed is high. usage: [RIG=skeleton] node tools/torque-log.mjs [punch|sword|heavy|chop] [seconds]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
const mode = process.argv[2] ?? 'punch', secs = +(process.argv[3] ?? 3), V3 = THREE.Vector3, k = await loadChar(), I = k.rig.idx, L = k.sword, f = (x, d = 1) => x.toFixed(d);
k.ragdoll = 0.25;
const names = k.b.map((b) => b.d.name);
let calls = [];
k.b.forEach((b, i) => { const o = b.rb.applyTorqueImpulse.bind(b.rb); b.rb.applyTorqueImpulse = (t, w) => { calls.push({ i, t: new V3(t.x, t.y, t.z), stack: /assist/.test(new Error().stack.split('\n')[2]) ? 'assist' : 'control' }); return o(t, w); }; });
for (let s = 0; s < 2 * 120; s++) k.step();
if (mode === 'sword' || mode === 'chop') { L.request(true); for (let s = 0; s < 4 * 120; s++) k.step(); }
const heavy = mode === 'heavy' || mode === 'chop'; if (!heavy) L.attackHeld = true;
let next = 0;
for (let s = 0; s < secs * 120; s++) {
  if (heavy && s >= next) { L.attack(true); next = s + 2.2 * 120; }
  calls = []; k.step(); k.readState();
  const w = k.b[I.chest].rb.angvel(), sp = Math.hypot(w.x, w.y, w.z);
  if (sp < 9) continue;
  const src = {};
  for (let c = 0; c < calls.length; c++) {
    const e = calls[c]; if (e.i !== I.chest) { if (e.i !== I.abdomen && calls[c + 1]?.i === I.chest) { (src['joint ' + names[e.i]] ??= new V3()).addScaledVector(calls[c + 1].t, 120); } continue; }
    const prev = calls[c - 1];
    if (e.stack === 'assist') (src['hold (assist)'] ??= new V3()).addScaledVector(e.t, 120);
    else if (calls[c + 1]?.i === I.abdomen && !(prev && prev.i !== I.abdomen && calls[c]?.i === I.chest && prev.stack === 'control' && false)) (src['joint chest-abdomen (child)'] ??= new V3()).addScaledVector(e.t, 120);
    else (src['other (parent of ' + (names[calls[c - 1]?.i] ?? '?') + ')'] ??= new V3()).addScaledVector(e.t, 120);
  }
  const sw = [...(L.fists?.sw ?? []), ...(L.swings ?? []), ...(L.sw ?? [])].map((x) => `${x.kind}@${f(x.t, 2)}`).join(',');
  console.log(`t=${f(s / 120, 3)} |w|=${f(sp)} (${f(w.x)},${f(w.y)},${f(w.z)}) [${sw}] torque on chest (N*m): ` + Object.entries(src).map(([n, v]) => `${n}: (${f(v.x, 0)},${f(v.y, 0)},${f(v.z, 0)})`).join(' | '));
}
