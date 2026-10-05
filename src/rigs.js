// The characters. Each spec says which bones drive which physics body, how the collision proxies are shaped, which layers it has and how it
// moves. Both use the same "SmartRig" body layout, so the same ghost / walker / active-ragdoll code runs them; only the data differs.
import { bodiesFor, KNIGHT_BONES, BLEND, PROXY } from './humanoid.js';
import { PUNCHES, ROBOT_SWINGS } from './attack.js';

// bones of the skeleton: spine / head / legs are numbered like the knight's; the arms have no finger chain, the hand is the palm + 4 small bones,
// and the rib cage is weighted to the shoulder-girdle bones (026 / 034), which therefore belong to the chest.
export const SKELETON_BONES = {
  ...KNIGHT_BONES,
  chest: { anchor: 'Bone_003', bones: ['Bone_003', 'Bone_002', 'Bone_026', 'Bone_034'], fit: ['Bone_018'] },
  armL: { sh: 'Bone_025', el: 'Bone_024', wr: null, hd: 'Bone_023', fg: ['Bone_022', 'Bone_021', 'Bone_020', 'Bone_019'] },
  armR: { sh: 'Bone_033', el: 'Bone_032', wr: null, hd: 'Bone_031', fg: ['Bone_030', 'Bone_029', 'Bone_028', 'Bone_027'] },
};

// bones of the robot: the same auto-rig as the knight (the spine / head / legs are numbered alike), but its arms are numbered the other way round (the Bone_022
// chain is on its right) and each hand has three finger chains of four bones: a thumb-like one first, then two for the fingers.
export const ROBOT_BONES = {
  ...KNIGHT_BONES,
  armL: { sh: 'Bone_027', el: 'Bone_026', wr: 'Bone_025', hd: 'Bone_024', fg: ['Bone_044', 'Bone_043', 'Bone_042', 'Bone_041', 'Bone_048', 'Bone_047', 'Bone_046', 'Bone_045', 'Bone_052', 'Bone_051', 'Bone_050', 'Bone_049'] },
  armR: { sh: 'Bone_022', el: 'Bone_021', wr: 'Bone_020', hd: 'Bone_019', fg: ['Bone_032', 'Bone_031', 'Bone_030', 'Bone_029', 'Bone_036', 'Bone_035', 'Bone_034', 'Bone_033', 'Bone_040', 'Bone_039', 'Bone_038', 'Bone_037'] },
};

export const KNIGHT = {
  name: 'knight', model: 'Untitled.glb', profile: 'src/profile.json',
  bodies: bodiesFor(KNIGHT_BONES), blend: BLEND, proxy: PROXY,
  sword: true,                       // the draw / sheathe / swing layer (sword.js)
  fists: { swings: PUNCHES, heavy: 'haymaker', combo: [['jab', 'L'], ['cross', 'R'], ['hook', 'L'], ['cross', 'R']], rollBase: -180, relaxed: 0, torsoLag: 0.1, cancel: 0.3,
    guard: { own: 1, hold: 3, spineW: 0.25, L: { hand: [0.07, 0.12, 0.20], fist: 0.9, roll: 100, pole: [-0.15, -1, -0.2] }, R: { hand: [0.08, 0.11, 0.19], fist: 0.9, roll: 90, pole: [-0.15, -1, -0.2] }, sp: { chest: 2, abd: 3, head: 5, py: -0.025 } } }, // unarmed: jab - cross - hook combo, haymaker; its neutral hand is palm-down (180 deg from palm-up)
  inertiaFloor: { abdomen: 0.4, chest: 0.9, head: 0.05, upperArm: 0.05, forearm: 0.04, hand: 0.04 }, // heavier virtual inertia of the torso and arms: stacked stiff controllers on a light body ring (see the skeleton)
  bitOrig: 15,                       // collision bit of the fitted colliders (they also touch the other characters')
  style: {},                         // walk / run overrides (walk.js WALK)
};

export const SKELETON = {
  name: 'skeleton', model: 'skeleton.glb', profile: 'src/profile-skeleton.json',
  bodies: bodiesFor(SKELETON_BONES, { armMass: 0.45 }), blend: BLEND, // bone arms: light (a heavy arm whipped through a swing would fold the torso over)
  // thin bones, cloth and a ribcage: slimmer collision proxies than the knight's armor
  proxy: {
    upperArm: { t: [0.01, 0.13], r: 0.035 }, forearm: { t: [0.01, 0.23], r: 0.032 }, thigh: { t: [0.03, 0.46], r: 0.058 }, shin: { t: [0.03, 0.45], r: 0.044 },
    pelvis: { s: [0.9, 0.9, 0.9] }, abdomen: { s: [0.9, 0.9, 0.9] }, chest: { s: [0.9, 0.95, 0.9] }, head: { r: 0.08 },
    hand: { s: [0.9, 0.85, 0.85] }, foot: { s: [1, 1, 1] },
  },
  sword: false,
  attack: { relaxed: 0.3, rollBase: -90, guard: { own: 0.5, hold: 1.2, spineW: 0.1, L: { hand: [0.05, 0.02, 0.17], fist: 0.5, roll: 90 }, R: { hand: [0.05, 0.02, 0.17], fist: 0.5, roll: 90 }, sp: { abd: 4, chest: 2, head: 6 } } }, // the savage-swing layer (attack.js) instead of a sword; relaxed hands curl a little, its neutral hand has the palm facing forward (90 deg from palm-up)
  bitOrig: 13,
  inertiaFloor: { abdomen: 0.4, chest: 0.9, head: 0.05 },  // its lumbar body is tiny: the joint controller's effective stiffness is capped by the body inertia (Ir/h^2), so it gets the knight's
  legIK: 'hinge',                   // its rest legs are knock-kneed (the knee 4.6 cm inside the hip-ankle line): the IK keys the knee hinge to the pelvis' lateral axis
  keyTweak: { hip4: 0.06, z4: -0.03, foot4: 0 }, // get-up lunge: the long thigh needs the hip a bit higher so the back knee stays off the floor
  style: { sway: 0.6, run: {} },
  // the model only has palm bones: procedural finger bones (skin.js) curl the fingers / thumb into a fist. Left-hand numbers, T-pose mesh space (the right hand mirrors them)
  fingers: {
    xk: 0.665, axisPoint: [0, 1.385, 0.047], // knuckle line: |x|; y / z of the finger axis
    joints: [0, 0.028, 0.047], blend: 0.007,  // knuckle / middle / tip joints: distance along the fingers from the knuckle line, half-width of the weight blends
    axis: [0, 1, 0], dir: 1, angles: [1.5, 2.8, 3.5], // curl axis (the fingers fold about it toward the palm), cumulative angle at the end of each phalanx at a full fist
    thumb: { base: [0.625, 1.41, 0.052], dir: [0.67, 0.63, 0.25], joints: [0, 0.03], radius: 0.024, minY: 1.405, axis: [-0.63, 0.38, 0.73], angles: [1.0, 1.9] },
  },               // it can run (walk.js RUN, tuned here)
};

// the robot: a slim android (1.7 m, 53 bones). Heavier and stiffer than the others, a stiff mechanical gait, and it can jump (jump.js).
export const ROBOT = {
  name: 'robot', model: 'robot.glb', profile: 'src/profile-robot.json',
  bodies: bodiesFor(ROBOT_BONES, { mass: 1.3, ks: 1.15 }), blend: BLEND,
  // slim limbs: the knight's armor-sized collision proxies would make the thighs rub on each other
  proxy: { upperArm: { t: [0.02, 0.19], r: 0.036 }, forearm: { t: [0.01, 0.25], r: 0.033 }, thigh: { t: [0.02, 0.42], r: 0.056 }, shin: { t: [0.03, 0.40], r: 0.046 },
    pelvis: { s: [0.9, 0.9, 0.9] }, abdomen: { s: [0.8, 0.9, 0.8] }, chest: { s: [0.85, 0.9, 0.85] }, head: { r: 0.065 }, hand: { s: [0.9, 0.85, 0.85] }, foot: { s: [1, 1, 1] } },
  sword: false,
  jump: { apex: 1.0, tuck: 0.02, arms: 0.25 }, // can jump (jump.js JUMP, a robot's version: legs straight down, arms nearly still)
  attack: { swings: ROBOT_SWINGS, heavy: 'hammer', combo: [['piston', 'L'], ['piston', 'R'], ['piston', 'L'], ['sweep', 'R']], relaxed: 0, rollBase: -180, torsoLag: 0.1, cancel: 0.3,
    guard: { own: 1, hold: 2.5, spineW: 0.2, L: { hand: [0.12, 0.03, 0.13], fist: 0.75, roll: 90, pole: [-0.2, -1, -0.1] }, R: { hand: [0.12, 0.03, 0.13], fist: 0.75, roll: 90, pole: [-0.2, -1, -0.1] }, sp: { abd: 2, head: 3, py: -0.02 } } }, // piston punches (a combo), a hammer blow
  inertiaFloor: { abdomen: 0.4, chest: 0.9, head: 0.05, upperArm: 0.05, forearm: 0.04, hand: 0.04, thigh: 0.12, shin: 0.03, foot: 0.02 }, // its limbs are thin (small inertia): stacked stiff controllers on light bodies ring
  bitOrig: 12,
  // mechanical gait: the swing foot goes straight up, across at a steady pace and straight down, the torso is held like a block (no sway / roll / twist), the
  // elbows stay bent at a right angle, the head turns in 12-degree servo steps, the feet stay flat, and a metronome cadence
  style: { idleScan: true, halfW: 0.215, mech: 0.85, rigid: 0.92, armReach: 0.7, armSwing: 0.6, headSnap: 12, footRoll: 0.12, lift: 0.055, bobScale: 0.5, kneeBend: 0.06, sway: 0, Tmin: 0.85,
    run: { halfW: 0.18, mech: 0.4, rigid: 0.92, armReach: 0.62, footRoll: 0.1, pitch: 3, pitchV: 2, torso: 2, headLead: 0.3, head: 0, twist: 0.3, bank: 1.2, lift: 0.15, Tmin: 0.75 } }, // (a boxier run path / a quicker cadence whips the feet at 13+ m/s, more than the physics can follow)
};

export const RIGS = { knight: KNIGHT, skeleton: SKELETON, robot: ROBOT };
