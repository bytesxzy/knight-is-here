// Sword + holder: draw / sheathe.
//  SwordLayer  – pure math + state (p: 0 = sheathed … 1 = drawn). The ghost asks it for torso twist and hand targets, so the physics
//                ragdoll reaches, grips, pulls and swings the sword with the same IK + joint controllers as everything else.
//  SwordVisual – the two unskinned meshes + a hanger strap: the holder hangs from the belt at the left side of the waist (it moves with the
//                pelvis, not with the leg), the sword sits in the holder or in the hands.
// Frames: "pelvis frame" = pelvis body frame (x left, y up, z forward at rest, origin at the pelvis anchor, ~90 cm above the floor).
import * as THREE from '#three';
import { Rx, Ry, Rz, ease } from './ghost.js';
import { env, applySpine, follow, fade } from './attack.js';

const { Vector3: V3, Quaternion: Q, Matrix4: M4 } = THREE;
const D = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm = (a, b, x) => ease((x - a) / (b - a));
const ID = new Q();
const basis = (x, y, z) => new Q().setFromRotationMatrix(new M4().makeBasis(x, y, z));

// ---- measured from "sword and sword holder.glb" (the file's own layout: holder scale 0.4, sword scale 0.54, sword tilted 25° inside it)
export const HOLDER_SCALE = 0.4, SWORD_SCALE = 0.54;
const GRIP_Y = 0.17 * SWORD_SCALE, GRIP_YL = 0.30 * SWORD_SCALE; // fist centres above the sword origin (m): right hand against the guard, left toward the pommel
const SLIDE = 0.80;                              // travel for the tip to clear the mouth (blade ≈ 0.77 m)
const SHEATH_T = new V3(-0.0758, 0.3284, 0.02);  // sword origin inside the holder, holder-local metres
const SHEATH_R = Rz(25 * D);

// ---- design parameters (tunable; derived constants are rebuilt from them)
export const TUNE = {   // values found with tools/sword-tune.mjs (both hands reach, joints inside limits, no body part inside another, blade clear of the body)
  mouth: [0.19, 0.1249, 0.07], back: 35.1307, out: 16,              // holder on the belt, left side of the waist (pelvis frame, m): throat position; tip trails back / out (deg)
  grab: [-0.0248, 0.0338, 0.1307],                                          // how far the left hand carries the throat while drawing (m)
  drawDir: [-0.696, 0.8666, 0.7009], drawDir2: [-0.9371, 0.95, 0.0598], // direction the sword leaves in (pelvis frame): holder swivelled by the left hand, and at the end of the pull
  gripRoll: 26.4398, gripHand: [-0.065, -0.065, 0.01],        // roll of the grip about the blade axis (deg); fist centre in hand-local metres (fingers close just below the palm)
  midB: [-0.15, 0.95, 0.25],                               // blade direction half-way through the swing (up and over, instead of the shortest arc)
  readyB: [-0.1468, 0.9, 0.3], readyN: [-1, 0, 0], readyGrip: [0.0381, 0.38, 0.4075], arc: [0.1, 0, 0],   // ready guard, heading frame at the pelvis: blade up and a little forward, two hands in front of the chest
  spine: { abdT: 30, chestT: 9.2964, abd: 4.1316, chest: 0, abdS: 8.6686, chestS: -12, head: 0 },                 // torso offsets at full reach (deg)
  leftHold: [-0.0141, 0.05, 0.05],                      // left hand on the holder: [along the draw axis from the mouth, up, outward] (m)
  rest: [0.2191, 0.08, 0.021],                                  // left hand resting on the pommel while he stands: [along the axis from the mouth, outward, forward] (m)
};
let M_B, GRAB, N_B, D_REST, R_SC, SW0, SW1, G, G_INV, GH, O_H, G_L, G_L_INV, GH_L, READY_Q, MID_Q, READY_ORIGIN;
export function rebuild() {
  const t = TUNE, back = t.back * D, out = t.out * D;
  M_B = new V3(...t.mouth); GRAB = new V3(...t.grab);
  const tip = new V3(0, -1, 0).applyQuaternion(Rx(back)).applyQuaternion(Rz(out));       // where the tip points: down, back, a little outward
  D_REST = tip.clone().negate();                                                         // draw direction at rest (up / forward / inward)
  N_B = new V3(-1, 0, 0); N_B.addScaledVector(D_REST, -N_B.dot(D_REST)).normalize();       // holder flat faces the body
  const aL = new V3(0, 1, 0).applyQuaternion(SHEATH_R), zL = new V3(0, 0, 1);
  R_SC = basis(D_REST, new V3().crossVectors(N_B, D_REST), N_B).multiply(basis(aL, new V3().crossVectors(zL, aL), zL).invert());
  SW0 = new Q().setFromUnitVectors(D_REST, new V3(...t.drawDir).normalize());
  SW1 = new Q().setFromUnitVectors(D_REST, new V3(...t.drawDir2).normalize());
  // right-hand grip (hand body rest frame: fingers −x, palm −y, thumb +z): blade out of the thumb side, flats facing sideways
  G = Rx(-90 * D).multiply(Ry(t.gripRoll * D)); G_INV = G.clone().invert();
  GH = new V3(...t.gripHand); O_H = GH.clone().add(new V3(0, 0, GRIP_Y));                 // sword origin in hand-local
  G_L = Rz(Math.PI).multiply(G); G_L_INV = G_L.clone().invert(); // left hand = right hand turned 180 deg about the grip: the usual two-hand sword hold
  GH_L = new V3(-GH.x, GH.y, GH.z);
  const rb = new V3(...t.readyB).normalize(), ry = rb.clone().negate();
  const rz = new V3(...t.readyN); rz.addScaledVector(ry, -rz.dot(ry)).normalize();
  READY_Q = basis(new V3().crossVectors(ry, rz), ry, rz);
  const my = new V3(...t.midB).normalize().negate(), mz = new V3(...t.readyN); mz.addScaledVector(my, -mz.dot(my)).normalize();
  MID_Q = basis(new V3().crossVectors(my, mz), my, mz);
  READY_ORIGIN = new V3(...t.readyGrip).addScaledVector(rb, GRIP_Y);
}
rebuild();
const ELBOW_POLE = new V3(0, -1, -0.35).normalize();      // chest frame: elbow down and back while reaching across

// ---- timeline in p
const P_GRAB = 0.30, P_PULLEND = 0.54, P_FREE = 0.62, P_SWINGEND = 0.86;
const DRAW_T = 1.7, SHEATHE_T = 2.0;

// ---- sword swings (drawn, two-handed). The sword is placed in the CHEST frame (x left, y up, z forward, origin at the chest anchor), so the torso's twist carries it:
// `hand` = the centre between the two hands (cock / end + arc bulge), the blade direction comes from azimuth / elevation (deg, from forward / the horizon),
// the flats face `nRef` (the sword keeps its flats through both the forehand and the backhand cut).
const sphere = (az, el) => { const ce = Math.cos(el * D); return new V3(Math.sin(az * D) * ce, Math.sin(el * D), Math.cos(az * D) * ce); };
export const SWORD_SWINGS = {
  slash: { d: [0.15, 0.13, 0.10, 0.26], az: [-60, 30], el: [10, -6], hand: { cock: [-0.06, 0.02, 0.24], end: [0.06, -0.02, 0.28], arc: [0, 0.01, 0.05] }, nRef: [0, -1, 0], nRoll: 30, side: 'R', impulse: 165, knock: false,
    sp: { chestT: 30, abdT: 16, chest: [-2, 8], abd: [-1, 5], chestS: [0, 0], head: [0, -3], headT: -0.6, pyaw: 8, pitch: [0, 2] } },
  back: { d: [0.15, 0.13, 0.10, 0.26], az: [60, -30], el: [10, -6], hand: { cock: [0.06, 0.02, 0.24], end: [-0.06, -0.02, 0.28], arc: [0, 0.01, 0.05] }, nRef: [0, -1, 0], nRoll: 30, side: 'L', impulse: 165, knock: false,
    sp: { chestT: 30, abdT: 16, chest: [-2, 8], abd: [-1, 5], chestS: [0, 0], head: [0, -3], headT: -0.6, pyaw: 8, pitch: [0, 2] } },
  chop: { d: [0.28, 0.17, 0.14, 0.40], az: [0, 0], el: [110, -20], hand: { cock: [0, 0.24, 0.14], end: [0, -0.05, 0.30], arc: [0, 0.04, 0.04] }, nRef: [-1, 0, 0], nRoll: 30, side: 'R', impulse: 340, knock: true,
    sp: { chestT: 0, abdT: 0, chest: [-12, 26], abd: [-4, 14], chestS: [0, 0], head: [-6, 10], headT: 0, pyaw: 0, pitch: [-2, 5] } },
};
// the specials: a lunging two-handed thrust, a rising cut (low on the right to high on the left)
SWORD_SWINGS.thrust = { d: [0.24, 0.11, 0.10, 0.30], az: [0, 0], el: [6, 6], hand: { cock: [0.02, -0.02, 0.07], end: [0.02, 0.02, 0.31], arc: [0, 0, 0] }, nRef: [0, -1, 0], nRoll: 0, side: 'R', impulse: 210, knock: false,
  sp: { chestT: 10, abdT: 6, chest: [0, 5], abd: [0, 3], chestS: [0, 0], head: [0, -3], headT: -0.4, pyaw: 4, pitch: [0, 2], pz: [-0.03, 0.12], py: [0, -0.04] } };
SWORD_SWINGS.rise = { d: [0.18, 0.13, 0.10, 0.28], az: [50, -25], el: [-35, 60], hand: { cock: [0.10, -0.10, 0.22], end: [-0.04, 0.14, 0.30], arc: [0, 0.02, 0.04] }, nRef: [0, -1, 0], nRoll: 30, side: 'L', impulse: 230, knock: true, lift: 0.8,
  sp: { chestT: 26, abdT: 14, chest: [4, -4], abd: [2, -2], chestS: [0, 0], head: [2, -4], headT: -0.5, pyaw: 7, pitch: [0, 1], py: [-0.03, 0.01] } };
for (const k of Object.values(SWORD_SWINGS)) k.T = k.d.reduce((a, b) => a + b, 0);
export const SWORD_COMBO = ['slash', 'back'];                       // the light attack button cycles through these
export const SWORD_SPECIALS = { Q: 'thrust', R: 'rise' };                                    // Q / R while the sword is drawn: filled in below with the special moves
const HILT = (GRIP_Y + GRIP_YL) / 2; // the hands' centre above the sword origin along the hilt (the blade runs the other way)
// sword origin + rotation in the chest frame at progress a of swing kind K
function swingLocal(K, a, sa) {
  const b = sphere(lerp(K.az[0], K.az[1], a), lerp(K.el[0], K.el[1], a)), b2 = sphere(lerp(K.az[0], K.az[1], a + 0.03), lerp(K.el[0], K.el[1], a + 0.03));
  const t = b2.clone().sub(b), n = new V3().crossVectors(b, t);
  if (n.lengthSq() < 1e-10) n.set(...K.nRef); else if (n.dot(new V3(...K.nRef)) < 0) n.negate();
  const ry = b.clone().negate(); n.addScaledVector(ry, -n.dot(ry)).normalize();
  if (K.nRoll) n.applyAxisAngle(b, K.nRoll * D * (a > 0 ? 1 : 1)); // (the flats turned about the blade: picks which way the wrists have to twist)
  const k = 4 * clamp(a, 0, 1) * (1 - clamp(a, 0, 1)), h = K.hand;
  const H = new V3(lerp(h.cock[0], h.end[0], a) + h.arc[0] * k, lerp(h.cock[1], h.end[1], a) + h.arc[1] * k, lerp(h.cock[2], h.end[2], a) + h.arc[2] * k).multiplyScalar(sa);
  return { pos: H.addScaledVector(b, HILT), quat: basis(new V3().crossVectors(ry, n), ry, n) };
}

const hpObj = () => ({ qsw: new Q(), q: new Q(), qs: new Q(), mouth: new V3(), pos: new V3(), axis: new V3() });
// holder pose for a pelvis transform (Pp, Qp). sv: swivel 0 (hanging) … 1 (first draw direction) … 2 (direction at the end of the pull),
// gw: how far the left hand has carried the throat. `mouth` = sword origin when sheathed, `axis` = way the sword slides out
function holderPose(Pp, Qp, sv, gw, o) {
  if (sv <= 1) o.qsw.copy(ID).slerp(SW0, sv); else o.qsw.copy(SW0).slerp(SW1, sv - 1);
  o.q.copy(Qp).multiply(o.qsw).multiply(R_SC);
  o.mouth.copy(M_B).addScaledVector(GRAB, gw).applyQuaternion(Qp).add(Pp);
  o.pos.copy(SHEATH_T).applyQuaternion(o.q).negate().add(o.mouth);
  o.qs.copy(o.q).multiply(SHEATH_R);
  o.axis.set(0, 1, 0).applyQuaternion(o.qs);
  return o;
}

export class SwordLayer {
  constructor() { this.boost = 3; this.worldW = 0.9; this.torsoRelax = 0; this.handK = 1; this.handMax = 400; this.p = 0; this.dir = 0; this.act = 0; this.walkW = 0; this.hp = hpObj(); this.hpFull = hpObj(); this.canStart = null;
    this.swingHandK = 1.6; this.swingHandMax = 1000; this.fists = null; this.swings = []; this.held = false; this.swQueued = null; this.swI = 0; this.swIdle = 9; this.sa = 1; // unarmed punches (an AttackLayer, set by the knight) + the sword swings
    this.ffs = 0; this.stop = 0; this.engT = 99; // how much the hand springs track the ghost's velocity (0..1, smooth), hit-stop timer, time since the last blow
  }

  get drawn() { return this.p > 0.5; }
  get busy() { return this.dir !== 0; }
  request(wantDrawn) {
    if (this.dir !== 0 || this.act < 0.99 || this.swinging || (this.canStart && !this.canStart())) return false;
    if (wantDrawn && this.p < 1) this.dir = 1; else if (!wantDrawn && this.p > 0) this.dir = -1; else return false;
    return true;
  }
  toggle() { return this.request(!this.drawn); }

  // advance in physics time. `standing`: the layer only drives the body while he is on his feet
  step(h, standing) {
    this.act = clamp(this.act + (standing ? h : -h) / 0.6, 0, 1);
    if (!standing && this.dir !== 0) { this.p = this.p < P_GRAB ? 0 : 1; this.dir = 0; } // knocked down mid-draw: it ends up sheathed or in hand
    if (this.dir !== 0) {
      this.p += (this.dir * h) / (this.dir > 0 ? DRAW_T : SHEATHE_T);
      if (this.p >= 1 || this.p <= 0) { this.p = clamp(this.p, 0, 1); this.dir = 0; }
    }
    // attacks: punches with the sword sheathed, swings with it drawn (and the guard held)
    const idle = this.dir === 0;
    if (this.fists) this.fists.walkW = this.walkW;
    this.fists?.step(h, standing && idle && this.p < 0.001);
    this.stepSwings(h, standing && idle && this.p >= 0.999);
    this.engT += h;
    this.ffs += ((this.swinging ? 1 : 0) - this.ffs) * (1 - Math.exp(-h / 0.08)); // (the switch from absolute damping to damping against the ghost's motion is smooth)
    if (this.held && standing && this.act > 0.99) this.attack(false);
  }

  // ---- attacks
  get swinging() { return this.swings.some((s) => s.t < s.T && s.kt === undefined) || !!this.fists?.swinging; }
  get handK() { return lerp(this._handK, this.swingHandK, this.ffs); } set handK(v) { this._handK = v; } // (stronger hand-of-god pull while it swings: the knight's arms are heavy)
  get handMax() { return lerp(this._handMax, this.swingHandMax, this.ffs); } set handMax(v) { this._handMax = v; }
  get handFF() { return this.ffs; } // while it swings, the hand springs / joint dampers track the ghost's velocity (no lag behind a fast hand)
  set attackHeld(v) { this.held = !!v; } get attackHeld() { return this.held; }
  engage() { this.engT = 0; this.fists?.engage(); }
  hitStop(sec) { this.stop = Math.max(this.stop, sec); this.fists?.hitStop(sec); }
  interrupt(sec = 0.16) { for (const s of this.swings) if (s.kt === undefined) { s.kt = 0; s.kd = sec; } this.swQueued = null; this.fists?.interrupt(sec); }
  // the buttons: light / heavy. Drawn: sword swings (a forehand - backhand combo, heavy = the overhead chop); sheathed: the fist combo (jab - cross - hook, heavy = haymaker)
  attack(heavy = false) {
    if (this.dir !== 0 || this.act < 0.99) return false;
    if (!heavy && this.swQueued?.kind === 'chop') return false; // (a heavy attack is waiting for its slot: no light one jumps the queue)
    if (this.p >= 0.999) return this.swordQueue(heavy ? 'chop' : SWORD_COMBO[(this.swIdle > 1.1 ? 0 : this.swI) % SWORD_COMBO.length]);
    if (this.p < 0.001 && this.fists) return this.fists.attack(heavy);
    return false;
  }
  // the special buttons (Q / R): drawn = the sword's, sheathed = the fists'
  special(key) {
    if (this.dir !== 0 || this.act < 0.99) return false;
    if (this.p >= 0.999) { const kind = SWORD_SPECIALS[key]; return kind ? this.swordQueue(kind, true) : false; }
    if (this.p < 0.001 && this.fists) return this.fists.special(key);
    return false;
  }
  swordQueue(kind, special = false) { if (this.swordSwing(kind, special)) { this.swQueued = null; return true; } if (!(this.swQueued?.kind === 'chop' && kind !== 'chop')) this.swQueued = { kind, t: 0.35, special }; return false; } // (a held light attack must not bump a waiting heavy one)
  swordSwing(kind, special = false) {
    const last = this.swings.filter((s) => s.kt === undefined).pop(), K = SWORD_SWINGS[kind];
    if (last && last.t < last.chain) return false; // (the last one must have landed and recovered a bit)
    if (this.swIdle > 1.1) this.swI = 0;
    if (!special) { if (kind !== 'chop') this.swI++; else this.swI = 0; }
    this.swIdle = 0; this.engT = 0;
    this.swings.push({ kind, side: K.side, t: 0, d: K.d.slice(), T: K.T, amp: 1, hit: false, as: 0, ws: 0, impulse: K.impulse, knock: K.knock, lift: K.lift, blade: true, chain: K.d[0] + K.d[1] + K.d[2] + (K.chain ?? 0.3) * K.d[3] });
    return true;
  }
  stepSwings(h, active) {
    if (!active) { this.swings.length = 0; this.swQueued = null; this.stop = 0; return; }
    const hh = this.stop > 0 ? h * 0.12 : h; this.stop = Math.max(0, this.stop - h);
    for (const s of this.swings) { s.t += hh; if (s.kt !== undefined) s.kt += h; const e = env(s); follow(s, 'as', e.a, 0.1, hh); follow(s, 'ws', e.w * (1 - fade(s)), 0.1, hh); }
    this.swings = this.swings.filter((s) => (s.kt === undefined ? s.t < s.T : s.kt < s.kd + 0.2) || s.ws > 0.02 || Math.abs(s.wsv) > 0.05);
    this.swIdle = this.swings.some((s) => s.t < s.T && s.kt === undefined) ? 0 : this.swIdle + h;
    if (this.swQueued) { this.swQueued.t -= h; if (this.swQueued.t <= 0) this.swQueued = null; else if (this.swordSwing(this.swQueued.kind, this.swQueued.special)) this.swQueued = null; }
  }
  // the swings / punches that can hit something right now: { side, impulse, knock, blade (sword) or hands }
  strikes() { return [...(this.fists?.strikes() ?? []), ...this.swings.filter((s) => !s.hit && s.kt === undefined && env(s).strike)]; }

  // ---- weights
  release() { return 1 - sm(P_FREE - 0.04, 0.80, this.p); }                                   // the holder settles back once the sword is free
  swivel() { return (sm(0.05, P_GRAB, this.p) + sm(P_GRAB, P_PULLEND, this.p)) * this.release(); } // 0 hanging, 1 first draw direction, 2 end of the pull
  grabW() { return sm(0.05, P_GRAB, this.p) * this.release(); }
  leftW() { return sm(0.04, 0.22, this.p) * (1 - sm(P_FREE - 0.02, 0.80, this.p)); }
  gripW() { return sm(0.66, 0.84, this.p); } // left hand joins the grip once the blade is clear
  restW() { return (1 - this.walkW) * (1 - sm(0.0, 0.14, this.p)); } // standing with the sword sheathed: the left hand rests on the pommel (not while walking)
  armW(side) { const b = side === 'R' ? this.act * sm(0, P_GRAB, this.p) : this.act * Math.max(this.leftW(), this.gripW(), this.restW()); return this.fists ? Math.max(b, this.fists.armW(side)) : b; } // how strongly the layer drives each arm
  curl(side) { const b = side === 'R' ? sm(0.17, 0.29, this.p) : Math.max(0.55 * this.leftW(), this.gripW(), 0.45 * this.restW()); return this.fists ? Math.max(b, this.fists.curl(side)) : b; }
  wHand() { return sm(P_FREE - 0.02, P_FREE + 0.05, this.p); } // sword: 0 = on the holder axis, 1 = in the hand

  // ---- ghost hooks
  drawSpineW() { return this.act * sm(0, 0.26, this.p) * (1 - sm(0.60, 0.88, this.p)); }
  spineW() { let w = this.drawSpineW(); for (const s of this.swings) w = Math.max(w, this.act * s.ws); return this.fists ? Math.max(w, this.fists.spineW()) : w; }
  spine(v) { // cross-body twist + lean toward the holder while reaching/pulling; the swings' twist / lean; the punches'
    const w = this.drawSpineW();
    const t = TUNE.spine;
    v.abdT += t.abdT * w; v.chestT += t.chestT * w; v.abd += t.abd * w; v.chest += t.chest * w; v.abdS += t.abdS * w; v.chestS += t.chestS * w; v.head += t.head * w;
    for (const s of this.swings) applySpine(v, SWORD_SWINGS[s.kind].sp, s, env(s), this.act, this.walkW);
    this.fists?.spine(v);
  }

  // sword origin + rotation the right hand should be holding at progress p (ghost frame)
  swordTarget(ctx, hp) {
    const { P, Qw } = ctx, p = this.p;
    if (p <= P_PULLEND) return { pos: hp.mouth.clone().addScaledVector(hp.axis, SLIDE * sm(P_GRAB, P_PULLEND, p)), quat: hp.qs.clone() };
    const hf = holderPose(P[0], Qw[0], 2 * this.release(), this.release(), this.hpFull); // end of the pull: holder fully swivelled, sword just clear
    // the guard is defined in the heading frame at the pelvis, so it stays steady while the pelvis twists (walking)
    const u = sm(P_PULLEND, P_SWINGEND, p), ready = READY_ORIGIN.clone().add(P[0]);
    const pos = new V3().lerpVectors(hf.mouth.clone().addScaledVector(hf.axis, SLIDE), ready, u).addScaledVector(new V3(...TUNE.arc), 4 * u * (1 - u));
    const qm = MID_Q.clone(), qr = READY_Q.clone();
    const g = { pos, quat: u < 0.5 ? hf.qs.clone().slerp(qm, u * 2) : qm.slerp(qr, (u - 0.5) * 2) };
    if (!this.swings.length) return g;
    const { I } = ctx; // a sword swing carries the sword from the guard to its cut and back: placed in the chest frame (the twisting torso carries it)
    for (const s of this.swings) {
      const e = env(s), L = swingLocal(SWORD_SWINGS[s.kind], e.a, this.sa), w = e.w * (1 - fade(s)) * this.act;
      g.pos.lerp(L.pos.applyQuaternion(Qw[I.chest]).add(P[I.chest]), w); g.quat.slerp(Qw[I.chest].clone().multiply(L.quat), w);
    }
    return g;
  }

  // hand override for one side. ctx = partially solved ghost { P, Qw, I }. null = leave the hand alone.
  // hand override for one side: the sword layer's, blended with the punches' while one is under way (the left hand leaves the pommel to jab)
  arm(side, ctx) {
    const base = this.limitReach(side, ctx, this.armBase(side, ctx)), f = this.fists?.arm(side, ctx);
    if (!f) return base;
    if (!base) return f;
    const t = f.w;
    return { pos: base.pos.clone().lerp(f.pos, t), w: lerp(base.w, f.w, t), quat: base.quat, wq: base.wq * (1 - t), pole: f.pole ?? base.pole, roll: f.roll };
  }
  // the arm never quite straightens: with the elbow nearly in line with shoulder and wrist the bend plane is undefined and the upper arm flipped about its axis
  // between a forehand and a backhand cut (the two-handed guard reaches almost the arm's full length): a soft reach limit at ~92%
  limitReach(side, ctx, r) {
    const F = this.fists; if (!r || !F) return r;
    const S = F.sh[side].clone().applyQuaternion(ctx.Qw[ctx.I.chest]).add(ctx.P[ctx.I.chest]), d = r.pos.clone().sub(S), n = d.length(), L0 = 0.78 * F.armLen, K = 0.14 * F.armLen;
    if (n > L0) { d.multiplyScalar((L0 + K * Math.tanh((n - L0) / K)) / n); r.pos = S.add(d); }
    return r;
  }
  armBase(side, ctx) {
    if (this.act < 0.001) return null;
    const { P, Qw, I } = ctx, hp = holderPose(P[0], Qw[0], this.swivel(), this.grabW(), this.hp);
    if (side === 'L') {
      const w = this.armW('L');
      if (w < 0.001) return null;
      const h = TUNE.leftHold, X = new V3(1, 0, 0).applyQuaternion(Qw[0]), Z = new V3(0, 0, 1).applyQuaternion(Qw[0]);
      const hold = hp.mouth.clone().addScaledVector(hp.axis, h[0]).addScaledVector(X, h[2]);
      hold.y += h[1];
      const r = TUNE.rest, rest = hp.mouth.clone().addScaledVector(hp.axis, r[0]).addScaledVector(X, r[1]).addScaledVector(Z, r[2]);
      const rw = this.restW(), lw = this.leftW(), pos = hold.lerp(rest, rw / Math.max(1e-6, rw + lw)); // from the pommel to the throat as the draw begins
      const gw = this.gripW();
      if (gw < 0.001) return { pos, w, quat: null, wq: 0, pole: null };
      // two-handed: the left fist goes to the grip, near the pommel
      const sw = this.swordTarget(ctx, hp), ql = sw.quat.clone().multiply(G_L_INV);
      const grip = sw.pos.clone().addScaledVector(new V3(0, 1, 0).applyQuaternion(sw.quat), GRIP_YL).sub(GH_L.clone().applyQuaternion(ql));
      return { pos: pos.lerp(grip, gw), w, quat: ql, wq: this.act * gw, pole: ELBOW_POLE.clone().applyQuaternion(Qw[I.chest]) };
    }
    const w = this.armW('R');
    if (w < 0.001) return null;
    const sw = this.swordTarget(ctx, hp);
    this.dbg = { pos: sw.pos.clone(), quat: sw.quat.clone() };
    const qh = sw.quat.multiply(G_INV);
    return { pos: sw.pos.sub(O_H.clone().applyQuaternion(qh)), w, quat: qh, wq: this.act * sm(0.03, P_GRAB - 0.04, this.p),
      pole: ELBOW_POLE.clone().applyQuaternion(Qw[I.chest]) };
  }
}

// sword origin + rotation for a right hand body transform (grip)
export const swordInHand = (Ph, Qh) => ({ pos: O_H.clone().applyQuaternion(Qh).add(Ph), quat: Qh.clone().multiply(G) });
export const TIP = 1.419 * SWORD_SCALE;
// the blade in the right hand's local frame (for the blade's collider): where it starts (the guard), the way it points, its length
export const bladeInHand = () => ({ origin: O_H.clone(), dir: new V3(0, -1, 0).applyQuaternion(G), len: TIP });
// where the left hand anchor must be (and how turned) to grip the sword at the place the right hand really holds it
export function leftGripOnSword(PhR, QhR) {
  const sw = swordInHand(PhR, QhR), q = sw.quat.clone().multiply(G_L_INV);
  return { pos: new V3(0, 1, 0).applyQuaternion(sw.quat).multiplyScalar(GRIP_YL).add(sw.pos).sub(GH_L.clone().applyQuaternion(q)), quat: q };
}
// the sheathed holder for tools: pose of the holder group + the sword inside it for a pelvis transform
export const holderAt = (Pp, Qp, sv = 0, gw = 0) => holderPose(Pp, Qp, sv, gw, hpObj());

// Floor contact for the unskinned meshes: if the tip of a rigid stick (pivot -> tip, length len) would go below the floor, turn it about the
// pivot (the hand's grip / the holder's throat) just far enough that it rests on the floor instead of passing through it.
const UP = new V3(0, 1, 0);
function liftTip(pivot, tipDir, len, minY, outQ) {
  const want = Math.min(0.98, (minY - pivot.y) / len);
  if (tipDir.y >= want) return false;
  const r = new V3().crossVectors(tipDir, UP); if (r.lengthSq() < 1e-8) r.set(1, 0, 0); r.normalize();
  if (tipDir.clone().applyAxisAngle(r, 0.05).y < tipDir.y) r.negate();
  let lo = 0, hi = Math.PI;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (tipDir.clone().applyAxisAngle(r, m).y < want) lo = m; else hi = m; }
  outQ.setFromAxisAngle(r, hi);
  return true;
}
const resetMesh = (m) => { m.removeFromParent(); m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); m.castShadow = m.receiveShadow = true; return m; };

export class SwordVisual {
  constructor(scene, holderMesh, swordMesh, layer, rig) {
    this.layer = layer; this.iHand = rig.idx.handR; this.w = 0; this.hp = hpObj();
    this.holder = new THREE.Group(); this.holder.scale.setScalar(HOLDER_SCALE); this.holder.add(resetMesh(holderMesh));
    this.sword = new THREE.Group(); this.sword.scale.setScalar(SWORD_SCALE); this.sword.add(resetMesh(swordMesh));
    // hanger: a leather strap from the belt to a collar round the holder's throat, with a small iron ring where it meets the belt
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.78, metalness: 0.1 }), iron = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.45, metalness: 0.85 });
    this.strap = new THREE.Mesh(new THREE.BoxGeometry(0.028, 1, 0.006), leather);   // length scaled each frame
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0036, 8, 20), iron);
    this.collar = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 20, 1, true), leather);
    for (const m of [this.strap, this.ring, this.collar]) { m.castShadow = m.receiveShadow = true; m.material.side = THREE.DoubleSide; }
    scene.add(this.holder, this.sword, this.strap, this.ring, this.collar);
    this.tmp = { a: new V3(), b: new V3(), q: new Q() };
  }

  // P[i] / Q[i]: world position (anchor) / rotation of body i (physics bodies, or a ghost pose)
  update(P, Q, dt = 1 / 60) {
    const L = this.layer, hp = holderPose(P[0], Q[0], L.swivel(), L.grabW(), this.hp), fq = this.tmp.q;
    // not upright (crawling, lying): the scabbard hangs from the belt by gravity instead of staying where it was on the hip
    const tilt = Math.acos(clamp(new V3(0, 1, 0).applyQuaternion(Q[0]).y, -1, 1)), droop = sm(0.25, 0.8, tilt);
    if (droop > 0.001) {
      fq.setFromUnitVectors(hp.axis.clone().negate(), new V3(0, -1, 0)); fq.copy(ID).slerp(fq, droop);
      hp.q.premultiply(fq); hp.qs.premultiply(fq); hp.axis.applyQuaternion(fq);
      hp.pos.copy(SHEATH_T).applyQuaternion(hp.q).negate().add(hp.mouth);
    }
    if (liftTip(hp.mouth, hp.axis.clone().negate(), 0.82, 0.03, fq)) { // lying on the floor: the holder rests on it, it does not sink in
      hp.q.premultiply(fq); hp.qs.premultiply(fq); hp.axis.applyQuaternion(fq);
      hp.pos.copy(SHEATH_T).applyQuaternion(hp.q).negate().add(hp.mouth);
    }
    this.holder.position.copy(hp.pos); this.holder.quaternion.copy(hp.q);
    const Qh = Q[this.iHand], Ph = P[this.iHand];
    // in the holder the sword can only slide along its axis, following how far the hand has pulled it
    const grip = GH.clone().applyQuaternion(Qh).add(Ph);
    const s = L.p > P_GRAB - 0.02 ? clamp(grip.clone().sub(hp.mouth).dot(hp.axis) - GRIP_Y, 0, SLIDE) : 0;
    const onAxis = hp.mouth.clone().addScaledVector(hp.axis, s);
    const handQ = Qh.clone().multiply(G), handP = O_H.clone().applyQuaternion(Qh).add(Ph);
    const target = L.wHand();
    this.w = dt === Infinity ? target : this.w + (target - this.w) * (1 - Math.exp(-dt * 14));
    this.sword.position.lerpVectors(onAxis, handP, this.w);
    this.sword.quaternion.slerpQuaternions(hp.qs, handQ, this.w);
    // the blade of a sword in hand rests on the floor too (the hand turns it about the grip)
    const pivot = hp.mouth.clone().lerp(grip, this.w), bladeDir = new V3(0, -1, 0).applyQuaternion(this.sword.quaternion);
    if (this.w > 0.01 && liftTip(pivot, bladeDir, TIP + 0.04, 0.02, fq)) {
      this.sword.quaternion.premultiply(fq); this.sword.position.sub(pivot).applyQuaternion(fq).add(pivot);
    }
    this.updateHanger(P[0], Q[0], hp);
  }

  // strap: from the belt (pelvis frame, just inside the throat) to the collar on the holder
  updateHanger(Pp, Qp, hp) {
    const { a, b, q } = this.tmp, throat = hp.mouth.clone().addScaledVector(hp.axis, -0.045);
    a.set(TUNE.mouth[0] - 0.045, TUNE.mouth[1] + 0.07, TUNE.mouth[2] + 0.005).applyQuaternion(Qp).add(Pp);   // belt anchor: a bit above and inboard of the throat
    b.copy(throat);
    const len = Math.max(0.01, a.distanceTo(b));
    this.strap.position.copy(a).add(b).multiplyScalar(0.5); this.strap.scale.set(1, len, 1);
    this.strap.quaternion.setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize());
    this.strap.quaternion.multiply(q.setFromAxisAngle(new V3(0, 1, 0), 0));
    this.ring.position.copy(a); this.ring.quaternion.copy(this.strap.quaternion).multiply(new Q().setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2));
    this.collar.position.copy(throat); this.collar.quaternion.setFromUnitVectors(new V3(0, 1, 0), hp.axis);
  }
}
