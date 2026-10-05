// The isometric camera: orthographic, 45 degrees around, 35.26 degrees above the ground (equal x / y / z offsets = true isometric), following the player.
// pick(): the ground point under a screen position (click-to-move).
import * as THREE from '#three';

const V3 = THREE.Vector3;
export function makeIso(domElement) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300), dir = new V3(1, 1, 1).normalize(), target = new V3(), ray = new THREE.Raycaster(), plane = new THREE.Plane(new V3(0, 1, 0), 0), hit = new V3();
  let viewH = 9; // metres from the bottom to the top of the screen (the wheel zooms)
  const iso = {
    camera, target, forward: new V3(-1, 0, -1).normalize(), // "up the screen" on the ground
    resize() { const a = innerWidth / innerHeight; camera.left = (-viewH * a) / 2; camera.right = (viewH * a) / 2; camera.top = viewH / 2; camera.bottom = -viewH / 2; camera.updateProjectionMatrix(); },
    zoom(f) { viewH = Math.min(24, Math.max(5, viewH * f)); iso.resize(); },
    follow(p, dt, snap = false) { target.lerp(new V3(p.x, 0.6, p.z), snap ? 1 : Math.min(1, dt * 4)); camera.position.copy(target).addScaledVector(dir, 80); camera.lookAt(target); },
    pick(cx, cy) { ray.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera); return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; },
  };
  domElement.addEventListener('wheel', (e) => { e.preventDefault(); iso.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  iso.resize();
  return iso;
}
