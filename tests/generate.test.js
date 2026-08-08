// The generator, and with it the game's anti-stuck guarantee.
//
// "Draw it for me" is the only reason a child who cannot yet draw a closed loop
// through three rings is not simply stopped. It calls `Generate.solve`, so if
// solve fails on a challenge, that challenge is a wall — which is the one thing
// the campaign is not allowed to contain. Every challenge and a year of Daily
// fields are checked here.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Track, Generate, RNG, CHALLENGES, FIELD, HALF_W, TRACK_W, MIN_LOOP } = S;

test("every campaign challenge can be solved by the generator", () => {
  const fails = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    const c = CHALLENGES[i];
    const spec = { obstacles: c.obstacles, gates: c.gates, minLen: c.minLen || MIN_LOOP, maxLen: c.maxLen };
    const g = Generate.solve(spec, { seed: 1000 + i });
    if (!g) fails.push(`${i + 1}. ${c.name}: no circuit in ${Generate.MAX_TRIES} tries`);
  }
  assert.deepEqual(fails, []);
});

test("and solved from any starting seed, not one lucky one", () => {
  // The button uses a random seed every press. If a challenge only works from
  // some seeds, a child gets "hmm, that one is tricky" at random.
  const fails = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    const c = CHALLENGES[i];
    const spec = { obstacles: c.obstacles, gates: c.gates, minLen: c.minLen || MIN_LOOP, maxLen: c.maxLen };
    for (const seed of [7, 31337, 999983, 5, 42]) {
      if (!Generate.solve(spec, { seed })) fails.push(`${i + 1}. ${c.name} @ seed ${seed}`);
    }
  }
  assert.deepEqual(fails, []);
});

test("a generated circuit passes the same linter a drawn one does", () => {
  const fails = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    const c = CHALLENGES[i];
    const spec = { obstacles: c.obstacles, gates: c.gates, minLen: c.minLen || MIN_LOOP, maxLen: c.maxLen };
    const g = Generate.solve(spec, { seed: 2000 + i });
    if (!g) continue;
    const problems = Track.lint(g.line, spec);
    if (problems.length) fails.push(`${i + 1}. ${c.name}: ${problems.join("; ")}`);
  }
  assert.deepEqual(fails, []);
});

test("a generated circuit really does go through every ring and around every obstacle", () => {
  // The linter already says so; this checks it from the outside, on the actual
  // sampled track rather than on the line handed to the linter.
  const fails = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    const c = CHALLENGES[i];
    if (!c.gates.length && !c.obstacles.length) continue;
    const spec = { obstacles: c.obstacles, gates: c.gates, minLen: c.minLen || MIN_LOOP, maxLen: c.maxLen };
    const g = Generate.solve(spec, { seed: 3000 + i });
    if (!g) continue;
    for (const gate of c.gates) {
      let best = Infinity;
      for (let s = 0; s < g.track.len; s += 5) {
        const p = g.track.at(s);
        best = Math.min(best, Math.hypot(p.x - gate.x, p.y - gate.y));
      }
      if (best > gate.r) fails.push(`${i + 1}. ${c.name}: missed a ring by ${(best - gate.r).toFixed(1)}`);
    }
    for (const o of c.obstacles) {
      let best = Infinity;
      for (let s = 0; s < g.track.len; s += 5) {
        const p = g.track.at(s);
        best = Math.min(best, Math.hypot(p.x - o.x, p.y - o.y));
      }
      if (best < o.r + HALF_W - 1) fails.push(`${i + 1}. ${c.name}: tarmac ${(o.r + HALF_W - best).toFixed(1)} into the ${o.kind}`);
    }
  }
  assert.deepEqual(fails, []);
});

test("a whole year of Daily Circuits is drawable", () => {
  const fails = [];
  for (let d = 0; d < 365; d += 7) {          // every 7th day: 53 fields
    const date = RNG.today(new Date(2026, 0, 1 + d));
    const f = Generate.field(date);
    if (!Generate.solve(f, { seed: f.seed })) fails.push(`${date}: unsolvable field`);
  }
  assert.deepEqual(fails, []);
});

test("the Daily field is the same for everyone on the same day, and different the next", () => {
  const a = Generate.field("2026-08-08");
  const b = Generate.field("2026-08-08");
  const c = Generate.field("2026-08-09");
  assert.deepEqual(a, b, "two players on the same day must get the same field");
  assert.notDeepEqual(a.obstacles, c.obstacles, "and a new one tomorrow");
});

test("Daily scenery never crowds a ring or the field edge", () => {
  const fails = [];
  for (let d = 0; d < 120; d += 3) {
    const date = RNG.today(new Date(2026, 0, 1 + d));
    const f = Generate.field(date);
    for (const o of f.obstacles) {
      if (o.x < 100 || o.y < 100 || o.x > FIELD.w - 100 || o.y > FIELD.h - 100) fails.push(`${date}: ${o.kind} in the corner`);
    }
    for (const g of f.gates) {
      for (const o of f.obstacles) {
        if (Math.hypot(o.x - g.x, o.y - g.y) < o.r + TRACK_W) fails.push(`${date}: a ring sits inside a ${o.kind}`);
      }
    }
  }
  assert.deepEqual(fails, []);
});

test("the generator finds most circuits quickly enough to feel instant", () => {
  // Each try runs the whole fix-up pipeline, so a challenge that needs dozens
  // of them is a visible freeze on the "draw it for me" button.
  const slow = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    const c = CHALLENGES[i];
    const spec = { obstacles: c.obstacles, gates: c.gates, minLen: c.minLen || MIN_LOOP, maxLen: c.maxLen };
    let total = 0;
    for (const seed of [11, 22, 33, 44]) {
      const g = Generate.solve(spec, { seed });
      total += g ? g.tries : Generate.MAX_TRIES;
    }
    if (total / 4 > 25) slow.push(`${i + 1}. ${c.name}: ${(total / 4).toFixed(1)} tries on average`);
  }
  assert.deepEqual(slow, []);
});
