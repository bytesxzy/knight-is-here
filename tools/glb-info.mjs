// Overview of a GLB: meshes (vertices, bounds), skins (bone count + hierarchy with world positions in the bind pose), textures. node tools/glb-info.mjs model.glb [bones]
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]), jsonLen = buf.readUInt32LE(12), gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const f = (v) => v.map((x) => x.toFixed(3)).join(', ');
console.log(`${process.argv[2]}: ${(buf.length / 1e6).toFixed(1)} MB; nodes ${gltf.nodes.length}, meshes ${gltf.meshes?.length}, skins ${gltf.skins?.length}, materials ${gltf.materials?.length}, textures ${gltf.textures?.length}, images ${gltf.images?.length}, animations ${gltf.animations?.length ?? 0}`);
const acc = gltf.accessors;
for (const [i, m] of (gltf.meshes ?? []).entries()) for (const p of m.primitives) { const a = acc[p.attributes.POSITION]; console.log(`mesh ${i} "${m.name}": ${a.count} verts, ${p.indices !== undefined ? acc[p.indices].count / 3 : '?'} tris, bounds min (${f(a.min)}) max (${f(a.max)}), skinned ${p.attributes.JOINTS_0 !== undefined}`); }
for (const [i, im] of (gltf.images ?? []).entries()) console.log(`image ${i}: ${im.mimeType} ${gltf.bufferViews[im.bufferView]?.byteLength ?? '?'} bytes`);
// world transforms of the nodes (T-pose), parents
const parent = new Array(gltf.nodes.length).fill(-1); gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const local = (n) => { if (n.matrix) return n.matrix; const t = n.translation ?? [0, 0, 0], q = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1], [x, y, z, w] = q; const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1]; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c]; return m; };
const world = (i) => { const l = local(gltf.nodes[i]); return parent[i] < 0 ? l : mul(world(parent[i]), l); };
for (const [si, sk] of (gltf.skins ?? []).entries()) {
  console.log(`skin ${si}: ${sk.joints.length} joints`);
  if (process.argv.includes('bones')) { const depth = (i) => { let d = 0; for (let p = parent[i]; p >= 0 && sk.joints.includes(p); p = parent[p]) d++; return d; };
    for (const j of sk.joints) { const m = world(j), n = gltf.nodes[j]; console.log(`${'  '.repeat(depth(j))}${n.name} at (${f([m[12], m[13], m[14]])}) scale ${f(n.scale ?? [1, 1, 1])}`); } }
}
const sc = gltf.nodes.filter((n) => n.scale && n.scale.some((x) => Math.abs(x - 1) > 1e-4)).slice(0, 5); if (sc.length) console.log('nodes with scale != 1:', sc.map((n) => n.name + ' ' + f(n.scale)).join(' | '));
