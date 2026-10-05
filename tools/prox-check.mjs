// Clearance of the self-collision proxies in the poses the animation actually uses (idle, walking, sword draw / guard, get-up).
// Prints, for every pair that could collide, the smallest distance (cm, negative = overlap) per scenario. usage: node tools/prox-check.mjs [all]
import fs from 'node:fs';
import RAPIER from '#rapier';
import * as THREE from '#three';
import { buildRig, groupOf, collides } from '../src/humanoid.js';
import { Ghost } from '../src/ghost.js';
import { Walker } from '../src/walk.js';
import { SwordLayer } from '../src/sword.js';

await RAPIER.init();
const { Vector3: V3, Quaternion: Q } = THREE;
const rig = buildRig(JSON.parse(fs.readFileSync(new URL('../src/profile.json', import.meta.url)))), I = rig.idx, B = rig.bodies;
const shapeOf = (f) => (f.shape === 'capsule' ? new RAPIER.Capsule(f.hh, f.r) : f.shape === 'ball' ? new RAPIER.Ball(f.r) : new RAPIER.RoundCuboid(f.h[0] - f.r, f.h[1] - f.r, f.h[2] - f.r, f.r));
const shapes = B.map((b) => shapeOf(b.prox)), loc = B.map((b) => ({ c: new V3(...b.prox.c), q: b.prox.shape === 'capsule' ? new Q(...b.prox.q) : new Q() }));
const pairs = [];
for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) if (collides(groupOf(B[i].name), groupOf(B[j].name))) pairs.push([i, j]);

function clearance(P, Qw, into) { // min distance per pair for one pose
  const pos = B.map((_, i) => loc[i].c.clone().applyQuaternion(Qw[i]).add(P[i])), rot = B.map((_, i) => Qw[i].clone().multiply(loc[i].q));
  const wq = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
  for (const [i, j] of pairs) {
    const c = shapes[i].contactShape(pos[i], wq(rot[i]), shapes[j], pos[j], wq(rot[j]), 0.3), d = c ? c.distance : 0.3, k = i + '-' + j;
    if (!(k in into) || d < into[k]) into[k] = d;
  }
}
const scen = {};
const run = (name, fn) => { scen[name] = {}; fn((P, Qw) => clearance(P, Qw, scen[name])); };
const g0 = () => { const g = new Ghost(rig); g.begin(null, new V3(), 0, 0); return g; };

run('idle', (ev) => { const g = g0(); for (const t of [g.duration + 1, g.duration + 4]) { const p = g.poseAt(t); ev(p.P, p.Qw); } });
for (const [name, v] of [['walk', 1], ['walk.5', 0.5]]) run(name, (ev) => {
  const g = g0(), W = new Walker(g); g.walker = W; W.command(new V3(0, 0, 1), v); for (let i = 0; i < 600; i++) W.step(1 / 120, null);
  for (let i = 0; i < 130; i++) { W.step(1 / 120, null); if (i % 4 === 0) { const p = g.poseAt(g.duration + 1); ev(p.P, p.Qw); } }
});
run('turn', (ev) => {
  const g = g0(), W = new Walker(g); g.walker = W; W.command(new V3(0, 0, 1), 1); for (let i = 0; i < 600; i++) W.step(1 / 120, null);
  W.command(new V3(1, 0, 0), 1); for (let i = 0; i < 200; i++) { W.step(1 / 120, null); if (i % 4 === 0) { const p = g.poseAt(g.duration + 1); ev(p.P, p.Qw); } }
});
run('draw', (ev) => { const g = g0(), L = new SwordLayer(); g.layer = L; L.act = 1; for (let k = 0; k <= 40; k++) { L.p = k / 40; const p = g.poseAt(g.duration + 1); ev(p.P, p.Qw); } });
run('guard+walk', (ev) => {
  const g = g0(), L = new SwordLayer(), W = new Walker(g); g.walker = W; g.layer = L; L.act = 1; L.p = 1; W.command(new V3(0, 0, 1), 1); for (let i = 0; i < 600; i++) W.step(1 / 120, null);
  for (let i = 0; i < 130; i++) { W.step(1 / 120, null); if (i % 4 === 0) { const p = g.poseAt(g.duration + 1); ev(p.P, p.Qw); } }
});
run('getup', (ev) => { const g = g0(); for (let t = 0; t <= g.duration; t += 0.15) { const p = g.poseAt(t); ev(p.P, p.Qw); } });

const names = Object.keys(scen), f = (x) => (x * 100).toFixed(1).padStart(6);
console.log('pair'.padEnd(24), names.map((n) => n.padStart(11)).join(''));
const rows = pairs.map(([i, j]) => [B[i].name + ' - ' + B[j].name, names.map((n) => scen[n][i + '-' + j])]);
for (const [label, ds] of rows.sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]))) if (process.argv.includes('all') || Math.min(...ds) < 0.01) console.log(label.padEnd(24), ds.map((d) => (d >= 0.3 ? '     -' : f(d)).padStart(11)).join(''));
