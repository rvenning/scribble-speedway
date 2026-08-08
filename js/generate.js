// Procedural circuits — the "draw it for me" button, and the Daily field.
//
// Every loop is built in POLAR coordinates around a centre: one radius per
// angle, angles strictly increasing once around. A star-shaped polygon cannot
// cross itself, so the hardest thing to get right about a generated racetrack
// is true by construction rather than by a check afterwards — the same trick as
// authoring a cave by waypoints instead of by pixels.
//
// It also makes checkpoint rings trivial: a gate simply IS one of the spokes,
// at its own angle and its own distance from the centre, so a generated track
// goes through it by construction too.
//
// What is left over — a corner too tight, tarmac over a pond, a loop that came
// out too short — is handled the way a player's drawing is: run it through the
// same relax-and-lint pipeline in track.js, and if it still fails, try the next
// seed. `solve()` is therefore the game's anti-stuck guarantee, and
// tests/generate.test.js asserts it succeeds for every challenge in the
// campaign and for a year of Daily fields.

const Generate = {
  MAX_TRIES: 240,

  // How far the field boundary is from `c` along `ang`, so a spoke can be
  // scaled as a fraction of the room it actually has rather than of a circle
  // that may hang off the edge.
  reach(c, ang, inset) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let m = Infinity;
    if (dx > 1e-6) m = Math.min(m, (FIELD.w - inset - c.x) / dx);
    if (dx < -1e-6) m = Math.min(m, (inset - c.x) / dx);
    if (dy > 1e-6) m = Math.min(m, (FIELD.h - inset - c.y) / dy);
    if (dy < -1e-6) m = Math.min(m, (inset - c.y) / dy);
    return Math.max(40, m);
  },

  // One candidate centre line. Returns raw points — the caller runs them
  // through the fix-up pipeline.
  loop(seed, { gates = [] } = {}) {
    const r = RNG.sub(seed, "loop");
    const inset = HALF_W + EDGE_MARGIN + 4;
    const c = { x: FIELD.w / 2 + r.range(-46, 46), y: FIELD.h / 2 + r.range(-30, 30) };

    // Gates are pinned spokes; the rest fill the gaps between them.
    const pinned = gates.map((g) => ({
      ang: Math.atan2(g.y - c.y, g.x - c.x),
      rad: Math.hypot(g.x - c.x, g.y - c.y),
      pin: true,
    })).sort((a, b) => a.ang - b.ang);

    const spokes = [];
    const want = r.int(9, 13);
    const filler = [];
    for (let i = 0; i < want; i++) {
      const base = -Math.PI + (i + 0.5) * (TAU / want);
      filler.push({ ang: base + r.range(-0.34, 0.34) * (TAU / want), pin: false });
    }
    for (const s of pinned.concat(filler).sort((a, b) => a.ang - b.ang)) {
      // Drop any spoke that crowds the one before it: two spokes at nearly the
      // same angle make a spike no amount of smoothing removes.
      if (spokes.length && s.ang - spokes[spokes.length - 1].ang < 0.28) {
        if (s.pin && !spokes[spokes.length - 1].pin) spokes.pop();
        else continue;
      }
      spokes.push(s);
    }
    if (spokes.length < 6) return null;

    const pts = [];
    for (let i = 0; i < spokes.length; i++) {
      const s = spokes[i];
      const max = Generate.reach(c, s.ang, inset);
      // Each spoke's length comes from its OWN generator, keyed on which spoke
      // it is — so adding a gate (and with it a spoke) does not reshuffle
      // every other spoke of the same seed.
      const rad = s.pin ? Math.min(s.rad, max) : max * (0.56 + RNG.sub(seed, "spoke", i)() * 0.34);
      pts.push({ x: c.x + Math.cos(s.ang) * rad, y: c.y + Math.sin(s.ang) * rad });
    }
    return pts;
  },

  // The first seed whose loop survives the fix-up and the linter.
  // `spec` is anything with { obstacles, gates, minLen, maxLen }.
  solve(spec = {}, { seed = 1, tries = Generate.MAX_TRIES } = {}) {
    for (let t = 0; t < tries; t++) {
      const raw = Generate.loop((seed ^ RNG.seedFrom("try" + t)) >>> 0, spec);
      if (!raw) continue;
      // Densify before the pipeline: the pipeline resamples anyway, but a
      // 12-point polygon relaxes into a rounder shape from a denser start.
      const dense = [];
      for (let i = 0; i < raw.length; i++) {
        const a = raw[i], b = raw[(i + 1) % raw.length];
        for (let k = 0; k < 6; k++) dense.push({ x: a.x + (b.x - a.x) * (k / 6), y: a.y + (b.y - a.y) * (k / 6) });
      }
      const res = Track.fromScribble(dense, spec);
      if (res.ok) return { track: res.track, line: res.line, tries: t + 1 };
    }
    return null;
  },

  /* ------------------------------------------------------- daily field -- */

  SCENERY: [
    { kind: "pond", r: 46, icon: "🦆" },
    { kind: "tree", r: 34, icon: "🌳" },
    { kind: "haystack", r: 30, icon: "🌾" },
    { kind: "rock", r: 32, icon: "🪨" },
    { kind: "barn", r: 40, icon: "🏠" },
  ],

  // The obstacles and checkpoint rings everyone in the family gets today.
  // Nothing here is placed near the field edge: an obstacle in a corner walls
  // off a whole region of the field and makes the drawing fiddly rather than
  // interesting.
  field(dateStr) {
    const seed = RNG.seedFrom("daily|" + dateStr);
    const r = RNG.sub(seed, "field");
    const pad = 130;
    const spread = (list, x, y, gap) => list.every((o) => Math.hypot(o.x - x, o.y - y) > gap);

    const obstacles = [];
    const want = r.int(3, 5);
    for (let i = 0; i < want * 14 && obstacles.length < want; i++) {
      const kind = r.pick(Generate.SCENERY);
      const x = r.range(pad, FIELD.w - pad), y = r.range(pad, FIELD.h - pad);
      if (spread(obstacles, x, y, 190)) obstacles.push({ ...kind, x: Math.round(x), y: Math.round(y) });
    }

    const gates = [];
    const wantG = r.int(2, 3);
    for (let i = 0; i < wantG * 20 && gates.length < wantG; i++) {
      const x = r.range(pad, FIELD.w - pad), y = r.range(pad, FIELD.h - pad);
      if (!spread(gates, x, y, 260)) continue;
      if (!obstacles.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + TRACK_W + 30)) continue;
      gates.push({ x: Math.round(x), y: Math.round(y), r: 74 });
    }

    return { seed, date: dateStr, obstacles, gates, minLen: MIN_LOOP, maxLen: MAX_LOOP };
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { Generate });
