// Reads the knight .glb and writes src/profile.json:
//  - rest-pose world position/rotation of every bone
//  - collider fits for every physics body (from the vertices each body's bones dominate)
// usage: node tools/build-profile.mjs <model.glb> <out.json> [knight|skeleton|robot]
import fs from 'node:fs';
import * as THREE from '#three';
import { BODIES as KNIGHT_BODIES } from '../src/humanoid.js';
import { SKELETON, ROBOT } from '../src/rigs.js';

const [, , glbPath = 'Untitled.glb', outPath = 'src/profile.json', rigName = 'knight'] = process.argv;
const BODIES = rigName === 'skeleton' ? SKELETON.bodies : rigName === 'robot' ? ROBOT.bodies : KNIGHT_BODIES;
const buf = fs.readFileSync(glbPath);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const bin = 20 + jsonLen + 8;
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const GET = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const SZ = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function readAccessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], sz = SZ[a.componentType];
  const stride = bv.byteStride || n * sz;
  const base = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float32Array(a.count * n);
  for (let v = 0; v < a.count; v++)
    for (let c = 0; c < n; c++) {
      let x = dv[GET[a.componentType]](base + v * stride + c * sz, true);
      if (a.normalized) x /= NORM[a.componentType];
      out[v * n + c] = x;
    }
  return out;
}

// ---- rest pose of every node (world space)
const nodes = gltf.nodes, parent = nodes.map(() => -1);
nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
const worldCache = [];
function worldOf(i) {
  if (worldCache[i]) return worldCache[i];
  const n = nodes[i], m = new THREE.Matrix4();
  if (n.matrix) m.fromArray(n.matrix);
  else m.compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
  return (worldCache[i] = parent[i] < 0 ? m : new THREE.Matrix4().multiplyMatrices(worldOf(parent[i]), m));
}
const skin = gltf.skins[0];
const r4 = (a) => a.map((x) => Math.round(x * 1e5) / 1e5);
const bones = {};
for (const ni of skin.joints) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  worldOf(ni).decompose(p, q, s);
  bones[nodes[ni].name] = { p: r4(p.toArray()), q: r4(q.toArray()) };
}

// ---- cluster vertices by the body that owns their dominant bone
const prim = gltf.meshes[0].primitives[0];
const pos = readAccessor(prim.attributes.POSITION), jt = readAccessor(prim.attributes.JOINTS_0), wt = readAccessor(prim.attributes.WEIGHTS_0);
const jointName = skin.joints.map((ni) => nodes[ni].name);
const boneBody = {};
BODIES.forEach((b) => [...b.bones, ...(b.fit || [])].forEach((n) => (boneBody[n] = b.name)));
const cloud = Object.fromEntries(BODIES.map((b) => [b.name, []]));
for (let v = 0; v < pos.length / 3; v++) {
  let best = 0, bw = -1;
  for (let k = 0; k < 4; k++) if (wt[v * 4 + k] > bw) { bw = wt[v * 4 + k]; best = jt[v * 4 + k]; }
  const body = boneBody[jointName[best]];
  if (body) cloud[body].push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
}

// ---- shape fitting
const pct = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const V = (a) => new THREE.Vector3(...a);
const anchorOf = Object.fromEntries(BODIES.map((b) => [b.name, V(bones[b.anchor].p)]));
const fits = {};
for (const b of BODIES) {
  const pts = cloud[b.name], n = pts.length / 3, A = anchorOf[b.name];
  if (n < 10) throw new Error('no vertices for ' + b.name);
  const rel = (i) => new THREE.Vector3(pts[i * 3] - A.x, pts[i * 3 + 1] - A.y, pts[i * 3 + 2] - A.z);
  if (b.shape === 'box' || b.shape === 'ball') {
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const col = new Float32Array(n).map((_, i) => rel(i).getComponent(a));
      lo[a] = pct(col, b.shape === 'ball' ? 0.05 : 0.01); hi[a] = pct(col, b.shape === 'ball' ? 0.95 : 0.99);
    }
    const c = lo.map((l, a) => (l + hi[a]) / 2), h = lo.map((l, a) => (hi[a] - l) / 2);
    if (b.shape === 'ball') fits[b.name] = { shape: 'ball', c: r4(c), r: r4([Math.max(h[0], h[2]) * 0.95])[0], n };
    else fits[b.name] = { shape: 'box', c: r4(c), h: r4(h), r: r4([Math.min(0.045, Math.max(0.012, Math.min(...h) * 0.4))])[0], n };
  } else {
    // capsule along anchor -> next body's anchor
    const u = anchorOf[b.next].clone().sub(A).normalize();
    const ts = new Float32Array(n), lat = [];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const r = rel(i), t = r.dot(u), l = r.clone().addScaledVector(u, -t);
      ts[i] = t; lat.push(l); cx += l.x; cy += l.y; cz += l.z;
    }
    const cl = new THREE.Vector3(cx / n, cy / n, cz / n);
    const rad = new Float32Array(n).map((_, i) => lat[i].clone().sub(cl).length());
    const t0 = pct(ts, 0.02), t1 = pct(ts, 0.98), R = pct(rad, 0.8);
    const hh = Math.max(0.005, (t1 - t0) / 2 - R);
    const c = A.clone().multiplyScalar(0).addScaledVector(u, (t0 + t1) / 2).add(cl);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    fits[b.name] = { shape: 'capsule', c: r4(c.toArray()), q: r4(q.toArray()), hh: r4([hh])[0], r: r4([R])[0], u: r4(u.toArray()), n };
  }
}
// the skeleton's vertex clouds are mostly cloth (the skirt hangs from the thigh bones, the sleeves from the arms): its limbs are thin, so its
// capsules are laid along the bones (anatomy), not fitted to the clouds. [t0, t1] = metres along the limb from the joint, r = radius.
const LIMBS = rigName !== 'skeleton' ? {} : { upperArmL: { t: [0, 0.134], r: 0.05 }, upperArmR: { t: [0, 0.134], r: 0.05 }, forearmL: { t: [0, 0.233], r: 0.045 }, forearmR: { t: [0, 0.233], r: 0.045 },
  thighL: { t: [0, 0.474], r: 0.075 }, thighR: { t: [0, 0.474], r: 0.075 }, shinL: { t: [0, 0.462], r: 0.058 }, shinR: { t: [0, 0.462], r: 0.058 } };
for (const [name, L] of Object.entries(LIMBS)) {
  const f = fits[name], u = new THREE.Vector3(...f.u), hh = Math.max(0.005, (L.t[1] - L.t[0]) / 2 - L.r);
  fits[name] = { ...f, c: r4(u.clone().multiplyScalar((L.t[0] + L.t[1]) / 2).toArray()), hh: r4([hh])[0], r: L.r };
}
// the hip armor is weighted to the thigh bones, so the fitted pelvis is just a patch of back armor: use a real pelvis block
fits.pelvis = rigName === 'skeleton' ? { shape: 'box', c: [0, 0.095, -0.035], h: [0.2, 0.09, 0.105], r: 0.03, n: fits.pelvis.n } // iliac wings reach out past the hip joints
  : rigName === 'robot' ? { shape: 'box', c: [0, 0.05, 0.02], h: [0.115, 0.08, 0.09], r: 0.03, n: fits.pelvis.n }
  : { shape: 'box', c: [0, 0.07, 0], h: [0.15, 0.085, 0.12], r: 0.03, n: fits.pelvis.n };
fs.writeFileSync(outPath, JSON.stringify({ bones, fits }));
console.log('wrote', outPath, '-', Object.keys(bones).length, 'bones');
for (const [k, f] of Object.entries(fits)) console.log(k.padEnd(10), f.shape.padEnd(7), 'n=' + String(f.n).padStart(6), JSON.stringify({ ...f, n: undefined, u: undefined, q: undefined }));
