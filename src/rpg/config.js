// All the numbers of the RPG in one place (waves, damage, drops, prices, the robot's recipe). Change them here, nothing else needs to be touched.
export const CFG = {
  waves: {
    total: 10,
    base: 4.5, growth: 1.3,        // skeletons in wave n = round(base * growth^(n-1)): 5, 6, 8, 10, 13, 17, 22, 28, 37, 48
    spawnEvery: 1.3,               // seconds between two spawns (they never all appear at once)
    aliveBase: 4, aliveEveryWaves: 2, // at most aliveBase + floor(n / aliveEveryWaves) skeletons are alive at a time (the pool below caps it)
    poolSize: 8,                   // skeleton bodies built at load time and re-used (a dead one is parked, then spawned again)
    clearBonus: 15,                // coins for clearing a wave: clearBonus * n
    healOnClear: 0.5,              // fraction of max HP restored between waves
  },
  player: { hp: 100, downsAllowed: 2, getUpHp: 0.6, invuln: 2.5, hpPerLevel: 20, dmgPerLevel: 0.1 }, // downsAllowed: knock-downs (HP bar empty) the player survives; the next one eliminates him
  dmg: { player: 0.12, enemy: 0.05, ally: 0.16, enemyPerWave: 0.05 }, // damage of a landed blow = the move's impulse * factor (a jab 85 -> 10, a slash 120 -> 6)
  skeleton: { hp: 30, hpPerWave: 0.1, runFromWave: 4, speed: 0.85, burst: [1.2, 1.0], swingRange: 1.4, corpseSeconds: 3.2 }, // pretty weak: 30 HP, slow swings, in bursts, they walk until wave 4
  drops: {
    coins: [1, 3], coinValue: 4, coinValuePerWave: 0.5, // coins per skeleton, value of one coin (+ per wave)
    bagChance: 0.3, bagItems: [1, 2],                 // a loot bag with crafting materials
    weights: { scrap: 55, copper: 22, magnesium: 13, circuit: 10 },
    magnet: 2.6, pickup: 0.9, lifetime: 120,         // loot is pulled to the player within `magnet` metres and picked up within `pickup`
  },
  lootModels: { coin: null, bag: null }, // your own models: 'coin.glb' / 'lootbag.glb' (next to index.html); null = a placeholder shape
  materials: { scrap: 'Scrap metal', copper: 'Copper', magnesium: 'Magnesium', circuit: 'Circuit board' },
  // the shop. price: a number, or one price per level (levels: how often it can be bought); once: a single permanent purchase; recipe: materials (+ price) instead of / besides coins
  shop: [
    { id: 'sword', name: 'Longsword', desc: 'Unlocks the sword (F draws / sheathes it)', price: 120, once: true },
    { id: 'tonic', name: 'Healing tonic', desc: '+50 HP right now', price: 30 },
    { id: 'hp', name: 'Vitality', desc: '+20 max HP', price: [80, 140, 200, 280, 360], levels: 5 },
    { id: 'dmg', name: 'Strength', desc: '+10% damage', price: [100, 180, 260, 340, 420], levels: 5 },
    { id: 'robot_buy', name: 'Buy a robot ally', desc: 'A robot fights beside you', price: 700, once: true, robot: true },
    { id: 'robot_craft', name: 'Craft a robot ally', desc: 'Build it from loot (no coins)', recipe: { scrap: 10, copper: 6, magnesium: 4, circuit: 3 }, once: true, robot: true },
  ],
};
export const waveSize = (n) => Math.round(CFG.waves.base * Math.pow(CFG.waves.growth, n - 1));
export const maxAlive = (n) => Math.min(CFG.waves.poolSize - 1, CFG.waves.aliveBase + Math.floor(n / CFG.waves.aliveEveryWaves));
