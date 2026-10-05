// Headless NPC test: three characters in one world, one of them a scripted "player" (its own AI off), the other two NPC brains. Phase 1: nobody attacks (every NPC must
// stay calm, no hits). Phase 2: the scripted player walks up to the victim and keeps hitting it; the victim must turn on the attacker and fight back (a knight defends himself
// with fists, or draws his sword when there is room). Phase 3: the player stops; the victim must calm down again (and a knight sheathes his sword).
// usage: node tools/npc-test.mjs <attacker: knight|skeleton|robot> <victim: knight|skeleton|robot> [fists|sword]   (the weapon is the knight attacker's)
// env: TRACE=1 prints every state change, KITE=1 makes the attacker hit and then walk away in cycles (the victim has to chase: the robot leaps)
import * as THREE from '#three';
import fs from 'node:fs';
import { Knight, Sim } from '../src/knight.js';
import { KNIGHT, SKELETON, ROBOT } from '../src/rigs.js';
import { NpcAI } from '../src/npc.js';
import { Combat } from '../src/combat.js';

const V3 = THREE.Vector3, attacker = process.argv[2] ?? 'knight', victim = process.argv[3] ?? 'skeleton', weapon = process.argv[4] ?? 'fists', f = (x, d = 2) => x.toFixed(d);
const prof = (s) => JSON.parse(fs.readFileSync(new URL('../' + s.profile, import.meta.url)));
const K = await Knight.create(prof(KNIGHT), KNIGHT), S = await Knight.create(prof(SKELETON), SKELETON, K.world), R = await Knight.create(prof(ROBOT), ROBOT, K.world);
K.reset(0, 0, 0); S.reset(-2.9, 1.5, Math.atan2(2.9, -1.5)); R.reset(2.8, 2.1, Math.atan2(-2.8, -2.1));
const all = [K, S, R], by = { knight: K, skeleton: S, robot: R }, A = by[attacker], target = by[victim];
const ais = new Map(all.map((c) => [c, new NpcAI(c, all)])), sim = new Sim(K.world, all), combat = new Combat(all);
const tag = (c) => (c === K ? 'K' : c === S ? 'S' : 'R');
const hits = { K: 0, S: 0, R: 0 }, downs = { K: 0, S: 0, R: 0 }, drew = { K: false };
combat.onHit = (e) => { hits[tag(e.att)]++; if (e.heavy) downs[tag(e.tgt)]++; if (e.tgt !== A) { const ai = ais.get(e.tgt); ai.provoke(e.att, e.heavy); ai.hurt(e.heavy); } };
sim.after.push(() => combat.update());
let t = 0, phase = 1, nan = false, maxSword = 0, jumps = 0, stuckAir = 0; const log = (m) => console.log(`t=${f(t, 1).padStart(5)} ${m}`);
if (R.jump) { const req = R.jump.request.bind(R.jump); R.jump.request = (...a) => { const ok = req(...a); if (ok) jumps++; return ok; }; } // how often the robot jumps
const states = () => all.map((c) => `${tag(c)}:${c.state}/${ais.get(c).state}${c === K ? (K.sword.p > 0.5 ? '(sword)' : '') : ''}`).join(' ');
const phaseHits = {};
const T1 = 12, T2 = 40, T3 = 70;
const reach = A === K ? (weapon === 'sword' ? 1.1 : 0.85) : A === S ? 1.2 : 1.1, stop = A === K ? (weapon === 'sword' ? 0.85 : 0.6) : A === S ? 0.62 : 0.72;
if (A === K && weapon === 'sword') K.sword.request(true);
for (let step = 0; step < T3 * 60; step++, t += 1 / 60) {
  if (A === K && t > 2 && weapon === 'sword' && K.sword.p < 0.01 && !K.sword.busy) K.sword.request(true);
  if (t > T1 && t < T2 && A.state === 'stand') { // the "player" attacks the chosen NPC: walks up and hits it
    if (phase === 1) { phase = 2; phaseHits.calm = { ...hits }; log(`--- the ${attacker} starts hitting the ${victim}`); }
    const p = target.b[0].p, k = A.b[0].p, d = new V3(p.x - k.x, 0, p.z - k.z), dist = d.length();
    if (process.env.KITE && (t - T1) % 10 > 6) { A.walk.command(d.clone().negate().normalize(), 1); A.sword.attackHeld = false; } // KITE=1: hit it, then walk away (it has to run / leap after you)
    else { A.walk.command(dist > stop ? d.normalize() : null, dist > 2 ? 1 : 0.3); A.sword.attackHeld = dist < reach && target.state === 'stand'; }
  } else if (t >= T2) { if (phase === 2) { phase = 3; phaseHits.fight = { ...hits }; log(`--- the ${attacker} stops attacking`); } A.walk.command(null, 0); A.sword.attackHeld = false; }
  else { A.walk.command(null, 0); A.sword.attackHeld = false; }
  for (const c of all) ais.get(c).update(1 / 60, c === A); // the attacker is the scripted "player": its own AI stays off
  sim.update(1 / 60);
  for (const c of all) { const p = c.b[0].p; if (!Number.isFinite(p.x + p.y + p.z)) nan = true; }
  if (K.sword.p > maxSword) maxSword = K.sword.p;
  if (R.jump?.active) { if (R.jump.t > 4) stuckAir++; } // (a jump lasts ~1.5 s: much longer than that is a bug)
  if (process.env.TRACE) for (const c of all) { const key = c.state + '/' + ais.get(c).state; if (c.__last !== key) { c.__last = key; log(`  ${tag(c)} -> ${key}  (dist to attacker ${f(c === A ? 0 : Math.hypot(c.b[0].p.x - A.b[0].p.x, c.b[0].p.z - A.b[0].p.z))})`); } }
  if (step % 300 === 0) log(states() + ` | hits K ${hits.K} S ${hits.S} R ${hits.R}`);
}
phaseHits.end = { ...hits };
console.log(`phase 1 (nobody attacks, ${T1}s): hits dealt ${JSON.stringify(phaseHits.calm)}  -> NPCs must not have started anything`);
console.log(`phase 2 (the ${attacker} attacks the ${victim}, ${T2 - T1}s): hits dealt ${JSON.stringify(phaseHits.fight)} (knocked down ${JSON.stringify(downs)})`);
console.log(`phase 3 (it stops, ${T3 - T2}s): ${JSON.stringify(phaseHits.end)}; final: ${states()} nan=${nan}, robot jumps ${jumps}${stuckAir ? ` (STUCK in a jump for ${stuckAir} steps!)` : ''}${victim === 'knight' ? `; knight sword max ${f(maxSword)}, at the end ${f(K.sword.p)} (should be sheathed again)` : ''}`);
