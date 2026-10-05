// A deliberately plain HUD (no art): health bar, knock-downs, coins and materials, the wave, a shop panel, an end screen. Everything is built from code, nothing in index.html.
const CSS = `
#rpg { position: fixed; inset: 0; pointer-events: none; font: 13px/1.4 system-ui, sans-serif; color: #eee; }
#rpg .box { position: absolute; background: rgba(12,14,18,.78); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 8px 10px; pointer-events: auto; }
#rpg .bar { width: 220px; height: 16px; background: #2a1215; border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,.2); }
#rpg .bar > div { height: 100%; background: linear-gradient(#e0523a, #a82a1d); width: 100%; transition: width .15s; }
#rpg button { background: #262c36; color: inherit; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; margin: 3px 4px 0 0; }
#rpg button:hover { background: #343c4a; } #rpg button:disabled { opacity: .45; cursor: default; }
#rpg .gold { color: #ffd24a; } #rpg .dim { color: #9aa0aa; font-size: 12px; }
#rpg #toast { left: 50%; top: 14%; transform: translateX(-50%); font-size: 18px; text-align: center; opacity: 0; transition: opacity .3s; pointer-events: none; }
#rpg #shop { right: 14px; top: 14px; width: 330px; max-height: calc(100% - 28px); overflow-y: auto; display: none; }
#rpg .row { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 5px 0; border-top: 1px solid rgba(255,255,255,.08); }
#rpg #end { left: 50%; top: 40%; transform: translate(-50%, -50%); text-align: center; font-size: 16px; display: none; min-width: 280px; }
#rpg #help { right: 14px; bottom: 14px; max-width: 360px; font-size: 12px; color: #b8bcc6; }
#rpg #flash { position: absolute; inset: 0; background: radial-gradient(transparent 55%, rgba(200,20,20,.55)); opacity: 0; transition: opacity .25s; pointer-events: none; }
`;
export class Hud {
  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    this.root = document.createElement('div'); this.root.id = 'rpg';
    this.root.innerHTML = `
      <div id="flash"></div>
      <div class="box" id="stats" style="left:14px;top:14px">
        <div class="bar"><div id="hp"></div></div>
        <div id="hptxt" style="margin:2px 0 4px"></div>
        <div id="downs"></div><div id="coins" class="gold"></div><div id="mats" class="dim"></div>
        <div id="wave" style="margin-top:6px"></div><div id="ally" class="dim"></div>
        <div><button id="bShop">Shop (B)</button><button id="bWave">Start wave (N)</button></div>
      </div>
      <div class="box" id="shop"></div>
      <div class="box" id="toast"></div>
      <div class="box" id="end"></div>
      <div class="box" id="help">Click = move (hold to keep walking) · WASD move · <b>Space</b> attack (hold = combo) · <b>E</b> heavy · <b>Q / R</b> specials · <b>F</b> draw / sheathe the sword · <b>B</b> shop · <b>N</b> next wave · wheel = zoom</div>`;
    document.body.append(this.root);
    this.q = (id) => this.root.querySelector('#' + id);
    this.shopOpen = false; this.cache = {};
    this.q('bShop').onclick = () => this.toggleShop(); this.q('bWave').onclick = () => this.onStart?.();
    this.onStart = null; this.onShop = null; this.onBuy = null;
  }
  setText(id, t) { if (this.cache[id] !== t) { this.cache[id] = t; this.q(id).innerHTML = t; } }
  set(s) {
    this.q('hp').style.width = Math.max(0, (100 * s.hp) / s.maxHp) + '%';
    this.setText('hptxt', `HP ${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`);
    this.setText('downs', `Knock-downs: ${'●'.repeat(s.downs)}${'○'.repeat(Math.max(0, s.downsAllowed - s.downs))} (${s.downs}/${s.downsAllowed} used, the next one eliminates you)`);
    this.setText('coins', `Coins: ${s.coins}`);
    this.setText('mats', s.matsText);
    this.setText('wave', s.waveText);
    this.setText('ally', s.allyText);
    const b = this.q('bWave'); b.disabled = !s.canStart; b.textContent = s.startText;
  }
  toast(msg, ms = 2200) { const t = this.q('toast'); t.innerHTML = msg; t.style.opacity = 1; clearTimeout(this.tt); this.tt = setTimeout(() => (t.style.opacity = 0), ms); }
  flash() { const f = this.q('flash'); f.style.opacity = 1; setTimeout(() => (f.style.opacity = 0), 120); }
  toggleShop(v = !this.shopOpen) { this.shopOpen = v; this.q('shop').style.display = v ? 'block' : 'none'; if (v) this.onShop?.(); }
  // rows: [{ id, name, desc, cost, state: 'buy' | 'owned' | 'max', can }]
  setShop(rows, coinsText) {
    const box = this.q('shop'); box.innerHTML = `<b>Shop</b> <span class="gold">${coinsText}</span> <button id="bClose" style="float:right">Close (B)</button>`;
    this.q('bClose').onclick = () => this.toggleShop(false);
    for (const r of rows) {
      const d = document.createElement('div'); d.className = 'row';
      d.innerHTML = `<div><b>${r.name}</b><br><span class="dim">${r.desc}</span><br><span class="gold">${r.cost}</span></div>`;
      const b = document.createElement('button'); b.textContent = r.state === 'owned' ? 'Owned' : r.state === 'max' ? 'Max' : 'Buy'; b.disabled = r.state !== 'buy' || !r.can; b.onclick = () => this.onBuy?.(r.id);
      d.append(b); box.append(d);
    }
  }
  showEnd(title, text, button, fn) {
    const e = this.q('end'); e.innerHTML = `<div style="font-size:24px;margin-bottom:6px">${title}</div><div class="dim" style="margin-bottom:8px">${text}</div>`;
    const b = document.createElement('button'); b.textContent = button; b.onclick = () => { e.style.display = 'none'; fn(); }; e.append(b); e.style.display = 'block';
  }
  hideEnd() { this.q('end').style.display = 'none'; }
}
