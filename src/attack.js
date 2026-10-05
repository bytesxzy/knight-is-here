// Attack layer: fist / claw / piston moves. Same plug-in interface as the sword layer (layers.js): the ghost asks it for torso twist / lean (spine), hand
// targets + hand roll (arm), and the skin for the finger curl (a fist); the physics swings the arms with the usual joint controllers + hand springs.
//  A move = anticipation (cock) -> strike -> follow-through -> recover. `a` runs 0 (cocked) -> 1 (end of the strike), `w` is how much the move owns the hand.
//  Hand offsets are in the chest frame, from the same-side shoulder (right-handed; the left hand mirrors them), in metres for the knight (scaled by the rig's
//  arm length). `fist` = finger curl at the cock / end (0 open .. 1 fist), `roll` = the hand's turn about the forearm in degrees at the cock / end.
//  SMOOTHNESS: a fighter keeps a GUARD (`style.guard`): while it is engaged the hands rest there, not at its sides, so every move starts and ends in the guard
//  and the arm never flaps up and down between blows. Everything the layer outputs is a convex blend (move poses + guard + the walker's arms) of continuous
//  weights, so overlapping moves of one hand cross-fade instead of switching; the strike curves have no velocity jump; a cancelled move fades out.
import * as THREE from '#three';
import { ease } from './ghost.js';

const { Vector3: V3 } = THREE;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const D = Math.PI / 180;
const S = ease; // smoothstep

// the skeleton's savage swings
export const SWINGS = {
  slash: { d: [0.26, 0.15, 0.10, 0.26], both: false, hand: { cock: [-0.20, 0.21, -0.17], end: [0.20, -0.21, 0.20], arc: [0, 0.10, 0.12] }, fist: [1, 1], roll: [0, 180], impulse: 120, knock: false, pole: [-0.7, -0.6, -0.25],
    sp: { chestT: 30, abdT: 18, chest: [-5, 12], abd: [-3, 8], chestS: [-4, 6], head: [2, -8], headT: -0.7, pyaw: 8, pitch: [-1, 3] } },
  hook: { d: [0.28, 0.16, 0.10, 0.26], both: false, hand: { cock: [-0.30, 0.0, -0.08], end: [0.16, -0.05, 0.27], arc: [-0.06, 0, 0.04] }, fist: [1, 1], roll: [0, 180], impulse: 135, knock: false, pole: [-1, -0.15, -0.2],
    sp: { chestT: 38, abdT: 22, chest: [0, 8], abd: [0, 5], chestS: [0, 0], head: [0, -4], headT: -0.7, pyaw: 10, pitch: [0, 2] } },
  smash: { d: [0.40, 0.20, 0.16, 0.36], both: true, hand: { cock: [0.12, 0.31, -0.08], end: [0.10, -0.25, 0.22], arc: [0, 0.08, 0.08] }, fist: [1, 1], roll: [90, 90], impulse: 330, knock: true, pole: [-0.85, 0.15, -0.5], poleEnd: [-0.8, -0.5, -0.3],
    sp: { chestT: 0, abdT: 0, chest: [-16, 28], abd: [-6, 18], chestS: [0, 0], head: [-10, 14], headT: 0, pyaw: 0, pitch: [-2, 6] } },
};
// the knight's punches (jab = the left hand, cross = the right, hook alternates, haymaker = the heavy one)
const PUNCH_POLE = [-0.15, -1, -0.2];
export const PUNCHES = {
  jab: { d: [0.06, 0.08, 0.06, 0.16], side: 'L', both: false, hand: { cock: [0.07, 0.12, 0.17], end: [0.07, 0.03, 0.35], arc: [0, 0.015, 0] }, fist: [0.9, 1], roll: [100, 180], impulse: 85, knock: false, pole: PUNCH_POLE,
    sp: { chestT: 5, abdT: 3, chest: [0, 5], abd: [0, 2], chestS: [0, 0], head: [0, -2], headT: -0.5, pyaw: 3, pitch: [0, 2] } },
  cross: { d: [0.09, 0.09, 0.07, 0.20], side: 'R', both: false, hand: { cock: [0.09, 0.10, 0.15], end: [0.09, 0.02, 0.355], arc: [0, 0.02, 0] }, fist: [0.9, 1], roll: [90, 180], impulse: 125, knock: false, pole: PUNCH_POLE,
    sp: { chestT: 16, abdT: 8, chest: [-1, 8], abd: [0, 4], chestS: [0, 0], head: [0, -3], headT: -0.6, pyaw: 6, pitch: [0, 3] } },
  hook: { d: [0.11, 0.10, 0.08, 0.21], both: false, hand: { cock: [-0.28, 0.10, 0.04], end: [0.15, 0.04, 0.27], arc: [-0.05, 0, 0.04] }, fist: [1, 1], roll: [100, 180], impulse: 150, knock: false, pole: [-1, -0.1, -0.2],
    sp: { chestT: 22, abdT: 12, chest: [0, 6], abd: [0, 3], chestS: [0, 0], head: [0, -3], headT: -0.7, pyaw: 8, pitch: [0, 2] } },
  haymaker: { d: [0.24, 0.13, 0.12, 0.30], side: 'R', both: false, hand: { cock: [-0.33, 0.20, -0.10], end: [0.18, -0.06, 0.28], arc: [-0.08, 0.04, 0.05] }, fist: [1, 1], roll: [60, 180], impulse: 270, knock: true, pole: [-1, -0.2, -0.3],
    sp: { chestT: 28, abdT: 16, chest: [-3, 12], abd: [-2, 6], chestS: [0, 0], head: [0, -5], headT: -0.7, pyaw: 10, pitch: [-1, 4] } },
};
PUNCHES.uppercut = { d: [0.16, 0.10, 0.08, 0.26], side: 'R', both: false, hand: { cock: [0.08, -0.30, 0.10], end: [0.06, 0.16, 0.30], arc: [0, 0, 0.04] }, fist: [1, 1], roll: [100, 60], impulse: 190, knock: true, lift: 0.9, pole: [-0.35, -1, -0.1],
  sp: { chestT: 12, abdT: 7, chest: [8, -5], abd: [4, -2], chestS: [0, 0], head: [2, -4], headT: -0.4, pyaw: 5, pitch: [1, -1], py: [-0.05, 0.02] } };
PUNCHES.elbow = { d: [0.10, 0.09, 0.07, 0.22], side: 'L', both: false, hand: { cock: [-0.18, 0.12, 0.10], end: [0.15, 0.08, 0.16], arc: [0, 0, 0] }, fist: [1, 1], roll: [90, 90], impulse: 135, knock: false, pole: [-0.6, -0.2, 0.8],
  sp: { chestT: 24, abdT: 14, chest: [0, 6], abd: [0, 3], chestS: [0, 0], head: [0, -3], headT: -0.6, pyaw: 8, pitch: [0, 2] } };
// the skeleton's extra moves: a lunging spear-hand stab, a two-handed claw rake (an X), a rising claw, a backhand sweep
SWINGS.stab = { d: [0.22, 0.09, 0.08, 0.24], both: false, hand: { cock: [0.06, 0.02, 0.10], end: [0.05, 0, 0.34], arc: [0, 0, 0] }, fist: [0, 0], roll: [90, 90], impulse: 150, knock: false, pole: [-0.5, -1, -0.2],
  sp: { chestT: 16, abdT: 9, chest: [0, 6], abd: [0, 4], chestS: [0, 0], head: [0, -3], headT: -0.5, pyaw: 6, pitch: [0, 2], pz: [0, 0.10], py: [0, -0.03] } };
SWINGS.rake = { d: [0.24, 0.12, 0.10, 0.28], both: true, hand: { cock: [-0.24, 0.26, -0.05], end: [0.15, -0.20, 0.26], arc: [0, 0.06, 0.06] }, fist: [0.3, 0.7], roll: [90, 90], impulse: 190, knock: false, pole: [-0.6, -0.8, -0.2],
  sp: { chestT: 0, abdT: 0, chest: [-8, 16], abd: [-3, 10], chestS: [0, 0], head: [-6, 10], headT: 0, pyaw: 0, pitch: [-1, 4] } };
SWINGS.rise = { d: [0.16, 0.10, 0.08, 0.26], side: 'R', both: false, hand: { cock: [0.06, -0.28, 0.10], end: [0.05, 0.18, 0.28], arc: [0, 0, 0.04] }, fist: [1, 1], roll: [90, 90], impulse: 200, knock: true, lift: 0.9, pole: [-0.35, -1, -0.1],
  sp: { chestT: 12, abdT: 7, chest: [8, -5], abd: [4, -2], chestS: [0, 0], head: [2, -4], headT: -0.4, pyaw: 5, pitch: [1, -1], py: [-0.04, 0.02] } };
SWINGS.backhand = { d: [0.16, 0.12, 0.08, 0.24], side: 'L', both: false, hand: { cock: [0.18, 0.04, 0.14], end: [-0.30, 0.06, 0.10], arc: [0, 0, 0.08] }, fist: [0.6, 1], roll: [90, 90], impulse: 140, knock: false, pole: [-0.8, -0.3, -0.4],
  sp: { chestT: 34, abdT: 20, chest: [0, 8], abd: [0, 5], chestS: [0, 0], head: [0, -5], headT: -0.7, pyaw: 9, pitch: [0, 2] } };
// the robot's moves: stiff, constant-speed pistons (lin: a trapezoid speed profile, no ease in or out), no corkscrew, a block of a torso
export const ROBOT_SWINGS = {
  piston: { d: [0.07, 0.10, 0.06, 0.18], lin: true, both: false, hand: { cock: [0.12, -0.02, 0.10], end: [0.06, -0.02, 0.37], arc: [0, 0, 0] }, fist: [0.75, 1], roll: [90, 90], impulse: 105, knock: false, pole: [-0.2, -1, -0.1],
    sp: { chestT: 6, abdT: 3, chest: [0, 3], abd: [0, 1], chestS: [0, 0], head: [0, 0], headT: 0, pyaw: 2, pitch: [0, 1] } },
  sweep: { d: [0.12, 0.14, 0.08, 0.22], lin: true, both: false, hand: { cock: [-0.30, 0.04, 0.10], end: [0.22, 0.02, 0.28], arc: [0, 0, 0] }, fist: [0.75, 1], roll: [90, 90], impulse: 140, knock: false, pole: [-1, -0.1, -0.2],
    sp: { chestT: 12, abdT: 6, chest: [0, 2], abd: [0, 1], chestS: [0, 0], head: [0, 0], headT: 0, pyaw: 4, pitch: [0, 1] } },
  hammer: { d: [0.30, 0.15, 0.14, 0.34], lin: true, side: 'R', both: true, hand: { cock: [0.12, 0.30, -0.05], end: [0.10, -0.22, 0.28], arc: [0, 0, 0] }, fist: [1, 1], roll: [90, 90], impulse: 300, knock: true, pole: [-0.85, 0.15, -0.5], poleEnd: [-0.8, -0.5, -0.3],
    sp: { chestT: 0, abdT: 0, chest: [-10, 20], abd: [-4, 12], chestS: [0, 0], head: [-4, 8], headT: 0, pyaw: 0, pitch: [-1, 4] } },
};
// the robot's extras: a launching uppercut, rapid pistons (the barrage), a two-handed clap, a straight-armed chop
ROBOT_SWINGS.uppercut = { d: [0.20, 0.12, 0.10, 0.28], lin: true, side: 'R', both: false, hand: { cock: [0.10, -0.30, 0.08], end: [0.07, 0.14, 0.30], arc: [0, 0, 0] }, fist: [0.75, 1], roll: [90, 90], impulse: 250, knock: true, lift: 1.0, pole: [-0.35, -1, -0.1],
  sp: { chestT: 6, abdT: 3, chest: [6, -4], abd: [3, -2], chestS: [0, 0], head: [0, 0], headT: 0, pyaw: 2, pitch: [0, 1], py: [-0.05, 0.02] } };
ROBOT_SWINGS.rapid = { d: [0.03, 0.05, 0.03, 0.10], lin: true, both: false, hand: { cock: [0.12, -0.02, 0.12], end: [0.06, -0.02, 0.35], arc: [0, 0, 0] }, fist: [0.75, 1], roll: [90, 90], impulse: 70, knock: false, pole: [-0.2, -1, -0.1],
  sp: { chestT: 3, abdT: 2, chest: [0, 2], abd: [0, 1], chestS: [0, 0], head: [0, 0], headT: 0, pyaw: 1, pitch: [0, 1] } };
ROBOT_SWINGS.clap = { d: [0.22, 0.10, 0.10, 0.30], lin: true, both: true, hand: { cock: [-0.20, 0.05, 0.06], end: [0.12, 0, 0.30], arc: [0, 0, 0] }, fist: [0.3, 0.3], roll: [90, 90], impulse: 260, knock: true, pole: [-1, -0.2, -0.2],
  sp: { chestT: 0, abdT: 0, chest: [-4, 10], abd: [-2, 6], chestS: [0, 0], head: [0, 3], headT: 0, pyaw: 0, pitch: [0, 3] } };
ROBOT_SWINGS.chop = { d: [0.18, 0.12, 0.10, 0.28], lin: true, both: false, hand: { cock: [0.04, 0.30, 0], end: [0.05, -0.20, 0.28], arc: [0, 0, 0] }, fist: [0.75, 1], roll: [90, 90], impulse: 190, knock: false, pole: [-0.85, 0.15, -0.5], poleEnd: [-0.8, -0.5, -0.3],
  sp: { chestT: 4, abdT: 2, chest: [-6, 12], abd: [-2, 6], chestS: [0, 0], head: [0, 0], headT: 0, pyaw: 1, pitch: [-1, 3] } };
// elbow side. `pole: 'free'` = the walker's own pole (the elbow bulges backward / down by itself): where a move's hand goes (almost) straight up or down the explicit
// poles of the other moves end up (anti)parallel to the reach and the upper arm swung about its axis; measured with tools/combat-smooth.mjs the free elbow is the
// smoothest (and physically the easiest to follow) for the stiff robot and for the skeleton's two-handed moves; the knight's punches keep their explicit poles
for (const k of Object.values(ROBOT_SWINGS)) { k.pole = 'free'; delete k.poleEnd; }
for (const k of [SWINGS.smash, SWINGS.rake]) { k.pole = 'free'; delete k.poleEnd; }
// display names (the controls panel)
export const LABELS = { jab: 'Jab', cross: 'Cross', hook: 'Hook', haymaker: 'Haymaker', uppercut: 'Uppercut', elbow: 'Elbow', slash: 'Slash', smash: 'Smash', stab: 'Lunge stab', rake: 'Double rake', rise: 'Rising claw', backhand: 'Backhand',
  piston: 'Piston', sweep: 'Sweep', hammer: 'Hammer', rapid: 'Rapid piston', clap: 'Thunder clap', chop: 'Chop', barrage: 'Piston barrage' };
export const tableFinish = (t) => { for (const k of Object.values(t)) k.T = k.d.reduce((a, b) => a + b, 0); };
for (const t of [SWINGS, PUNCHES, ROBOT_SWINGS]) tableFinish(t);

// ---- timing. The strike curve is C1 into the follow-through (it arrives with ~no speed: the hit is the end of the motion, not a stop dead), `lin` moves
// (a machine) use a trapezoid speed profile: 15% accelerating, constant, 15% braking.
const trap = (u, r = 0.15) => (u < r ? (u * u) / (2 * r * (1 - r)) : u > 1 - r ? 1 - ((1 - u) * (1 - u)) / (2 * r * (1 - r)) : (u - r / 2) / (1 - r));
const whip = (u) => S(Math.pow(u, 1.35)); // slow start, fastest around 70%, eases into the end pose
// where a move is: a (0 cocked .. 1 struck, a little beyond in the follow-through), w (how much it owns the hand), strike (the window in which it can hit)
export function env(s) {
  const [d0, d1, d2, d3] = s.d, t = s.t;
  if (t < d0) return { a: 0, w: S(t / (0.8 * d0)), strike: false };
  const ts = t - d0;
  if (ts < d1) { const u = ts / d1, a = s.lin ? trap(u) : whip(u); return { a, w: 1, strike: a > 0.45 }; }
  const th = ts - d1;
  if (th < d2) return { a: 1 + 0.06 * S(th / d2), w: 1, strike: th < 0.5 * d2 };
  return { a: 1.06, w: 1 - S((th - d2) / d3), strike: false };
}
export const fade = (s) => (s.kt === undefined ? 0 : S(s.kt / s.kd)); // a cancelled move fades out instead of vanishing

// a value that follows its target like a critically damped spring (smooth velocity: a violent target must not demand an instant torso whip)
export function follow(s, key, target, tau, h) {
  const v = key + 'v';
  s[v] = (s[v] ?? 0) + ((target - s[key]) / (tau * tau) - (2 * (s[v] ?? 0)) / tau) * h;
  s[key] += s[v] * h;
}
// torso twist / lean / head / hips of one move (sp = the kind's `sp` table, e = env(s), s.as = the low-passed progress the torso follows)
export function applySpine(v, sp, s, e, act, walkW = 0) {
  const m = s.side === 'L' ? -1 : 1, w = (s.ws ?? e.w) * (1 - fade(s)) * act * s.amp, a = s.as, tw = (2 * a - 1) * w; // (the torso follows smoothed progress / ownership: s.as, s.ws)
  v.chestT += m * sp.chestT * tw; v.abdT += m * sp.abdT * tw; v.headT += m * sp.headT * (sp.chestT + sp.abdT) * tw; v.pyaw += m * sp.pyaw * tw;
  v.chest += lerp(sp.chest[0], sp.chest[1], a) * w; v.abd += lerp(sp.abd[0], sp.abd[1], a) * w; v.chestS += m * lerp(sp.chestS[0], sp.chestS[1], a) * w;
  v.head += lerp(sp.head[0], sp.head[1], a) * w; v.pitch += lerp(sp.pitch[0], sp.pitch[1], a) * w;
  if (sp.pz) v.pz += lerp(sp.pz[0], sp.pz[1], a) * w * (1 - walkW); // a lunge: the pelvis moves into the blow (the legs bend with it; not while he walks)
  if (sp.py) v.py += lerp(sp.py[0], sp.py[1], a) * w * (1 - walkW);
}

const HAND_PARTS = { L: ['handL', 'forearmL'], R: ['handR', 'forearmR'], B: ['handL', 'forearmL', 'handR', 'forearmR'] };

export class AttackLayer {
  // style: swings (table), heavy (its heavy move), combo ([[kind, side], ...] the light attack button cycles through; none = a random savage mix), relaxed (resting
  // fist curl), rollBase (deg: how far the rig's neutral hand is turned from palm-up), speed / amp scale, smash (chance of the heavy move in a random combo),
  // guard ({ own, hold, L: {hand, fist, roll, pole}, R: {...}, sp }: the fighting stance, see GUARD in rigs.js), specials ({ Q: 'elbow', ... })
  constructor(rig, style = {}) {
    this.rig = rig; this.sa = rig.scale?.a ?? 1; this.style = { speed: 1, amp: 1, smash: 0.2, torsoLag: 0.07, cancel: 0, relaxed: 0, rollBase: 0, swings: SWINGS, heavy: 'smash', ...style };
    this.table = this.style.swings;
    this.boost = 3; this.handFF = 1; this.handK = style.handK ?? 1; this.handMax = style.handMax ?? 400; this.worldW = 0.9; this.torsoRelax = 0; this.act = 0; this.walkW = 0; this.p = 0; this.dir = 0; this.canStart = null;
    this.sw = []; this.frenzy = false; this.side = 'R'; this.rand = 1; this.n = 0; this.last = null; this.smashOK = true; this.queued = null; this.pending = null; this.comboI = 0; this.idle = 9;
    this.eng = 0; this.engT = 99; this.stop = 0; this.pin = false; // engagement (how much the guard is up), time since the last blow, hit-stop timer, held up by the AI
    const B = rig.bodies, I = rig.idx;
    this.sh = { L: B[I.upperArmL].off.clone(), R: B[I.upperArmR].off.clone() };
    this.armLen = B[I.forearmL].off.length() + B[I.handL].off.length(); // shoulder -> wrist when the arm is straight
    this.out = { L: this.blank(), R: this.blank() };
  }
  blank() { return { off: new V3(), W: 0, roll: 0, curl: this.style.relaxed, pole: new V3(), dir: new V3(), free: 0 }; }
  // ---- the sword layer's interface (nothing to draw / sheathe)
  get drawn() { return false; }
  get busy() { return false; }
  toggle() { return false; }
  request() { return false; }
  gripW() { return 0; }

  // ---- control
  rnd() { let t = (this.rand += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } // tiny deterministic generator (mulberry32): the same fight every run
  get swinging() { return this.sw.some((s) => s.t < s.T && s.kt === undefined); }
  set attackHeld(v) { this.frenzy = !!v; } get attackHeld() { return this.frenzy; }
  engage() { this.engT = 0; }                     // raise the guard (a fighter that is sizing somebody up)
  hitStop(sec) { this.stop = Math.max(this.stop, sec); } // a blow landed: the layer's own clock nearly stops for a moment (weight)
  // a blow landed on me: the moves in progress fade out (they do not vanish)
  interrupt(sec = 0.16) { for (const s of this.sw) if (s.kt === undefined) { s.kt = 0; s.kd = sec; } this.queued = null; this.pending = null; this.script = null; }
  // the player's buttons: light / heavy attack (a press while a move is under way is buffered into the next one)
  attack(heavy = false) {
    if (!heavy && this.queued?.kind === this.style.heavy) return false; // (a heavy attack is waiting for its slot: no light one jumps the queue)
    if (heavy) return this.queue(this.style.heavy, this.table[this.style.heavy].side ?? null);
    const c = this.style.combo;
    if (!c) return this.queue(null, null);
    const [kind, side] = c[(this.idle > 1.1 ? 0 : this.comboI) % c.length];
    return this.queue(kind, side);
  }
  // the special buttons (Q / R / F): one named move each
  special(key) {
    const kind = this.style.specials?.[key], sc = this.style.scripts?.[kind]; // (a script = a scripted run of moves: the robot's barrage)
    if (sc) { if (this.script?.length) return false; this.script = sc.map((x) => x.slice()); return true; }
    if (!kind || !this.table[kind]) return false; return this.queue(kind, this.table[kind].side ?? null, true);
  }
  queue(kind, side, special = false) { if (this.swing(kind, side)) { this.queued = null; return true; } if (!(this.queued?.kind === this.style.heavy && kind !== this.style.heavy)) this.queued = { kind, side, t: 0.35, special }; return false; } // (a held light attack must not bump a waiting heavy one)
  // start a move (kind / side optional: the next one of a savage random combo). false while the arms are still busy with the last one.
  swing(kind = null, side = null, special = false) {
    const last = this.sw.filter((s) => s.kt === undefined).pop();
    if (this.act < 0.99 || (last && last.t < last.chain)) return false; // (the last one must have landed, and recovered a bit)
    if (!kind) kind = this.pending ?? this.pick(); // (a two-handed move that had to wait stays picked)
    const K = this.table[kind];
    if (last && (last.both || K.both) && last.t < last.T * 0.8) { this.pending = K.both ? kind : null; return false; } // a two-handed move needs both arms free
    this.pending = null;
    const c = this.style.combo;
    if (c && !special) { if (this.idle > 1.1) this.comboI = 0; if (c[this.comboI % c.length][0] === kind) this.comboI++; else if (kind === this.style.heavy) this.comboI = 0; } // (the combo advances with the light moves)
    this.side = side ?? K.side ?? (this.side === 'R' ? 'L' : 'R');
    const sp = this.style.speed * (0.94 + 0.12 * this.rnd()), amp = this.style.amp * (0.95 + 0.1 * this.rnd());
    const d = K.d.map((x) => x / sp), warm = this.style.guard ? 0.2 * (1 - clamp(this.eng, 0, 1)) : 0; // (a blow from rest: the arm first has to come up, which takes a moment)
    d[0] += warm; const T = K.T / sp + warm;
    this.n++; this.last = kind; this.idle = 0; this.engT = 0;
    this.sw.push({ kind, side: K.both ? 'B' : this.side, t: 0, d, T, amp, hit: false, as: 0, ws: 0, ar: 0, lin: !!K.lin, impulse: K.impulse * amp, knock: K.knock, lift: K.lift, blade: false, parts: K.parts ?? HAND_PARTS[K.both ? 'B' : this.side],
      chain: d[0] + d[1] + (this.style.cancel > 0 ? d[2] + this.style.cancel * d[3] : (K.chain ?? 0.5) * d[2]) });
    return true;
  }
  // the next move of the savage random combo: slashes and hooks, now and then a two-handed smash (only when allowed: the AI saves it for close range)
  pick() {
    const st = this.style, r = this.rnd(), c = this.rnd();
    if (st.only) return st.only;
    if (this.table.smash && this.n > 1 && this.smashOK && this.last !== 'smash' && r < st.smash) return 'smash';
    const pool = st.pool ?? ['slash', 'hook'];
    return pool[Math.floor(c * pool.length) % pool.length];
  }
  // the moves whose strike window is open right now (the combat code tests contacts and marks `hit`)
  strikes() { return this.sw.filter((s) => !s.hit && s.kt === undefined && env(s).strike); }

  step(h, standing) {
    this.act = clamp(this.act + (standing ? h : -h) / 0.35, 0, 1);
    if (!standing) { this.sw.length = 0; this.queued = null; this.script = null; this.eng = 0; this.engv = 0; this.out.L = this.blank(); this.out.R = this.blank(); return; }
    const hh = this.stop > 0 ? h * 0.12 : h, tl = this.style.torsoLag; this.stop = Math.max(0, this.stop - h);
    for (const s of this.sw) {
      s.t += hh; const e = env(s), f = fade(s);
      if (s.kt !== undefined) s.kt += h;
      follow(s, 'as', e.a, tl, hh); follow(s, 'ws', e.w * (1 - f), tl, hh); follow(s, 'ar', e.a, 0.09, hh); // (the torso is much slower than the whipping hand; the hand's turn is eased too)
    }
    this.sw = this.sw.filter((s) => (s.kt === undefined ? s.t < s.T || s.ws > 0.02 || Math.abs(s.wsv) > 0.05 : s.kt < s.kd + 0.2 && (s.ws > 0.02 || Math.abs(s.wsv) > 0.05))); // (a finished move stays until the torso has settled: it must not vanish in one step)
    this.idle = this.swinging ? 0 : this.idle + h;
    this.engT += h;
    const G = this.style.guard, want = G && (this.pin || this.engT < G.hold || this.swinging) ? 1 : 0;
    if (G) { follow(this, 'eng', want, want > this.eng ? 0.09 : 0.22, h); this.eng = clamp(this.eng, 0, 1); }
    if (this.queued) { this.queued.t -= h; if (this.queued.t <= 0) this.queued = null; else if (this.swing(this.queued.kind, this.queued.side, this.queued.special)) this.queued = null; }
    if (this.script?.length && this.act > 0.99) { const [k, sd] = this.script[0]; if (this.swing(k, sd, true)) this.script.shift(); } // (the script's next move starts as soon as the last one has landed and recovered)
    if (this.frenzy && this.act > 0.99 && !this.script?.length) { if (this.style.combo) this.attack(false); else this.swing(); }
    this.refresh(h);
  }

  // ---- the blend. For each hand: the moves in progress (weights = their ownership), the guard (what is left, scaled by the engagement) and the walker's own arms (the rest)
  guardOf(side) {
    const G = this.style.guard?.[side], m = side === 'L' ? -1 : 1;
    return G ? { off: new V3(m * G.hand[0], G.hand[1], G.hand[2]).multiplyScalar(this.sa), roll: (G.roll ?? 0) + this.style.rollBase, curl: G.fist ?? this.style.relaxed, pole: new V3(m * (G.pole?.[0] ?? -0.15), G.pole?.[1] ?? -1, G.pole?.[2] ?? -0.2).normalize() } : null;
  }
  has(s, side) { return s.side === 'B' || s.side === side; }
  refresh(h = 1 / 120) {
    for (const side of ['L', 'R']) {
      const m = side === 'L' ? -1 : 1, o = this.out[side], gd = this.guardOf(side), terms = [];
      let ws = 0;
      for (const s of this.sw) if (this.has(s, side)) {
        const e = env(s), w = e.w * (1 - fade(s)) * this.act;
        if (w < 1e-4) continue;
        const K = this.table[s.kind], h = K.hand, a = e.a, k = 4 * clamp(a, 0, 1) * (1 - clamp(a, 0, 1)), f = this.sa * s.amp, ar = clamp(s.ar, 0, 1);
        terms.push({ w, off: new V3(m * (lerp(h.cock[0], h.end[0], a) + h.arc[0] * k), lerp(h.cock[1], h.end[1], a) + h.arc[1] * k, lerp(h.cock[2], h.end[2], a) + h.arc[2] * k).multiplyScalar(f),
          roll: lerp(K.roll[0], K.roll[1], ar) + this.style.rollBase, curl: lerp(K.fist[0], K.fist[1], clamp(a, 0, 1)), free: K.pole === 'free' ? 1 : 0, pole: K.pole && K.pole !== 'free' ? (K.poleEnd ? new V3(m * lerp(K.pole[0], K.poleEnd[0], a), lerp(K.pole[1], K.poleEnd[1], a), lerp(K.pole[2], K.poleEnd[2], a)) : new V3(m * K.pole[0], K.pole[1], K.pole[2])).normalize() : null });
        ws += w;
      }
      if (ws > 1) for (const t of terms) t.w /= ws;
      ws = Math.min(1, ws);
      if (gd && terms.length > 1) { const wm = Math.max(...terms.map((t) => t.w)), via = 2 * (ws - wm); if (via > 1e-4) terms.push({ w: via, off: gd.off, roll: gd.roll, curl: gd.curl, pole: gd.pole }); } // (two moves of one hand cross-fading: the hand travels THROUGH the guard, never through the shoulder: a cock behind the body to the end of a blow across it are opposite directions)
      const g = gd ? (1 - ws) * clamp(this.eng, 0, 1) * (this.style.guard.own ?? 1) * this.act : 0; // the guard's share
      if (g > 1e-4) terms.push({ w: g, off: gd.off, roll: gd.roll, curl: gd.curl, pole: gd.pole });
      const W = terms.reduce((a, t) => a + t.w, 0);
      o.W = Math.min(1, W);
      if (W < 1e-4) { o.roll = 0; o.curl = this.style.relaxed; o.off.set(0, 0, 0); o.pole.set(0, 0, 0); continue; }
      o.off.set(0, 0, 0); o.pole.set(0, 0, 0); o.roll = 0; let curl = 0, pw = 0, fw = 0;
      let rr = 0; const dv = new V3(); // (blend in polar form: the DIRECTIONS and the RADII from the shoulder are averaged, so a cock behind the shoulder blended with a guard in front never drags the hand through the shoulder: the elbow IK has no defined bend there and the arm flipped)
      for (const t of terms) { const r = t.off.length(); o.off.addScaledVector(t.off, t.w / W); rr += (t.w / W) * r; if (r > 1e-5) dv.addScaledVector(t.off, t.w / (W * r)); o.roll += t.w * t.roll; fw += (t.w / W) * (t.free ?? 0); if (t.pole) { o.pole.addScaledVector(t.pole, t.w); pw += t.w; } }
      { const rmin = 0.27 * this.armLen, e = 0.04, r = 0.5 * (rr + rmin + Math.sqrt((rr - rmin) * (rr - rmin) + e * e)); // (a smooth floor: the arm never folds up against the shoulder)
        if (dv.lengthSq() > 0.04) o.dir.lerp(dv.normalize(), 0.6).normalize(); else if (o.off.lengthSq() > 1e-6 && o.dir.lengthSq() < 1e-6) o.dir.copy(o.off).normalize(); // (hysteresis: when the directions cancel out the hand keeps the last good one)
        if (o.dir.lengthSq() > 1e-6) o.off.copy(o.dir).multiplyScalar(r); }
      { const d = o.off.length(), L0 = 0.8 * this.armLen, K = 0.15 * this.armLen; if (d > L0) o.off.multiplyScalar((L0 + K * Math.tanh((d - L0) / K)) / d); } // the arm never quite straightens (the elbow angle changes very fast near full extension): a soft reach limit at ~93%
      o.roll *= D; // (the roll is not normalised: it goes to 0 with the ownership, like the arm itself)
      for (const t of terms) curl += (t.w / W) * t.curl;
      o.curl = lerp(this.style.relaxed, curl, Math.min(1, W)); // fingers: relaxed hands, a fist through a blow (clenched from the cock on)
      if (pw > 0) o.pole.divideScalar(pw);
      o.free = fw;
      if (o.pole.lengthSq() > 1e-6) { // the elbow side follows its target like a critically damped spring: where the bend plane is nearly (anti)parallel to the reach a small change of the pole swings the elbow a long way round the arm's axis, this keeps that swing smooth
        if (o.pq) { const tau = 0.045; o.pv.addScaledVector(o.pole.clone().sub(o.pq).multiplyScalar(1 / (tau * tau)).addScaledVector(o.pv, -2 / tau), h); o.pq.addScaledVector(o.pv, h); o.pole.copy(o.pq).normalize(); }
        else { o.pq = o.pole.clone(); o.pv = new V3(); }
      } else o.pq = null;
    }
  }

  // ---- weights
  armW(side) { return this.act * this.out[side].W; }
  spineW() {
    let w = 0; for (const s of this.sw) w = Math.max(w, s.ws);
    const G = this.style.guard; if (G?.sp) w = Math.max(w, this.eng * (G.spineW ?? 0.3));
    return this.act * w;
  }
  curl(side) { return this.out[side].curl; }

  // ---- ghost hooks
  spine(v) {
    for (const s of this.sw) applySpine(v, this.table[s.kind].sp, s, env(s), this.act, this.walkW);
    const G = this.style.guard;
    if (G?.sp && this.eng > 0.001) { // the stance: a little forward lean, the chin tucked, knees bent (not while walking)
      const e = this.eng * this.act, q = G.sp, nw = 1 - this.walkW;
      v.chest += (q.chest ?? 0) * e; v.abd += (q.abd ?? 0) * e; v.head += (q.head ?? 0) * e; v.chestT += (q.chestT ?? 0) * e; v.abdT += (q.abdT ?? 0) * e; v.pyaw += (q.pyaw ?? 0) * e;
      v.py += (q.py ?? 0) * e * nw; v.pz += (q.pz ?? 0) * e * nw;
    }
  }
  arm(side, ctx) {
    const o = this.out[side];
    if (this.act < 0.001 || o.W < 0.001) return null;
    const { P, Qw, I } = ctx, pos = this.sh[side].clone().applyQuaternion(Qw[I.chest]).add(P[I.chest]).add(o.off.clone().applyQuaternion(Qw[I.chest]));
    const pole = o.pole.lengthSq() > 1e-6 ? o.pole.clone().normalize().applyQuaternion(Qw[I.chest]) : null;
    return { pos, w: o.W, quat: null, wq: 0, pole, roll: o.roll, free: o.free ?? 0 };
  }
}
