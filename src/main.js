// App: scene, lighting, UI and the main loop. Physics + animation live in knight.js / ghost.js / walk.js; the three characters (the knight, the skeleton, the
// robot) share one physics world. You drive one of them, the others are NPCs (npc.js): neutral until somebody hits them, then they fight back.
import * as THREE from '#three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Knight, Sim, STEP } from './knight.js';
import { worldPose } from './ghost.js';
import { SkinBinder } from './skin.js';
import { buildArena, ARENA_R } from './arena.js';
import { SwordVisual, TUNE, rebuild, SWORD_COMBO, SWORD_SPECIALS } from './sword.js';
import { LABELS } from './attack.js';
import { KNIGHT, SKELETON, ROBOT } from './rigs.js';
import { NpcAI } from './npc.js';
import { Combat } from './combat.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const V3 = THREE.Vector3;
// the cast: spec, model file, where it stands in the arena (x, z); the NPCs face the knight
const CAST = [
  { spec: KNIGHT, glb: 'Untitled.glb', at: [0, 0] },
  { spec: SKELETON, glb: 'skeleton.glb', at: [-2.9, 1.5] },
  { spec: ROBOT, glb: 'robot.glb', at: [2.8, 2.1] },
];

async function main() {
  const status = $('loading');
  const film = params.has('film'), filmRig = params.get('rig') ?? 'knight'; // film modes show one character: ?rig=skeleton | robot for the others
  const cast = CAST.filter((c) => !film || c.spec.name === filmRig);
  const pct = {}, show = () => { const v = Object.values(pct); status.textContent = `Loading models… ${Math.round(v.reduce((a, b) => a + b, 0) / cast.length)}%`; };
  const load = (c) => new GLTFLoader().loadAsync(c.glb, (e) => { if (e.total) { pct[c.spec.name] = (100 * e.loaded) / e.total; show(); } });
  const profiles = await Promise.all(cast.map((c) => fetch(c.spec.profile).then((r) => r.json())));
  const [gltfs, swordGltf] = await Promise.all([Promise.all(cast.map(load)), cast.some((c) => c.spec.sword) ? new GLTFLoader().loadAsync('sword and sword holder.glb') : null]);
  status.textContent = 'Starting physics…';
  let world = null;
  const bodies = [];
  for (const [i, c] of cast.entries()) { const ch = await Knight.create(profiles[i], c.spec, world); world ??= ch.world; bodies.push(ch); }
  const dirs = [new V3(0, 0.12, 1), new V3(0, 0.12, -1), new V3(1, 0.1, 0.25), new V3(-1, 0.1, 0.25)]; // push directions for knock-downs

  // ---- renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = 0.85;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1014);
  scene.fog = new THREE.Fog(0x0e1014, 10, 34);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0x90a4c8, 0x2a2118, 0.4));
  const sun = new THREE.DirectionalLight(0xffe2bd, 2.5);
  sun.position.set(4, 8, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 22 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(3.6, 1.8, 4.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.8, 0.6);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.5; controls.maxDistance = 14;

  const arena = buildArena(scene, bodies[0]);

  // ---- the characters: physics body + skinned mesh (+ the knight's sword). rec.P / rec.Q = the interpolated pose to draw.
  const chars = [];
  const makeChar = (ch, gltf, profile, spawn) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; for (const t of ['map', 'normalMap', 'metalnessMap', 'roughnessMap']) if (o.material[t]) o.material[t].anisotropy = 8; } });
    const rec = { ch, name: ch.spec.name, skin: new SkinBinder(gltf.scene, ch.rig, profile), P: ch.b.map((b) => b.rp), Q: ch.b.map((b) => b.rq), spawn, sv: null, colView: null, ai: null };
    if (ch.spec.sword) { // the two unskinned meshes: the bigger one is the holder, the other the sword
      const parts = []; swordGltf.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
      parts.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
      rec.sv = new SwordVisual(scene, parts[0], parts[1], ch.sword, ch.rig);
    }
    if (params.has('col')) { // debug: ?col=1 draws the self-collision shapes (wireframe) on the characters
      const mat = new THREE.MeshBasicMaterial({ color: ch.spec.name === 'knight' ? 0x33ffcc : ch.spec.name === 'robot' ? 0x66aaff : 0xff7744, wireframe: true, transparent: true, opacity: 0.6, depthTest: false });
      const items = ch.rig.bodies.map((b) => {
        const f = b.prox, geo = f.shape === 'capsule' ? new THREE.CapsuleGeometry(f.r, 2 * f.hh, 4, 10) : f.shape === 'ball' ? new THREE.SphereGeometry(f.r, 12, 8) : new THREE.BoxGeometry(2 * f.h[0], 2 * f.h[1], 2 * f.h[2]);
        const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 10; scene.add(mesh);
        return { mesh, c: new V3(...f.c), q: f.shape === 'capsule' ? new THREE.Quaternion(...f.q) : new THREE.Quaternion() };
      });
      rec.colView = (P, Q) => items.forEach((it, i) => { it.mesh.position.copy(it.c).applyQuaternion(Q[i]).add(P[i]); it.mesh.quaternion.copy(Q[i]).multiply(it.q); });
    }
    ch.reset(spawn.x, spawn.z, spawn.psi);
    chars.push(rec);
    return rec;
  };
  const fist = params.has('fist') ? +params.get('fist') : null; // debug: &fist=0..1 forces the fingers' curl
  const poseChar = (rec, P, Q, dt) => { const ch = rec.ch; rec.skin.curl.R = fist ?? ch.sword.curl('R'); rec.skin.curl.L = fist ?? ch.sword.curl('L'); rec.skin.apply(P, Q); if (rec.sv) rec.sv.update(P, Q, dt); if (rec.colView) rec.colView(P, Q); };
  cast.forEach((c, i) => {
    const x = film ? 0 : c.at[0], z = film ? 0 : c.at[1];
    makeChar(bodies[i], gltfs[i], profiles[i], { x, z, psi: film || c.spec.name === 'knight' ? 0 : Math.atan2(-x, -z) });
  });
  for (const rec of chars) poseChar(rec, rec.P, rec.Q, Infinity);
  const byName = Object.fromEntries(chars.map((r) => [r.name, r])), K = byName.knight, S = byName.skeleton, R = byName.robot;
  const knight = K?.ch, skeleton = S?.ch, robot = R?.ch;
  const sim = new Sim(world, chars.map((r) => r.ch));
  const combat = new Combat(chars.map((r) => r.ch)); // who hits whom (punches, sword, claws): checked after every physics step
  sim.after.push(() => combat.update());
  let shake = 0; // screen shake (px) after a landed hit

  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  status.hidden = true;

  if (params.has('hide') && K) { K.sv.holder.visible = false; K.sv.sword.visible = false; } // debug: look at the belt without the sword
  window.__app = { knight, skeleton, robot, chars, byName, sim, camera, controls, scene, THREE, renderer, skin: chars[0].skin, swordView: K?.sv, mesh: chars[0].skin.mesh, combat }; // test hooks
  if (film) return filmstrip(params.get('film'), chars[0]);

  // ---- UI. `ctl` = the character the keyboard / buttons / slider drive. Every other character is an NPC (neutral until it is hit).
  $('ui').hidden = false;
  let ctl = K ?? chars[0], demo = !!K;
  for (const r of chars) r.ai = new NpcAI(r.ch, chars.map((x) => x.ch));
  const ctlRow = $('ctlRow'); ctlRow.textContent = '';
  const rag = $('rag');
  const setRag = () => { ctl.ch.ragdoll = rag.value / 100; $('ragv').textContent = rag.value + '%'; };
  rag.addEventListener('input', setRag);
  const selectChar = (rec) => {
    if (!rec) return;
    ctl = rec; rag.value = Math.round(rec.ch.ragdoll * 100); $('ragv').textContent = rag.value + '%';
    for (const r of chars) r.btn.classList.toggle('on', r === rec);
    keys.clear(); mouseHeld = false; movesSig = '';
    for (const r of chars) { r.ch.walk.command(null, 0); r.ch.sword.attackHeld = false; r.ai.release(); }
  };
  for (const r of chars) { const b = document.createElement('button'); b.textContent = 'Play: ' + r.name[0].toUpperCase() + r.name.slice(1); b.onclick = () => selectChar(r); r.btn = b; ctlRow.append(b); }
  ctlRow.hidden = chars.length < 2; $('aiRow').hidden = chars.length < 2;
  let dirIdx = 1;
  $('knock').onclick = () => ctl.ch.knockDown(dirs[dirIdx++ % dirs.length], ctl.name === 'knight' ? 130 : 150);
  $('reset').onclick = () => { for (const r of chars) { r.ch.reset(r.spawn.x, r.spawn.z, r.spawn.psi); r.ai.reset(); } demo = false; };
  $('getup').onclick = () => { if (ctl.ch.state === 'fall') ctl.ch.beginGetUp(); };
  let wantToggle = 0; // F while walking: he stops first, then draws / sheathes
  let mouseHeld = false, movesSig = '', lastAtk = -9;
  const toggleSword = () => { const sw = ctl.ch.sword; if (!ctl.ch.spec.sword) return; if (!sw.toggle() && ctl.ch.walk.moving) wantToggle = clock + 3; };
  const keys = new Set(), fwd = new V3(), right = new V3();
  const inputDir = () => { // WASD / arrows relative to the camera view -> a world direction (null = no input)
    const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const iz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    if (!ix && !iz) return null;
    fwd.subVectors(controls.target, camera.position).setY(0).normalize();
    right.set(-fwd.z, 0, fwd.x);
    return new V3().addScaledVector(fwd, iz).addScaledVector(right, ix).normalize();
  };
  // ---- the controls (the same on every character; the moves behind the keys differ):
  //   mouse: LEFT click = the light attack (hold = the combo keeps going), RIGHT drag = orbit, wheel = zoom
  //   E = heavy attack, Q / R = special moves, F = a third special (the knight: draw / sheathe the sword), Space = jump (robot) / guard up (hold)
  const L0 = () => ctl.ch.sword, FX = () => L0().fists ?? L0(), nm = (k) => LABELS[k] ?? SW_LABELS[k] ?? k;
  const SW_LABELS = { slash: 'Forehand cut', back: 'Backhand cut', chop: 'Overhead chop', thrust: 'Lunging thrust', rise: 'Rising cut' };
  const stamp = () => { lastAtk = clock; };
  const act = {
    jump: () => ctl.ch.jump?.request(inputDir(), 1),
    light: () => { stamp(); return L0().attack(false); }, heavy: () => { stamp(); return L0().attack(true); },
    special: (key) => { stamp(); return L0().special?.(key); },
    f: () => (ctl.ch.spec.sword ? toggleSword() : act.special('F')),
  };
  // the move list of whoever is driven right now: [key, label, action]
  const moveRows = () => {
    const ch = ctl.ch, L = L0(), fx = FX(), drawn = !!(ch.spec.sword && L.drawn), st = fx.style ?? {}, rows = [];
    const combo = drawn ? SWORD_COMBO : (st.combo ?? []).map((c) => c[0]);
    rows.push(['Click', 'Combo: ' + [...new Set(combo)].map(nm).join(' · '), act.light]);
    rows.push(['E', nm(drawn ? 'chop' : st.heavy ?? 'smash'), act.heavy]);
    for (const k of ['Q', 'R']) { const kind = drawn ? SWORD_SPECIALS[k] : st.specials?.[k]; if (kind) rows.push([k, nm(kind), () => act.special(k)]); }
    if (ch.spec.sword) rows.push(['F', drawn ? 'Sheathe sword' : 'Draw sword', act.f]); else if (st.specials?.F) rows.push(['F', nm(st.specials.F), act.f]);
    rows.push(['Space', ch.jump ? 'Jump (hold a direction to leap)' : 'Guard up (hold)', ch.jump ? act.jump : null]);
    return rows;
  };
  const buildMoves = () => {
    const sig = ctl.name + (ctl.ch.sword.drawn ? '+sword' : '');
    if (sig === movesSig) return;
    movesSig = sig; const box = $('moves'); box.textContent = '';
    for (const [key, label, fn] of moveRows()) {
      const b = document.createElement('button'); b.className = 'mv'; b.innerHTML = `<kbd>${key}</kbd> ${label}`;
      if (fn) b.onclick = fn; else b.disabled = true;
      box.append(b);
    }
  };
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
    if (!e.repeat) {
      if (e.code === 'KeyE') act.heavy();
      else if (e.code === 'KeyQ' || e.code === 'KeyR') act.special(e.code === 'KeyQ' ? 'Q' : 'R');
      else if (e.code === 'KeyF') act.f();
      else if (e.code === 'Space' && ctl.ch.jump) act.jump();
      else if (e.code === 'KeyJ') act.light();
      else if (e.code === 'Tab') { e.preventDefault(); selectChar(chars[(chars.indexOf(ctl) + 1) % chars.length]); }
    }
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouseHeld = false; });
  // the mouse: the left button attacks (a press = the light attack, held = the combo goes on); the right button orbits the camera
  const cv = renderer.domElement;
  controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0 && !e.ctrlKey) { mouseHeld = true; act.light(); } });
  addEventListener('pointerup', (e) => { if (e.button === 0) mouseHeld = false; });
  const foe = () => { // the nearest character still on its feet, within 5 m
    const P = ctl.P[0]; let best = null, bd = 5;
    for (const r of chars) if (r !== ctl && r.ch.state === 'stand') { const d = Math.hypot(r.P[0].x - P.x, r.P[0].z - P.z); if (d < bd) { bd = d; best = r; } }
    return best && { r: best, d: bd };
  };
  const steer = () => {
    const w = ctl.ch.walk, shift = keys.has('ShiftLeft') || keys.has('ShiftRight'), att = L0(), fx = FX();
    att.attackHeld = mouseHeld || keys.has('KeyJ'); // hold the attack button: the combo goes on (knight punches / swings, skeleton frenzy, robot pistons)
    if ('pin' in fx) fx.pin = keys.has('Space') && !ctl.ch.jump; // Space: keep the guard up
    const d = inputDir();
    if (!d && !wantToggle && ctl.ch.state === 'stand' && (att.swinging || att.attackHeld || clock - lastAtk < 0.8)) { // aim assist: while fighting and standing still, turn toward the nearest foe
      const f = foe();
      if (f) {
        const P = ctl.P[0], dir = new V3(f.r.P[0].x - P.x, 0, f.r.P[0].z - P.z).normalize(), err = Math.abs(Math.atan2(Math.sin(Math.atan2(dir.x, dir.z) - ctl.ch.ghost.psi), Math.cos(Math.atan2(dir.x, dir.z) - ctl.ch.ghost.psi)));
        if (err > 0.12) return w.command(dir, f.d > 1.1 ? 0.3 : 0.07);
      }
    }
    if (!d || wantToggle) return w.command(null, 0);
    w.command(d, shift && !w.canRun ? w.slowThrottle : 1, shift && w.canRun); // Shift: slow (knight) / run (skeleton, robot)
  };
  $('auto').onchange = (e) => { for (const r of chars) r.ch.autoGetUp = e.target.checked; };
  $('ai').onchange = (e) => { for (const r of chars) { r.ai.enabled = e.target.checked; if (!e.target.checked) r.ai.release(); } };
  const label = { fall: 'ragdoll · limp', getup: 'getting up…', stand: 'standing' }, cap = (s) => s[0].toUpperCase() + s.slice(1);
  setInterval(() => {
    const ch = ctl.ch, sw = ch.sword, j = ch.jump;
    $('state').textContent = ctl.name + ': ' + label[ch.state] + (j?.active ? ' · jumping' : ch.walk.moving ? (ch.walk.gait > 0.5 ? ' · running' : ' · walking') : '') + (sw.busy ? (sw.dir > 0 ? ' · drawing sword' : ' · sheathing sword') : sw.drawn ? ' · sword drawn' : '') + (sw.swinging ? (sw.drawn ? ' · swinging' : ch.spec.sword ? ' · punching' : ' · attacking') : '');
    $('npcs').textContent = chars.filter((r) => r !== ctl).map((r) => `${cap(r.name)}: ${r.ch.state !== 'stand' ? 'down' : r.ai.enabled ? r.ai.label : 'off'}`).join(' · ');
    buildMoves();
  }, 120);
  $('ui').addEventListener('pointerup', () => setTimeout(() => document.activeElement?.blur?.(), 0)); // (a focused button / checkbox / slider would also react to Space / arrow keys)
  selectChar(ctl);

  // ctrl+click / tap a character to shove it (shift = hard hit). Shoving counts as attacking it.
  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    if (e.pointerType === 'mouse' && !e.ctrlKey) { down = null; return; } // (a mouse click attacks; ctrl+click / a touch tap shoves the character under the pointer)
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), held = performance.now() - down.t;
    down = null;
    if (moved > 5 || held > 400) return;
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    let best = null;
    for (const r of chars) { const hit = r.ch.pick(ray.ray.origin, ray.ray.direction); if (hit) { const d = hit.point.distanceTo(ray.ray.origin); if (!best || d < best.d) best = { ...hit, d, r }; } }
    if (!best) return;
    const push = ray.ray.direction.clone().setY(0).normalize().add(new V3(0, 0.1, 0)).normalize().multiplyScalar(e.shiftKey ? 320 : 150);
    if (e.shiftKey) best.r.ch.goLimp(); // a hard hit knocks the wind (and the balance) out of him
    best.r.ch.shove(best.rb, best.point, push);
    if (best.r !== ctl) { best.r.ai.provoke(ctl.ch, !!e.shiftKey); best.r.ai.hurt(!!e.shiftKey); }
  });

  combat.onHit = (e) => {
    const victim = chars.find((r) => r.ch === e.tgt), attacker = chars.find((r) => r.ch === e.att);
    if (attacker && attacker !== ctl) attacker.ai.hits++;
    if (victim && victim !== ctl) { victim.ai.provoke(e.att, e.heavy); victim.ai.hurt(e.heavy); } // an NPC that is hit turns on whoever did it (and staggers)
    shake = Math.max(shake, e.heavy ? 16 : 7);
  };
  // ---- loop. The demo: the knight stands for a moment, gets knocked over, lies there, gets up (the NPCs are neutral: they leave him alone).
  let last = performance.now(), clock = 0;
  const sunOff = new V3(4, 8, 3), sunGoal = new V3(), texel = 8 / 2048;
  const tick = (dt) => {
    clock += dt;
    if (demo && clock > 1.2) { demo = false; K.ch.knockDown(dirs[0], 130); }
    for (const r of chars) r.ai.update(dt, r === ctl);
    steer();
    if (wantToggle && (clock > wantToggle || ctl.ch.state !== 'stand')) wantToggle = 0;
    else if (wantToggle && ctl.ch.walk.mode === 'idle' && ctl.ch.walk.w < 0.05) { wantToggle = 0; ctl.ch.sword.toggle(); }
    sim.update(dt);
    for (const r of chars) { if (Math.hypot(r.P[0].x, r.P[0].z) > ARENA_R + 1) r.ch.reset(r.spawn.x, r.spawn.z, r.spawn.psi); } // safety net: never wander off the platform
    for (const r of chars) poseChar(r, r.P, r.Q, dt);
    arena.update(clock);
    shake *= Math.exp(-dt * 14); renderer.domElement.style.transform = shake > 0.4 ? `translate(${((Math.random() - 0.5) * shake).toFixed(1)}px, ${((Math.random() - 0.5) * shake).toFixed(1)}px)` : '';
    // gently follow the controlled character (move camera and target together so the view doesn't swing)
    const P0 = ctl.P[0], moving = ctl.ch.walk.moving;
    const follow = new V3(P0.x, 0.8 + 0.5 * Math.max(0, P0.y - 1.0), P0.z + 0.15).sub(controls.target).multiplyScalar(Math.min(1, dt * (moving ? 3.5 : 1.5)));
    controls.target.add(follow); camera.position.add(follow);
    // the shadow camera follows in whole shadow-map texels, so the shadow edges don't swim while he walks
    sunGoal.lerp(new V3(P0.x, 0, P0.z), Math.min(1, dt * 3));
    const sr = new V3().crossVectors(new V3(0, 1, 0), sunOff).normalize(), su = new V3().crossVectors(sunOff, sr).normalize(), a = sunGoal.dot(sr), b = sunGoal.dot(su);
    sun.target.position.copy(sunGoal).addScaledVector(sr, Math.round(a / texel) * texel - a).addScaledVector(su, Math.round(b / texel) * texel - b);
    sun.position.copy(sun.target.position).add(sunOff);
    controls.update();
  };
  renderer.setAnimationLoop((now) => {
    tick(Math.min(0.05, (now - last) / 1000));
    last = now;
    renderer.render(scene, camera);
  });
  // test hook: advance the simulation by `sec` seconds without waiting for animation frames (e.g. when the tab is hidden)
  Object.assign(window.__app, { advance(sec) { for (let i = 0; i < sec * 60; i++) tick(1 / 60); renderer.render(scene, camera); }, select: selectChar, act });
  Object.defineProperty(window.__app, 'ctl', { get: () => ctl });

  // ---- debug filmstrips (?film=ghost | ?film=sim | walk | walksim | sword | swordsim | grip; &rig=skeleton for the skeleton): one image showing the whole sequence, rendered without the UI
  function filmstrip(kind, rec) {
    const knight = rec.ch, poseKnight = (P, Q, dt) => poseChar(rec, P, Q, dt);
    $('ui').hidden = true;
    renderer.setAnimationLoop(null);
    const frames = [];
    if (kind === 'ghost') {
      const g = knight.ghost;
      g.begin(null, new V3(0, 0, 0), 0, 0);
      for (const t of g.keys.map((k) => k.t).concat([12.5])) {
        const p = g.evaluate(t), w = worldPose(knight.rig, p.rootP, p.rootQ, p.ql);
        frames.push({ label: `ghost t=${t.toFixed(1)}`, P: w.P, Q: w.Q });
      }
    } else if (kind === 'grip') { // right hand in the T-pose holding the sword; ?gh=x,y,z &roll= tune the grip
      if (params.has('gh')) TUNE.gripHand = params.get('gh').split(',').map(Number);
      if (params.has('roll')) TUNE.gripRoll = +params.get('roll');
      rebuild(); knight.sword.p = 1; knight.sword.act = 1;
      const P = knight.rig.bodies.map((b) => b.anchor.clone()), Q = knight.rig.bodies.map(() => new THREE.Quaternion());
      for (let i = 0; i < 3; i++) frames.push({ label: ['above', 'front', 'inside'][i], P, Q, p: 1, grip: i });
    } else if (kind === 'swordsim') { // physics-driven draw (or ?sheathe=1: draw first, then sheathe), captured at progress marks
      knight.reset(); const L = knight.sword, down = params.has('sheathe');
      const marks = (params.get('ps') ?? (down ? '0.9,0.7,0.55,0.4,0.25,0.1' : '0.1,0.25,0.35,0.5,0.62,0.8,1')).split(',').map(Number);
      let phase = 0, mi = 0;
      for (let s = 1; s <= 30 * 120 && mi < marks.length; s++) {
        if (s === 360) { L.request(true); phase = 1; }
        if (down && phase === 1 && L.p >= 1 && !L.busy && L.act > 0.99) { for (let k = 0; k < 120; k++) knight.step(); L.request(false); phase = 2; }
        knight.step();
        if ((down ? phase === 2 : phase === 1) && (down ? L.p <= marks[mi] : L.p >= marks[mi])) {
          knight.readState(); frames.push({ label: `physics p=${L.p.toFixed(2)}`, P: knight.b.map((b) => b.p.clone()), Q: knight.b.map((b) => b.q.clone()), p: L.p }); mi++;
        }
      }
    } else if (kind === 'walk' || kind === 'walksim') { // gait filmstrip: kinematic (ghost only) or physics-driven; &sword=1 with the sword drawn, &thr= speed 0..1
      const W = knight.walk, L = knight.sword, g = knight.ghost, sim1 = kind === 'walksim', dt = 1 / 120;
      knight.reset();
      if (params.has('sword')) { L.act = 1; L.p = 1; }
      const thr = +(params.get('thr') ?? 1), n = +(params.get('n') ?? 8);
      const grab = (label) => {
        let P, Q;
        if (sim1) { knight.readState(); P = knight.b.map((b) => b.p.clone()); Q = knight.b.map((b) => b.q.clone()); }
        else { const e = g.evaluate(g.duration + 1), w = worldPose(knight.rig, e.rootP, e.rootQ, e.ql); P = w.P; Q = w.Q; }
        frames.push({ label, P, Q, p: L.p });
      };
      const tick1 = () => { if (sim1) knight.step(); else { L.step(dt, true); g.layer = L.act > 0.001 ? L : null; W.step(dt, null); } };
      for (let s = 0; s < 120; s++) tick1();
      W.command(new V3(0, 0, 1), thr, params.has('run'));
      for (let s = 0; s < 120 * 4; s++) tick1();
      if (params.has('swing')) { L.frenzy = true; if (params.has('kinds')) L.style.only = params.get('kinds'); } // the skeleton's savage swings (&kinds=slash|hook|smash)
      const gap = params.has('dt') ? Math.round(+params.get('dt') * 120) : Math.round((W.T * 120) / n);
      for (let i = 0; i < n; i++) { grab(`${kind} ${params.has('dt') ? (i * +params.get('dt')).toFixed(2) + 's' : (i / n).toFixed(2)}`); for (let s = 0; s < gap; s++) tick1(); }
    } else if (kind === 'jump') { // the jump, physics-driven: &dir=up|leap|run (leap = toward +z, run = running jump) &dt= &n= &skip=
      const J = knight.jump, dt = 1 / 120, n = +(params.get('n') ?? 8), gap = Math.round(+(params.get('dt') ?? 0.1) * 120), mode = params.get('dir') ?? 'up';
      knight.reset();
      for (let s = 0; s < 240; s++) knight.step();
      if (mode === 'run') { knight.walk.command(new V3(0, 0, 1), 1, true); for (let s = 0; s < 360; s++) knight.step(); }
      J.request(mode === 'leap' ? new V3(0, 0, 1) : null);
      for (let s = 0; s < Math.round(+(params.get('skip') ?? 0) * 120); s++) knight.step();
      for (let i = 0; i < n; i++) {
        knight.readState(); frames.push({ label: `jump ${J.phase} ${(i * gap * dt + +(params.get('skip') ?? 0)).toFixed(2)}s`, P: knight.b.map((b) => b.p.clone()), Q: knight.b.map((b) => b.q.clone()) });
        for (let s = 0; s < gap; s++) knight.step();
      }
    } else if (kind === 'attack') { // the character's attack moves, physics-driven: &mode=punch|sword (knight; the skeleton always swings) &heavy=1 &hold=1 (keep attacking) &dt= &n=
      const L = knight.sword, sword = params.get('mode') === 'sword', heavy = params.has('heavy'), dt = 1 / 120, n = +(params.get('n') ?? 8), gap = Math.round(+(params.get('dt') ?? 0.07) * 120);
      knight.reset();
      for (let s = 0; s < 120; s++) knight.step();
      if (sword && L.request) { L.request(true); for (let s = 0; s < 5 * 120; s++) knight.step(); }
      for (let s = 0; s < Math.round(+(params.get('pre') ?? 0) * 120); s++) knight.step();
      if (params.has('pin')) (L.fists ?? L).pin = true; // &pin=1: the guard stays up (&noatk=1: no attack at all: look at the stance)
      if (params.has('kind')) { const kd = params.get('kind'); if (sword) L.swordSwing(kd, true); else (L.fists ?? L).swing(kd, params.get('side'), true); } // &kind=uppercut (a named move) / &key=Q (a special button)
      else if (params.has('key')) L.special(params.get('key'));
      else if (!params.has('noatk')) L.attack(heavy);
      if (params.has('hold')) L.attackHeld = true;
      for (let s = 0; s < Math.round(+(params.get('skip') ?? 0) * 120); s++) knight.step(); // &skip=seconds: start the strip this long after the button press
      for (let i = 0; i < n; i++) {
        knight.readState(); frames.push({ label: `${params.get('mode') ?? 'attack'}${heavy ? ' heavy' : ''} ${(i * gap * dt).toFixed(2)}s`, P: knight.b.map((b) => b.p.clone()), Q: knight.b.map((b) => b.q.clone()), p: L.p });
        for (let s = 0; s < gap; s++) knight.step();
      }
    } else if (kind === 'sword') {
      const g = knight.ghost, L = knight.sword;
      g.begin(null, new V3(0, 0, 0), 0, 0); g.layer = L; L.act = 1;
      for (const p of (params.get('ps') ?? '0,0.15,0.3,0.42,0.54,0.66,0.78,1').split(',').map(Number)) {
        L.p = p;
        const e = g.evaluate(g.duration + 1), w = worldPose(knight.rig, e.rootP, e.rootQ, e.ql);
        frames.push({ label: `sword p=${p}`, P: w.P, Q: w.Q, p });
      }
    } else {
      const marks = [0.5, 1.5, 2.4, 3.6, 5.2, 6.4, 7.4, 8.4, 9.6, 12.0, 14.0, 16.0].filter((_, i) => params.get('n') === null || i < +params.get('n'));
      knight.reset();
      const dir = dirs[+(params.get('dir') ?? 0)];
      for (let s = 1; s <= 16 * 120; s++) {
        if (s === 120) knight.knockDown(dir, 130);
        knight.step();
        const t = s * STEP, m = marks.findIndex((x) => Math.abs(x - t) < STEP / 2);
        if (m >= 0) { knight.readState(); frames.push({ label: `t=${t.toFixed(1)}s ${knight.state}`, P: knight.b.map((b) => b.p.clone()), Q: knight.b.map((b) => b.q.clone()) }); }
      }
    }
    const cols = kind.startsWith('sword') || kind.startsWith('walk') || kind === 'grip' || kind === 'attack' || kind === 'jump' ? Math.min(4, frames.length) : Math.min(6, frames.length), rows = Math.ceil(frames.length / cols), W = innerWidth / cols, H = innerHeight / rows;
    renderer.setScissorTest(true);
    frames.forEach((f, i) => {
      const x = (i % cols) * W, y = innerHeight - (Math.floor(i / cols) + 1) * H;
      if (f.p !== undefined) knight.sword.p = f.p;
      poseKnight(f.P, f.Q, Infinity);
      const zc = f.P[0].z, xc = f.P[0].x;
      camera.aspect = W / H; camera.fov = 36; camera.updateProjectionMatrix();
      if (f.grip !== undefined) {
        const h = f.P[knight.rig.idx.handR], o = [[0.0, 0.40, 0.25], [-0.05, 0.05, 0.5], [0.45, 0.1, 0.1]][f.grip];
        camera.fov = 28; camera.updateProjectionMatrix(); camera.position.set(h.x - 0.07 + o[0], h.y + o[1], h.z + o[2]); camera.lookAt(h.x - 0.07, h.y, h.z + 0.02);
      } else if (kind.startsWith('sword') || kind.startsWith('walk') || kind === 'attack' || kind === 'jump') { // ?cam=dx,dy,dz&look=x,y,z (relative to the pelvis xz), ?fov=
        const c = (params.get('cam') ?? (kind === 'jump' ? '5.2,1.5,0.4' : kind === 'attack' ? '2.6,1.3,2.3' : kind.startsWith('walk') ? '3.4,1.05,0.2' : '1.5,1.3,2.9')).split(',').map(Number), l = (params.get('look') ?? (kind === 'jump' ? '0,1.1,0.2' : kind === 'attack' ? '0,1.0,0.35' : kind.startsWith('walk') ? '0,0.8,0.1' : '0.05,0.95,0.15')).split(',').map(Number);
        camera.fov = +(params.get('fov') ?? 36); camera.updateProjectionMatrix();
        camera.position.set(xc + c[0], c[1], zc + c[2]); camera.lookAt(xc + l[0], l[1], zc + l[2]);
      }
      else { camera.position.set(xc + 3.3, 1.5, zc + 3.4); camera.lookAt(xc, 0.62, zc); }
      sun.target.position.set(xc, 0, zc); sun.position.set(xc + 4, 8, zc + 3);
      renderer.setViewport(x, y, W, H); renderer.setScissor(x, y, W, H);
      renderer.render(scene, camera);
      const d = document.createElement('div');
      d.className = 'tag'; d.textContent = f.label; d.style.cssText = `left:${x + 6}px;top:${innerHeight - y - H + 4}px`;
      document.body.append(d);
    });
  }
}

main().catch((e) => { console.error(e); $('loading').hidden = false; $('loading').textContent = 'Error: ' + e.message; });
