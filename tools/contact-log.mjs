// Which body parts touch each other (self-collision proxies) and how deep, in a physics scenario.
// usage: [RIG=skeleton] node tools/contact-log.mjs [walk|run|swing|sword|guard|fall|getup] [ragdoll]   (swing = running with the skeleton's savage swings)
import fs from 'node:fs';
import * as THREE from '#three';
import { Knight } from '../src/knight.js';
import { loadChar } from './rig-util.mjs';

const scenario = process.argv[2] ?? 'walk', V3 = THREE.Vector3;
const k = await loadChar(); k.ragdoll = +(process.argv[3] ?? 0.25);
const W = k.world, names = k.b.map((b) => b.d.name), h2i = new Map(k.proxies.map((c, i) => [c.handle, i])), stat = {};
let steps = 0;
const log = () => {
  steps++;
  k.proxies.forEach((c, i) => W.contactPairsWith(c, (c2) => {
    const j = h2i.get(c2.handle); if (j === undefined || j < i) return;
    let dmin = 1; W.contactPair(c, c2, (m) => { for (let q = 0; q < m.numContacts(); q++) dmin = Math.min(dmin, m.contactDist(q)); });
    if (dmin > 0.002) return;
    const key = names[i] + ' - ' + names[j], e = (stat[key] ??= { n: 0, deep: 0 }); e.n++; e.deep = Math.min(e.deep, dmin);
  }));
};
const run = (sec) => { for (let s = 0; s < sec * 120; s++) { k.step(); log(); } };
run(1);
if (scenario === 'walk') { k.walk.command(new V3(0, 0, 1), 1); run(6); k.walk.command(new V3(1, 0, 0), 1); run(3); k.walk.command(null, 0); run(2); }
else if (scenario === 'run' || scenario === 'swing') { k.walk.command(new V3(0, 0, 1), 1, true); run(5); if (scenario === 'swing') { k.sword.frenzy = true; run(12); k.sword.frenzy = false; run(2); } k.walk.command(null, 0); run(3); }
else if (scenario === 'sword' || scenario === 'guard') { k.sword.request(true); run(3.5); if (scenario === 'guard') { k.walk.command(new V3(0, 0, 1), 1); run(5); k.walk.command(null, 0); run(2); } k.sword.request(false); run(3.5); }
else if (scenario === 'fall') { k.knockDown(new V3(0, 0.12, 1), 130); run(8); }
else if (scenario === 'getup') { k.knockDown(new V3(0, 0.12, 1), 130); run(30); }
console.log(`${scenario}: ${steps} steps. pair (steps in contact, deepest overlap cm)`);
for (const [key, e] of Object.entries(stat).sort((a, b) => b[1].n - a[1].n).slice(0, 14)) console.log(key.padEnd(24), String(e.n).padStart(6), ' ', (e.deep * 100).toFixed(1));
console.log('final state', k.state, 'tilt', (Math.acos(Math.min(1, new V3(0, 1, 0).applyQuaternion(k.b[k.rig.idx.chest].q).y)) * 57.3).toFixed(0) + '°');
