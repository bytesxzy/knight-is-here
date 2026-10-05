// Numeric sanity check of the kinematic get-up (no physics): reach errors, ground contact, key heights per keyframe.
import { Ghost, worldPose } from '../src/ghost.js';
import { loadRig } from './rig-util.mjs';

const rig = loadRig().rig, ghost = new Ghost(rig), I = rig.idx;
console.log('scale', JSON.stringify(Object.fromEntries(Object.entries(ghost.sc).map(([k, v]) => [k, +v.toFixed(3)]))));
const f = (x) => x.toFixed(3);
console.log('H', JSON.stringify(Object.fromEntries(Object.entries(ghost.H).map(([k, v]) => [k, +v.toFixed(3)]))), 'thigh', f(ghost.thigh));
const times = [...ghost.keys.map((k) => k.t), 12.5];
for (const t of times) {
  const pose = ghost.evaluate(t), w = worldPose(rig, pose.rootP, pose.rootQ, pose.ql), g = ghost.poseAt(t);
  const low = ghost.lowest({ P: w.P, Qw: w.Q }, true);
  const y = (n) => f(w.P[I[n]].y), z = (n) => f(w.P[I[n]].z);
  console.log(`t=${String(t).padEnd(5)} pelvis y=${y('pelvis')} z=${z('pelvis')} | chest y=${y('chest')} z=${z('chest')} | head y=${y('head')} z=${z('head')} | ` +
    `kneeL y=${y('shinL')} z=${z('shinL')} | handL y=${y('handL')} z=${z('handL')} | footL y=${y('footL')} z=${z('footL')} footR y=${y('footR')} z=${z('footR')} | ` +
    `lowest=${f(low)} | reach err (footL,handL,footR,handR)=${g.err.map(f).join(',')}`);
}
