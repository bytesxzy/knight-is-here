// Active ragdoll: Rapier rigid bodies + joints, driven toward the "ghost" pose by inertia-aware joint torque controllers.
// `ragdoll` (0..1) scales how much the body is allowed to be limp: joint strength and the soft balance assist at the pelvis.
// States: 'fall' (limp, only joint limits + friction) -> 'getup' (ghost keyframes) -> 'stand' (ghost idle, soft balance).
import RAPIER from '#rapier';
import * as THREE from '#three';
import { buildRig, GROUPS, groupOf, collides } from './humanoid.js';
import { Ghost, worldPose } from './ghost.js';
import { SwordLayer, leftGripOnSword, bladeInHand } from './sword.js';
import { NoLayer } from './layers.js';
import { AttackLayer } from './attack.js';
import { KNIGHT } from './rigs.js';
import { Walker } from './walk.js';
import { JumpLayer } from './jump.js';

const { Vector3: V3, Quaternion: Q } = THREE;
export const STEP = 1 / 120;
// collision groups (16 membership bits | 16 filter bits): bits 0-11 = the self-collision proxies' groups (humanoid.js GROUPS), 14 = the world,
// 15 / 13 = the fitted colliders of the first / second character: they touch the world and each other's, never their own. Proxies only touch
// other proxies (never the floor).
const BIT_WORLD = 14, SELF_FRICTION = 0.25, CHAR_BITS = (1 << 15) | (1 << 13) | (1 << 12); // CHAR_BITS: the fitted colliders' bits of the characters (knight 15, skeleton 13, robot 12)
const GROUP_WORLD = ((1 << BIT_WORLD) << 16) | 0xffff;
const proxyGroups = () => Object.fromEntries(GROUPS.map((g, i) => [g, ((1 << i) << 16) | GROUPS.reduce((m, h, j) => (collides(g, h) ? m | (1 << j) : m), 0)]));
const ZETA = 0.9, EMAX = 1.5;
export const TORSO = { chest: { k: 3500, z: 3.5 }, head: { k: 100, z: 3 } }; // walking: hand-of-god hold of the chest / head on the ghost's world orientation (N*m/rad, damping x critical)
export const FOOT = { k: 9000, c: 2, max: 700 }; // hand-of-god spring on the feet while walking (N/m, damping ratio, N)
export const LEG = { boost: 0, ff: 1 }; // walking legs: extra joint stiffness (x), how much of the ghost's joint velocity the damper tracks (0..1) // PD error is clamped so a big mismatch gives bounded effort instead of a violent snap
// how much each joint tracks the ghost's WORLD orientation (balance) rather than only its orientation relative to the parent (floppy)
const WORLD_BLEND = { abdomen: 0.8, chest: 0.8, head: 0.5, thigh: 0.9, foot: 1.0, upperArm: 0.35, hand: 0.3 };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function rotVec(q, out) { // rotation vector (axis * angle), shortest way round
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  return s < 1e-9 ? out.set(0, 0, 0) : out.set(x, y, z).multiplyScalar((2 * Math.atan2(s, w)) / s);
}
const hingeAngle = (q, a) => {
  let ang = 2 * Math.atan2(q.x * a[0] + q.y * a[1] + q.z * a[2], q.w);
  if (ang > Math.PI) ang -= 2 * Math.PI; else if (ang < -Math.PI) ang += 2 * Math.PI;
  return ang;
};

export class Knight {
  // spec: which character (rigs.js; default the knight). world: share another character's physics world (then it is not created here).
  static async create(profile, spec = KNIGHT, world = null) { await RAPIER.init(); return new Knight(profile, spec, world); }

  constructor(profile, spec = KNIGHT, world = null) {
    this.RAPIER = RAPIER; this.spec = spec;
    this.rig = buildRig(profile, spec);
    this.ghost = new Ghost(this.rig);
    this.sword = spec.sword ? new SwordLayer() : spec.attack ? new AttackLayer(this.rig, spec.attack === true ? {} : spec.attack) : new NoLayer(); // optional upper-body layer: draw / sheathe (the knight), savage swings (the skeleton)
    this.walk = new Walker(this.ghost, spec.style); // locomotion: footstep-planned walking
    this.ghost.walker = this.walk;
    if (spec.sword && spec.fists) { this.sword.fists = new AttackLayer(this.rig, spec.fists); this.sword.sa = this.rig.scale?.a ?? 1; } // the knight also punches (sheathed) and swings the sword (drawn)
    this.jump = spec.jump ? new JumpLayer(this.ghost, this.walk, spec.jump === true ? {} : spec.jump) : null; // the robot's signature move
    this.ghost.jump = this.jump;
    this.sword.canStart = () => this.walk.mode === 'idle' && this.walk.w < 0.05; // draw / sheathe only while standing still
    this.prevRoot = null; this.prevQw = null; this.prevPw = null;
    this.groupOrig = ((1 << spec.bitOrig) << 16) | (1 << BIT_WORLD) | (CHAR_BITS & ~(1 << spec.bitOrig)); // touches the world and every OTHER character's fitted colliders, never its own
    if (world) this.world = world;
    else {
      this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      this.world.timestep = STEP;
      this.world.numSolverIterations = 8;
      this.addStatic(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0));
    }
    this.knightColliders = new Set();
    this.pg = proxyGroups(); this.proxies = []; this.selfCollide = true;
    this.b = [];
    this.buildBodies();
    if (spec.sword) this.makeBlade();
    this.mass = this.b.reduce((m, b) => m + b.d.mass, 0);
    this.ragdoll = 0.25;
    this.acc = 0;
    this.reset();
  }

  addStatic(desc) {
    return this.world.createCollider(desc.setFriction(1).setRestitution(0).setCollisionGroups(GROUP_WORLD));
  }

  // ---------------------------------------------------------------- construction
  buildBodies() {
    const R = RAPIER;
    for (const d of this.rig.bodies) {
      const bd = R.RigidBodyDesc.dynamic().setTranslation(d.anchor.x, d.anchor.y, d.anchor.z)
        .setLinearDamping(0.05).setAngularDamping(0.6).setCanSleep(false);
      const f = d.fit;
      let cd, inertia;
      const m = d.mass;
      if (f.shape === 'capsule') {
        cd = R.ColliderDesc.capsule(f.hh, f.r).setRotation({ x: f.q[0], y: f.q[1], z: f.q[2], w: f.q[3] });
        const L = 2 * f.hh, r = f.r, vc = Math.PI * r * r * L, vs = (4 / 3) * Math.PI * r ** 3, mc = (m * vc) / (vc + vs), ms = m - mc;
        inertia = { kind: 'capsule', u: new V3(0, 1, 0).applyQuaternion(new Q(...f.q)), Ia: 0.5 * mc * r * r + 0.4 * ms * r * r,
          It: (mc * (3 * r * r + L * L)) / 12 + ms * (0.4 * r * r + (f.hh + 0.375 * r) ** 2) };
        inertia.frame = f.q;
      } else if (f.shape === 'ball') {
        cd = R.ColliderDesc.ball(f.r);
        inertia = { kind: 'ball', I: 0.4 * m * f.r * f.r };
      } else {
        cd = R.ColliderDesc.roundCuboid(f.h[0] - f.r, f.h[1] - f.r, f.h[2] - f.r, f.r);
        const [hx, hy, hz] = f.h;
        inertia = { kind: 'box', I: [(m * (hy * hy + hz * hz)) / 3, (m * (hx * hx + hz * hz)) / 3, (m * (hx * hx + hy * hy)) / 3] };
      }
      // inertia floor: explicit joint torques on very light bodies (pelvis hub, hands, twist axes) go unstable otherwise
      const floor = d.name === 'pelvis' ? 0.6 : this.spec.inertiaFloor?.[d.name.replace(/[LR]$/, '')] ?? 0.012;
      const base = inertia.kind === 'capsule' ? [inertia.It, inertia.Ia, inertia.It] : inertia.kind === 'ball' ? [inertia.I, inertia.I, inertia.I] : inertia.I;
      const grown = base.map((x) => Math.max(x, floor));
      if (grown.some((x, k) => x > base[k])) {
        const fr = inertia.frame ?? [0, 0, 0, 1];
        bd.setAdditionalMassProperties(1e-3, { x: f.c[0], y: f.c[1], z: f.c[2] }, { x: grown[0] - base[0], y: grown[1] - base[1], z: grown[2] - base[2] }, { x: fr[0], y: fr[1], z: fr[2], w: fr[3] });
        if (inertia.kind === 'capsule') { inertia.It = Math.max(inertia.It, floor); inertia.Ia = Math.max(inertia.Ia, floor); }
        else if (inertia.kind === 'ball') inertia.I = Math.max(inertia.I, floor);
        else inertia.I = grown;
      }
      const rb = this.world.createRigidBody(bd);
      cd.setTranslation(f.c[0], f.c[1], f.c[2]).setMass(m).setFriction(1).setRestitution(0).setCollisionGroups(this.groupOrig);
      const col = this.world.createCollider(cd, rb);
      this.knightColliders.add(col.handle);
      const pr = d.prox, pdesc = pr.shape === 'capsule' ? R.ColliderDesc.capsule(pr.hh, pr.r).setRotation({ x: pr.q[0], y: pr.q[1], z: pr.q[2], w: pr.q[3] })
        : pr.shape === 'ball' ? R.ColliderDesc.ball(pr.r) : R.ColliderDesc.roundCuboid(pr.h[0] - pr.r, pr.h[1] - pr.r, pr.h[2] - pr.r, pr.r);
      pdesc.setTranslation(pr.c[0], pr.c[1], pr.c[2]).setDensity(0).setFriction(SELF_FRICTION).setRestitution(0).setCollisionGroups(this.pg[groupOf(d.name)]);
      this.proxies.push(this.world.createCollider(pdesc, rb));
      const b = { d, rb, col, inertia, parent: d.parent, wb: WORLD_BLEND[d.name.replace(/[LR]$/, '')] ?? 0, p: new V3(), q: new Q(), pp: new V3(), pq: new Q(), rp: new V3(), rq: new Q(), w: new V3(), axes: [new V3(), new V3(), new V3()], jt: null };
      this.b.push(b);
    }
    for (const b of this.b) b.leg = /^(thigh|shin|foot)/.test(b.d.name);
    for (const b of this.b) {
      const j = b.d.joint;
      if (!j) continue;
      const par = this.b[b.parent], a1 = { x: b.d.off.x, y: b.d.off.y, z: b.d.off.z }, a2 = { x: 0, y: 0, z: 0 };
      let jd;
      if (j.type === 'hinge') {
        jd = RAPIER.JointData.revolute(a1, a2, { x: j.axis[0], y: j.axis[1], z: j.axis[2] });
      } else jd = RAPIER.JointData.spherical(a1, a2);
      const joint = this.world.createImpulseJoint(jd, par.rb, b.rb, true);
      if (j.type === 'hinge') joint.setLimits(j.lim[0], j.lim[1]); // (JointData.limits is ignored by this Rapier version)
      if (j.type === 'ball') {
        const refQ = new Q(...j.ref);
        b.jt = { refInv: refQ.clone().invert(), n: new V3(...j.limb).applyQuaternion(refQ).normalize() };
      }
    }
  }

  // the sword's blade as a sensor capsule on the right hand (it never touches anything physically: the combat code queries it for hits)
  makeBlade() {
    const { origin, dir, len } = bladeInHand(), r = 0.035, c = origin.clone().addScaledVector(dir, len / 2), q = new Q().setFromUnitVectors(new V3(0, 1, 0), dir);
    this.bladeCol = this.world.createCollider(RAPIER.ColliderDesc.capsule(len / 2 - r, r).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setSensor(true).setDensity(0).setCollisionGroups(0), this.b[this.rig.idx.handR].rb);
  }

  // ---------------------------------------------------------------- helpers
  readState() {
    for (const b of this.b) {
      const r = b.rb.rotation(), w = b.rb.angvel(), p = b.rb.translation();
      b.q.set(r.x, r.y, r.z, r.w); b.w.set(w.x, w.y, w.z); b.p.set(p.x, p.y, p.z);
    }
  }
  inertiaAlong(b, n) {
    const I = b.inertia;
    if (I.kind === 'ball') return I.I;
    const l = n.clone().applyQuaternion(b.q.clone().invert());
    if (I.kind === 'box') return I.I[0] * l.x * l.x + I.I[1] * l.y * l.y + I.I[2] * l.z * l.z;
    const c = l.dot(I.u);
    return I.It + (I.Ia - I.It) * c * c;
  }
  principalAxes(b) { // world-space principal axes of a body, with their inertias
    const I = b.inertia, ax = b.axes;
    if (I.kind === 'capsule') {
      ax[0].copy(I.u).applyQuaternion(b.q);
      const t = Math.abs(ax[0].y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
      ax[1].crossVectors(ax[0], t).normalize(); ax[2].crossVectors(ax[0], ax[1]);
      return [I.Ia, I.It, I.It];
    }
    ax[0].set(1, 0, 0).applyQuaternion(b.q); ax[1].set(0, 1, 0).applyQuaternion(b.q); ax[2].set(0, 0, 1).applyQuaternion(b.q);
    return I.kind === 'ball' ? [I.I, I.I, I.I] : I.I;
  }

  // soft swing/twist limits: fills `out` (world frame) with a rotation vector that points back inside the allowed range
  limitError(b, rel, out) {
    const j = b.d.joint, jt = b.jt, a = this.b[b.parent];
    const d = rel.clone().multiply(jt.refInv);
    if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
    const n = jt.n, p = d.x * n.x + d.y * n.y + d.z * n.z;
    const tw = new Q(n.x * p, n.y * p, n.z * p, d.w);
    if (tw.length() < 1e-6) tw.set(0, 0, 0, 1); else tw.normalize();
    const sv = rotVec(d.multiply(tw.clone().invert()), new V3());
    const twAng = 2 * Math.atan2(p, d.w), ex = new V3();
    let viol = false;
    for (const k of ['x', 'y', 'z']) {
      const lim = j.sw[k];
      if (!lim) continue;
      const c = clamp(sv[k], lim[0], lim[1]);
      if (c !== sv[k]) { ex[k] += c - sv[k]; viol = true; }
    }
    const tc = clamp(twAng, j.tw[0], j.tw[1]);
    if (tc !== twAng) { ex.addScaledVector(n, tc - twAng); viol = true; }
    if (viol) out.copy(ex).applyQuaternion(a.q);
    return viol;
  }

  // ---------------------------------------------------------------- one physics step
  // step() = preStep (layers, gait, ghost, controllers, assists) + world.step + postStep (sanity, state machine). Characters sharing a world run
  // all their preSteps, one world.step, then all their postSteps (Sim below).
  step() { this.preStep(); this.world.step(); this.postStep(); }

  preStep() {
    const h = STEP;
    this.t += h;
    this.readState();
    let pose = null, S = 0, A = 0;
    this.sword.walkW = this.walk.we; // (while he walks the left hand is free to swing; standing, it rests on the pommel)
    this.jump?.step(h, this.state === 'stand');
    const jumping = !!this.jump?.active;
    this.sword.step(h, this.state === 'stand' && !jumping); // (no attacks while it is in the air)
    this.ghost.layer = this.sword.act > 0.001 ? this.sword : null;
    this.walk.blocked = this.sword.busy;
    if (this.state === 'stand' && !jumping) this.walk.step(h, this.b[0].p);
    else if (this.walk.mode !== 'idle' || this.walk.w > 0) this.walk.reset();
    if (this.state !== 'fall') {
      this.tg += h;
      pose = this.ghost.evaluate(this.tg);
      const wp = worldPose(this.rig, pose.rootP, pose.rootQ, pose.ql);
      pose.Qw = wp.Q; pose.Pw = wp.P;
      if (this.state !== 'stand') this.prevRoot = null; // (only locomotion needs it; during a get-up the plain absolute damping works better)
      if (this.state === 'stand' && this.prevQw) pose.wG = pose.Qw.map((q, i) => rotVec(q.clone().multiply(this.prevQw[i].clone().invert()), new V3()).divideScalar(h));
      if (this.state === 'stand' && this.prevPw) pose.vG = pose.Pw.map((p, i) => p.clone().sub(this.prevPw[i]).divideScalar(h));
      this.prevQw = this.state === 'stand' ? pose.Qw.map((q) => q.clone()) : null;
      this.prevPw = this.state === 'stand' ? pose.Pw.map((p) => p.clone()) : null;
      if (this.prevRoot) { // the ghost root velocity: the balance assist must not fight a character that is meant to move
        pose.rootV = pose.rootP.clone().sub(this.prevRoot.p).divideScalar(h).clampLength(0, jumping ? 9 : 5);
        pose.rootW = rotVec(pose.rootQ.clone().multiply(this.prevRoot.q.clone().invert()), new V3()).divideScalar(h);
      }
      if (this.state === 'stand') this.prevRoot = { p: pose.rootP.clone(), q: pose.rootQ.clone() };
      const ramp = this.state === 'getup' ? 0.35 + 0.65 * ease01((this.tg - this.ghost.t0) / 1.5) : 1;
      S = ramp * Math.pow(1 - this.ragdoll, 1.5);
      A = ramp * (1 - this.ragdoll);
    }
    this.control(pose, S, h);
    if (pose && A > 0) this.assist(pose, A, h);
  }

  postStep() {
    this.sanity();
    this.updateState(STEP);
  }

  control(pose, S, h) {
    const B = this.b, tau = new V3(), eP = new V3(), eL = new V3(), wrel = new V3();
    for (let i = 1; i < B.length; i++) {
      const b = B[i], a = B[b.parent], j = b.d.joint;
      // while the sword layer drives an arm it gets much stiffer and follows the ghost's world orientation more
      const aw = !pose ? 0 : /^(upperArm|forearm|hand)/.test(b.d.name) ? this.sword.armW(b.d.name.endsWith('R') ? 'R' : 'L') : b.d.name === 'abdomen' || b.d.name === 'chest' ? 0.8 * this.sword.spineW() : 0;
      const lw = b.leg && pose && this.state === 'stand' ? Math.max(this.walk.we, this.jump?.footW ?? 0) : 0; // legs while walking / jumping: the damper tracks the ghost's joint velocity (no braking of the swing)
      const rel = a.q.clone().invert().multiply(b.q);
      wrel.copy(b.w).sub(a.w);
      const ffk = lw > 0 ? lw * LEG.ff : aw > 0 ? aw * this.sword.handFF : 0; // how much of the ghost's joint velocity the damper tracks: legs while walking, arms while a swing / punch drives them
      const wT = ffk > 0 && pose && pose.wG ? pose.wG[i].clone().sub(pose.wG[b.parent]).clampLength(0, 30) : null; // the ghost's relative angular velocity (world)
      eP.set(0, 0, 0); eL.set(0, 0, 0);
      let ksP = 0, ksL = 0, axes, inertias;
      if (j.type === 'hinge') {
        const axW = new V3(...j.axis).applyQuaternion(a.q);
        axes = [axW]; inertias = [0];
        if (S > 0 && pose) { eP.copy(axW).multiplyScalar(clamp(hingeAngle(pose.ql[i], j.axis) - hingeAngle(rel, j.axis), -EMAX, EMAX)); ksP = j.ks * S * (1 + this.sword.boost * aw + LEG.boost * lw); }
      } else {
        inertias = this.principalAxes(b); axes = b.axes;
        if (S > 0 && pose) {
          const qt = a.q.clone().multiply(pose.ql[i]).slerp(pose.Qw[i], b.wb + (this.sword.worldW - b.wb) * aw); // relative target, blended toward the ghost's world target
          rotVec(qt.multiply(b.q.clone().invert()), eP);
          const m = eP.length(); if (m > EMAX) eP.multiplyScalar(EMAX / m);
          ksP = j.ks * S * (1 + this.sword.boost * aw + LEG.boost * lw);
        }
        if (this.limitError(b, rel, eL)) ksL = Math.max(3 * j.ks, 200);
      }
      tau.set(0, 0, 0);
      for (let k = 0; k < axes.length; k++) {
        const n = axes[k];
        const Ic = j.type === 'hinge' ? this.inertiaAlong(b, n) : inertias[k], Ip = this.inertiaAlong(a, n), Ir = (Ic * Ip) / (Ic + Ip);
        const ks = ksP + ksL, kd = (ksP > 0 ? 2 * ZETA * Math.sqrt(ksP * Ir) : 0) + (ksL > 0 ? 1.6 * Math.sqrt(ksL * Ir) : 0) + 0.3 * Math.sqrt(j.ks * Ir);
        const spring = ksP * eP.dot(n) + ksL * eL.dot(n);
        tau.addScaledVector(n, ((spring - kd * (wrel.dot(n) - (wT ? ffk * wT.dot(n) : 0))) * Ir) / (Ir + h * kd + h * h * ks)); // implicit-Euler scaled PD
      }
      b.rb.applyTorqueImpulse({ x: tau.x * h, y: tau.y * h, z: tau.z * h }, true);
      a.rb.applyTorqueImpulse({ x: -tau.x * h, y: -tau.y * h, z: -tau.z * h }, true);
    }
  }

  // soft "hand of god" balance support at the pelvis: springs toward the ghost pelvis, scaled by (1 - ragdoll)
  assist(pose, A, h) {
    const r = this.b[0], M = this.mass, W = M * 9.81, lv = r.rb.linvel(), rv = pose.rootV ?? new V3(), v = { x: lv.x - rv.x, y: lv.y - rv.y, z: lv.z - rv.z };
    const spring = (ks, e, vel, lo, hi) => {
      const c = 2 * ZETA * Math.sqrt(ks * M);
      return clamp(((ks * e - c * vel) / (1 + (h * c + h * h * ks) / M)), lo, hi);
    };
    const jm = this.jump?.support ?? 0; // a jump: the pull may be several times the body weight (it throws the body up and catches it again)
    const fx = spring(3000 * A, pose.rootP.x - r.p.x, v.x, -W * (1 + 3 * jm), W * (1 + 3 * jm));
    const fy = spring(28000 * A, pose.rootP.y - r.p.y, v.y, -0.3 * W, (1.2 + 4.8 * jm) * W);
    const fz = spring(3000 * A, pose.rootP.z - r.p.z, v.z, -W * (1 + 3 * jm), W * (1 + 3 * jm));
    r.rb.applyImpulse({ x: fx * h, y: fy * h, z: fz * h }, true);
    if (this.jump?.phase === 'launch') { // the push-off: the ghost's acceleration (+ gravity, which is the physics' own job) goes to every body in proportion to its mass (the landing is the ground's job)
      const ay = this.jump.ay(), ah = this.jump.ah(this.tmpV ??= new V3());
      for (const b of this.b) { const m = b.d.mass; b.rb.applyImpulse({ x: m * ah.x * h, y: m * (9.81 + ay) * h, z: m * ah.z * h }, true); }
    }
    // sword layer: spring each hand it drives toward the ghost's hand (hand of god, scaled by the ragdoll slider)
    for (const side of ['R', 'L']) {
      const w = this.sword.armW(side) * A;
      if (w < 0.01) continue;
      const hb = this.b[this.rig.idx['hand' + side]], hv = hb.rb.linvel();
      let tp = pose.Pw[hb.d.i];
      if (side === 'L' && this.sword.gripW() > 0.01) { const hr = this.b[this.rig.idx.handR]; tp = tp.clone().lerp(leftGripOnSword(hr.p, hr.q).pos, this.sword.gripW()); } // grip the sword where the right hand really holds it
      const m = 3, hk = 3500 * w * this.sword.handK, hc = 1.6 * Math.sqrt(hk * m), hf = 1 + (h * hc + h * h * hk) / m, ff = this.sword.handFF, tv = ff > 0 && pose.vG ? pose.vG[hb.d.i] : null;
      const F = new V3(hk * (tp.x - hb.p.x) - hc * (hv.x - (tv ? ff * tv.x : 0)), hk * (tp.y - hb.p.y) - hc * (hv.y - (tv ? ff * tv.y : 0)), hk * (tp.z - hb.p.z) - hc * (hv.z - (tv ? ff * tv.z : 0))).divideScalar(hf);
      if (F.length() > this.sword.handMax) F.multiplyScalar(this.sword.handMax / F.length());
      hb.rb.applyImpulse({ x: F.x * h, y: F.y * h, z: F.z * h }, true);
    }
    // walking: each foot is pulled to the ghost's foot (landings where they were planned, planted feet stay planted: no skating)
    const lw = this.state === 'stand' ? Math.max(Math.min(1, this.walk.we * 4), this.jump?.footW ?? 0) * A : 0; // (full strength by the first step; also while it jumps)
    if (lw > 0.01 && pose.vG) for (const side of ['L', 'R']) {
      const fb = this.b[this.rig.idx['foot' + side]], fv = fb.rb.linvel(), tp = pose.Pw[fb.d.i], tv = pose.vG[fb.d.i];
      const fm = 6, fk = FOOT.k * lw, fc = FOOT.c * Math.sqrt(fk * fm), ff = 1 + (h * fc + h * h * fk) / fm;
      const F = new V3(fk * (tp.x - fb.p.x) - fc * (fv.x - tv.x), fk * (tp.y - fb.p.y) - fc * (fv.y - tv.y), fk * (tp.z - fb.p.z) - fc * (fv.z - tv.z)).divideScalar(ff);
      if (F.length() > FOOT.max) F.multiplyScalar(FOOT.max / F.length());
      fb.rb.applyImpulse({ x: F.x * h, y: F.y * h, z: F.z * h }, true);
    }
    // walking: the chest and head are held on the ghost's world orientation with real damping. Left to the joint controllers the torso is a soft,
    // lightly damped spring whose natural frequency (~1.4 Hz) is the step rate: the arm swing and hip yaw make it ring (+-16 deg twist, side sway).
    const tw = this.state === 'stand' ? Math.max(this.walk.we, this.jump?.torsoW ?? 0) * A * (1 - this.sword.torsoRelax * this.sword.spineW()) : 0; // (a layer that drives the spine hard takes over from this hold: two stiff controllers on one light body ring)
    if (tw > 0.01 && pose.wG) for (const [name, cfg] of Object.entries(TORSO)) {
      const bb = this.b[this.rig.idx[name]], I = bb.inertia.kind === 'ball' ? bb.inertia.I : (bb.inertia.I[0] + bb.inertia.I[1] + bb.inertia.I[2]) / 3;
      const eq = rotVec(pose.Qw[bb.d.i].clone().multiply(bb.q.clone().invert()), new V3()); if (eq.length() > 0.3) eq.setLength(0.3);
      const ks = cfg.k * tw, kd = cfg.z * 2 * Math.sqrt(ks * I), f = I / (I + h * kd + h * h * ks), w = bb.rb.angvel(), wg = new V3(...Object.values(pose.wG[bb.d.i].clone().clampLength(0, 6)).slice(0, 3)); // (ghost's own angular velocity, capped: a violent upper-body move must not demand an impossible torque)
      bb.rb.applyTorqueImpulse({ x: (ks * eq.x - kd * (w.x - wg.x)) * f * h, y: (ks * eq.y - kd * (w.y - wg.y)) * f * h, z: (ks * eq.z - kd * (w.z - wg.z)) * f * h }, true);
    }
    // pelvis orientation (only the pelvis feels it, so keep it gentle and within what its own inertia can take)
    const e = rotVec(pose.rootQ.clone().multiply(r.q.clone().invert()), new V3()), w = r.w;
    const ks = 3500 * A, kd = 50 * Math.sqrt(A), rw = pose.rootW ?? new V3();
    r.rb.applyTorqueImpulse({ x: (ks * e.x - kd * (w.x - rw.x)) * h, y: (ks * e.y - kd * (w.y - rw.y)) * h, z: (ks * e.z - kd * (w.z - rw.z)) * h }, true);
  }

  sanity() {
    for (const b of this.b) {
      const t = b.rb.translation();
      if (!Number.isFinite(t.x + t.y + t.z)) { this.reset(this.home.x, this.home.z, this.home.psi); return; }
      const v = b.rb.linvel(), w = b.rb.angvel(), sv = Math.hypot(v.x, v.y, v.z), sw = Math.hypot(w.x, w.y, w.z);
      if (sv > 12) b.rb.setLinvel({ x: (v.x * 12) / sv, y: (v.y * 12) / sv, z: (v.z * 12) / sv }, true);
      if (sw > 20) b.rb.setAngvel({ x: (w.x * 20) / sw, y: (w.y * 20) / sw, z: (w.z * 20) / sw }, true);
    }
  }

  // ---------------------------------------------------------------- state machine
  updateState(h) {
    const P = this.b[0].p, chest = this.b[this.rig.idx.chest];
    if (this.state === 'fall') {
      this.tFall += h;
      let sp = 0;
      for (const b of this.b) { const v = b.rb.linvel(), w = b.rb.angvel(); sp = Math.max(sp, Math.hypot(v.x, v.y, v.z) * 2, Math.hypot(w.x, w.y, w.z) * 0.4); }
      this.still = sp < 0.45 ? this.still + h : 0;
      if (this.autoGetUp && this.ragdoll < 0.9 && ((this.tFall > 1.6 && this.still > 0.7) || this.tFall > 7)) this.beginGetUp();
    } else if (this.state === 'getup' && this.tg >= this.ghost.duration) {
      this.state = 'stand'; this.t = 0;
    } else if (this.state === 'stand') {
      const up = new V3(0, 1, 0).applyQuaternion(chest.q);
      this.toppled = this.t > 1.5 && (up.y < 0.45 || P.y < 0.4 * this.ghost.sc.h) ? this.toppled + h : 0;
      if (this.toppled > 0.5 || this.ragdoll >= 0.95) this.goLimp(); // 100% ragdoll = no strength left: he just stays down
    }
  }

  beginGetUp() {
    this.readState();
    const I = this.rig.idx, P = this.b[0].p, up = this.b[I.chest].p.clone().sub(P);
    let l = new V3(up.x, 0, up.z);
    if (l.length() < 0.15 * this.ghost.sc.l) l = new V3(0, 0, 1).applyQuaternion(this.b[0].q).setY(0); // upright-ish: face where the pelvis faces
    l.normalize();
    const ql = this.b.map((b, i) => (i === 0 ? new Q() : this.b[b.parent].q.clone().invert().multiply(b.q)));
    // lying flat -> start from the prone key; kneeling in a heap (hips up) -> start from all-fours
    const t0 = P.y > 0.3 * this.ghost.sc.l ? this.ghost.keys[2].t : 0;
    this.ghost.begin({ rootP: P.clone(), rootQ: this.b[0].q.clone(), ql }, new V3(P.x, 0, P.z), Math.atan2(l.x, l.z), t0);
    this.walk.reset(); this.prevRoot = null; this.prevQw = null; this.prevPw = null;
    this.state = 'getup'; this.tg = t0; this.t = 0;
  }

  goLimp() { this.state = 'fall'; this.tFall = 0; this.still = 0; this.walk.reset(); this.prevRoot = null; this.prevQw = null; this.prevPw = null; }

  // public: knock the knight over. dir = push direction (world), impulse in N*s applied at the chest
  knockDown(dir = new V3(0, 0.12, 1), impulse = 120) {
    this.goLimp();
    const d = dir.clone().normalize().multiplyScalar(impulse);
    this.b[this.rig.idx.chest].rb.applyImpulse({ x: d.x, y: d.y, z: d.z }, true);
  }
  // public: shove a body part at a world point (stays upright if the push is gentle)
  shove(rb, point, impulse) {
    rb.applyImpulseAtPoint({ x: impulse.x, y: impulse.y, z: impulse.z }, { x: point.x, y: point.y, z: point.z }, true);
  }
  // public: ray pick -> { body, point } for the closest knight collider
  pick(origin, dir) {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, 60, true, undefined, undefined, undefined, undefined, (c) => this.knightColliders.has(c.handle));
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return { rb: hit.collider.parent(), point: new V3(p.x, p.y, p.z) };
  }

  // public: limbs / torso / head collide with each other (A/B switch)
  setSelfCollision(on) {
    this.selfCollide = on;
    this.b.forEach((b, i) => this.proxies[i].setCollisionGroups(on ? this.pg[groupOf(b.d.name)] : 0));
  }

  // public: back to a standing pose in the middle of the arena
  reset(x = 0, z = 0, psi = 0) {
    this.home = { x, z, psi };
    this.ghost.begin(null, new V3(x, 0, z), psi);
    this.tg = this.ghost.duration;
    const g = this.ghost.evaluate(this.tg), w = worldPose(this.rig, g.rootP, g.rootQ, g.ql);
    this.b.forEach((b, i) => {
      b.rb.setTranslation(w.P[i], true); b.rb.setRotation(w.Q[i], true);
      b.rb.setLinvel({ x: 0, y: 0, z: 0 }, true); b.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    this.state = 'stand'; this.t = 0; this.tFall = 0; this.still = 0; this.toppled = 0; this.autoGetUp = true;
    this.sword.p = 0; this.sword.dir = 0; this.sword.act = 0; this.walk.reset(); this.prevRoot = null; this.prevQw = null; this.prevPw = null;
    this.readState();
    for (const b of this.b) { b.pp.copy(b.p); b.pq.copy(b.q); b.rp.copy(b.p); b.rq.copy(b.q); }
  }

  // advance by wall-clock dt using fixed steps. b.rp / b.rq = the pose to draw: the last two physics states blended by the leftover time,
  // so the picture moves evenly whatever the display's refresh rate (no judder from 2-3-1-2 steps per frame)
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n++ < 12) { this.snapshot(); this.step(); this.acc -= STEP; }
    this.interpolate(this.acc / STEP);
  }
  snapshot() { this.readState(); for (const b of this.b) { b.pp.copy(b.p); b.pq.copy(b.q); } }
  interpolate(a) {
    this.readState();
    a = clamp(a, 0, 1);
    for (const b of this.b) { b.rp.lerpVectors(b.pp, b.p, a); b.rq.slerpQuaternions(b.pq, b.q, a); }
  }
}

// Fixed-step driver for characters that share one physics world.
export class Sim {
  constructor(world, chars) { this.world = world; this.chars = chars; this.acc = 0; this.after = []; } // after: callbacks run after every physics step (hit detection)
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n++ < 12) {
      for (const c of this.chars) c.snapshot();
      for (const c of this.chars) c.preStep();
      this.world.step();
      for (const c of this.chars) c.postStep();
      for (const f of this.after) f();
      this.acc -= STEP;
    }
    for (const c of this.chars) c.interpolate(this.acc / STEP);
  }
}

const ease01 = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
