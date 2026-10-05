// Humanoid definition for the "SmartRig" characters (the knight, the skeleton: same auto-rig, same body layout, different bones / proportions).
// T-pose frame: +X = character's LEFT, +Y up, +Z forward. Every physics body is anchored at a rig joint
// (bone head), sits at identity rotation in the T-pose, and drives a set of bones.
import * as THREE from '#three';

const S2 = Math.SQRT1_2;

// Joint spec:  ball  -> 3-DOF, soft swing/twist limits.  ref = neutral rotation, limb = limb axis in child frame,
//                       sw = limits on the swing vector components (parent frame), tw = twist limits (rad)
//              hinge -> 1-DOF Rapier revolute joint with hard limits.
// ks = nominal joint stiffness in N*m/rad at 100% strength. `o.mass` / `o.ks` scale a whole rig (a lighter or weaker character), `o.armMass` just the arms.
const arm = (S, k, b, o) => [
  { name: 'upperArm' + S, parent: 'chest', anchor: b.sh, bones: [b.sh], mass: 3.5 * o.mass * o.armMass, shape: 'capsule', next: 'forearm' + S,
    joint: { type: 'ball', ks: 350 * o.ks, ref: [0, 0, -k * S2, S2], limb: [k, 0, 0],
             sw: { x: [-3.0, 1.0], z: k > 0 ? [-1.4, 3.0] : [-3.0, 1.4] }, tw: [-1.6, 1.6] } }, // z: crossing the chest is allowed (sword draw)
  { name: 'forearm' + S, parent: 'upperArm' + S, anchor: b.el, bones: [b.el, b.wr].filter(Boolean), mass: 2.5 * o.mass * o.armMass, shape: 'capsule', next: 'hand' + S,
    joint: { type: 'hinge', ks: 250 * o.ks, axis: [0, 1, 0], lim: k > 0 ? [-2.5, 0.05] : [-0.05, 2.5], flex: -k } },
  { name: 'hand' + S, parent: 'forearm' + S, anchor: b.hd, bones: [b.hd, ...b.fg], mass: 1.2 * o.mass * o.armMass, shape: 'box',
    joint: { type: 'ball', ks: 40 * o.ks, ref: [0, 0, 0, 1], limb: [k, 0, 0],
             sw: { y: k > 0 ? [-2.0, 1.4] : [-1.4, 2.0], z: [-1.6, 1.6] }, tw: [-2.6, 2.6] } }, // no separate forearm-roll joint: the wrist carries it too
];
const leg = (S, k, b, o) => [
  { name: 'thigh' + S, parent: 'pelvis', anchor: b.hip, bones: [b.hip], mass: 11 * o.mass, shape: 'capsule', next: 'shin' + S,
    joint: { type: 'ball', ks: 1400 * o.ks, ref: [0, 0, 0, 1], limb: [0, -1, 0],
             sw: { x: [-2.1, 0.55], z: k > 0 ? [-0.5, 0.9] : [-0.9, 0.5] }, tw: [-0.7, 0.7] } },
  { name: 'shin' + S, parent: 'thigh' + S, anchor: b.kn, bones: [b.kn], mass: 6 * o.mass, shape: 'capsule', next: 'foot' + S,
    joint: { type: 'hinge', ks: 1200 * o.ks, axis: [1, 0, 0], lim: [0, 2.6], flex: 1 } },
  { name: 'foot' + S, parent: 'shin' + S, anchor: b.an, bones: [b.an, b.ba, b.tp], mass: 2.5 * o.mass, shape: 'box',
    joint: { type: 'ball', ks: 300 * o.ks, ref: [0, 0, 0, 1], limb: [0, 1, 0], sw: { x: [-0.7, 1.5], z: [-0.4, 0.4] }, tw: [-0.5, 0.5] } },
];

// The 16 bodies for a set of bone names n = { pelvis: [..], pelvisAnchor, abdomen: { anchor, bones, fit }, chest: {..}, head: {..}, armL, armR, legL, legR }
export function bodiesFor(n, opts = {}) {
  const o = { mass: 1, ks: 1, armMass: 1, ...opts };
  return [
    { name: 'pelvis', parent: null, anchor: n.pelvisAnchor, bones: n.pelvis, mass: 14 * o.mass, shape: 'box' },
    { name: 'abdomen', parent: 'pelvis', anchor: n.abdomen.anchor, bones: n.abdomen.bones, fit: n.abdomen.fit, mass: 9 * o.mass, shape: 'box',
      joint: { type: 'ball', ks: 1000 * o.ks, ref: [0, 0, 0, 1], limb: [0, 1, 0], sw: { x: [-0.45, 0.75], z: [-0.4, 0.4] }, tw: [-0.6, 0.6] } },
    { name: 'chest', parent: 'abdomen', anchor: n.chest.anchor, bones: n.chest.bones, fit: n.chest.fit, mass: 22 * o.mass, shape: 'box',
      joint: { type: 'ball', ks: 900 * o.ks, ref: [0, 0, 0, 1], limb: [0, 1, 0], sw: { x: [-0.4, 0.6], z: [-0.35, 0.35] }, tw: [-0.6, 0.6] } },
    { name: 'head', parent: 'chest', anchor: n.head.anchor, bones: n.head.bones, mass: 6 * o.mass, shape: 'ball',
      joint: { type: 'ball', ks: 120 * o.ks, ref: [0, 0, 0, 1], limb: [0, 1, 0], sw: { x: [-0.9, 0.9], z: [-0.6, 0.6] }, tw: [-1.2, 1.2] } },
    ...arm('L', 1, n.armL, o), ...arm('R', -1, n.armR, o), ...leg('L', 1, n.legL, o), ...leg('R', -1, n.legR, o),
  ];
}

export const KNIGHT_BONES = {
  pelvis: ['Bone_000', 'Bone_001'], pelvisAnchor: 'Bone_001',
  abdomen: { anchor: 'Bone_005', bones: ['Bone_005'], fit: ['Bone_004'] },
  chest: { anchor: 'Bone_003', bones: ['Bone_003', 'Bone_002', 'Bone_023', 'Bone_028'], fit: ['Bone_018'] },
  head: { anchor: 'Bone_018', bones: ['Bone_017', 'Bone_016'] },
  armL: { sh: 'Bone_022', el: 'Bone_021', wr: 'Bone_020', hd: 'Bone_019', fg: ['Bone_032', 'Bone_031', 'Bone_030', 'Bone_029', 'Bone_036', 'Bone_035', 'Bone_034', 'Bone_033'] },
  armR: { sh: 'Bone_027', el: 'Bone_026', wr: 'Bone_025', hd: 'Bone_024', fg: ['Bone_040', 'Bone_039', 'Bone_038', 'Bone_037', 'Bone_044', 'Bone_043', 'Bone_042', 'Bone_041'] },
  legL: { hip: 'Bone_010', kn: 'Bone_009', an: 'Bone_008', ba: 'Bone_007', tp: 'Bone_006' },
  legR: { hip: 'Bone_015', kn: 'Bone_014', an: 'Bone_013', ba: 'Bone_012', tp: 'Bone_011' },
};
export const BODIES = bodiesFor(KNIGHT_BONES);

// Bones that sit between two bodies take a blend of both rotations.
export const BLEND = { Bone_004: ['abdomen', 'chest', 0.5], Bone_018: ['chest', 'head', 0.5] };

// Reference proportions (the knight): other rigs scale the keyframes / gait constants that were tuned in metres for him.
export const REF = { leg: 0.8539, hipX: 0.1262, shX: 0.18757, arm: 0.3749, hipY: 0.933 };
const snap = (r) => (Math.abs(r - 1) < 0.01 ? 1 : r); // the knight itself must stay bit-for-bit what it was
export function rigScale(rig) {
  const B = rig.bodies, I = rig.idx, d = (a, b) => a.anchor.distanceTo(b.anchor);
  const leg = (d(B[I.thighL], B[I.shinL]) + d(B[I.shinL], B[I.footL]) + d(B[I.thighR], B[I.shinR]) + d(B[I.shinR], B[I.footR])) / 2;
  const hipX = (Math.abs(B[I.thighL].anchor.x) + Math.abs(B[I.thighR].anchor.x)) / 2, shX = (Math.abs(B[I.upperArmL].anchor.x) + Math.abs(B[I.upperArmR].anchor.x)) / 2;
  const arm = (d(B[I.upperArmL], B[I.forearmL]) + d(B[I.forearmL], B[I.handL]) + d(B[I.upperArmR], B[I.forearmR]) + d(B[I.forearmR], B[I.handR])) / 2;
  const hipY = (B[I.thighL].anchor.y + B[I.thighR].anchor.y) / 2;
  return { l: snap(leg / REF.leg), x: snap(hipX / REF.hipX), sx: snap(shX / REF.shX), a: snap(arm / REF.arm), h: snap(hipY / REF.hipY), leg, hipX, shX, arm, hipY };
}

// ---- self-collision proxies. The fitted colliders (profile.json) wrap all the armor and cloth (thighs 15 cm thick, overlapping each other at
// rest), so limbs colliding with each other use slimmer shapes of their own: capsules [t0, t1] along the limb axis (m from the joint) + radius,
// boxes scaled, ball radius. They only collide with other proxies (never the floor: the fitted colliders do that).
export const PROXY = {
  upperArm: { t: [0.02, 0.175], r: 0.062 }, forearm: { t: [0.01, 0.205], r: 0.044 }, thigh: { t: [0.02, 0.425], r: 0.095 }, shin: { t: [0.03, 0.43], r: 0.068 },
  pelvis: { s: [0.95, 0.94, 0.95] }, abdomen: { s: [0.75, 0.9, 0.85] }, chest: { s: [0.9, 0.95, 0.9] }, head: { r: 0.086 },
  hand: { s: [0.9, 0.85, 0.85] }, foot: { s: [1, 1, 1] },
};
// proxies of a limb pair share one collision group when they never need different partners (forearm+hand, shin+foot)
export const GROUPS = ['pelvis', 'abdomen', 'chest', 'head', 'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR', 'thighL', 'lowerLegL', 'thighR', 'lowerLegR'];
export const groupOf = (name) => (/^(forearm|hand)/.test(name) ? 'lowerArm' + name.slice(-1) : /^(shin|foot)/.test(name) ? 'lowerLeg' + name.slice(-1) : name);
// pairs that never collide: neighbours in the chain (they are jointed) plus pairs that overlap by design in the poses the animation uses
export const NOHIT = [
  ['pelvis', 'abdomen'], ['abdomen', 'chest'], ['chest', 'head'], ['chest', 'upperArmL'], ['chest', 'upperArmR'], ['upperArmL', 'lowerArmL'], ['upperArmR', 'lowerArmR'],
  ['pelvis', 'thighL'], ['pelvis', 'thighR'], ['thighL', 'lowerLegL'], ['thighR', 'lowerLegR'],
  // (upper arm vs waist: left colliding, they only touch when something is wrong)
];
export const collides = (a, b) => a !== b && !NOHIT.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function makeProxy(d, fit, table) {
  const P = table[d.name.replace(/[LR]$/, '')];
  if (!P) return fit;
  if (fit.shape === 'capsule') {
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...fit.q)), c = new THREE.Vector3(...fit.c);
    const lat = c.clone().addScaledVector(u, -c.dot(u)), hh = Math.max(0.005, (P.t[1] - P.t[0]) / 2 - P.r);
    return { shape: 'capsule', c: lat.addScaledVector(u, (P.t[0] + P.t[1]) / 2).toArray(), q: fit.q, hh, r: P.r };
  }
  if (fit.shape === 'box') { const h = fit.h.map((x, i) => x * P.s[i]), r = Math.min(fit.r, ...h); return { shape: 'box', c: fit.c, h, r }; }
  return { ...fit, r: P.r ?? fit.r };
}

// Merge the definition with a profile (rest-pose data + mesh-fitted colliders) into a runtime rig description.
// spec (see rigs.js): { bodies, proxy, blend, ... }; without one: the knight.
export function buildRig(profile, spec = null) {
  const defs = spec?.bodies ?? BODIES, table = spec?.proxy ?? PROXY, idx = {};
  defs.forEach((d, i) => (idx[d.name] = i));
  const bodies = defs.map((d, i) => {
    const anchor = new THREE.Vector3(...profile.bones[d.anchor].p);
    const parent = d.parent == null ? -1 : idx[d.parent];
    return { ...d, i, parent, anchor, fit: profile.fits[d.name], prox: makeProxy(d, profile.fits[d.name], table) };
  });
  bodies.forEach((b) => {
    b.off = b.parent < 0 ? new THREE.Vector3() : b.anchor.clone().sub(bodies[b.parent].anchor); // rest offset in parent frame
    b.children = bodies.filter((c) => c.parent === b.i).map((c) => c.i);
  });
  const rig = { bodies, idx, bones: profile.bones, blend: spec?.blend ?? BLEND, spec };
  rig.scale = rigScale(rig);
  return rig;
}
