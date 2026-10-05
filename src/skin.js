// Writes physics/ghost body transforms onto the character's skinned-mesh bones.
// Every bone's world rotation = (rotation of the body that drives it) * (its rest world rotation); local rotations follow from the
// parent chain, so the weirdly oriented auto-rig bone axes never matter. Only the root bone gets a position.
// A rig whose hands have no finger bones (the skeleton: palm bones only) gets procedural ones (`spec.fingers`): chained bones for the four fingers
// and the thumb, the weights of the finger vertices are moved onto them by distance along the finger, and `curl` closes them into a fist.
import * as THREE from '#three';

const { Vector3: V3, Quaternion: Q, Matrix4: M4 } = THREE;
const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const mirrorQ = (q) => new Q(q.x, -q.y, -q.z, q.w); // a rotation mirrored across the x = 0 plane (left hand -> right hand)

// Adds the finger bones of one hand (side +1 = left / -1 = right) to the mesh's skeleton and re-weights the finger vertices.
// Returns the new bones [{ bone, chain, j }] (rest world rotation = the hand bone's) and their bind matrices.
function addFingerBones(mesh, handName, side, cfg, extraBones, extraInv) {
  const skel = mesh.skeleton, hi = skel.bones.findIndex((b) => b.name === handName), hb = skel.bones[hi];
  const M = skel.boneInverses[hi].clone().invert(), hp = new V3(), hq = new Q(), sc = new V3();
  M.decompose(hp, hq, sc);
  const hqInv = hq.clone().invert(), made = [];
  const chain = (name, parent, parentWorld, joints, tag) => { // joints: world (mesh space) pivot positions, root first
    let par = parent, pw = parentWorld;
    return joints.map((J, j) => {
      const bone = new THREE.Bone(); bone.name = `${name}_${j}`;
      bone.position.copy(J).sub(pw).applyQuaternion(hqInv); par.add(bone);
      const bind = new M4().compose(J, hq, new V3(1, 1, 1));
      extraBones.push(bone); extraInv.push(bind.clone().invert());
      made.push({ bone, chain: tag, j, index: -1 }); par = bone; pw = J;
      return bone;
    });
  };
  const x0 = side * cfg.xk, yc = cfg.axisPoint[1], zc = cfg.axisPoint[2];
  const fJ = cfg.joints.map((s) => new V3(x0 + side * s, yc, zc));
  chain(`Finger${side > 0 ? 'L' : 'R'}`, hb, hp, fJ, 'F');
  const T = cfg.thumb, tb = new V3(side * T.base[0], T.base[1], T.base[2]), td = new V3(side * T.dir[0], T.dir[1], T.dir[2]).normalize();
  const tJ = T.joints.map((s) => tb.clone().addScaledVector(td, s));
  chain(`Thumb${side > 0 ? 'L' : 'R'}`, hb, hp, tJ, 'T');
  return { made, hi, tb, td, hp };
}

export class SkinBinder {
  constructor(root, rig, profile) {
    this.mesh = null;
    root.traverse((o) => { if (o.isSkinnedMesh) this.mesh = o; });
    if (!this.mesh) throw new Error('no skinned mesh in the model');
    this.mesh.frustumCulled = false; // the bind-pose bounds are meaningless once the bones move
    const cfg = rig.spec?.fingers ?? null;
    this.fingerCfg = cfg;
    const extraDriver = {}, extraFinger = {}; // new bone name -> driving body index / { side, chain, j }
    if (cfg) {
      root.updateMatrixWorld(true);
      const extraBones = [], extraInv = [], geo = this.mesh.geometry, pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
      profile = { ...profile, bones: { ...profile.bones } };
      for (const [side, S] of [[1, 'L'], [-1, 'R']]) {
        const hand = rig.bodies[rig.idx['hand' + S]], handName = hand.bones[0], own = new Set(hand.bones.map((n) => this.mesh.skeleton.bones.findIndex((b) => b.name === n)));
        const r = addFingerBones(this.mesh, handName, side, cfg, extraBones, extraInv), base = this.mesh.skeleton.bones.length + extraBones.length - r.made.length, pi = r.hi;
        r.made.forEach((m, k) => { m.index = base + k; profile.bones[m.bone.name] = { p: [0, 0, 0], q: profile.bones[handName].q }; extraDriver[m.bone.name] = hand.i; extraFinger[m.bone.name] = { side: S, chain: m.chain, j: m.j }; });
        const F = r.made.filter((m) => m.chain === 'F').map((m) => m.index), Tm = r.made.filter((m) => m.chain === 'T').map((m) => m.index);
        // re-weight: the finger vertices (beyond the knuckle line) split over the finger bones by distance along the finger, the thumb vertices likewise
        const p = new V3(), joints = cfg.joints, tj = cfg.thumb.joints, w = cfg.blend;
        for (let v = 0; v < pos.count; v++) {
          if (!own.has(si.getX(v)) && !own.has(si.getY(v))) continue; // only vertices that belong to this hand
          p.fromBufferAttribute(pos, v);
          if (side * p.x < 0.6) continue;
          const dT = p.clone().sub(r.tb), tz = dT.dot(r.td), rad = dT.addScaledVector(r.td, -tz).length();
          if (rad < cfg.thumb.radius && tz > -0.01 && p.y > cfg.thumb.minY) { // the thumb
            const a1 = sm(tj[0] - w, tj[0] + w, tz), a2 = sm(tj[1] - w, tj[1] + w, tz);
            si.setXYZW(v, pi, Tm[0], Tm[1], 0); sw.setXYZW(v, 1 - a1, a1 - a2, a2, 0);
          } else if (side * p.x > cfg.xk) { // a finger
            const s = side * p.x - cfg.xk, a1 = sm(joints[0] - w, joints[0] + w, s), a2 = sm(joints[1] - w, joints[1] + w, s), a3 = sm(joints[2] - w, joints[2] + w, s);
            si.setXYZW(v, pi, F[0], F[1], F[2]); sw.setXYZW(v, 1 - a1, a1 - a2, a2 - a3, a3);
          }
        }
      }
      si.needsUpdate = sw.needsUpdate = true;
      const old = this.mesh.skeleton;
      this.mesh.bind(new THREE.Skeleton([...old.bones, ...extraBones], [...old.boneInverses, ...extraInv]), this.mesh.bindMatrix);
    }
    const bones = this.mesh.skeleton.bones;
    const driver = {};
    rig.bodies.forEach((b) => b.bones.forEach((n) => (driver[n] = b.i)));
    Object.assign(driver, extraDriver);
    const depth = (b) => { let d = 0; for (let p = b.parent; p && p.isBone; p = p.parent) d++; return d; };
    this.items = [...bones].sort((a, b) => depth(a) - depth(b)).map((bone) => {
      const bl = rig.blend[bone.name];
      return {
        bone, restQ: new THREE.Quaternion(...profile.bones[bone.name].q), parent: null, worldQ: new THREE.Quaternion(),
        a: bl ? rig.idx[bl[0]] : driver[bone.name], b: bl ? rig.idx[bl[1]] : -1, t: bl ? bl[2] : 0,
      };
    });
    const byBone = new Map(this.items.map((it) => [it.bone, it]));
    this.items.forEach((it) => (it.parent = byBone.get(it.bone.parent) ?? null));
    this.root = this.items.find((it) => !it.parent);
    // finger bones: curl them around a grip / into a fist. chain 0 = thumb, 1 = fingers; j = joint along the chain (the knight);
    // procedural fingers (cfg): chain 'F' / 'T' with the curl axis and angles from the spec
    this.curl = { L: 0, R: 0 };
    if (cfg) {
      for (const it of this.items) { const f = extraFinger[it.bone.name]; if (f) it.finger = f; }
      const aF = new V3(...cfg.axis).normalize(), aT = new V3(...cfg.thumb.axis).normalize();
      this.curlQ = { L: { F: aF, T: aT }, R: { F: aF, T: aT } };
    } else {
      for (const S of ['L', 'R']) rig.bodies[rig.idx['hand' + S]].bones.slice(1).forEach((name, i) => { this.items.find((it) => it.bone.name === name).finger = { side: S, chain: i < 4 ? 0 : 1, j: i % 4 }; });
    }
    this.rootOffset = new THREE.Vector3(...profile.bones[this.root.bone.name].p).sub(rig.bodies[0].anchor);
  }

  // cumulative curl angle (rad) at the end of each joint, at full curl
  fingerCurl({ side, chain, j }) {
    const cfg = this.fingerCfg, amt = this.curl[side];
    if (cfg) { // procedural fingers: rotate about the (left-hand) axis, mirrored for the right hand
      const a = (chain === 'F' ? cfg.angles : cfg.thumb.angles)[j] * amt, ax = new V3(...(chain === 'F' ? cfg.axis : cfg.thumb.axis)).normalize();
      const q = new Q().setFromAxisAngle(ax, -a * cfg.dir); // (left hand: toward the palm)
      return side === 'L' ? q : mirrorQ(q);
    }
    const a = (chain === 0 ? [0.3, 0.7, 1.1, 1.3] : [0.6, 1.3, 2.0, 2.5])[j] * amt;
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side === 'R' ? a : -a); // about the knuckle line, towards the palm
  }

  // P[i] / Q[i]: world position (of the anchor joint) / rotation of body i
  apply(P, Q) {
    for (const it of this.items) {
      const q = it.worldQ;
      if (it.b >= 0) q.slerpQuaternions(Q[it.a], Q[it.b], it.t); else q.copy(Q[it.a]);
      if (it.finger && this.curl[it.finger.side] > 0) q.multiply(this.fingerCurl(it.finger));
      q.multiply(it.restQ);
      if (it.parent) it.bone.quaternion.copy(it.parent.worldQ).invert().multiply(q); else it.bone.quaternion.copy(q);
    }
    this.root.bone.position.copy(this.rootOffset).applyQuaternion(Q[0]).add(P[0]);
  }
}
