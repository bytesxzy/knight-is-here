// Persistent progress (localStorage): coins, crafting materials, what was bought, the next wave, the best wave. Every access is wrapped: a private window / blocked storage just means no saving.
const KEY = 'knight-rpg-save-v1';
export const defaults = () => ({ v: 1, coins: 0, mats: { scrap: 0, copper: 0, magnesium: 0, circuit: 0 }, owned: { sword: false, robot: false }, up: { hp: 0, dmg: 0 }, wave: 1, best: 0, runs: 0 });
const merge = (d, o) => { for (const k of Object.keys(d)) { if (o?.[k] === undefined) continue; if (d[k] && typeof d[k] === 'object') merge(d[k], o[k]); else if (typeof o[k] === typeof d[k]) d[k] = o[k]; } return d; };
export function loadSave() { try { const raw = localStorage.getItem(KEY); return raw ? merge(defaults(), JSON.parse(raw)) : defaults(); } catch { return defaults(); } }
export function writeSave(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
export function wipeSave() { try { localStorage.removeItem(KEY); } catch {} return defaults(); }
