// Per-bone vertex statistics of a skinned GLB (dominant bone per vertex): count, bounding box and centroid. usage: node tools/bone-stats.mjs model.glb
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]), jsonLen = buf.readUInt32LE(12), gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)), bin = 20 + jsonLen + 8, dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const GET = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }, SZ = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }, NORM = { 5121: 255, 5123: 65535 };
const acc = (i) => { const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], sz = SZ[a.componentType], stride = bv.byteStride || n * sz, base = bin + (bv.byteOffset || 0) + (a.byteOffset || 0), out = new Float32Array(a.count * n);
  for (let v = 0; v < a.count; v++) for (let c = 0; c < n; c++) { let x = dv[GET[a.componentType]](base + v * stride + c * sz, true); if (a.normalized) x /= NORM[a.componentType]; out[v * n + c] = x; } return out; };
const prim = gltf.meshes[0].primitives[0], pos = acc(prim.attributes.POSITION), jt = acc(prim.attributes.JOINTS_0), wt = acc(prim.attributes.WEIGHTS_0), jn = gltf.skins[0].joints.map((ni) => gltf.nodes[ni].name);
const st = {};
for (let v = 0; v < pos.length / 3; v++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) if (wt[v * 4 + k] > bw) { bw = wt[v * 4 + k]; best = jt[v * 4 + k]; }
  const n = jn[best], e = (st[n] ??= { n: 0, lo: [9, 9, 9], hi: [-9, -9, -9], s: [0, 0, 0] });
  e.n++; for (let a = 0; a < 3; a++) { const x = pos[v * 3 + a]; e.lo[a] = Math.min(e.lo[a], x); e.hi[a] = Math.max(e.hi[a], x); e.s[a] += x; } }
for (const n of Object.keys(st).sort()) { const e = st[n]; console.log(n, String(e.n).padStart(6), 'x[' + e.lo[0].toFixed(2) + ',' + e.hi[0].toFixed(2) + '] y[' + e.lo[1].toFixed(2) + ',' + e.hi[1].toFixed(2) + '] z[' + e.lo[2].toFixed(2) + ',' + e.hi[2].toFixed(2) + '] c(' + e.s.map((x) => (x / e.n).toFixed(2)).join(',') + ')'); }
