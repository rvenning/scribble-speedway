// The Garage — permanent car upgrades bought with coins.
//
// Every upgrade is a MULTIPLIER on one physics constant, applied in one place
// (`carStats`), so the engine never has to know the shop exists and a bot can
// be handed any loadout by passing a different progress object.
//
// The balance target is the progression bot in tests/bot.test.js: a player who
// races each challenge once, in order, banks what it actually pays and buys the
// cheapest affordable thing each time. Not a no-upgrade run (nobody reaches
// chapter 4 with a stock car) and not a fully-loaded one (nobody has 2000 coins
// by challenge 6).

const UPGRADES = [
  {
    id: "grip", icon: "🛞", name: "Sticky Tyres",
    desc: "Hold a tighter line without sliding wide",
    costs: [70, 150, 260, 400], value: [1.07, 1.14, 1.21, 1.28],
    fmt: (v) => `+${Math.round((v - 1) * 100)}% grip`,
  },
  {
    id: "top", icon: "🏎️", name: "Bigger Engine",
    desc: "A higher top speed down the straights",
    costs: [80, 170, 290, 440], value: [1.05, 1.10, 1.15, 1.20],
    fmt: (v) => `+${Math.round((v - 1) * 100)}% top speed`,
  },
  {
    id: "accel", icon: "⚡", name: "Turbo Start",
    desc: "Get back up to speed quicker after a corner",
    costs: [60, 140, 250], value: [1.14, 1.28, 1.42],
    fmt: (v) => `+${Math.round((v - 1) * 100)}% acceleration`,
  },
  {
    id: "brakes", icon: "🅿️", name: "Big Brakes",
    desc: "Brake later and still make the corner",
    costs: [65, 145, 255], value: [1.16, 1.32, 1.48],
    fmt: (v) => `+${Math.round((v - 1) * 100)}% braking`,
  },
];

function upgradeValue(progress, id) {
  const def = UPGRADES.find((u) => u.id === id);
  const lvl = (progress && progress.upgrades && progress.upgrades[id]) || 0;
  if (!def || lvl <= 0) return 1;
  return def.value[Math.min(lvl, def.value.length) - 1];
}

// The one place the shop meets the physics.
function carStats(progress) {
  return {
    grip: RULES.grip * upgradeValue(progress, "grip"),
    top: RULES.topSpeed * upgradeValue(progress, "top"),
    accel: RULES.accel * upgradeValue(progress, "accel"),
    brake: RULES.brake * upgradeValue(progress, "brakes"),
  };
}

if (typeof window === "undefined") Object.assign(globalThis, { UPGRADES, upgradeValue, carStats });
