// The RPG loop on top of the active-ragdoll engine: an isometric camera, click-to-move, 10 waves of weak skeletons (spawned a few at a time, with pathfinding), a health bar
// with knock-downs (HP empty = knocked down; a third knock-down eliminates you), coins + loot bags that save, a shop (the sword, upgrades, a robot ally you can buy or craft from
// materials). All numbers live in config.js. main.js builds the characters (a knight, the robot, a pool of skeletons) and hands them over.
import * as THREE from '#three';
import { CFG, waveSize, maxAlive } from './config.js';
import { loadSave, writeSave } from './save.js';
import { NavGrid, Steering } from './nav.js';
import { Loot, loadLootModels } from './loot.js';
import { makeIso } from './iso.js';
import { Hud } from './ui.js';
import { NpcAI, NPC } from '../npc.js';
import { ARENA_R } from '../arena.js';

const V3 = THREE.Vector3, rnd = Math.random, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export async function startRpg(ctx) {
  const { renderer, scene, sun, sim, combat, chars, poseChar, arena, GLTFLoader, controls } = ctx, cv = renderer.domElement;
  controls.enabled = false; controls.dispose?.(); scene.fog = null;
  const K = chars.find((r) => r.name === 'knight'), RB = chars.find((r) => r.name === 'robot'), pool = chars.filter((r) => r.name === 'skeleton'), P = K.ch;
  const active = [P]; sim.chars = active; combat.chars = active; // only the characters that are in the arena are simulated
  const S = loadSave(), hud = new Hud(), iso = makeIso(cv), nav = new NavGrid(arena.obstacles);
  const steering = new Steering(nav, () => pool.filter((r) => r.active && !r.dead).map((r) => r.ch.b[0].p));
  const loot = new Loot(scene, await loadLootModels(GLTFLoader).catch(() => ({})));
  const P0 = P.b[0].p, playerNav = {}; // (playerNav: the player's own path state for click-to-move)

  // ---- state
  let phase = 'intermission', wave = Math.min(CFG.waves.total, Math.max(1, S.wave)), queue = 0, spawnT = 0, clock = 0, downs = 0, invuln = 0, koPending = false, shake = 0, saveT = 0, dirty = false, hudT = 0;
  let maxHp = CFG.player.hp + CFG.player.hpPerLevel * S.up.hp, hp = maxHp;
  const save = () => { dirty = true; };
  const flush = () => { if (dirty) { writeSave(S); dirty = false; } };

  // ---- the characters: pool of skeletons + the robot are parked far away (outside the arena wall) until they are needed
  const park = (rec, i) => { rec.ch.reset(24 + (i % 4) * 3, 24 + Math.floor(i / 4) * 3, 0); rec.root.visible = false; rec.active = false; };
  P.team = 'player';
  for (const [i, r] of pool.entries()) {
    r.ch.team = 'enemy'; r.ch.sword.style.speed = CFG.skeleton.speed; r.ch.sword.style.smash = 0.08; r.hp = 0; r.dead = false;
    r.ai = new NpcAI(r.ch, active, { ...NPC.skeleton, aggroT: 1e9, forgetDist: 99, run: false, specials: null, swingRange: CFG.skeleton.swingRange, smashRange: 1.2, burst: CFG.skeleton.burst, nav: steering });
    park(r, i);
  }
  RB.ch.team = 'player'; park(RB, pool.length);
  const unlockSword = (on) => { P.sword.locked = !on; K.sv.holder.visible = on; K.sv.sword.visible = on; };
  unlockSword(S.owned.sword);
  const activateRobot = () => {
    if (RB.active) return;
    RB.ch.reset(P0.x + 1.2, P0.z + 1.2, 0); RB.root.visible = true; RB.active = true; active.push(RB.ch);
    RB.ai = new NpcAI(RB.ch, active, { ...NPC.robot, ally: true, allyRange: 14, followDist: 3, forgetDist: 99, nav: steering, specials: ['Q', 'R', 'F'] });
    RB.ai.leader = P; RB.ai.foes = () => pool.filter((r) => r.active && !r.dead).map((r) => r.ch);
  };
  if (S.owned.robot) activateRobot();

  // ---- skeletons: spawn, kill, drop loot, remove
  const spawnPoint = () => {
    let first = null;
    for (let t = 0; t < 16; t++) {
      const a = rnd() * Math.PI * 2, x = Math.sin(a) * 10.2, z = Math.cos(a) * 10.2;
      if (nav.isBlocked(x, z)) continue;
      first ??= { x, z };
      if (Math.hypot(x - P0.x, z - P0.z) < 7) continue;
      if (pool.some((r) => r.active && Math.hypot(r.ch.b[0].p.x - x, r.ch.b[0].p.z - z) < 1.4)) continue;
      return { x, z };
    }
    return first ?? { x: 0, z: 10 };
  };
  const living = () => pool.filter((r) => r.active && !r.dead).length;
  const spawnOne = () => {
    const r = pool.find((x) => !x.active); if (!r) return false;
    const sp = spawnPoint();
    r.ch.reset(sp.x, sp.z, Math.atan2(-sp.x, -sp.z)); r.ch.ragdoll = 0.25; r.ch.autoGetUp = true;
    r.root.visible = true; r.active = true; r.dead = false; r.deadT = 0; r.maxHp = r.hp = Math.round(CFG.skeleton.hp * (1 + CFG.skeleton.hpPerWave * (wave - 1)));
    r.ai.reset(); r.ai.enabled = true; r.ai.burstT = rnd() * 2; r.ai.navState = null; r.ai.rand = Math.floor(rnd() * 1e6);
    r.ai.cfg.run = wave >= CFG.skeleton.runFromWave; r.ai.target = P; r.ai.state = 'fight'; r.ai.aggro = 1e9;
    active.push(r.ch);
    return true;
  };
  const dropLoot = (r) => {
    const p = r.ch.b[0].p, D = CFG.drops, n = D.coins[0] + Math.floor(rnd() * (D.coins[1] - D.coins[0] + 1)), v = Math.max(1, Math.round(D.coinValue + D.coinValuePerWave * (wave - 1)));
    for (let i = 0; i < n; i++) loot.spawn('coin', p.x, p.z, v);
    if (rnd() < D.bagChance) {
      const items = {}, count = D.bagItems[0] + Math.floor(rnd() * (D.bagItems[1] - D.bagItems[0] + 1)), tot = Object.values(D.weights).reduce((a, b) => a + b, 0);
      for (let i = 0; i < count; i++) { let x = rnd() * tot; for (const [k, w] of Object.entries(D.weights)) { if ((x -= w) < 0) { items[k] = (items[k] ?? 0) + 1; break; } } }
      loot.spawn('bag', p.x, p.z, items);
    }
  };
  const kill = (r) => {
    if (r.dead) return;
    r.dead = true; r.deadT = 0; r.ai.enabled = false; r.ai.release(); r.ch.autoGetUp = false; r.ch.ragdoll = 1; r.ch.goLimp();
    dropLoot(r);
  };
  const despawn = (r) => { const i = active.indexOf(r.ch); if (i >= 0) active.splice(i, 1); park(r, pool.indexOf(r)); r.dead = false; };
  const collect = (it) => {
    if (it.kind === 'coin') S.coins += it.data;
    else { const t = []; for (const [k, n] of Object.entries(it.data)) { S.mats[k] += n; t.push(`+${n} ${CFG.materials[k]}`); } hud.toast(t.join(' · '), 1500); }
    save(); if (hud.shopOpen) refreshShop();
  };

  // ---- the player: damage, knock-downs, elimination
  const ko = () => {
    downs++;
    if (downs > CFG.player.downsAllowed) return eliminate();
    koPending = true; hud.toast(`Knocked down! (${downs}/${CFG.player.downsAllowed})`, 2500);
    P.knockDown(new V3(rnd() - 0.5, 0.12, rnd() - 0.5).normalize(), 140);
  };
  const eliminate = () => {
    phase = 'over'; P.autoGetUp = false; P.goLimp(); S.wave = 1; S.runs++; save(); flush();
    hud.showEnd('Eliminated', `You fell in wave ${wave} of ${CFG.waves.total}. Your coins, materials and purchases are kept.`, 'Try again', restartRun);
  };
  const hurtPlayer = (impulse) => {
    if (phase === 'over' || phase === 'won' || invuln > 0 || koPending || P.state !== 'stand') return;
    hp -= Math.max(1, Math.round(impulse * CFG.dmg.enemy * (1 + CFG.dmg.enemyPerWave * (wave - 1)))); hud.flash();
    if (hp <= 0) { hp = 0; ko(); }
  };
  combat.onHit = (e) => {
    shake = Math.max(shake, e.heavy ? 16 : 7);
    if (e.tgt === P) return hurtPlayer(e.s.impulse);
    const r = pool.find((x) => x.ch === e.tgt); if (!r || !r.active || r.dead) return;
    const mul = e.att === P ? CFG.dmg.player * (1 + CFG.player.dmgPerLevel * S.up.dmg) : e.att === RB.ch ? CFG.dmg.ally : 0;
    if (!mul) return;
    r.hp -= Math.max(1, Math.round(e.s.impulse * mul)); r.ai.hurt(e.heavy);
    if (r.hp <= 0) kill(r);
  };

  // ---- waves
  const startWave = () => { if (phase !== 'intermission') return; phase = 'wave'; queue = waveSize(wave); spawnT = 1; hud.toast(`Wave ${wave} / ${CFG.waves.total}<br><span class="dim">${queue} skeletons</span>`, 2500); };
  const clearWave = () => {
    const bonus = CFG.waves.clearBonus * wave; S.coins += bonus; S.best = Math.max(S.best, wave); hp = Math.min(maxHp, hp + maxHp * CFG.waves.healOnClear);
    if (wave >= CFG.waves.total) {
      phase = 'won'; S.wave = 1; S.runs++; save(); flush();
      return hud.showEnd('Victory!', `All ${CFG.waves.total} waves cleared. +${bonus} coins. Your progress is kept.`, 'Play again', restartRun);
    }
    wave++; S.wave = wave; phase = 'intermission'; save(); flush(); hud.toast(`Wave cleared! +${bonus} coins<br><span class="dim">press N for wave ${wave}</span>`, 3500);
  };
  function restartRun() {
    for (const r of pool) if (r.active) despawn(r);
    loot.clear(); P.reset(0, 0, 0); P.autoGetUp = true; maxHp = CFG.player.hp + CFG.player.hpPerLevel * S.up.hp; hp = maxHp; downs = 0; invuln = 0; koPending = false;
    wave = 1; S.wave = 1; phase = 'intermission'; moveTarget = null; hud.hideEnd();
    if (RB.active) RB.ch.reset(1.2, 1.2, 0);
    iso.follow(P0, 0, true); save(); flush();
  }

  // ---- shop
  const price = (it) => (Array.isArray(it.price) ? it.price[Math.min(S.up[it.id] ?? 0, it.price.length - 1)] : it.price ?? 0);
  const recipeOk = (it) => !it.recipe || Object.entries(it.recipe).every(([k, n]) => S.mats[k] >= n);
  const itemState = (it) => (it.id === 'sword' && S.owned.sword) || (it.robot && S.owned.robot) ? 'owned' : it.levels && (S.up[it.id] ?? 0) >= it.levels ? 'max' : 'buy';
  const canBuy = (it) => itemState(it) === 'buy' && S.coins >= price(it) && recipeOk(it) && !(it.id === 'tonic' && hp >= maxHp);
  const costText = (it) => [price(it) ? `${price(it)} coins` : '', ...Object.entries(it.recipe ?? {}).map(([k, n]) => `${n} ${CFG.materials[k]} (${S.mats[k]})`)].filter(Boolean).join(' + ');
  function refreshShop() { hud.setShop(CFG.shop.map((it) => ({ id: it.id, name: it.levels ? `${it.name} (${S.up[it.id] ?? 0}/${it.levels})` : it.name, desc: it.desc, cost: costText(it), state: itemState(it), can: canBuy(it) })), `Coins: ${S.coins}`); }
  function buy(id) {
    const it = CFG.shop.find((x) => x.id === id); if (!it || !canBuy(it)) return false;
    S.coins -= price(it); for (const [k, n] of Object.entries(it.recipe ?? {})) S.mats[k] -= n;
    if (id === 'sword') { S.owned.sword = true; unlockSword(true); hud.toast('You bought the sword: press F to draw it'); }
    else if (id === 'tonic') hp = Math.min(maxHp, hp + 50);
    else if (id === 'hp') { S.up.hp++; maxHp += CFG.player.hpPerLevel; hp += CFG.player.hpPerLevel; }
    else if (id === 'dmg') S.up.dmg++;
    else if (it.robot) { S.owned.robot = true; activateRobot(); hud.toast('A robot ally joins you'); }
    save(); flush(); refreshShop(); return true;
  }
  hud.onBuy = buy; hud.onShop = refreshShop; hud.onStart = startWave;

  // ---- input: click-to-move (hold = keep walking toward the pointer), WASD, Space attack, E heavy, Q / R specials, F sword, B shop, N next wave
  const keys = new Set(); let moveTarget = null, pointerDown = false, lastAtk = -9, wantToggle = 0;
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.8, depthTest: false })); marker.renderOrder = 20; marker.visible = false; scene.add(marker);
  const setTarget = (e) => { const p = iso.pick(e.clientX, e.clientY); if (p) moveTarget = new V3().copy(nav.nearestFree(p.x, p.z)).setY(0); };
  cv.style.touchAction = 'none'; cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; pointerDown = true; setTarget(e); cv.setPointerCapture?.(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (pointerDown) setTarget(e); });
  addEventListener('pointerup', () => { pointerDown = false; });
  const stamp = () => { lastAtk = clock; };
  const act = {
    light: () => { stamp(); return P.sword.attack(false); }, heavy: () => { stamp(); return P.sword.attack(true); }, special: (k) => { stamp(); return P.sword.special?.(k); },
    sword: () => { if (!S.owned.sword) return hud.toast('Buy the sword in the shop (B)'); if (!P.sword.toggle() && P.walk.moving) wantToggle = clock + 3; },
  };
  addEventListener('keydown', (e) => {
    if (!e.repeat) {
      if (e.code === 'KeyE') act.heavy(); else if (e.code === 'KeyQ') act.special('Q'); else if (e.code === 'KeyR') act.special('R');
      else if (e.code === 'KeyF') act.sword(); else if (e.code === 'Space' || e.code === 'KeyJ') act.light();
      else if (e.code === 'KeyB') hud.toggleShop(); else if (e.code === 'KeyN') startWave(); else if (e.code === 'Escape') hud.toggleShop(false);
    }
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code)); addEventListener('blur', () => { keys.clear(); pointerDown = false; });
  const keyDir = () => {
    const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0), iz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    if (!ix && !iz) return null;
    const f = iso.forward; return new V3().addScaledVector(f, iz).addScaledVector(new V3(-f.z, 0, f.x), ix).normalize();
  };
  const nearestFoe = () => { let best = null, bd = 5; for (const r of pool) if (r.active && !r.dead && r.ch.state === 'stand') { const p = r.ch.b[0].p, d = Math.hypot(p.x - P0.x, p.z - P0.z); if (d < bd) { bd = d; best = { p, d }; } } return best; };
  const steer = () => {
    const W = P.walk, L = P.sword, shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    L.attackHeld = keys.has('Space') || keys.has('KeyJ');
    if (P.state !== 'stand') { moveTarget = null; return; }
    if (wantToggle) { W.command(null, 0); if (clock > wantToggle) wantToggle = 0; else if (W.mode === 'idle' && W.w < 0.05) { wantToggle = 0; L.toggle(); } return; }
    const d = keyDir();
    if (d) { moveTarget = null; return W.command(d, shift ? W.slowThrottle : 1, !shift && W.canRun); }
    if (moveTarget) {
      const dx = moveTarget.x - P0.x, dz = moveTarget.z - P0.z, dist = Math.hypot(dx, dz);
      if (dist < 0.35) moveTarget = null;
      else { const dir = steering.steer(playerNav, P0, moveTarget, dist, false) ?? new V3(dx, 0, dz).normalize(); return W.command(dir, dist < 1 ? 0.55 : 1, dist > 3 && W.canRun); }
    }
    if (L.swinging || L.attackHeld || clock - lastAtk < 0.8) { // aim assist: fighting on the spot, turn toward the nearest foe
      const f = nearestFoe();
      if (f) { const a = Math.atan2(f.p.x - P0.x, f.p.z - P0.z); if (Math.abs(wrap(a - P.ghost.psi)) > 0.12) return W.command(new V3(Math.sin(a), 0, Math.cos(a)), f.d > 1.1 ? 0.3 : 0.07); }
    }
    W.command(null, 0);
  };

  // ---- the loop
  const sunOff = new V3(4, 8, 3), sunGoal = new V3(), texel = 18 / 2048;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 }); sun.shadow.camera.updateProjectionMatrix();
  let first = true;
  const update = (dt, draw = true) => {
    clock += dt; steering.now = clock; if (invuln > 0) invuln -= dt;
    steer();
    for (const r of pool) if (r.active && !r.dead) { // everybody walks at the player (or at the robot when it is closer)
      const ai = r.ai; ai.aggro = 1e9; ai.state = ai.state === 'calm' ? 'fight' : ai.state;
      let tg = P, bd = Math.hypot(P.b[0].p.x - r.ch.b[0].p.x, P.b[0].p.z - r.ch.b[0].p.z) + (P.state === 'stand' ? 0 : 99);
      if (RB.active && RB.ch.state === 'stand') { const d = Math.hypot(RB.ch.b[0].p.x - r.ch.b[0].p.x, RB.ch.b[0].p.z - r.ch.b[0].p.z); if (d < bd - 1.5) { tg = RB.ch; bd = d; } }
      ai.target = tg; ai.update(dt, false);
    }
    if (RB.active) RB.ai.update(dt, false);
    // waves
    if (phase === 'wave') {
      spawnT -= dt;
      if (queue > 0 && spawnT <= 0 && living() < maxAlive(wave) && spawnOne()) { queue--; spawnT = CFG.waves.spawnEvery * (0.7 + 0.6 * rnd()); }
      if (queue === 0 && living() === 0) clearWave();
    }
    sim.update(dt);
    // the player's knock-down is over: back on his feet with some HP and a moment of grace
    if (koPending && P.state === 'stand') { koPending = false; hp = Math.max(hp, maxHp * CFG.player.getUpHp); invuln = CFG.player.invuln; }
    for (const r of pool) if (r.active && r.dead && (r.deadT += dt) > CFG.skeleton.corpseSeconds) despawn(r);
    for (const c of [...active]) if (Math.hypot(c.b[0].p.x, c.b[0].p.z) > ARENA_R + 1) { // safety net: never wander off the platform
      const r = pool.find((x) => x.ch === c);
      if (r && r.dead) despawn(r); else if (r) { const sp = spawnPoint(); c.reset(sp.x, sp.z, 0); } else c.reset(0, 0, 0);
    }
    for (const r of chars) if (r.active !== false && (r === K || r.active)) poseChar(r, r.P, r.Q, dt);
    loot.update(dt, P0, collect);
    if (dirty && (saveT += dt) > 1.5) { saveT = 0; flush(); }
    iso.follow(P0, dt, first); first = false;
    sunGoal.lerp(new V3(P0.x, 0, P0.z), Math.min(1, dt * 3));
    const sr = new V3().crossVectors(new V3(0, 1, 0), sunOff).normalize(), su = new V3().crossVectors(sunOff, sr).normalize(), a = sunGoal.dot(sr), b = sunGoal.dot(su);
    sun.target.position.copy(sunGoal).addScaledVector(sr, Math.round(a / texel) * texel - a).addScaledVector(su, Math.round(b / texel) * texel - b); sun.position.copy(sun.target.position).add(sunOff);
    marker.visible = !!moveTarget && P.state === 'stand'; if (moveTarget) { marker.position.set(moveTarget.x, 0.05, moveTarget.z); marker.scale.setScalar(1 + 0.15 * Math.sin(clock * 8)); }
    shake *= Math.exp(-dt * 14); cv.style.transform = shake > 0.4 ? `translate(${((rnd() - 0.5) * shake).toFixed(1)}px, ${((rnd() - 0.5) * shake).toFixed(1)}px)` : '';
    if ((hudT -= dt) <= 0 || !draw) { hudT = 0.1; updateHud(); }
    if (draw) renderer.render(scene, iso.camera);
  };
  const updateHud = () => {
    const m = Object.entries(CFG.materials).map(([k, n]) => `${n}: ${S.mats[k]}`).join(' · ');
    hud.set({ hp, maxHp, downs, downsAllowed: CFG.player.downsAllowed, coins: S.coins, matsText: m,
      waveText: phase === 'wave' ? `Wave ${wave} / ${CFG.waves.total}: ${queue + living()} skeletons left` : phase === 'intermission' ? `Wave ${wave} / ${CFG.waves.total} is next (best: ${S.best})` : phase === 'won' ? 'All waves cleared' : 'Eliminated',
      allyText: S.owned.robot ? 'Robot ally: fighting beside you' : 'No robot ally yet (shop: buy or craft one)', canStart: phase === 'intermission', startText: `Start wave ${wave} (N)` });
  };
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); iso.resize(); });
  let last = performance.now();
  renderer.setAnimationLoop((now) => { update(Math.min(0.05, (now - last) / 1000)); last = now; });
  const game = {
    S, P, pool, RB, active, hud, iso, nav, loot, buy, startWave, restartRun, refreshShop, update, kill, spawnOne,
    state: () => ({ phase, wave, queue, hp, maxHp, downs, living: living(), coins: S.coins, mats: { ...S.mats }, owned: { ...S.owned }, up: { ...S.up }, loot: loot.items.length, activeChars: active.length, invuln, koPending }),
    advance(sec) { for (let i = 0; i < sec * 60; i++) update(1 / 60, false); renderer.render(scene, iso.camera); },
    setHp(v) { hp = v; }, flush,
  };
  window.__rpg = game;
  updateHud();
  if (S.wave > 1) hud.toast(`Welcome back: wave ${wave} is next<br><span class="dim">${S.coins} coins saved</span>`, 3500); else hud.toast('Press N to start wave 1<br><span class="dim">Click to move · Space to fight</span>', 4000);
  return game;
}
