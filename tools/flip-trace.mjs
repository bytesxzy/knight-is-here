// finds one-step flips of the ghost's arm joints (a pole / twist flip in the arm IK) and prints what the layer asked for at that moment
// usage: [RIG=skeleton] node tools/flip-trace.mjs [seconds] [thresholdRad]
import * as THREE from '#three';
import { loadChar } from './rig-util.mjs';
const V3 = THREE.Vector3, k = await loadChar(), I = k.rig.idx, L = k.sword, A = L.fists ?? L, secs = +(process.argv[2] ?? 6), thr = +(process.argv[3] ?? 0.5), f = (x, d = 2) => x.toFixed(d);
k.ragdoll = 0.25; for (let s = 0; s < 240; s++) k.step();
if (process.env.SWORD && L.request) { L.request(true); for (let s = 0; s < 5 * 120; s++) k.step(); }
let prev = null, n = 0, nextHeavy = 1.0, arms = [], armsPrev = []; const v3 = (v) => v.toArray().map((x) => f(x)).join(',');
globalThis.__limbDbg = (o) => { if (o.S.y > 1.1) arms.push(o); };
for (let s = 0; s < secs * 120 && n < 12; s++) {
  L.attackHeld = true; if (process.env.MIXED && s / 120 >= nextHeavy) { L.attack(true); nextHeavy = s / 120 + 2.6; }
  k.step(); k.readState(); if (k.state !== 'stand') break;
  armsPrev = arms; arms = []; const e = k.ghost.evaluate(k.tg), cur = {}; for (const j of ['upperArmL', 'upperArmR', 'forearmL', 'forearmR']) cur[j] = e.ql[I[j]].clone();
  if (prev) for (const j in cur) { const a = 2 * Math.acos(Math.min(1, Math.abs(prev[j].dot(cur[j])))); if (a > thr) { n++; const S = j.endsWith('L') ? 'L' : 'R', o = A.out[S];
    console.log(`t=${f(s / 120)} ${j} jumped ${f(a)} rad | moves ${A.sw.map((m) => m.kind + '@' + f(m.t)).join(',')} | out.${S} W=${f(o.W)} off=${o.off.toArray().map((x) => f(x)).join(',')} pole=${o.pole.toArray().map((x) => f(x)).join(',')} roll=${f(o.roll)}`);
    if (process.env.DBG) for (const [tag, list] of [['before', armsPrev], ['after', arms]]) for (const q of list) if (Math.sign(q.S.x) === (S === 'L' ? 1 : -1) || true) console.log(`   ${tag} S.x=${f(q.S.x)} dn=${v3(q.dn)} a=${v3(q.a)} b=${v3(q.b)} off=${f(q.off)} twist=${f(q.twist)} c=${f(q.c)} pole=${v3(q.pole)}`); } }
  prev = cur;
}
console.log('flips:', n);
