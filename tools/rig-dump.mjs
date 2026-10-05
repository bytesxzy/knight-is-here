// Key proportions of a rig in its T-pose / body frames. RIG=skeleton node tools/rig-dump.mjs
import { loadRig } from './rig-util.mjs';
const { rig } = loadRig(), B = rig.bodies, I = rig.idx, f = (v) => v.toArray().map((x) => x.toFixed(3)).join(', ');
const anchorOf = (n) => B[I[n]].anchor;
console.log('anchors (T-pose world):'); for (const n of ['pelvis', 'abdomen', 'chest', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'handR']) console.log(' ', n.padEnd(10), f(anchorOf(n)));
console.log('offsets (in the parent body frame):'); for (const n of ['abdomen', 'chest', 'head', 'upperArmL', 'upperArmR', 'forearmL', 'handL']) console.log(' ', n.padEnd(10), f(B[I[n]].off));
console.log('arm: shoulder->elbow', B[I.forearmL].off.length().toFixed(3), 'elbow->hand', B[I.handL].off.length().toFixed(3), ' scale', JSON.stringify(rig.scale));
