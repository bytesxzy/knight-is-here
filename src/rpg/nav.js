// A little pathfinding: a grid over the arena (the pillars and crates, inflated by the agent's radius, are blocked), A* with string pulling, and a steering helper
// that follows the path, replans now and then and keeps the skeletons from stacking up. Used by the skeletons (npc.js `nav`) and by the player's click-to-move.
import * as THREE from '#three';

const V3 = THREE.Vector3;
export class NavGrid {
  constructor(obstacles, { radius = 11.4, cell = 0.4, agentR = 0.45 } = {}) {
    this.cell = cell; this.n = Math.ceil((2 * radius) / cell); this.o = -(this.n * cell) / 2; this.radius = radius;
    this.blocked = new Uint8Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const x = this.o + (i + 0.5) * cell, z = this.o + (j + 0.5) * cell;
      let b = Math.hypot(x, z) > radius;
      for (const ob of obstacles) if (Math.hypot(x - ob.x, z - ob.z) < ob.r + agentR) b = true;
      this.blocked[j * this.n + i] = b ? 1 : 0;
    }
  }
  ci(x) { return Math.min(this.n - 1, Math.max(0, Math.floor((x - this.o) / this.cell))); }
  isBlocked(x, z) { return this.blocked[this.ci(z) * this.n + this.ci(x)] === 1; }
  centre(i, j) { return { x: this.o + (i + 0.5) * this.cell, z: this.o + (j + 0.5) * this.cell }; }
  los(ax, az, bx, bz) { // is the straight line free?
    const d = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let k = 0; k <= steps; k++) { const t = k / steps; if (this.isBlocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }
  nearestFree(x, z) { // the closest walkable point (the player clicked on a pillar)
    if (!this.isBlocked(x, z)) return { x, z };
    const i0 = this.ci(x), j0 = this.ci(z);
    for (let r = 1; r < 12; r++) {
      let best = null, bd = 1e9;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= this.n || j >= this.n || this.blocked[j * this.n + i]) continue;
        const c = this.centre(i, j), d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; }
      }
      if (best) return best;
    }
    return { x: 0, z: 0 };
  }
  // A* on the 8-neighbour grid (no corner cutting), then string pulling: waypoints [{x, z}, ...] ending at the goal, or null
  findPath(ax, az, bx, bz) {
    const n = this.n, s = this.nearestFree(ax, az), g = this.nearestFree(bx, bz), si = this.ci(s.x) + this.ci(s.z) * n, gi = this.ci(g.x) + this.ci(g.z) * n;
    const G = new Float32Array(n * n).fill(Infinity), par = new Int32Array(n * n).fill(-1), closed = new Uint8Array(n * n), heap = [];
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const h = (i) => { const dx = Math.abs((i % n) - (gi % n)), dz = Math.abs(((i / n) | 0) - ((gi / n) | 0)); return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)); };
    G[si] = 0; push(h(si), si);
    let found = false, guard = 0;
    while (heap.length && guard++ < 6000) {
      const [, cur] = pop(); if (closed[cur]) continue; closed[cur] = 1;
      if (cur === gi) { found = true; break; }
      const cx = cur % n, cz = (cur / n) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const ni = x + z * n; if (this.blocked[ni] || closed[ni]) continue;
        if (dx && dz && (this.blocked[cx + dx + cz * n] || this.blocked[cx + (cz + dz) * n])) continue;
        const ng = G[cur] + (dx && dz ? Math.SQRT2 : 1);
        if (ng < G[ni]) { G[ni] = ng; par[ni] = cur; push(ng + h(ni), ni); }
      }
    }
    if (!found) return null;
    const cells = []; for (let c = gi; c !== -1; c = par[c]) cells.push(this.centre(c % n, (c / n) | 0));
    cells.reverse(); cells[cells.length - 1] = { x: g.x, z: g.z };
    const out = []; let a = { x: ax, z: az }, k = 0; // string pulling: skip every waypoint that can be reached straight from the last kept one
    while (k < cells.length) { let far = k; for (let m = cells.length - 1; m > k; m--) if (this.los(a.x, a.z, cells[m].x, cells[m].z)) { far = m; break; } out.push(cells[far]); a = cells[far]; k = far + 1; }
    return out;
  }
}

// per-agent steering state lives on the agent (`agent.navState`). agents(): the positions of the others (they push each other apart a little)
export class Steering {
  constructor(grid, agents = () => []) { this.grid = grid; this.agents = agents; this.now = 0; this.out = new V3(); }
  steer(agent, from, to, dist, sep = true) {
    const st = (agent.navState ??= { path: null, wp: 0, tPlan: -9, gx: 1e9, gz: 1e9 }), g = this.grid;
    let tx = to.x, tz = to.z;
    if (g.los(from.x, from.z, to.x, to.z)) st.path = null;
    else {
      if (!st.path || this.now - st.tPlan > 0.45 + 0.2 * ((agent.rand ?? 0) % 1) || Math.hypot(st.gx - to.x, st.gz - to.z) > 1.5) {
        st.path = g.findPath(from.x, from.z, to.x, to.z); st.tPlan = this.now; st.wp = 0; st.gx = to.x; st.gz = to.z;
      }
      if (st.path) {
        while (st.wp < st.path.length - 1 && Math.hypot(st.path[st.wp].x - from.x, st.path[st.wp].z - from.z) < 0.45) st.wp++;
        tx = st.path[st.wp].x; tz = st.path[st.wp].z;
      }
    }
    this.out.set(tx - from.x, 0, tz - from.z);
    if (this.out.lengthSq() < 1e-6) return null;
    this.out.normalize();
    if (sep && !agent.ally) for (const p of this.agents()) { // keep a little apart from the others (an ally runs INTO the fight, and nobody keeps away from the one it is walking to)
      if (p === from || p === to) continue;
      const dx = from.x - p.x, dz = from.z - p.z, d = Math.hypot(dx, dz);
      if (d > 1e-3 && d < 1.0) this.out.x += (dx / d) * (1 - d) * 0.9, this.out.z += (dz / d) * (1 - d) * 0.9;
    }
    return this.out.lengthSq() < 1e-6 ? null : this.out.clone().normalize();
  }
}
