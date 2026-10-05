// A jump (the robot's signature move). The ghost does the whole move as a kinematic target: crouch -> explosive launch -> ballistic flight -> landing
// absorb -> recover. The physics body follows it through the usual controllers; while the jump is on, the balance assist may pull the pelvis with several
// times body weight (`support`), which is what throws the whole body into the air (and catches it again).
//  - the ghost origin carries the horizontal motion (launch speed, constant in the air, killed by the feet at touchdown);
//  - the pelvis height is a hand-built curve: a squat, a Hermite push-off whose end velocity is the take-off speed, a parabola, a Hermite landing
//    that stops the fall, a smooth return;
//  - the pose (legs, arms, torso) is written into the ghost's parameter vector like the walker does, blended in at the start and out at the end.
// A character gets it from its spec (`jump: {...}` overrides JUMP).
import * as THREE from '#three';
import { ease } from './ghost.js';

const { Vector3: V3 } = THREE;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => ease((x - a) / (b - a));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const JUMP = {
  apex: 1.05,       // m: how far the pelvis rises above its standing height
  crouch: 0.26,     // s: the squat before it (a running jump squats for a moment only)
  launch: 0.13,     // s: the explosive extension (the feet leave the ground at its end)
  dip: 0.30,        // m: how far the pelvis drops in the squat
  land: 0.17,       // s: touchdown: the fall is stopped over this time ...
  landDip: 0.30,    // m: ... by dropping this far below standing height
  recover: 0.32,    // s: straightening up again
  leap: 3.4,        // m/s: horizontal speed of a directed jump
  turn: 7,          // rad/s: how fast it turns toward the jump direction during the squat
  cooldown: 0.35,   // s before the next one
  tuck: 0.04,       // m: how far the feet are drawn up in flight (0 = legs straight down, a robot's jump)
  arms: 0.5,        // 0 = arms stay as they are .. 1 = swung back in the squat, up in the launch
};

export class JumpLayer {
  constructor(ghost, walker, cfg = {}) {
    this.g = ghost; this.w = walker; this.c = { ...JUMP, ...cfg };
    const s = ghost.sc; this.sa = s.a; this.sl = s.l;
    this.reset();
  }
  reset() { this.phase = 'idle'; this.t = 0; this.vh = new V3(); this.cool = 0; this.target = null; this.v0 = 0; this.tf = 0; this.wj = 0; this.power = 1; this.settle = 0; }
  get active() { return this.phase !== 'idle'; }
  get airborne() { return this.phase === 'launch' || this.phase === 'air'; }
  get ready() { return this.phase === 'idle' && this.cool <= 0; }
  // how much extra pull the balance assist may use (it launches and catches the whole body): 0 .. 1
  get support() { return this.phase === 'launch' || this.phase === 'air' || this.phase === 'land' ? 1 : this.phase === 'crouch' ? 0.25 : 0; }
  // the damped chest / head orientation hold (the walking torso hold): the torso is a heavy pendulum on a light waist joint, a jump sets it swinging and it rings for seconds otherwise
  get torsoW() { return this.phase !== 'idle' ? 1 : clamp(this.settle / 0.8, 0, 1); }
  get footW() { return this.phase === 'air' || this.phase === 'land' || this.phase === 'launch' ? 1 : 0; } // the feet are pulled to the ghost's feet only while it is off the ground / landing

  // start a jump. dir: a world direction to leap toward (null = straight up, keeping any running momentum); power 0..1 scales the height.
  request(dir = null, power = 1) {
    if (!this.ready) return false;
    const c = this.c, w = this.w, g = this.g, hd = new V3(Math.sin(g.psi), 0, Math.cos(g.psi));
    this.power = clamp(power, 0.3, 1);
    this.v0 = Math.sqrt(2 * 9.81 * c.apex * this.power * this.power); this.tf = (2 * this.v0) / 9.81;
    const run = w.moving ? w.v : 0;
    this.dirW = dir ? new V3(dir.x, 0, dir.z).normalize() : null;
    this.vLaunch = this.dirW ? new V3().copy(this.dirW).multiplyScalar(c.leap * (0.6 + 0.4 * this.power)) : hd.clone().multiplyScalar(run); // m/s the horizontal velocity at the end of the push-off
    this.vh = hd.clone().multiplyScalar(run);                                    // the running momentum carries on through the squat
    this.Tc = run > 1.2 ? 0.1 : c.crouch;
    this.phase = 'crouch'; this.t = 0;
    w.reset();                                                                   // the gait is over: the jump owns the pose from here
    return true;
  }

  // advance in physics time. standing: only while the character is on its feet
  step(h, standing) {
    this.cool = Math.max(0, this.cool - h); this.settle = Math.max(0, this.settle - h);
    if (this.phase === 'idle') return;
    if (!standing) { this.phase = 'idle'; this.wj = 0; this.cool = 0.5; this.settle = 0; return; }
    const c = this.c, g = this.g;
    this.t += h;
    // phases
    const Tc = this.Tc, Tl = c.launch, Tf = this.tf, Tn = c.land, Tr = c.recover;
    const prev = this.phase;
    if (this.phase === 'crouch' && this.t >= Tc) { this.phase = 'launch'; this.t0 = this.t; }
    else if (this.phase === 'launch' && this.t - this.t0 >= Tl) { this.phase = 'air'; this.t1 = this.t; }
    else if (this.phase === 'air' && this.t - this.t1 >= Tf) { this.phase = 'land'; this.t2 = this.t; }
    else if (this.phase === 'land' && this.t - this.t2 >= Tn) { this.phase = 'recover'; this.t3 = this.t; }
    else if (this.phase === 'recover' && this.t - this.t3 >= Tr) { this.phase = 'idle'; this.cool = c.cooldown; this.wj = 0; this.settle = 1.2; return; }
    // blend weight: in over the squat, out over the end of the recovery
    this.wj = this.phase === 'recover' ? 1 - sm(0.45, 1, (this.t - this.t3) / Tr) : sm(0, Math.min(Tc, 0.14), this.t);
    // horizontal motion
    if (this.dirW) {
      if (this.phase === 'crouch' || this.phase === 'launch') { // turn toward the jump, then the push-off accelerates it
        const target = Math.atan2(this.dirW.x, this.dirW.z), e = wrap(target - g.psi);
        g.psi += clamp(e * 12, -c.turn, c.turn) * h;
      }
      if (this.phase === 'launch') this.vh.lerp(this.vLaunch, 1 - Math.exp(-h / 0.035));
      else if (this.phase === 'crouch') this.vh.multiplyScalar(Math.exp(-h / 0.25));
    }
    if (this.phase === 'land' || this.phase === 'recover') this.vh.multiplyScalar(Math.exp(-h / (this.phase === 'land' ? 0.09 : 0.05))); // the feet grip: it stops
    g.origin.addScaledVector(this.vh, h);
    g.R = g.R.setFromAxisAngle(new V3(0, 1, 0), g.psi);
  }

  // pelvis height above its standing height (m) at the current moment
  y() {
    const c = this.c, Tc = this.Tc, Tl = c.launch, D = c.dip * this.power;
    if (this.phase === 'crouch') return -D * sm(0, Tc, this.t);
    if (this.phase === 'launch') { // Hermite from (-D, at rest) to (0, v0): the push-off
      const u = clamp((this.t - this.t0) / Tl, 0, 1);
      return -D * (2 * u ** 3 - 3 * u ** 2 + 1) + this.v0 * Tl * (u ** 3 - u ** 2);
    }
    if (this.phase === 'air') { const tau = this.t - this.t1; return Math.max(0, this.v0 * tau - 4.905 * tau * tau); }
    if (this.phase === 'land') { // Hermite from (0, falling at v0) to (-landDip, at rest)
      const u = clamp((this.t - this.t2) / c.land, 0, 1);
      return (u ** 3 - 2 * u ** 2 + u) * -this.v0 * c.land + -c.landDip * (-2 * u ** 3 + 3 * u ** 2);
    }
    const u = clamp((this.t - this.t3) / c.recover, 0, 1); // recover
    return -c.landDip * (1 - sm(0, 1, u));
  }

  // acceleration of the ghost pelvis (m/s^2): vertical, and horizontal during the push-off. The balance assist hands it to EVERY body as a mass-proportional force,
  // so the whole body is thrown up / caught as a unit: pulling the pelvis alone left the torso behind and folded it over (80 degrees at the waist).
  ay() {
    const c = this.c, Tc = this.Tc, Tl = c.launch, D = c.dip * this.power;
    if (this.phase === 'crouch') { const u = clamp(this.t / Tc, 0, 1); return (-D * (6 - 12 * u)) / (Tc * Tc); }
    if (this.phase === 'launch') { const u = clamp((this.t - this.t0) / Tl, 0, 1); return (-D * (12 * u - 6) + this.v0 * Tl * (6 * u - 2)) / (Tl * Tl); }
    if (this.phase === 'air') return -9.81;
    if (this.phase === 'land') { const u = clamp((this.t - this.t2) / c.land, 0, 1), T = c.land; return (-this.v0 * T * (6 * u - 4) - c.landDip * (-12 * u + 6)) / (T * T); }
    if (this.phase === 'recover') { const u = clamp((this.t - this.t3) / c.recover, 0, 1), T = c.recover; return (c.landDip * (6 - 12 * u)) / (T * T); }
    return 0;
  }
  ah(out) { out.set(0, 0, 0); if (this.phase === 'launch' && this.dirW) out.copy(this.vLaunch).sub(this.vh).multiplyScalar(1 / 0.035).clampLength(0, 30); return out; }

  // write the pose into the ghost's parameter vector v (ghost frame), blended by this.wj
  apply(v) {
    if (this.phase === 'idle') return;
    const c = this.c, w = this.wj, wk = this.w, y = this.y(), sa = this.sa, sl = this.sl, g = this.g;
    const mix = (k, val) => { v[k] += (val - v[k]) * w; };
    const sq = clamp(-y / (c.dip * this.power), 0, 1.2);        // how deep in the squat (0 standing .. 1 full) -- also in the landing
    const air = this.phase === 'air' ? 1 : 0, vs = clamp(this.vh.length() / c.leap, 0, 1);
    mix('py', wk.pyIdle + y); mix('px', 0); mix('pz', wk.zp - 0.07 * sq * sl);        // hips back in the squat
    mix('pitch', 16 * sq + 7 * vs * (this.phase !== 'crouch' ? 1 : 0)); mix('abd', 6 * sq); mix('chest', 6 * sq); mix('head', -10 * sq - 4 * vs * air);
    for (const k of ['pyaw', 'proll', 'abdT', 'chestT', 'abdS', 'chestS', 'headT']) mix(k, 0);
    // legs: feet on the ground at the idle stance; in the air they follow the pelvis (y) and are drawn up a little, extended again for the touchdown
    const tuck = c.tuck * sl * sm(0, 0.18, this.t - (this.t1 ?? 0)) * (1 - sm(0.62, 0.95, (this.t - (this.t1 ?? 0)) / Math.max(0.2, this.tf))) * air;
    const rise = this.phase === 'launch' ? Math.max(0, y) : air ? y + tuck : 0;
    const toe = this.phase === 'launch' ? 30 * sm(0.45, 1, (this.t - this.t0) / c.launch) : air ? 12 * (1 - sm(0.5, 0.95, (this.t - this.t1) / this.tf)) : 0;
    for (const S of ['L', 'R']) {
      const n = wk.neutral[S];
      mix('f' + S + 'x', n.x); mix('f' + S + 'z', n.z + (air ? 0.03 : 0)); mix('f' + S + 'y', g.footH(toe) + rise); mix('ff' + S, 1); mix('fo' + S, toe);
    }
    // arms: swung back in the squat, forward-up in the push-off, out for balance in the air, then down
    const A = c.arms, ph = this.phase;
    const back = A * sm(0, 1, sq) * (ph === 'crouch' || ph === 'land' || ph === 'recover' ? 1 : 0), up = A * (ph === 'launch' ? sm(0, 1, (this.t - this.t0) / c.launch) : ph === 'air' ? 1 - 0.4 * sm(0.5, 1, (this.t - this.t1) / this.tf) : 0);
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      mix('h' + S + 'x', sx * (0.125 + 0.06 * up) * sa);
      mix('h' + S + 'y', (-0.30 + 0.14 * up + 0.04 * back) * sa);
      mix('h' + S + 'z', (0.04 - 0.22 * back + 0.30 * up) * sa);
    }
  }
}
