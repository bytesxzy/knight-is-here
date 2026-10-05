// Procedural walking + running: a footstep planner + gait-phase body motion that fills the ghost's parameter vector.
//  - Stance feet are planted in the WORLD (no sliding, also while turning); a swing foot travels on a minimum-jerk arc from where it left the
//    ground to a touchdown point predicted from the pelvis motion (where the pelvis will be half-way through the coming stance). It lands with zero velocity.
//  - Every body signal is a smooth function of the gait phase: pelvis bob = a cosine at twice the step rate (its depth comes from the leg
//    geometry), sway / yaw / roll / counter-rotating torso / arm swing are sinusoids. Nothing jumps at heel strike.
//  - Speed follows a jerk-limited response; the heading follows a critically damped third-order response (no overshoot, finite jerk) and the
//    head / chest lead the turn a little. The planner predicts both with the same laws.
//  - Running is the same machinery with another gait: a character whose style has a `run` entry blends WALK -> RUN by the speed it really has
//    (`gait`, 0..1): shorter ground contact (duty < 0.5 = a flight phase), the pelvis dips at mid-stance instead of vaulting over it (the same cosine,
//    half a period later), a forward lean, bent pumping arms, higher knees, banking into turns.
//  - The ghost origin + heading are the character's root motion; the physics body just tracks the resulting pose.
//  - Everything that depends on the body (leg length, hip width, arm length) comes from the rig, so any "SmartRig" character can walk.
import * as THREE from '#three';
import { Ry, ease } from './ghost.js';

const { Vector3: V3 } = THREE;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm = (a, b, x) => ease((x - a) / (b - a));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const minJerk = (u) => { u = clamp(u, 0, 1); return u * u * u * (10 + u * (-15 + 6 * u)); }; // 0 -> 1 with zero velocity AND acceleration at both ends
const lp = (h, tau) => 1 - Math.exp(-h / tau);      // first-order low-pass blend factor for a time step h
const softMin = (a, b, k) => -Math.log(Math.exp(-k * a) + Math.exp(-k * b)) / k;
const lerp = (a, b, t) => a + (b - a) * t;

export const WALK = {
  vMax: 1.2, acc: 1.9, dec: 2.8,               // top speed (m/s), acceleration, deceleration
  turnWn: 6.2, turnE: [0.9, 0.55],              // heading follower: natural frequency (rad/s) and the largest error it is fed standing / at full speed (sets the peak turn rate)
  duty: 0.58, lift: 0.085, halfW: 0.145,       // fraction of the cycle on the ground, foot clearance (m), foot half-spacing (m)  (lengths are for the knight's size: scaled by the rig)
  kneeBend: 0.035,                             // how much shorter (fraction) the legs run at full speed (bent knees)
  bobScale: 1.0, bobMin: 0.03, reachGeo: 1.0, geoMargin: 0.012, // pelvis bob: depth factor, gait phase of its lowest point; planted-leg reach limit (fraction of the straight leg) + slack
  strideA: 0.3, strideB: 0.25, Tmin: 0.85,      // stance travel (m) = A + B * speed; shortest gait cycle (s)
  maxReach: 0.34,                              // furthest a foot lands ahead of the pelvis (m)
  toeOut: 12,                                  // deg: the boots splay 17° at rest, walking straightens them a bit
  pitch: 1.0, pitchV: 1.5, torso: -3,          // pelvis pitch at rest / extra at full speed (deg); abdomen and chest pitch at full speed (negative = stand tall)
  armSwing: 1, headLead: 0.35, chestLead: 0.12, // arm swing amplitude scale; how far the head / chest lead a turn (fraction of the remaining turn)
  sway: 1,                                     // side-to-side pelvis sway scale (a character with wide hips sways less)
  mech: 0, rigid: 0, armReach: 1, headSnap: 0, footRoll: 1, // a robot's gait: swing foot lifts straight up / travels at constant speed / drops straight down (0..1); how much the torso is held like a block (kills sway,
                                               // roll, counter-rotation); arm shell radius (< 1 = elbows bent); the head turns in steps of this many degrees; heel-toe roll of the stance foot
};

// the running gait: the values the walker blends toward as its speed rises through g0..g1 (only the keys that differ; a style's `run` overrides these)
export const RUN = {
  vMax: 3.2, acc: 3.4, dec: 4.4,
  duty: 0.36, lift: 0.17, halfW: 0.115, kneeBend: 0.10,
  strideA: 0.3, strideB: 0.14, Tmin: 0.6, maxReach: 0.5,
  toeOut: 6, pitch: 4, pitchV: 3, torso: 5, armSwing: 1, headLead: 0.4, chestLead: 0.15,
  head: -10,        // head pitch against the chest (deg): chin up, eyes ahead
  twist: 1.8,       // shoulders / hips counter-rotate this much more than when walking
  bank: 3,          // lean into a turn, x walking
  g0: 1.25, g1: 2.0, // speed range (m/s) over which the gait changes from walk to run
  mech: 0, rigid: 0, armReach: 1, footRoll: 1,
};
const MIX = ['vMax', 'acc', 'dec', 'duty', 'lift', 'halfW', 'kneeBend', 'strideA', 'strideB', 'Tmin', 'maxReach', 'toeOut', 'pitch', 'pitchV', 'torso', 'armSwing', 'headLead', 'chestLead', 'mech', 'rigid', 'armReach', 'footRoll'];

// the two smoothed responses (state objects so the planner can run them forward without touching the real ones)
function stepSpeed(s, vt, h, c) { // speed follows its target through a low-passed acceleration: no jerk spikes when starting / stopping
  const aT = clamp((vt - s.v) * 4, -c.dec, c.acc);
  s.a += (aT - s.a) * lp(h, 0.08);
  s.v = Math.max(0, s.v + s.a * h);
}
function stepHeading(s, target, E, h, wn) { // critically damped third-order follower: jerk = wn^3 e - 3 wn^2 w - 3 wn a. No overshoot, the jerk is finite.
  const e = clamp(wrap(target - s.psi), -E, E);
  s.al += (wn * wn * wn * e - 3 * wn * wn * s.w - 3 * wn * s.al) * h;
  s.w += s.al * h; s.psi += s.w * h;
}

export class Walker {
  constructor(ghost, style = {}) {
    this.g = ghost;
    const { run, ...walk } = style;
    this.B = { ...WALK, ...walk }; this.R = run ? { ...RUN, ...run } : null; this.c = { ...this.B };
    const rig = ghost.rig, B = rig.bodies, I = rig.idx, s = ghost.sc;
    this.sl = s.l; this.sx = s.x; this.sa = s.a;                 // leg length, hip width, arm length relative to the knight
    this.leg = (B[I.shinL].off.length() + B[I.footL].off.length() + B[I.shinR].off.length() + B[I.footR].off.length()) / 2; // hip -> ankle of a straight leg
    this.hip = { L: B[I.thighL].off.clone(), R: B[I.thighR].off.clone() };                                                  // hip joints in the pelvis frame
    this.hipY = (this.hip.L.y + this.hip.R.y) / 2;
    const k = ghost.keys[ghost.keys.length - 1];
    this.zp = k.pz; this.pyIdle = k.py;                                       // standing pelvis position along the heading (ghost frame), standing pelvis height
    this.neutral = { L: new V3(k.fLx, 0, k.fLz), R: new V3(k.fRx, 0, k.fRz) }; // idle feet (ghost frame, x/z)
    this.slowThrottle = 0.45;
    this.reset();
  }

  get canRun() { return !!this.R; }
  stride(v) { return (this.c.strideA + this.c.strideB * v) * this.sl; }      // pelvis travel during one stance (m) grows with speed
  turnE(v) { const sr = clamp(v / this.c.vMax, 0, 1); return this.c.turnE[0] + (this.c.turnE[1] - this.c.turnE[0]) * sr; }
  setGait(g) { this.gait = g; const c = this.c, B = this.B, R = this.R; for (const k of MIX) c[k] = R ? lerp(B[k], R[k], g) : B[k]; }

  reset() {
    this.sp = { v: 0, a: 0 }; this.hd = { psi: this.g.psi, w: 0, al: 0 };
    this.v = 0; this.vt = 0; this.T = 1.7; this.dir = null; this.throttle = 0; this.run = false; this.blocked = false; this.err = 0; this.errS = 0; this.headQ = 0;
    this.setGait(0); this.duty = this.c.duty;
    this.mode = 'idle'; this.w = 0; this.we = 0; this.phase = 0; this.foot = null; this.stopping = false;
  }
  command(dir, throttle = 1, run = false) { this.dir = dir; this.throttle = throttle; this.run = run && !!this.R; } // dir: world direction (V3) or null
  get moving() { return this.mode !== 'idle'; }
  phaseOf(s) { return (this.phase + (s === 'R' ? 0.5 : 0)) % 1; }

  begin() {
    const g = this.g;
    this.foot = {};
    for (const s of ['L', 'R']) {
      const pos = new V3(this.neutral[s].x, 0, this.neutral[s].z).applyQuaternion(g.R).add(g.origin);
      this.foot[s] = { pos, yaw: g.psi, sw: false, from: pos.clone(), to: pos.clone(), yawFrom: g.psi, yawTo: g.psi, stopped: false, planStop: false, ph0: 0, php: 0 };
    }
    this.setGait(0); this.duty = this.c.duty; this.phase = this.duty; // the left foot lifts first
    this.mode = 'walk'; this.stopping = false;
    this.sp = { v: 0, a: 0 }; this.hd = { psi: g.psi, w: 0, al: 0 }; this.T = 1.25;
    for (const s of ['L', 'R']) this.foot[s].php = this.phaseOf(s);
  }

  // advance in physics time. phys: the physical pelvis position (keeps the ghost from running away when he is blocked or shoved)
  step(h, phys) {
    const g = this.g, c = this.c;
    const vTop = this.run && this.R ? this.R.vMax : this.B.vMax, vCmd = !this.blocked && this.dir ? clamp(this.throttle, 0, 1) * vTop : 0, want = vCmd > 0.05;
    if (this.mode === 'idle') {
      if (!want) { this.w = Math.max(0, this.w - h / 0.45); this.we = ease(this.w); this.err = 0; this.errS *= 1 - lp(h, 0.15); this.headQ *= 1 - lp(h, 0.05); return; }
      this.begin();
    }
    const target = want ? Math.atan2(this.dir.x, this.dir.z) : g.psi, err = wrap(target - g.psi);
    this.err = err; this.errS += (err - this.errS) * lp(h, 0.15); // (the head / chest lead follow a smoothed error: pressing a key must not snap them)
    if (c.headSnap > 0) this.headQ += (Math.round(clamp(c.headLead * this.errS * 180 / Math.PI, -32, 32) / c.headSnap) * c.headSnap - this.headQ) * lp(h, 0.05); // a servo head: steps of headSnap degrees
    if (this.R) this.setGait(this.gait + (sm(this.R.g0, this.R.g1, this.v) - this.gait) * lp(h, 0.12)); // the gait follows the speed he really has
    this.hd.psi = g.psi; stepHeading(this.hd, target, this.turnE(this.v), h, c.turnWn); g.psi = this.hd.psi; g.R = Ry(g.psi);
    this.vt = want ? vCmd * (0.65 + 0.35 * Math.cos(err)) : 0; // ease off while turning (a 90 degree turn at ~2/3 speed, a U-turn is nearly a pivot)
    stepSpeed(this.sp, this.vt, h, c); this.v = this.sp.v;
    const hd = new V3(Math.sin(g.psi), 0, Math.cos(g.psi));
    g.origin.addScaledVector(hd, this.v * h);
    if (phys) { // never let the ghost get more than 30 cm away from the physical pelvis
      const ex = phys.x - (g.origin.x + hd.x * this.zp), ez = phys.z - (g.origin.z + hd.z * this.zp), d = Math.hypot(ex, ez), lim = 0.3 + 0.1 * this.gait;
      if (d > lim) { g.origin.x += ex * (1 - lim / d); g.origin.z += ez * (1 - lim / d); }
    }
    this.stopping = !want;
    const vc = Math.max(0.5 * (this.v + this.vt), 0.2); // cadence follows the speed he is heading for
    let Tt = clamp(this.stride(vc) / (c.duty * vc), c.Tmin, 1.7);
    if (Math.abs(this.hd.w) > 0.5) Tt = Math.min(Tt, 1.15); // pivoting: brisk little steps
    if (this.stopping) Tt = Math.min(Tt, 0.95);        // coming to rest: the closing steps stay brisk (he is not shuffling for two more seconds)
    this.T += (Tt - this.T) * lp(h, 0.2);
    this.duty = c.duty; // (continuous: a swing remembers where in the cycle it started, so a changing duty never stretches or pops one that is under way)
    this.phase = (this.phase + h / this.T) % 1;
    for (const s of ['L', 'R']) {
      const f = this.foot[s], ph = this.phaseOf(s);
      if (f.sw && ph < f.php) { f.sw = false; f.pos.copy(f.to); f.yaw = f.yawTo; f.stopped = f.planStop; } // the phase wrapped: touchdown
      if (!f.sw && ph >= this.duty) this.liftOff(s, f, ph);
      f.php = ph;
    }
    this.w = Math.min(1, this.w + h / 0.45); this.we = ease(this.w);
    if (this.stopping && this.v < 0.03 && this.foot.L.stopped && this.foot.R.stopped) this.mode = 'idle'; // both feet settled at the idle stance
  }

  // plan where this foot lands: run the speed / heading laws forward to know where the pelvis will be. The foot is put where the pelvis will be
  // half-way through the coming stance (so it passes over the foot symmetrically, whatever the speed does meanwhile: accelerating, turning).
  liftOff(s, f, ph) {
    const g = this.g, c = this.c, tsw = (1 - ph) * this.T, sgn = s === 'L' ? 1 : -1, dt = 1 / 60;
    f.sw = true; f.ph0 = ph; f.from.copy(f.pos); f.yawFrom = f.yaw; f.planStop = this.stopping; f.stopped = false;
    const target = this.stopping || !this.dir ? g.psi : Math.atan2(this.dir.x, this.dir.z), vt = this.stopping ? 0 : this.vt;
    const sp = { ...this.sp }, hd = { psi: g.psi, w: this.hd.w, al: this.hd.al }, org = g.origin.clone();
    const tEnd = this.stopping ? 3 : this.T * (1 - ph + this.duty / 2); // lift-off -> half-way through the next stance
    let psiTd = hd.psi; const orgTd = org.clone();
    for (let t = 0; t < tEnd; t += dt) {
      stepHeading(hd, target, this.turnE(sp.v), dt, c.turnWn); stepSpeed(sp, vt, dt, c);
      org.x += Math.sin(hd.psi) * sp.v * dt; org.z += Math.cos(hd.psi) * sp.v * dt;
      if (t < tsw) { psiTd = hd.psi; orgTd.copy(org); }
      if (this.stopping && sp.v < 0.02) break;
    }
    const R = Ry(hd.psi);
    if (this.stopping) f.to.set(this.neutral[s].x, 0, this.neutral[s].z).applyQuaternion(R).add(org); // settle at the idle stance
    else {
      f.to.set(sgn * c.halfW * this.sx, 0, this.zp).applyQuaternion(R).add(org);                       // under the pelvis at mid-stance
      // ... but never a lunge: while he is still accelerating that point is far ahead (first step from a standstill), so cap the reach at touchdown
      const fx = Math.sin(psiTd), fz = Math.cos(psiTd), pel = new V3(orgTd.x + fx * this.zp, 0, orgTd.z + fz * this.zp);
      const df = (f.to.x - pel.x) * fx + (f.to.z - pel.z) * fz, cap = c.maxReach * this.sl;
      if (df > cap) { f.to.x -= fx * (df - cap); f.to.z -= fz * (df - cap); }
    }
    f.yawTo = this.stopping ? hd.psi : psiTd;
  }

  // write the walking pose into the ghost's parameter vector v (ghost frame), blended in by this.we
  apply(v) {
    if (!this.foot) return;
    const g = this.g, c = this.c, w = this.we, gt = this.gait, idle = this.mode === 'idle', sr = clamp(this.v / c.vMax, 0, 1), Rinv = g.R.clone().invert();
    const phL = this.phaseOf('L'), cy = Math.cos(TAU * phL), cm = Math.cos(TAU * (phL - this.duty / 2)); // cm: +1 at left mid-stance, -1 at right mid-stance
    const F = {};
    for (const s of ['L', 'R']) {
      const f = this.foot[s], ph = this.phaseOf(s), swing = f.sw && !idle;
      let pos = f.pos, yaw = f.yaw, pitch = 0, lift = 0;
      if (swing) { // minimum-jerk arc: toes drop at lift-off, come up before landing, the foot touches down with zero velocity
        const u = clamp((ph - f.ph0) / (1 - f.ph0), 0, 1), b = Math.sin(Math.PI * Math.pow(u, 0.85)), mech = c.mech;
        const e = lerp(minJerk(u), sm(0.18, 0.7, u), mech), bl = lerp(b * b, sm(0, 0.18, u) * (1 - sm(0.68, 1, u)), mech); // mechanical: up, across at a steady pace, down
        pos = new V3().lerpVectors(f.from, f.to, e); yaw = f.yawFrom + wrap(f.yawTo - f.yawFrom) * e;
        lift = (0.05 + 0.035 * sr) * (c.lift / 0.085) * this.sl * bl; pitch = (lerp(25, 40, gt) - lerp(33, 40, gt) * sm(0, 0.65, u)) * c.footRoll;
      } else if (!idle) { // stance: heel strike -> flat -> roll onto the toes (running lands on the ball of the foot)
        const u = clamp(ph / this.duty, 0, 1);
        pitch = (u < 0.15 ? lerp(-8, 4, gt) * (1 - sm(0, 0.15, u)) : lerp(25, 35, gt) * sm(0.55, 1, u)) * c.footRoll;
      }
      const p = pos.clone().sub(g.origin).applyQuaternion(Rinv);
      F[s] = { x: p.x, z: p.z, y: g.footH(pitch) + lift, pitch, yaw };
    }
    // pelvis: a small sway toward the stance foot (the plate armor keeps the torso steady: little side-to-side wobble)
    const blk = 1 - c.rigid, px = (0.005 + 0.004 * sr) * this.sx * c.sway * blk * cm, pz = this.zp, hipZ = (this.hip.L.z + this.hip.R.z) / 2;
    // height: a cosine at twice the step rate. Its top is the knees-a-little-bent leg length, its depth is what a step of this length costs
    // (leg reach: R - sqrt(R^2 - d^2)); a soft safety against the planted legs' real reach keeps odd steps (turning, shoves) feasible.
    // Walking: lowest in double support (the body vaults over the stance leg). Running: lowest at mid-stance, highest in the flight (the leg is a spring).
    const R = this.leg * (1 - c.kneeBend * sm(0, 0.9, sr)), top = g.footH(0) + R - this.hipY, dTd = 0.5 * this.duty * this.T * this.v; // dTd: the front foot lands this far ahead of the pelvis
    const depth = c.bobScale * (R - Math.sqrt(Math.max(0.04, R * R - dTd * dTd))), bobPh = lerp(c.bobMin, 0.5 * this.duty, gt), pyBob = top - 0.5 * depth * (1 + Math.cos(2 * TAU * (phL - bobPh)));
    let num = 0, den = 0;
    for (const [s, hx] of [['L', px + this.hip.L.x], ['R', px + this.hip.R.x]]) {
      const dh = Math.hypot(F[s].x - hx, F[s].z - (pz + hipZ)), dy = Math.sqrt(Math.max(0.04, (c.reachGeo * this.leg) ** 2 - dh * dh));
      num += Math.exp(-60 * (F[s].y + dy - this.hipY)); den += 1; // both feet count: a swing foot about to land must be reachable too
    }
    const pyGeo = -Math.log(num / den) / 60, py = clamp(softMin(pyBob, pyGeo + c.geoMargin, 80), 0.865 * this.pyIdle, 1.02 * this.pyIdle);
    const mix = (key, val) => { v[key] += (val - v[key]) * w; };
    mix('py', py); mix('px', px); mix('pz', pz); mix('pitch', c.pitch + c.pitchV * sr); mix('abd', c.torso * sr); mix('chest', c.torso * sr); // stand tall: the torso sags forward a few degrees under the gait forces
    if (gt > 0.001) mix('head', (this.R.head ?? 0) * gt * sr);
    const tg = 1 + ((this.R?.twist ?? 1) - 1) * gt, bk = 1 + ((this.R?.bank ?? 1) - 1) * gt;
    const roll = 0.7 * cm * sr * blk, lean = -1.5 * clamp(this.hd.w, -2.5, 2.5) * sr * bk * blk; // pelvis roll (rhythmic) and the lean into a turn
    const R2D = 180 / Math.PI, leadH0 = clamp(c.headLead * this.errS * R2D, -32, 32), leadC = clamp(c.chestLead * this.errS * R2D, -11, 11) * blk, leadH = c.headSnap > 0 ? this.headQ : leadH0; // head, then chest, lead a turn
    mix('pyaw', -3 * cy * sr * tg * blk); mix('proll', roll + lean);
    mix('abdS', -0.5 * roll); mix('chestS', -0.5 * roll);            // the torso cancels the pelvis' roll: it stays upright, no side-to-side wobble
    mix('abdT', 2.5 * cy * sr * tg * blk); mix('chestT', 4 * cy * sr * tg * blk + leadC);   // shoulders turn against the hips (+3.5 deg net) ...
    mix('headT', -2.8 * cy * sr * tg * blk + leadH);                              // ... while the helmet keeps looking ahead (and into the turn)
    // arms: hands swing along a shell around the shoulder (more elbow bend on the forward swing), opposite the same-side leg.
    // Running: elbows bent, hands pump between the hip and the chest.
    const sa = this.sa, A = (0.03 + 0.10 * sr) * sa * c.armSwing, armR = 0.02 * sa + A * cy, armL = 0.02 * sa - 0.9 * A * cy, Lr = 0.325 * sa * c.armReach, hx = 0.125 * sa, hy = (x, z) => -Math.sqrt(Math.max(0.01, Lr * Lr - x * x - z * z));
    const pump = (p, side) => ({ x: side * 0.115 * sa, y: (-0.17 + 0.11 * p) * sa, z: (0.05 + 0.19 * p) * sa }), rr = pump(cy, -1), rl = pump(-cy, 1);
    mix('hRx', lerp(-hx, rr.x, gt)); mix('hLx', lerp(hx, rl.x, gt));
    mix('hRz', lerp(armR, rr.z, gt)); mix('hLz', lerp(armL, rl.z, gt));
    mix('hRy', lerp(hy(hx, armR), rr.y, gt)); mix('hLy', lerp(hy(hx, armL), rl.y, gt));
    const wf = idle ? w : 1; // while settling at idle the feet fade back to the keyed stance (hides a few cm of landing error)
    for (const s of ['L', 'R']) {
      const set = (key, val) => { v[key] += (val - v[key]) * wf; };
      set('f' + s + 'x', F[s].x); set('f' + s + 'y', F[s].y); set('f' + s + 'z', F[s].z);
      set('ff' + s, 1); set('fo' + s, F[s].pitch); set('fy' + s, (wrap(F[s].yaw - g.psi) * 180) / Math.PI + (s === 'L' ? -c.toeOut : c.toeOut));
    }
  }
}
