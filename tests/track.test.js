// The geometry that turns a scribble into a circuit.
//
// This is the file that decides whether a four-year-old's drawing becomes a
// racetrack or a rejection, so it is tested from both ends: a wide sweep of
// synthetic "hands" must all come out raceable, and the specific shapes that
// genuinely cannot be raced must be refused with the RIGHT sentence — a wrong
// message is as bad as a wrong verdict, because it sends the player to fix
// something that was never the problem.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Track, Generate, RNG, FIELD, HALF_W, MIN_RADIUS, TAU, MIN_LOOP, NODE_SPACING } = S;

// A wobbly hand-drawn loop: an off-round oval plus per-sample jitter.
function hand(seed, { wobble = 14, n = 200, rx = 240, ry = 340, lobes = 3 } = {}) {
  const r = RNG.make(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + Math.sin(a * lobes + seed) * 0.14;
    pts.push({
      x: FIELD.w / 2 + Math.cos(a) * rx * k + r.range(-wobble, wobble),
      y: FIELD.h / 2 + Math.sin(a) * ry * k + r.range(-wobble, wobble),
    });
  }
  return pts;
}

/* ------------------------------------------------------------ the sweep -- */

test("every ordinary hand-drawn loop becomes a raceable circuit", () => {
  const fails = [];
  for (let seed = 1; seed <= 120; seed++) {
    const res = Track.fromScribble(hand(seed, { wobble: 8 + (seed % 5) * 6 }));
    if (!res.ok) fails.push(`seed ${seed}: ${res.problems[0]}`);
  }
  assert.deepEqual(fails, []);
});

test("a very shaky hand still works — the fix-up is doing the job, not luck", () => {
  // 26 units of jitter on a 78-wide track is a stroke that wanders more than
  // half a track width. If this ever fails, `relax` has stopped smoothing.
  const fails = [];
  for (let seed = 1; seed <= 40; seed++) {
    const res = Track.fromScribble(hand(seed, { wobble: 26, n: 300 }));
    if (!res.ok) fails.push(`seed ${seed}: ${res.problems[0]}`);
  }
  assert.deepEqual(fails, []);
});

test("no built circuit has a corner tighter than a car can take", () => {
  const bad = [];
  for (let seed = 1; seed <= 60; seed++) {
    const res = Track.fromScribble(hand(seed, { wobble: 18, lobes: 5 }));
    if (!res.ok) continue;
    const r = res.track.minRadius();
    // The linter's own tolerance is 0.82 of the target; anything the pipeline
    // ships has to clear that or the two disagree.
    if (r < MIN_RADIUS * 0.82) bad.push(`seed ${seed}: radius ${r.toFixed(1)}`);
  }
  assert.deepEqual(bad, []);
});

test("the tightest allowed corner still leaves the physics a positive radius", () => {
  // game.js divides by (1 - curvature * offset). At the inside edge of the
  // tightest legal corner that is (1 - HALF_W/MIN_RADIUS), and if MIN_RADIUS
  // ever creeps down toward HALF_W the sim divides by ~0 and cars teleport.
  assert.ok(MIN_RADIUS > HALF_W * 1.4,
    `MIN_RADIUS ${MIN_RADIUS} must comfortably exceed HALF_W ${HALF_W}`);
  assert.ok(1 - HALF_W / MIN_RADIUS > 0.3);
});

/* ------------------------------------------------- the refusals, by name -- */

const problemOf = (pts, spec) => (Track.fromScribble(pts, spec).problems || [])[0] || "";

test("a loop too small to race is refused for being small", () => {
  const tiny = [];
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * TAU;
    tiny.push({ x: 350 + Math.cos(a) * 70, y: 500 + Math.sin(a) * 70 });
  }
  assert.match(problemOf(tiny), /too small/);
});

test("a figure-8 is refused for crossing itself", () => {
  const eight = [];
  for (let i = 0; i < 260; i++) {
    const a = (i / 260) * TAU;
    eight.push({ x: 350 + Math.sin(a * 2) * 230, y: 500 + Math.sin(a) * 340 });
  }
  assert.match(problemOf(eight), /crosses over itself/);
});

test("a stroke that never comes back is refused for not joining up", () => {
  const open = [];
  for (let i = 0; i < 120; i++) open.push({ x: 90 + i * 4, y: 500 + Math.sin(i / 12) * 60 });
  assert.match(problemOf(open), /finish where you started/);
});

test("a track drawn slightly over a tree is nudged clear rather than rejected", () => {
  // The common case, and the one that decides whether a child keeps playing:
  // they meant to go round it and clipped the edge. The repair should fix that
  // silently, and the result must genuinely clear the tree.
  const tree = { kind: "tree", x: 350, y: 200, r: 34 };
  const pts = [];
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * TAU;
    pts.push({ x: 350 + Math.cos(a) * 240, y: 500 + Math.sin(a) * 320 });
  }
  // Shift the loop so its top edge runs straight through the tree.
  const spec = { obstacles: [{ ...tree, y: 190 }] };
  const res = Track.fromScribble(pts, spec);
  assert.equal(res.ok, true, res.problems[0]);
  let closest = Infinity;
  for (let s = 0; s < res.track.len; s += 4) {
    const p = res.track.at(s);
    closest = Math.min(closest, Math.hypot(p.x - spec.obstacles[0].x, p.y - spec.obstacles[0].y));
  }
  assert.ok(closest >= spec.obstacles[0].r + HALF_W - 1, `tarmac still ${closest.toFixed(1)} from the tree`);
});

test("a field with nowhere to drive is refused for the obstacle, and named", () => {
  // Wider than the field can route around, so no amount of nudging saves it.
  const spec = { obstacles: [{ kind: "pond", x: FIELD.w / 2, y: FIELD.h / 2, r: 320 }] };
  const pts = [];
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * TAU;
    pts.push({ x: FIELD.w / 2 + Math.cos(a) * 250, y: FIELD.h / 2 + Math.sin(a) * 340 });
  }
  assert.match(problemOf(pts, spec), /over the pond/);
});

test("a checkpoint the player went nowhere near is reported as a MISSED CHECKPOINT", () => {
  // The repair used to drag the nearest point all the way to a distant ring,
  // which drew a spike that crossed its own neck — so the player was told
  // their track crossed itself when they had simply missed a ring.
  const spec = { gates: [{ x: 120, y: 880, r: 60 }] };
  const pts = [];
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * TAU;
    pts.push({ x: 380 + Math.cos(a) * 200, y: 330 + Math.sin(a) * 230 });
  }
  assert.match(problemOf(pts, spec), /checkpoint/);
});

test("a checkpoint only just missed is pulled in, because that was a wobble", () => {
  const gate = { x: 350, y: 130, r: 76 };
  const pts = [];
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * TAU;
    pts.push({ x: 350 + Math.cos(a) * 250, y: 520 + Math.sin(a) * 330 });   // top edge ~190, gate at 130
  }
  const res = Track.fromScribble(pts, { gates: [gate] });
  assert.equal(res.ok, true, res.problems[0]);
});

test("a rejected drawing still hands back the repaired line to show the player", () => {
  const eight = [];
  for (let i = 0; i < 260; i++) {
    const a = (i / 260) * TAU;
    eight.push({ x: 350 + Math.sin(a * 2) * 230, y: 500 + Math.sin(a) * 340 });
  }
  const res = Track.fromScribble(eight);
  assert.equal(res.ok, false);
  assert.ok(res.line && res.line.length > 20, "the drawing screen needs something to draw");
});

/* ---------------------------------------------------------- the rescue -- */

// "Fix my track" promises a raceable circuit whatever the player drew. `Draw`
// cannot be loaded headless, so this composes the same ladder its handler does:
// repair the drawing, else rebuild it in the shape they drew, else generate one.
function fixLadder(raw, spec = {}) {
  const repaired = Track.repair(raw, spec);
  if (repaired.ok) return { by: "repair", track: repaired.track };
  const shaped = Generate.fromShape(repaired.line || raw, spec, 12345);
  if (shaped) return { by: "fromShape", track: shaped.track };
  const made = Generate.solve(spec, { seed: 999 });
  if (made) return { by: "generate", track: made.track };
  return null;
}

const ring = (cx, cy, rx, ry, n = 200) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
};

test("the fix ladder rescues every drawing that cannot be raced", () => {
  const cases = {
    "a coin-sized loop": [ring(350, 500, 70, 70), {}],
    "a figure-8": [(() => {
      const p = [];
      for (let i = 0; i < 260; i++) {
        const a = (i / 260) * TAU;
        p.push({ x: 350 + Math.sin(a * 2) * 230, y: 500 + Math.sin(a) * 340 });
      }
      return p;
    })(), {}],
    "a loop drawn over the barn": [ring(350, 500, 250, 330),
      { obstacles: [{ kind: "barn", x: 350, y: 220, r: 40 }] }],
    "a loop that misses a ring entirely": [ring(380, 330, 200, 230),
      { gates: [{ x: 120, y: 880, r: 60 }] }],
    "a loop far too big for a tight challenge": [ring(350, 500, 300, 430), { maxLen: 1500 }],
    "a lopsided scrawl": [(() => {
      const p = [];
      for (let i = 0; i < 240; i++) {
        const a = (i / 240) * TAU;
        const r = 120 + Math.sin(a * 5) * 90 + Math.sin(a * 11) * 50;
        p.push({ x: 350 + Math.cos(a) * r, y: 500 + Math.sin(a) * r * 1.4 });
      }
      return p;
    })(), {}],
  };

  // Only the drawings the ordinary pipeline actually refuses are interesting
  // here — the rest are evidence that the everyday repair is doing its job, not
  // failures of this test. Asserting a hand-written case must be broken makes
  // the suite fragile against improvements to that repair.
  const broken = Object.entries(cases).filter(([, [raw, spec]]) => !Track.fromScribble(raw, spec).ok);
  assert.ok(broken.length >= 4,
    `only ${broken.length} of the pathological drawings are still refused — add harder ones`);

  const fails = [];
  for (const [name, [raw, spec]] of broken) {
    const fixed = fixLadder(raw, spec);
    if (!fixed) { fails.push(`${name}: the fix button would have failed`); continue; }
    const problems = Track.lint(fixed.track.pts, spec);
    if (problems.length) fails.push(`${name}: fixed to something still broken — ${problems[0]}`);
  }
  assert.deepEqual(fails, []);
});

test("the fix ladder keeps the player's own shape when it can", () => {
  // A loop that only just clips a tree should come back recognisably theirs,
  // not replaced with a generated circuit somewhere else on the field.
  const spec = { obstacles: [{ kind: "tree", x: 350, y: 190, r: 34 }] };
  const raw = ring(350, 500, 240, 320);
  const before = Track.fromScribble(raw, spec);
  const fixed = Track.repair(raw, spec);
  assert.equal(fixed.ok, true, "the repair rungs should have handled this alone");
  // Centroid should barely move — same circuit, nudged.
  const mid = (pts) => pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  const a = mid(before.line), b = mid(fixed.line);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 90, "the repaired circuit wandered off");
});

/* -------------------------------------------------------- the sampling -- */

test("arc length wraps, so a lap has no seam", () => {
  const t = Track.fromScribble(hand(7)).track;
  const a = t.toWorld(120, 18), b = t.toWorld(120 + t.len, 18), c = t.toWorld(120 - t.len, 18);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6);
  assert.ok(Math.hypot(a.x - c.x, a.y - c.y) < 1e-6);
});

test("the centre line is where the sampler says it is, all the way round", () => {
  const t = Track.fromScribble(hand(11)).track;
  let worst = 0;
  for (let s = 0; s < t.len; s += 3) {
    const { d } = t.nearest(t.at(s).x, t.at(s).y);
    worst = Math.max(worst, d);
  }
  // `nearest` snaps to the closest NODE, so half a node spacing is the floor.
  assert.ok(worst < NODE_SPACING, `centre line off by ${worst.toFixed(2)}`);
});

test("the outside of a corner is faster than the inside, and shorter is the trade", () => {
  const t = Track.fromScribble(hand(3, { lobes: 4 })).track;
  // Find the sharpest corner and check the racing-line trade-off exists there.
  let bs = 0, bk = 0;
  for (let s = 0; s < t.len; s += 4) {
    const k = t.curvAt(s);
    if (Math.abs(k) > Math.abs(bk)) { bk = k; bs = s; }
  }
  const inside = Math.sign(bk) * (HALF_W - 6), outside = -Math.sign(bk) * (HALF_W - 6);
  assert.ok(t.limitAt(bs, outside, 190) > t.limitAt(bs, inside, 190), "the outside line must carry more speed");
  assert.ok(t.advance(bs, inside) < t.advance(bs, outside), "the inside line must cover less ground");
  assert.ok(t.advance(bs, inside) > 0.25, "and the sim must never divide by ~0");
});

test("the ideal lap is a real lower bound — no track claims to be quicker than its own speed limit", () => {
  const stock = { grip: 190, top: 208, accel: 96, brake: 168 };
  for (let seed = 1; seed <= 20; seed++) {
    const t = Track.fromScribble(hand(seed)).track;
    const ideal = t.idealLap(stock);
    assert.ok(ideal > t.len / stock.top * 0.999, `seed ${seed}: ideal lap beats flat out everywhere`);
    assert.ok(ideal < t.len / 40, `seed ${seed}: ideal lap ${ideal.toFixed(1)}s is implausibly slow`);
  }
});

/* ------------------------------------------------------------ the save --- */

test("a saved circuit comes back the same shape", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const t = Track.fromScribble(hand(seed)).track;
    const round = Track.decode(Track.encode(t.pts));
    assert.ok(round, `seed ${seed} failed to decode`);
    const back = Track.make(round);
    assert.ok(Math.abs(back.len - t.len) / t.len < 0.02, `seed ${seed}: length drifted ${(back.len - t.len).toFixed(1)}`);
    assert.deepEqual(Track.lint(round), [], `seed ${seed}: a saved circuit stopped being raceable`);
  }
});

test("a saved circuit is small enough to ride the family sync", () => {
  const t = Track.fromScribble(hand(5, { rx: 300, ry: 430 })).track;
  const enc = Track.encode(t.pts);
  assert.ok(enc.length < 900, `${enc.length} chars is too big for a progress document`);
});

test("garbage decodes to nothing rather than to a broken track", () => {
  for (const junk of ["", "xx", "not-a-track", null, undefined, "abc", "0".repeat(33)]) {
    assert.equal(Track.decode(junk), null, `decoded ${JSON.stringify(junk)}`);
  }
});
