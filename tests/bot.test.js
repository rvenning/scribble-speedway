// Balance — the campaign, driven by bots.
//
// The cast, and what each one is for:
//
//   ace   the guardrail. Nothing in the campaign may be beyond it.
//   kid   the tuning target. Aims at the racing line but wanders and lifts
//         late — a child who understands the corner and cannot hold the line.
//         It must sometimes win and sometimes not, and must ALWAYS finish.
//   idle  the control. Holds no input at all.
//
// `idle` needs a word, because in this game "doing nothing" is not passive: the
// throttle is automatic and the car follows the road, so a player who never
// touches the screen still completes the race — slowly, sliding wide out of
// every corner and onto the grass. That is deliberate. A five-year-old must
// never be stranded. So the assertion is not "idle loses" in the abstract, it
// is that idle never WINS and never earns more than the participation star,
// which is what makes steering worth doing.
//
// Run `node tests/bot.test.js --report` for the per-challenge table.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Track, Generate, Game, RULES, CHALLENGES, carStats, UPGRADES, SKINS } = S;

const REPORT = process.argv.includes("--report");

// The error model IS the design document, so each term names a real mistake.
//
// `kid` used to be the clever line plus uniform random noise, and that was
// wrong in a way that quietly inverted the whole report: random steering is a
// worse strategy than no steering at all, so the child bot came out SLOWER than
// the bot holding no input, and every conclusion drawn from the gap between
// them was backwards. A small child on a touchscreen does not add noise to a
// racing line — they hold a side of the screen or nothing (coarse), and they
// react to the corner after it has started (lag).
const BRAINS = {
  ace: { line: 1.0, aggr: 1.0, coarse: false, lag: 0, wobble: 0 },
  kid: { line: 0.60, aggr: 0.82, coarse: true, lag: 14, wobble: 0.12 },
  idle: null,
};

// One race, driven by one brain, at one loadout.
function race(track, ch, brainName, prog = {}, seed = 1) {
  S.__reseed(seed);
  const brain = BRAINS[brainName];
  Game.start({
    track, challenge: ch, challengeIdx: 0, mode: "campaign",
    stats: carStats(prog), assist: false, skin: SKINS[0],
    profile: { name: "Bot", avatar: "🤖" },
  });
  const me = Game.cars[0];
  if (brain) { me.line = 0.80 * brain.line; me.aggr = 0.93 * brain.aggr; }
  Game.phase = "race"; Game.countdown = 0;         // skip the lights

  let f = 0, wob = 0;
  const hist = [];
  while (Game.running && f < 60 * 300) {
    if (!brain) { Game.input.steer = 0; Game.input.brake = false; }
    else {
      hist.push(Game.aim(me));
      let steer = hist[Math.max(0, hist.length - 1 - brain.lag)];
      if (brain.coarse) steer = Math.abs(steer) > 0.28 ? Math.sign(steer) : 0;
      // The bot's own randomness must come from the SANDBOX's seeded
      // Math.random, or the suite passes and fails at random while the engine
      // it drives looks perfectly deterministic.
      if (brain.wobble && f % 24 === 0) wob = (S.__rand() * 2 - 1) * brain.wobble;
      Game.input.steer = Math.max(-1, Math.min(1, steer + wob));
      Game.input.brake = Game.needBrake(me, me.aggr);
    }
    Game.update(1 / 60);
    f++;
  }
  return Game.result || { place: 99, stars: 0, coins: 0, time: f / 60, finished: false, timedOut: true };
}

// One circuit per challenge, generated the way the "draw it for me" button
// would — so the table measures the challenge rather than one lucky drawing.
const TRACKS = CHALLENGES.map((c, i) => {
  const spec = { obstacles: c.obstacles, gates: c.gates, minLen: c.minLen, maxLen: c.maxLen };
  const g = Generate.solve(spec, { seed: 100 + i });
  assert.ok(g, `challenge ${i + 1} (${c.name}) has no circuit — see generate.test.js`);
  return g.track;
});

// A player who races each challenge once, in order, banks what it actually
// pays, and spends on the cheapest thing available. Neither of the fictions:
// not a stock car in chapter 4, and not a full garage in chapter 1.
function progression(brainName) {
  const prog = { coinsEarned: 0, coinsSpent: 0, upgrades: {} };
  const bal = () => prog.coinsEarned - prog.coinsSpent;
  const rows = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    const r = race(TRACKS[i], CHALLENGES[i], brainName, prog, 7000 + i);
    prog.coinsEarned += r.coins;
    rows.push({ i, ...r, garage: { ...prog.upgrades } });
    for (;;) {
      let best = null;
      for (const u of UPGRADES) {
        const lvl = prog.upgrades[u.id] || 0;
        if (lvl >= u.costs.length) continue;
        const cost = u.costs[lvl];
        if (cost <= bal() && (!best || cost < best.cost)) best = { u, cost };
      }
      if (!best) break;
      prog.coinsSpent += best.cost;
      prog.upgrades[best.u.id] = (prog.upgrades[best.u.id] || 0) + 1;
    }
  }
  return rows;
}

const ACE = progression("ace");
const KID = progression("kid");
const IDLE = CHALLENGES.map((c, i) => race(TRACKS[i], c, "idle", {}, 9000 + i));

// The control bot gets a WIDER net than one circuit per challenge, because the
// player draws the track and how well "hold no input" does depends entirely on
// the drawing. A single circuit each said the control bot always came last; six
// circuits each said it won eleven races, at every difficulty in the campaign,
// and every one of those was a real defect in the physics or the AI.
const IDLE_SEEDS = [100, 250, 400, 550, 700, 850];
const IDLE_WIDE = [];
for (let i = 0; i < CHALLENGES.length; i++) {
  const c = CHALLENGES[i];
  const spec = { obstacles: c.obstacles, gates: c.gates, minLen: c.minLen, maxLen: c.maxLen };
  for (const s of IDLE_SEEDS) {
    const g = Generate.solve(spec, { seed: s + i });
    if (g) IDLE_WIDE.push({ i, seed: s, ...race(g.track, c, "idle", {}, 9000 + i + s) });
  }
}

if (REPORT) {
  console.log("\n #  challenge             len    par    ace   kid  idle | place a/k/i | stars a/k/i | coins");
  for (let i = 0; i < CHALLENGES.length; i++) {
    const a = ACE[i], k = KID[i], d = IDLE[i];
    console.log(
      String(i + 1).padStart(2), CHALLENGES[i].name.padEnd(20),
      TRACKS[i].len.toFixed(0).padStart(5), a.par.toFixed(1).padStart(6),
      a.time.toFixed(1).padStart(6), k.time.toFixed(1).padStart(5), d.time.toFixed(1).padStart(5),
      "|", `${a.place}/${k.place}/${d.place}`.padStart(9),
      "|", `${a.stars}/${k.stars}/${d.stars}`.padStart(10),
      "|", String(k.coins).padStart(5)
    );
  }
  const sum = (rows) => rows.reduce((s, r) => s + r.stars, 0);
  console.log(`\nstars — ace ${sum(ACE)}/54 · kid ${sum(KID)}/54 · idle ${sum(IDLE)}/54`);
  console.log("kid garage at the end:", JSON.stringify(KID[KID.length - 1].garage));
}

/* ------------------------------------------------------- the guardrails -- */

test("every challenge finishes — nothing runs out the clock", () => {
  const stuck = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    for (const [name, rows] of [["ace", ACE], ["kid", KID], ["idle", IDLE]]) {
      if (rows[i].timedOut) stuck.push(`${i + 1}. ${CHALLENGES[i].name} (${name})`);
    }
  }
  assert.deepEqual(stuck, []);
});

test("a good driver with the garage they could actually have wins everything", () => {
  const lost = ACE.filter((r) => r.place !== 1).map((r) => `${r.i + 1}. ${CHALLENGES[r.i].name} came ${r.place}`);
  assert.deepEqual(lost, [], "the campaign must contain no wall");
});

test("and three-stars it, so the top grade is reachable on every challenge", () => {
  const missed = ACE.filter((r) => r.stars < 3).map((r) => `${r.i + 1}. ${CHALLENGES[r.i].name}: ${r.stars}`);
  assert.deepEqual(missed, []);
});

/* --------------------------------------------------- the tuning target --- */

test("a child never gets stuck: every challenge is finished first time", () => {
  // Finishing is always worth a star and a star always unlocks the next
  // challenge, so this IS the kindness guarantee.
  const stuck = KID.filter((r) => r.stars < 1).map((r) => `${r.i + 1}. ${CHALLENGES[r.i].name}`);
  assert.deepEqual(stuck, []);
});

test("but a child does not walk it — the campaign is sometimes lost", () => {
  const wins = KID.filter((r) => r.place === 1).length;
  assert.ok(wins >= 5, `a child won only ${wins}/18 — too discouraging`);
  assert.ok(wins <= 14, `a child won ${wins}/18 — there is nothing to beat`);
  const stars = KID.reduce((s, r) => s + r.stars, 0);
  assert.ok(stars > 24 && stars < 48, `${stars}/54 stars is outside the band worth chasing`);
});

test("the difficulty actually climbs — the last chapter is harder than the first", () => {
  const early = KID.slice(0, 5).reduce((s, r) => s + r.stars, 0) / 5;
  const late = KID.slice(13).reduce((s, r) => s + r.stars, 0) / 5;
  assert.ok(early > late, `chapter 1 averaged ${early.toFixed(2)} stars and the finale ${late.toFixed(2)}`);
});

/* --------------------------------------------------------- the control --- */

test("doing nothing wins nothing, on any circuit", () => {
  const won = IDLE_WIDE.filter((r) => r.place === 1)
    .map((r) => `${r.i + 1}. ${CHALLENGES[r.i].name} (circuit ${r.seed})`);
  assert.deepEqual(won, [], "a player who never touches the screen must never win a race");
});

test("doing nothing essentially never grades", () => {
  // Not a hard zero, and deliberately so.
  //
  // The player draws the circuit, so the population of circuits is open-ended,
  // and a few per cent of them come out flowing enough that holding the middle
  // of the road scrapes a podium against the gentlest field in the campaign.
  // The hard guarantee is the one above — a passive player never WINS, on any
  // of these — and that one is absolute.
  //
  // The generator already refuses circuits where driving does not beat not
  // driving (Generate.rewardsDriving), which is what took this from four wins
  // to none. Chasing the last few podiums meant raising that bar until the
  // generator started running out of seeds, which risks the anti-stuck
  // guarantee to fix something no player will ever notice.
  const graded = IDLE_WIDE.filter((r) => r.stars > 1);
  assert.ok(graded.length <= 3,
    `a passive player graded on ${graded.length} of ${IDLE_WIDE.length} circuits: ` +
    graded.map((r) => `${r.i + 1}/${r.seed}`).join(", "));
});

test("doing nothing finishes near the back, not mid-pack", () => {
  const mean = IDLE_WIDE.reduce((s, r) => s + r.place, 0) / IDLE_WIDE.length;
  assert.ok(mean > 6.5, `a passive player averaged ${mean.toFixed(2)} of 8 — steering has to matter more`);
});

test("steering is worth real time, not a rounding error", () => {
  // If holding no input were nearly as quick as driving, the whole game would
  // be the throttle being held down for you.
  const ratio = IDLE.reduce((s, r, i) => s + r.time / ACE[i].time, 0) / IDLE.length;
  assert.ok(ratio > 1.3, `a bot that never steers was only ${((ratio - 1) * 100).toFixed(0)}% slower`);
});

/* ---------------------------------------------------------- the garage --- */

test("the garage is worth buying — the same driver is quicker with it fitted", () => {
  const kitted = { coinsEarned: 9999, coinsSpent: 0, upgrades: { grip: 4, top: 4, accel: 3, brakes: 3 } };
  let better = 0;
  for (let i = 0; i < CHALLENGES.length; i += 4) {
    const stock = race(TRACKS[i], CHALLENGES[i], "kid", {}, 500 + i);
    const full = race(TRACKS[i], CHALLENGES[i], "kid", kitted, 500 + i);
    if (full.time < stock.time * 0.97) better++;
  }
  assert.ok(better >= 4, "a full garage barely moved the lap times");
});

test("but a full garage does not erase the game", () => {
  const kitted = { coinsEarned: 9999, coinsSpent: 0, upgrades: { grip: 4, top: 4, accel: 3, brakes: 3 } };
  const last = race(TRACKS[17], CHALLENGES[17], "kid", kitted, 4242);
  assert.ok(last.time > last.par * 0.7, "the finale collapsed once everything was bought");
});

/* ------------------------------------------------------------- the par --- */

test("par is a property of the circuit, not of the car in the garage", () => {
  // Par must not move as the player upgrades, or the third star runs away from
  // the very purchases bought to catch it.
  const stock = race(TRACKS[0], CHALLENGES[0], "ace", {}, 1);
  const kitted = race(TRACKS[0], CHALLENGES[0], "ace", { upgrades: { grip: 4, top: 4 } }, 1);
  assert.ok(Math.abs(stock.par - kitted.par) < 1e-9);
});

test("a longer circuit gets a longer par, so drawing a small one is no cheat", () => {
  const short = TRACKS.reduce((a, b) => (a.len < b.len ? a : b));
  const long = TRACKS.reduce((a, b) => (a.len > b.len ? a : b));
  const ch = CHALLENGES[0];
  assert.ok(S.parTime(long, ch) > S.parTime(short, ch));
});
