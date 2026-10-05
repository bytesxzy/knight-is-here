// Analyze the hand geometry of a skinned GLB: which vertices are fingers / thumb (connected components beyond the knuckle line). node tools/hand-analyze.mjs skeleton.glb [xKnuckle]
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]), jsonLen = buf.readUInt32LE(12), gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)), bin = 20 + jsonLen + 8;
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const GET = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }, SZ = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }, NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const acc = (i) => { const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], n = NC[a.type], sz = SZ[a.componentType], stride = bv.byteStride || n * sz, base = bin + (bv.byteOffset || 0) + (a.byteOffset || 0), out = new Float64Array(a.count * n);
  for (let v = 0; v < a.count; v++) for (let c = 0; c < n; c++) out[v * n + c] = dv[GET[a.componentType]](base + v * stride + c * sz, true); return out; };
const prim = gltf.meshes[0].primitives[0], pos = acc(prim.attributes.POSITION), idx = acc(prim.indices), N = pos.length / 3;
const xk = +(process.argv[3] ?? 0.665), side = +(process.argv[4] ?? 1);
const inHand = (v) => side * pos[v * 3] > 0.6;
const zone = (v) => inHand(v) && side * pos[v * 3] > xk;
// union-find over triangle edges restricted to the finger zone
const par = Array.from({ length: N }, (_, i) => i), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (zone(a) && zone(b)) par[find(a)] = find(b); if (zone(b) && zone(c)) par[find(b)] = find(c); if (zone(a) && zone(c)) par[find(a)] = find(c); }
const comp = new Map();
for (let v = 0; v < N; v++) if (zone(v)) { const r = find(v), e = comp.get(r) ?? { n: 0, lo: [9, 9, 9], hi: [-9, -9, -9], s: [0, 0, 0] }; e.n++; for (let a = 0; a < 3; a++) { const x = pos[v * 3 + a]; e.lo[a] = Math.min(e.lo[a], x); e.hi[a] = Math.max(e.hi[a], x); e.s[a] += x; } comp.set(r, e); }
const hand = []; for (let v = 0; v < N; v++) if (inHand(v)) hand.push(v);
console.log('hand vertices (|x|>0.6):', hand.length, ' knuckle line |x| =', xk);
const f = (x) => x.toFixed(3);
for (const e of [...comp.values()].sort((a, b) => b.n - a.n).slice(0, 12)) console.log(`component n=${String(e.n).padStart(5)} bbox x[${f(e.lo[0])},${f(e.hi[0])}] y[${f(e.lo[1])},${f(e.hi[1])}] z[${f(e.lo[2])},${f(e.hi[2])}] centroid (${f(e.s[0] / e.n)},${f(e.s[1] / e.n)},${f(e.s[2] / e.n)})`);
// palm-region extent
let lo = [9, 9, 9], hi = [-9, -9, -9]; for (const v of hand) if (side * pos[v * 3] <= xk) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[v * 3 + a]); hi[a] = Math.max(hi[a], pos[v * 3 + a]); }
console.log(`palm region (|x| in 0.6..${xk}): x[${f(lo[0])},${f(hi[0])}] y[${f(lo[1])},${f(hi[1])}] z[${f(lo[2])},${f(hi[2])}]`);
