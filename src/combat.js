// Hits, for both directions (the knight's punches / sword against the skeleton, the skeleton's swings against the knight). A swing that is in its strike
// window and whose hand / forearm (or the knight's blade) touches a body of the other character lands once: the body is shoved at the contact point
// (a heavy blow also knocks the target down). Contacts are exact shape queries (Rapier `contactCollider`), run every physics step.
import * as THREE from '#three';

const { Vector3: V3 } = THREE;
const HANDS = { L: ['handL', 'forearmL'], R: ['handR', 'forearmR'], B: ['handL', 'forearmL', 'handR', 'forearmR'] };

export class Combat {
  constructor(chars) { this.chars = chars; this.onHit = null; this.hits = 0; }
  update() { for (const a of this.chars) for (const t of this.chars) if (a !== t && a.state === 'stand') this.resolve(a, t); }

  resolve(att, tgt) {
    const L = att.sword;
    if (!L.strikes) return;
    for (const s of L.strikes()) {
      const c = this.contact(att, tgt, s);
      if (!c) continue;
      s.hit = true; this.hits++;
      this.land(att, tgt, s, c);
    }
  }

  // the closest touching pair between the striking part(s) of `att` and the bodies of `tgt`
  contact(att, tgt, s) {
    const cols = s.blade ? [att.bladeCol] : (s.parts ?? HANDS[s.side]).map((n) => att.b[att.rig.idx[n]].col);
    let best = null;
    for (const col of cols) for (const tb of tgt.b) {
      const ct = col.contactCollider(tb.col, 0.03);
      if (ct && (!best || ct.distance < best.d)) best = { d: ct.distance, tb, p: ct.point2 ?? ct.point1 };
    }
    return best;
  }

  land(att, tgt, s, c) {
    const A = att.b[0].p, T = tgt.b[0].p, dir = new V3(T.x - A.x, 0, T.z - A.z).normalize();
    const hand = att.b[att.rig.idx[s.side === 'L' ? 'handL' : 'handR']].rb.linvel(), hv = new V3(hand.x, 0, hand.z);
    if (hv.length() > 1) dir.addScaledVector(hv.normalize(), 0.6).normalize(); // a little along the swing itself
    const push = dir.add(new V3(0, s.knock ? 0.25 : 0.12, 0)).normalize().multiplyScalar(s.impulse), at = new V3(c.p.x, c.p.y, c.p.z);
    if (s.knock) tgt.goLimp();
    tgt.shove(c.tb.rb, at, push);
    this.onHit?.({ att, tgt, s, point: at, heavy: !!s.knock, part: c.tb.d.name });
  }
}
