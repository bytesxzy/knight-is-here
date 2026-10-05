// "Ghost": a kinematic target-pose generator (keyframes + 2-bone IK + ground contact).
// The physics ragdoll chases this pose with joint torques, so the ghost is also where walking/running/IK will live.
// Ghost frame: x = left, y = up, z = forward (the direction the knight ends up facing). Poses are local rotations per body.
import * as THREE from '#three';

const { Vector3: V3, Quaternion: Q } = THREE;
const D = Math.PI / 180;
const ax = (x, y, z) => (a) => new Q().setFromAxisAngle(new V3(x, y, z), a);
export const Rx = ax(1, 0, 0), Ry = ax(0, 1, 0), Rz = ax(0, 0, 1);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// a robot's idle glances: head yaw (deg) holds a direction for 2.7 s, then snaps to the next within 0.2 s
const SCAN = [0, 22, 0, -18, 0, 12, -26, 0];
export const scanYaw = (t) => { const T = 2.7, i = Math.floor(t / T), f = t / T - i, a = SCAN[((i % 8) + 8) % 8], b = SCAN[(((i + 1) % 8) + 8) % 8], u = Math.min(1, Math.max(0, (f - 0.925) / 0.075)); return a + (b - a) * u * u * (3 - 2 * u); };
export const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

// a direction turned toward another along the shortest arc (a plain lerp of two opposite poles passes through zero and the elbow flips to the other side)
const slerpDir = (a, b, t) => a.clone().applyQuaternion(new Q().slerp(new Q().setFromUnitVectors(a, b), t));
// the point `w` of the way from T to P about the shoulder S: the direction turns along the shortest arc, the distance is blended and kept above rmin (smoothly)
function blendReach(S, T, P, w, rmin) {
  const a = T.clone().sub(S), b = P.clone().sub(S), ra = a.length(), rb = b.length();
  if (ra < 1e-5 || rb < 1e-5) return T.clone().lerp(P, w);
  const r = ra + (rb - ra) * w, e = 0.03, rr = 0.5 * (r + rmin + Math.sqrt((r - rmin) * (r - rmin) + e * e)), dir = slerpDir(a.divideScalar(ra), b.divideScalar(rb), w);
  return S.clone().addScaledVector(dir, w < 1e-4 ? ra : w > 1 - 1e-4 ? rb : rr);
}
// ---- two-bone IK. S: root joint, T: wanted end position, pole: direction the middle joint should bulge to.
// oL / oE: rest offsets upper->lower and lower->end, h: hinge axis (upper frame), s: sign of the flexion angle.
function solveLimb(S, T, pole, oL, oE, h, s, hingeW = null, eps = 0.06, memo = null) {
  const d = T.clone().sub(S), Dd = d.length();
  const A = oL.dot(h) * h.dot(oE), B = oL.dot(oE) - A, C = oL.dot(new V3().crossVectors(h, oE));
  const R = Math.hypot(B, C), phi = Math.atan2(C, B);
  const c = clamp((Dd * Dd - oL.lengthSq() - oE.lengthSq() - 2 * A) / (2 * R), -1, 1);
  const k = phi + s * Math.acos(c);
  const vE = oL.clone().add(oE.clone().applyQuaternion(new Q().setFromAxisAngle(h, k)));
  const dn = d.normalize();
  const Q1 = new Q().setFromUnitVectors(vE.normalize(), dn);
  const perp = (v) => v.clone().addScaledVector(dn, -v.dot(dn));
  const a = perp(oL.clone().applyQuaternion(Q1)), b = perp(pole);
  // the pole only defines the twist once the middle joint is clearly off the root->end line (a straight limb has no defined bend plane)
  let twist = 0;
  const off = a.length();
  if (off > 1e-6 && b.lengthSq() > 1e-8) {
    const bl0 = Math.sqrt(b.lengthSq()); a.normalize(); b.normalize();
    const bl = clamp((bl0 / Math.max(Math.sqrt(pole.lengthSq()), 1e-6) - 0.3) / 0.4, 0, 1); // (a pole (anti)parallel to the reach direction has no defined bend side: its authority fades out instead of flipping the arm about its axis)
    let raw = Math.atan2(dn.dot(new V3().crossVectors(a, b)), a.dot(b));
    if (memo) { // the twist angle is tracked through time: when the wanted bend side is the opposite of the natural one the angle sits at +-PI and one tiny change would flip it by 2 PI (times the fades below: a jump of the whole arm)
      if (memo.raw !== undefined) { raw = memo.raw + Math.atan2(Math.sin(raw - memo.raw), Math.cos(raw - memo.raw)); if (raw > Math.PI + 0.8) raw -= 2 * Math.PI; else if (raw < -Math.PI - 0.8) raw += 2 * Math.PI; }
      memo.raw = raw;
    }
    twist = raw * clamp(off / eps, 0, 1) * bl * bl * (3 - 2 * bl);
  }
  if (hingeW) { // rest limbs that are bent sideways (knock-kneed legs): put the HINGE axis on the wanted world axis instead of chasing the bulge direction
    const pc = h.clone().applyQuaternion(Q1), pd = hingeW.clone();
    pc.addScaledVector(dn, -pc.dot(dn)); pd.addScaledVector(dn, -pd.dot(dn));
    if (pc.lengthSq() > 1e-10 && pd.lengthSq() > 1e-10) { pc.normalize(); pd.normalize(); twist = Math.atan2(dn.dot(new V3().crossVectors(pc, pd)), pc.dot(pd)); }
  }
  return { QU: new Q().setFromAxisAngle(dn, twist).multiply(Q1), k };
}

// collision sample points of a fitted shape (anchor-local point + radius)
function samplePoints(f) {
  const c = new V3(...f.c);
  if (f.shape === 'ball') return [{ p: c, r: f.r }];
  if (f.shape === 'capsule') {
    const u = new V3(0, 1, 0).applyQuaternion(new Q(...f.q)).multiplyScalar(f.hh);
    return [{ p: c.clone().add(u), r: f.r }, { p: c.clone().sub(u), r: f.r }];
  }
  const hx = f.h[0] - f.r, hy = f.h[1] - f.r, hz = f.h[2] - f.r, out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push({ p: new V3(c.x + sx * hx, c.y + sy * hy, c.z + sz * hz), r: f.r });
  return out;
}

const FIELDS = ['py', 'px', 'pz', 'pitch', 'abd', 'chest', 'head', 'abdT', 'chestT', 'abdS', 'chestS', // T = twist, S = side bend (deg)
  'pyaw', 'proll', 'headT', 'fyL', 'fyR', // pelvis yaw/roll, head yaw (deg), foot yaw (deg) - used by walking
  'fLx', 'fLy', 'fLz', 'fRx', 'fRy', 'fRz', 'hLx', 'hLy', 'hLz', 'hRx', 'hRy', 'hRz',
  'ffL', 'ffR', 'foL', 'foR', 'hfL', 'hfR', 'afL', 'afR', 'hs'];

export class Ghost {
  constructor(rig) {
    this.rig = rig;
    this.sc = rig.scale ?? { l: 1, x: 1, sx: 1, a: 1, h: 1 }; // proportions relative to the knight (the keyframes are tuned in metres for him)
    const B = rig.bodies, I = rig.idx;
    this.n = B.length;
    this.samples = B.map((b) => samplePoints(b.fit));
    this.limb = ['L', 'R'].map((S, si) => {
      const k = si === 0 ? 1 : -1;
      return { k, hip: I['thigh' + S], knee: I['shin' + S], foot: I['foot' + S], sh: I['upperArm' + S], el: I['forearm' + S], hand: I['hand' + S], S };
    });
    const g = (i, q) => -Math.min(...this.samples[i].map((s) => s.p.clone().applyQuaternion(q).y - s.r));
    const per = (fn) => Math.max(...this.limb.map(fn)); // armor is not symmetric: take the worse side
    this.H = {
      thigh: per((l) => g(l.hip, new Q())), foot: per((l) => g(l.foot, new Q())), hand: per((l) => g(l.hand, Ry(-l.k * Math.PI / 2))),
      shin: per((l) => g(l.knee, Rx(Math.PI / 2))), footTop: per((l) => g(l.foot, Rx(Math.PI))),
    };
    const l = this.limb[0];
    this.thigh = B[l.knee].off.length();
    this.hipOff = B[this.limb[0].hip].off.clone().add(B[this.limb[1].hip].off).multiplyScalar(0.5);
    this.clampable = B.map((b) => !/^(thigh|shin|foot|hand)/.test(b.name));
    this.keys = this.buildKeys();
    this.tStand = this.keys[this.keys.length - 2].t; // reaching the upright pose
    this.duration = this.keys[this.keys.length - 1].t;
    this.snap = null; this.tb = 1.6; // seconds to blend from the physical heap into the first key
    this.begin(null, new V3(), 0);
  }

  // pelvis height/forward position that puts the hip joints at (hipY, hipZ) for a given pelvis pitch
  pel(hipY, hipZ, pitchDeg) {
    const r = this.hipOff.clone().applyQuaternion(Rx(pitchDeg * D));
    return { py: hipY - r.y, pz: hipZ - r.z, pitch: pitchDeg };
  }

  // ankle height at which a foot collider pitched by `pitchDeg` (toes down +) just touches the ground
  groundH(i, q) { return -Math.min(...this.samples[i].map((s) => s.p.clone().applyQuaternion(q).y - s.r)); }
  footH(pitchDeg) { const q = Rx(pitchDeg * D); return Math.max(...this.limb.map((l) => this.groundH(l.foot, q))); }

  buildKeys() {
    const { H, thigh } = this, s = this.sc, ankleLie = Math.max(H.shin, H.footTop), K = this.rig.spec?.keyTweak ?? {}; // K: per-character nudges of a few keys (rigs.js)
    const hipKneel = Math.max(H.shin + thigh, H.thigh), kneeY = hipKneel - thigh; // the cuisse armor decides how high the kneeling hip sits
    const zk = -0.3 * s.l, fy = H.foot, hang = { hs: 1, hLx: 0.075 * s.a, hLy: -0.355 * s.a, hLz: 0.04 * s.a, hRx: -0.075 * s.a, hRy: -0.355 * s.a, hRz: 0.04 * s.a, hfL: 0, hfR: 0 };
    const kneelFeet = (z) => ({ fLx: 0.14 * s.x, fLy: ankleLie, fLz: z, fRx: -0.14 * s.x, fRy: ankleLie, fRz: z, ffL: 1, ffR: 1, foL: 180, foR: 180, afL: 85, afR: 85 }); // foot lies instep-down (world pitch 180) whatever the shin does
    const under = (o = {}) => ({ hs: 0, hfL: 1, hfR: 1, ...o }); // hands planted: filled in by underShoulders()
    const keys = [];
    const TS = 0.85; // overall speed of the get-up
    const add = (t, o) => { t *= TS; const pv = keys.length ? this.keyVals(keys[keys.length - 1]) : {}; keys.push({ t, ...pv, ...(typeof o === 'function' ? o(pv) : o) }); };
    // 0 prone: legs trailing behind, hands by the ribs
    add(0, { py: 0, px: 0, pz: 0, pitch: 90, abd: 0, chest: 0, head: 10, abdT: 0, chestT: 0, abdS: 0, chestS: 0, pyaw: 0, proll: 0, headT: 0, fyL: 0, fyR: 0, ...kneelFeet(-0.95 * s.l), fLy: ankleLie + 0.05, fRy: ankleLie + 0.05, hs: 0, hLx: 0.30 * s.sx, hLy: H.hand, hLz: 0.15 * s.l, hRx: -0.30 * s.sx, hRy: H.hand, hRz: 0.15 * s.l, hfL: 1, hfR: 1 });
    // 1 hands under the shoulders, chest starts to rise
    add(2.2, { pitch: 90, abd: -12, chest: -22, head: -25, ...kneelFeet(-0.95 * s.l), fLy: ankleLie + 0.05, fRy: ankleLie + 0.05, ...under(), underSh: 0.0 });
    // 2 all fours: knees under the hips, hands under the shoulders
    add(4.6, (pv) => this.fitPitch(pv, hipKneel, zk, { abd: -8, chest: -10, head: -28, ...kneelFeet(zk - thigh), ...under(), underSh: 0.0 }));
    // 3 upright kneel, arms hang
    add(6.4, { ...this.pel(hipKneel, zk, 6), abd: 0, chest: 0, head: 0, ...kneelFeet(zk - thigh), ...hang });
    // 4 lunge: right foot planted ahead, pelvis shifting over it
    add(7.8, { ...this.pel(kneeY + (0.35 + (K.hip4 ?? 0)) * s.l, zk + (0.26 + (K.z4 ?? 0)) * s.l, 12), abd: 4, chest: 4, head: -6, fLz: zk - (0.08 + (K.foot4 ?? 0)) * s.l, fLy: ankleLie, fRx: -0.17 * s.x, fRy: fy, fRz: zk + 0.50 * s.l, ffR: 1, foR: 0, afR: 0, ...hang });
    // 5 pushing up, back foot swinging through
    add(9.0, { ...this.pel(0.74 * s.h, zk + 0.46 * s.l, 16), abd: 8, chest: 6, head: -4, fLx: 0.15 * s.x, fLy: fy + 0.12 * s.l, fLz: zk + 0.30 * s.l, ffL: 0.7, foL: 60, afL: 20, fRx: -0.17 * s.x, fRy: fy, fRz: zk + 0.52 * s.l, ffR: 1, afR: 0, ...hang });
    // 6 standing, a little unsteady
    add(10.3, { ...this.pel(0.925 * s.h, zk + 0.5 * s.l, 3), abd: 1, chest: 0, head: 2, fLx: 0.15 * s.x, fLy: fy, fLz: zk + 0.42 * s.l, ffL: 1, foL: 0, afL: 0, fRx: -0.15 * s.x, fRy: fy, fRz: zk + 0.56 * s.l, ffR: 1, afR: 0, ...hang });
    // 7 settle upright
    add(11.6, { ...this.pel(0.935 * s.h, zk + 0.5 * s.l, 0), abd: 0, chest: 0, head: 0, fLz: zk + 0.48 * s.l, fRz: zk + 0.52 * s.l, ...hang });
    return keys;
  }
  // all-fours: smallest torso pitch (head-down slope) at which the short arms still reach the floor under the shoulders
  fitPitch(pv, hipY, hipZ, rest) {
    let o;
    for (let p = 96; p <= 150; p++) {
      o = { ...rest, ...this.pel(hipY, hipZ, p) };
      const g = this.solve({ ...pv, ...o, under: 1 });
      if (Math.max(g.err[1], g.err[3]) < 0.006) break;
    }
    return o;
  }
  keyVals(k) { const o = {}; for (const f of FIELDS) o[f] = k[f]; o.underSh = undefined; return o; }

  // key values at time t (eased between keys); after the last key holds with a gentle "still shaky" sway
  sample(t) {
    const K = this.keys, v = {};
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1].t) i++;
    const a = K[i], b = K[i + 1], w = ease((t - a.t) / (b.t - a.t));
    for (const f of FIELDS) v[f] = a[f] + (b[f] - a[f]) * w;
    v.under = (a.underSh !== undefined ? 1 - w : 0) + (b.underSh !== undefined ? w : 0);
    v.under = clamp(v.under, 0, 1);
    const s = ease((t - this.tStand) / 3) * (1 - 0.35 * ease((t - this.duration) / 8)) * (1 - (this.walker?.we ?? 0));
    if (s > 0 && this.rig.spec?.style?.idleScan) v.headT += s * scanYaw(t); // a robot: no breathing sway, its head snaps from one glance to the next
    else if (s > 0) {
      v.px += 0.012 * s * Math.sin(0.9 * t); v.pz += 0.010 * s * Math.sin(0.65 * t + 1); v.py += 0.004 * s * Math.sin(1.7 * t);
      v.chest += 1.6 * s * Math.sin(1.1 * t); v.head += 2.2 * s * Math.sin(0.8 * t + 2); v.pitch += 0.8 * s * Math.sin(0.7 * t + 0.5);
    }
    if (this.walker && this.walker.we > 0.0005) this.walker.apply(v); // locomotion overrides pelvis, feet, arm swing
    if (this.jump?.active) this.jump.apply(v);                          // a jump (robot) overrides the whole pose
    if (this.layer) this.layer.spine(v); // optional upper-body layer (sword draw …)
    return v;
  }

  // forward kinematics + IK for one parameter set. returns ghost-frame transforms + local rotations.
  solve(v, pyOverride) {
    const B = this.rig.bodies, I = this.rig.idx, n = this.n;
    const P = B.map(() => new V3()), Qw = B.map(() => new Q()), ql = B.map(() => new Q());
    const place = (i, q) => { const p = B[i].parent; ql[i].copy(q); Qw[i].copy(Qw[p]).multiply(q); P[i].copy(B[i].off).applyQuaternion(Qw[p]).add(P[p]); };
    const py = pyOverride ?? v.py;
    ql[0].copy(Ry(v.pyaw * D).multiply(Rz(v.proll * D)).multiply(Rx(v.pitch * D))); Qw[0].copy(ql[0]); P[0].set(v.px, py, v.pz);
    place(I.abdomen, Rz(v.abdS * D).multiply(Rx(v.abd * D)).multiply(Ry(v.abdT * D)));
    place(I.chest, Rz(v.chestS * D).multiply(Rx(v.chest * D)).multiply(Ry(v.chestT * D))); place(I.head, Ry(v.headT * D).multiply(Rx(v.head * D)));
    const err = [];
    for (const l of this.limb) {
      const k = l.k;
      // leg
      let S = B[l.hip].off.clone().applyQuaternion(Qw[0]).add(P[0]);
      let T = new V3(v['f' + l.S + 'x'], v['f' + l.S + 'y'], v['f' + l.S + 'z']);
      // hinge-geometry poles (never degenerate): the knee bulges perpendicular to the leg line, in the plane set by the pelvis' lateral axis
      const Xp = new V3(1, 0, 0).applyQuaternion(Qw[0]);
      let r = solveLimb(S, T, new V3().crossVectors(T.clone().sub(S).normalize(), Xp), B[l.knee].off, B[l.foot].off, new V3(1, 0, 0), 1, this.rig.spec?.legIK === 'hinge' ? Xp : null);
      Qw[l.hip].copy(r.QU); ql[l.hip].copy(Qw[0]).invert().multiply(r.QU); P[l.hip].copy(S);
      place(l.knee, Rx(r.k));
      const fl = new Q().copy(Qw[l.knee]).invert().multiply(Ry(v['fy' + l.S] * D)).multiply(Rx(v['fo' + l.S] * D)), ff = v['ff' + l.S];
      place(l.foot, Rx(v['af' + l.S] * D).slerp(fl, ff));
      err.push(P[l.foot].distanceTo(T));
      // arm
      const c = I.chest;
      S = B[l.sh].off.clone().applyQuaternion(Qw[c]).add(P[c]);
      const raw = new V3(v['h' + l.S + 'x'], v['h' + l.S + 'y'], v['h' + l.S + 'z']);
      const abs = raw.clone().lerp(new V3(S.x, this.H.hand, S.z), v.under); // planted: straight under the shoulder
      const rel = raw.clone().applyQuaternion(Qw[c]).add(S);                // hanging: offset from the shoulder, in chest frame
      T = abs.lerp(rel, v.hs);
      const ov = this.layer ? this.layer.arm(l.S, { P, Qw, I }) : null; // layer may take over the hand (target, orientation, elbow side)
      if (ov) T.copy(blendReach(S, T, ov.pos, ov.w, 0.3 * (B[l.el].off.length() + B[l.hand].off.length()))); // (the hand follows the walker's target into the layer's through the shoulder's SPHERE: a straight lerp from a hanging arm to a raised one passes right by the shoulder, where the elbow IK has no defined direction)
      const Xc = new V3(1, 0, 0).applyQuaternion(Qw[c]);
      let pole = new V3().crossVectors(Xc, T.clone().sub(S).normalize()); // elbows bulge backward
      if (ov && ov.pole) pole = pole.lengthSq() > 1e-8 ? slerpDir(pole.normalize(), ov.pole.clone().normalize(), ov.w * (1 - (ov.free ?? 0))) : ov.pole.clone(); // (a layer's `free` share leaves the elbow to the walker's own pole)
      r = solveLimb(S, T, pole, B[l.el].off, B[l.hand].off, new V3(0, 1, 0), -k, null, ov ? 0.06 + (0.008 - 0.06) * ov.w : 0.06, (this.memo ??= { L: {}, R: {} })[l.S]); // (a layer that reaches far must not lose the elbow's plane just as the arm straightens: the upper arm would flip about its axis)
      Qw[l.sh].copy(r.QU); ql[l.sh].copy(Qw[c]).invert().multiply(r.QU); P[l.sh].copy(S);
      place(l.el, Ry(r.k));
      const flat = Ry(-k * Math.PI / 2), hf = v['hf' + l.S];
      const qh = new Q().copy(Qw[l.el]).invert().multiply(flat).slerp(new Q(), 1 - hf);
      if (ov && ov.quat && ov.wq > 0) qh.slerp(new Q().copy(Qw[l.el]).invert().multiply(ov.quat), ov.wq);
      if (ov && ov.roll) qh.multiply(Rx(k * ov.roll)); // the layer turns the hand about the forearm (a corkscrew punch): + = pronation on both hands
      place(l.hand, qh);
      err.push(P[l.hand].distanceTo(T));
    }
    return { P, Qw, ql, err };
  }

  // lowest point of the pose (collider surface), relative to the ground
  // (limbs placed by IK against ground targets are excluded from the clamp unless all=true: lifting the pelvis can't fix them)
  lowest(g, all = false) {
    let low = Infinity;
    for (let i = 0; i < this.n; i++) if (all || this.clampable[i]) for (const s of this.samples[i]) low = Math.min(low, g.P[i].y + s.p.clone().applyQuaternion(g.Qw[i]).y - s.r);
    return low;
  }

  // full pose at time t in the ghost frame, kept above the ground
  poseAt(t) {
    const v = this.sample(t);
    let py = v.py, g = this.solve(v, py);
    for (let i = 0; i < 6; i++) { const low = this.lowest(g); if (low > -0.002) break; py -= low; g = this.solve(v, py); }
    return g;
  }

  // set where/how the get-up happens: origin (world pos below the pelvis), heading psi (world yaw of the ghost's +Z),
  // and an optional snapshot of the physical pose to blend away from
  begin(snap, origin, psi, t0 = 0) {
    this.origin = origin.clone(); this.psi = psi; this.R = Ry(psi); this.snap = snap; this.t0 = t0;
  }

  // world-space pose at get-up time t: { rootP, rootQ, ql[] } (+ P/Qw world transforms for every body)
  evaluate(t) {
    const g = this.poseAt(t), B = this.rig.bodies;
    const rootP = g.P[0].clone().applyQuaternion(this.R).add(this.origin), rootQ = this.R.clone().multiply(g.Qw[0]);
    const ql = g.ql.map((q) => q.clone());
    if (this.snap && t - this.t0 < this.tb) {
      const w = ease((t - this.t0) / this.tb), s = this.snap;
      rootP.lerpVectors(s.rootP, rootP, w); rootQ.slerpQuaternions(s.rootQ, rootQ, w);
      for (let i = 1; i < this.n; i++) ql[i].slerpQuaternions(s.ql[i], ql[i], w);
    }
    return { rootP, rootQ, ql, err: g.err };
  }
}

// forward kinematics from a root transform + local rotations -> world {P, Q} per body (used for rendering/snapshots)
export function worldPose(rig, rootP, rootQ, ql) {
  const B = rig.bodies, P = B.map(() => new V3()), Qw = B.map(() => new Q());
  P[0].copy(rootP); Qw[0].copy(rootQ);
  for (let i = 1; i < B.length; i++) {
    const p = B[i].parent;
    Qw[i].copy(Qw[p]).multiply(ql[i]);
    P[i].copy(B[i].off).applyQuaternion(Qw[p]).add(P[p]);
  }
  return { P, Q: Qw };
}
