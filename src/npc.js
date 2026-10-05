// NPC brain, one per character, switched off for the character the player is driving. NEUTRAL: it stands there and never starts anything. Once somebody
// hits it (a landed punch / sword / claw, a shove) it turns on that attacker: runs / walks at it and fights back with whatever the character has: the skeleton's
// savage swings, the robot's piston punches and hammer blow (and its jump to close a gap or hop out of a swing), the knight's fists, or the sword once drawn.
// It calms down again once it has not been hit for a while (`aggroT`), the attacker is gone, or the attacker is down (it waits for it to get up).
import * as THREE from '#three';

const { Vector3: V3 } = THREE;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const NPC = {
  common: { aggroT: 9, rest: 1.6, stunLight: 0, stunHeavy: 0.9, forgetDist: 14 }, // light blows only shove it (it keeps swinging: it trades blows); a heavy one stops it for a moment
  skeleton: { run: true, stopDist: 0.62, meleeDist: 1.15, swingRange: 4.2, smashRange: 2.4 },
  robot: { run: true, stopDist: 0.72, meleeDist: 1.3, swingRange: 1.6, leap: [3.4, 9, 3.2], dodge: 0.35, heavyEvery: 4.5 },
  knight: { run: false, stopDist: 0.62, swordStop: 0.88, meleeDist: 1.2, drawDist: 1.8, heavyEvery: 5, sheatheAfter: 5 },
};

const swingCount = (ch) => (ch.sword.n ?? 0) + (ch.sword.fists?.n ?? 0) + (ch.sword.swI ?? 0);

export class NpcAI {
  constructor(me, all, cfg = null) {
    this.me = me; this.all = all; this.cfg = { ...NPC.common, ...(cfg ?? NPC[me.spec.name] ?? {}) };
    this.enabled = true; this.rand = 12345;
    this.reset();
  }
  rnd() { let t = (this.rand += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  reset() { this.state = 'calm'; this.target = null; this.aggro = 0; this.stunT = 0; this.restT = 0; this.heavyT = 2; this.leapT = 0; this.calmT = 0; this.hits = 0; this.lastN = 0; this.release(); }
  release() { const me = this.me; me.walk.command(null, 0); me.sword.attackHeld = false; }
  get label() { return this.state === 'fight' || this.state === 'gloat' || this.state === 'stunned' ? `${this.state} ${this.target?.spec.name ?? ''}`.trim() : this.state; }

  // somebody hit me: turn on it
  provoke(att, heavy = false) {
    if (!this.enabled || !att || att === this.me) return;
    if (this.target !== att) this.lastN = swingCount(att);
    if (this.state === 'calm' || this.state === 'player') { this.state = 'fight'; this.heavyT = Math.max(this.heavyT, 1.2 + 1.6 * this.rnd()); } // it opens with the quick blows, not the heavy one
    this.target = att; this.aggro = this.cfg.aggroT; this.calmT = 0;
  }
  // a blow landed on me: the heavy ones stop me (and cancel what I was doing) for a moment
  hurt(heavy) {
    const t = heavy ? this.cfg.stunHeavy : this.cfg.stunLight;
    if (!this.enabled || t <= 0) return;
    this.stunT = Math.max(this.stunT, t);
    const L = this.me.sword; L.interrupt?.(0.16); // (the move in progress fades out, it does not vanish)
    L.attackHeld = false;
  }

  update(dt, off) {
    const me = this.me, W = me.walk, L = me.sword, c = this.cfg;
    if (off) { this.state = 'player'; this.target = null; return; } // the player drives this one
    if (this.state === 'player') this.state = 'calm';
    L.attackHeld = false;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.restT > 0) this.restT -= dt;
    this.heavyT -= dt; this.leapT -= dt;
    if (!this.enabled) { W.command(null, 0); return; }
    if (me.state !== 'stand') { this.state = this.target ? this.state : 'calm'; W.command(null, 0); return; } // down: the auto get-up handles it
    if (me.jump?.active) return; // in the air: nothing to decide
    const tg = this.target;
    if (tg) this.aggro -= dt;
    const me0 = me.b[0].p, tg0 = tg?.b[0].p;
    if (!tg || this.aggro <= 0 || Math.hypot(tg0.x - me0.x, tg0.z - me0.z) > c.forgetDist) { // neutral again
      if (tg) { this.target = null; this.state = 'calm'; }
      this.state = 'calm'; W.command(null, 0);
      if (me.spec.sword && L.drawn && !L.busy) { this.calmT += dt; if (this.calmT > c.sheatheAfter && W.mode === 'idle' && W.w < 0.05) L.request(false); } // a knight puts his sword away
      return;
    }
    this.calmT = 0;
    const dx = tg0.x - me0.x, dz = tg0.z - me0.z, dist = Math.hypot(dx, dz), dir = new V3(dx, 0, dz).normalize();
    const err = Math.abs(wrap(Math.atan2(dx, dz) - me.ghost.psi));
    if (this.stunT > 0) { this.state = 'stunned'; W.command(null, 0); return; }
    if (this.restT > 0 || tg.state !== 'stand') { // the attacker is down: wait for it to get up (a knight uses the time to draw his sword)
      this.state = 'gloat';
      if (me.spec.sword && !L.drawn && dist > 0.9) { W.command(null, 0); if (!L.busy && W.mode === 'idle' && W.w < 0.05) L.request(true); return; }
      W.command(dist > 1.6 ? dir : null, 0.5); return;
    }
    this.state = 'fight';
    const stop = me.spec.sword && L.drawn ? c.swordStop : c.stopDist;
    const tv = tg.b[0].rb.linvel(), moving = Math.hypot(tv.x, tv.z) > 0.5; // is it walking away?
    // ---- the knight: draw the sword when there is room (he has to stand still for it), punch while it is sheathed and the attacker is close
    if (me.spec.sword && !L.drawn && !L.busy && dist > c.drawDist) { W.command(null, 0); if (W.mode === 'idle' && W.w < 0.05) L.request(true); return; }
    if (L.busy) { W.command(null, 0); return; }
    // ---- the robot's jump: a leap to close a gap, a hop out of the way of a swing that is coming
    if (me.jump?.ready) {
      if (c.leap && this.leapT <= 0 && dist > c.leap[0] && dist < c.leap[1] && err < 0.4) { me.jump.request(dir, 1); this.leapT = c.leap[2]; return; }
      const n = swingCount(tg);
      if (c.dodge && n !== this.lastN && dist < 1.5 && this.rnd() < c.dodge) { this.lastN = n; me.jump.request(dir.clone().negate().add(new V3(dir.z, 0, -dir.x).multiplyScalar(this.rnd() < 0.5 ? 0.6 : -0.6)), 0.7); return; }
      this.lastN = n;
    }
    // ---- close in: run while it is far, ease off as it closes; a retreating attacker is run down
    if (dist > c.meleeDist || (moving && dist > stop + 0.1)) {
      W.command(dir, Math.min(1, Math.max(0.6, (dist - stop) / 2.2)), !!c.run && err < 1.2);
    } else W.command(dist > stop + 0.05 || err > 0.5 ? dir : null, dist > stop + 0.05 ? 0.3 : 0.15); // melee: stand the ground, creep closer / turn to face it
    // ---- fight
    const face = err < 0.9;
    if (me.spec.name === 'skeleton') { L.smashOK = dist < c.smashRange; L.attackHeld = dist < c.swingRange && face && tg.state !== 'getup'; } // wild swings from far away
    else if (me.spec.name === 'robot') {
      L.attackHeld = dist < c.swingRange && face;
      if (dist < c.meleeDist && face && this.heavyT <= 0) { L.attack(true); this.heavyT = c.heavyEvery * (0.7 + 0.6 * this.rnd()); }
    } else { // the knight
      const reach = L.drawn ? 1.15 : 0.95;
      L.attackHeld = dist < reach && face;
      if (dist < reach && face && this.heavyT <= 0) { L.attack(true); this.heavyT = c.heavyEvery * (0.7 + 0.6 * this.rnd()); }
    }
  }
}
