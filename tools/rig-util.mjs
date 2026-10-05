// Shared helpers for the tools. RIG=skeleton node tools/xxx.mjs runs a tool on the skeleton instead of the knight.
import fs from 'node:fs';
import { buildRig } from '../src/humanoid.js';
import { Knight } from '../src/knight.js';
import { RIGS } from '../src/rigs.js';

export const rigName = () => process.env.RIG ?? 'knight';
export function loadRig(name = rigName()) {
  const spec = RIGS[name], profile = JSON.parse(fs.readFileSync(new URL('../' + spec.profile, import.meta.url)));
  return { spec, profile, rig: buildRig(profile, spec) };
}
export async function loadChar(name = rigName(), world = null) {
  const { spec, profile } = loadRig(name);
  return Knight.create(profile, spec, world);
}
