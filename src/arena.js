// A deliberately tiny stone arena: tiled floor, a few pillars, crates, two torches. Static physics colliders go into the knight's world.
import * as THREE from '#three';

function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#26231f';
  x.fillRect(0, 0, 512, 512);
  const n = 4, s = 512 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 58 + Math.random() * 24;
    x.fillStyle = `rgb(${v + 10},${v + 5},${v - 6})`;
    x.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
  }
  for (let k = 0; k < 9000; k++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.07})`;
    x.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const ARENA_R = 12; // radius of the tiled platform (m); an invisible wall keeps everybody on it

export function buildArena(scene, knight) {
  const R = knight.RAPIER, group = new THREE.Group(), torches = [];
  scene.add(group);
  const stone = new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.92, metalness: 0 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85, metalness: 0 });
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // floor: tiled platform + dark ground around it (the physics floor is one big flat slab at y = 0)
  const tex = stoneTexture();
  tex.repeat.set(ARENA_R * 0.875, ARENA_R * 0.875);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  group.add(floor);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; ground.receiveShadow = true;
  group.add(ground);

  // a low stone curb at the edge + an invisible wall just outside it (a runner must not leave the platform)
  const curb = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R + 0.15, ARENA_R + 0.15, 0.22, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 0.95, side: THREE.DoubleSide }));
  curb.position.y = 0.11; curb.castShadow = curb.receiveShadow = true;
  group.add(curb);
  const SEG = 36, half = (ARENA_R + 0.4) * Math.tan(Math.PI / SEG) + 0.05;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, r = ARENA_R + 0.4;
    knight.addStatic(R.ColliderDesc.cuboid(half, 1.5, 0.4).setTranslation(Math.sin(a) * r, 1.5, Math.cos(a) * r).setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }));
  }

  // pillars in an arc behind the knight
  for (let i = 0; i < 5; i++) {
    const a = THREE.MathUtils.degToRad(-72 + i * 36), r = 6, x = Math.sin(a) * r - 0.6, z = -Math.cos(a) * r + 0.8;
    const h = i === 1 ? 1.9 : 3.3;
    add(new THREE.BoxGeometry(1.0, 0.3, 1.0), stone, x, 0.15, z);
    add(new THREE.CylinderGeometry(0.36, 0.42, h, 20), stone, x, 0.3 + h / 2, z);
    if (i !== 1) add(new THREE.BoxGeometry(1.0, 0.28, 1.0), stone, x, 0.3 + h + 0.14, z);
    knight.addStatic(R.ColliderDesc.cylinder((h + 0.3) / 2, 0.42).setTranslation(x, (h + 0.3) / 2, z));
  }
  // crates
  for (const [x, z, s, ry] of [[3.4, -1.6, 0.8, 0.4], [3.9, -0.7, 0.55, -0.2], [-3.6, -0.9, 0.7, 0.9]]) {
    add(new THREE.BoxGeometry(s, s, s), wood, x, s / 2, z, ry);
    knight.addStatic(R.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setTranslation(x, s / 2, z).setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) }));
  }
  // torches
  for (const [x, z] of [[-3.1, -4.4], [3.4, -4.3]]) {
    add(new THREE.CylinderGeometry(0.04, 0.05, 1.5, 8), wood, x, 0.75, z);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffb04a }));
    flame.position.set(x, 1.6, z);
    const light = new THREE.PointLight(0xff9a3c, 14, 9, 1.6);
    light.position.set(x, 1.7, z);
    group.add(flame, light);
    torches.push({ flame, light, base: light.intensity, seed: Math.random() * 10 });
  }
  return { group, update(t) { for (const k of torches) { const f = 0.85 + 0.15 * Math.sin(t * 9 + k.seed) * Math.sin(t * 5.3 + k.seed * 2); k.light.intensity = k.base * f; k.flame.scale.setScalar(0.9 + 0.2 * f); } } };
}
