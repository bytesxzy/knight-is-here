// Writes the best parameter set of a tools/sword-tune.mjs run (its output file) into src/sword.js. usage: node tools/apply-tune.mjs <tune-output.txt>
import fs from 'node:fs';
const out = fs.readFileSync(process.argv[2], 'utf8').split('\n'), i = out.findIndex((l) => l.startsWith('BEST cost'));
const t = JSON.parse(out[i + 1]);
const r = (x) => (typeof x === 'number' ? +x.toFixed(4) : x), arr = (a) => '[' + a.map(r).join(', ') + ']';
const body = `export const TUNE = {   // values found with tools/sword-tune.mjs (both hands reach, joints inside limits, no body part inside another, blade clear of the body)
  mouth: ${arr(t.mouth)}, back: ${r(t.back)}, out: ${r(t.out)},              // holder on the belt, left side of the waist (pelvis frame, m): throat position; tip trails back / out (deg)
  grab: ${arr(t.grab)},                                          // how far the left hand carries the throat while drawing (m)
  drawDir: ${arr(t.drawDir)}, drawDir2: ${arr(t.drawDir2)}, // direction the sword leaves in (pelvis frame): holder swivelled by the left hand, and at the end of the pull
  gripRoll: ${r(t.gripRoll)}, gripHand: ${arr(t.gripHand)},        // roll of the grip about the blade axis (deg); fist centre in hand-local metres (fingers close just below the palm)
  midB: ${arr(t.midB)},                               // blade direction half-way through the swing (up and over, instead of the shortest arc)
  readyB: ${arr(t.readyB)}, readyN: ${arr(t.readyN)}, readyGrip: ${arr(t.readyGrip)}, arc: ${arr(t.arc)},   // ready guard, heading frame at the pelvis: blade up and a little forward, two hands in front of the chest
  spine: { abdT: ${r(t.spine.abdT)}, chestT: ${r(t.spine.chestT)}, abd: ${r(t.spine.abd)}, chest: ${r(t.spine.chest)}, abdS: ${r(t.spine.abdS)}, chestS: ${r(t.spine.chestS)}, head: ${r(t.spine.head)} },                 // torso offsets at full reach (deg)
  leftHold: ${arr(t.leftHold)},                      // left hand on the holder: [along the draw axis from the mouth, up, outward] (m)
  rest: ${arr(t.rest)},                                  // left hand resting on the pommel while he stands: [along the axis from the mouth, outward, forward] (m)
};
`;
const p = new URL('../src/sword.js', import.meta.url), s = fs.readFileSync(p, 'utf8'), a = s.indexOf('export const TUNE = {'), b = s.indexOf('let M_B');
fs.writeFileSync(p, s.slice(0, a) + body + s.slice(b));
console.log('TUNE written from', process.argv[2]);
