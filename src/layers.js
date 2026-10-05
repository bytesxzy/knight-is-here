// Upper-body layers (the sword's draw / sheathe, the enemy's attack swings) plug into the ghost + the physics through one small interface.
// This is the "no layer" stand-in: a character without a weapon layer.
export class NoLayer {
  constructor() { this.boost = 3; this.handFF = 0; this.worldW = 0.9; this.torsoRelax = 0; this.handK = 1; this.handMax = 400; this.p = 0; this.dir = 0; this.act = 0; this.walkW = 0; this.canStart = null; }
  get drawn() { return false; }
  get busy() { return false; }
  step() {}
  armW() { return 0; }
  spineW() { return 0; }
  gripW() { return 0; }
  curl() { return 0; }
  toggle() { return false; }
  request() { return false; }
}
