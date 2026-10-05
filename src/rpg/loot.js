// Dropped loot: coins and loot bags. They are placeholder shapes until you add your own models: put `coin.glb` and / or `lootbag.glb` next to index.html and set their names in CFG.lootModels (config.js); they are
// loaded (origin at the bottom of the model, roughly 0.25 m for the coin and 0.4 m for the bag; they spin / bob by themselves).
// The mechanics: a hop out of the corpse, then a magnet pulls the loot to the player within CFG.drops.magnet, and it is picked up within CFG.drops.pickup.
import * as THREE from '#three';
import { CFG } from './config.js';

export async function loadLootModels(GLTFLoader) { // CFG.lootModels = { coin: 'coin.glb', bag: 'lootbag.glb' }: a name set there is loaded, null = the placeholder shape
  const out = {};
  for (const [k, file] of Object.entries(CFG.lootModels)) {
    if (!file) continue;
    try { out[k] = (await new GLTFLoader().loadAsync(file)).scene; } catch { /* missing / broken file: placeholder */ }
  }
  return out;
}

export class Loot {
  constructor(scene, models = {}) {
    this.scene = scene; this.models = models; this.items = [];
    this.coinGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.035, 16); this.coinMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.9, roughness: 0.3, emissive: 0x553300, emissiveIntensity: 0.6 });
    this.bagGeo = new THREE.SphereGeometry(0.2, 14, 10); this.bagMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
  }
  mesh(kind) {
    if (this.models[kind]) return this.models[kind].clone(true);
    if (kind === 'coin') { const m = new THREE.Mesh(this.coinGeo, this.coinMat); m.rotation.x = Math.PI / 2; const g = new THREE.Group(); g.add(m); return g; }
    const g = new THREE.Group(), b = new THREE.Mesh(this.bagGeo, this.bagMat), knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.bagMat);
    b.scale.y = 0.85; b.position.y = 0.17; knot.position.y = 0.4; g.add(b, knot); return g;
  }
  // kind: 'coin' (data = value) | 'bag' (data = { scrap: n, ... })
  spawn(kind, x, z, data) {
    const mesh = this.mesh(kind); mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mesh.position.set(x, 0.3, z); this.scene.add(mesh);
    const a = Math.random() * Math.PI * 2, v = 1.2 + Math.random() * 1.6;
    this.items.push({ kind, data, mesh, t: 0, vx: Math.cos(a) * v, vz: Math.sin(a) * v, y: 0.3, vy: 3.2 + Math.random() });
  }
  update(dt, pp, collect) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i], m = it.mesh; it.t += dt;
      if (it.vy !== 0 || it.y > 0.06) { // the hop
        it.vy -= 12 * dt; it.y += it.vy * dt; m.position.x += it.vx * dt; m.position.z += it.vz * dt; it.vx *= 1 - 3 * dt; it.vz *= 1 - 3 * dt;
        if (it.y <= 0.06) { it.y = 0.06; it.vy = 0; }
        m.position.y = it.y;
      } else m.position.y = 0.06 + 0.04 * Math.sin(it.t * 4 + i);
      m.rotation.y += dt * (it.kind === 'coin' ? 3 : 1);
      const dx = pp.x - m.position.x, dz = pp.z - m.position.z, d = Math.hypot(dx, dz);
      if (it.t > 0.5 && d < CFG.drops.magnet && d > 1e-3) { const s = Math.min(d, (3 + 9 * (1 - d / CFG.drops.magnet)) * dt); m.position.x += (dx / d) * s; m.position.z += (dz / d) * s; }
      if ((it.t > 0.4 && d < CFG.drops.pickup) || it.t > CFG.drops.lifetime) { if (d < CFG.drops.pickup) collect(it); this.scene.remove(m); this.items.splice(i, 1); }
    }
  }
  clear() { for (const it of this.items) this.scene.remove(it.mesh); this.items.length = 0; }
}
