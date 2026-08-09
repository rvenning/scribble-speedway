// Procedural circuits — the "draw it for me" button, the "fix my track" last
// resort, and the Daily field.
//
// Every loop is a RADIUS PROFILE in polar coordinates about one centre: one
// radius per angle, sampled on a uniform angular grid. A single-valued r(θ)
// cannot cross itself, so the hardest property of a racetrack is true by
// construction rather than by a check afterwards, and a checkpoint ring is
// simply a point on the profile, so a generated circuit drives through it by
// construction too.
//
// What changed, and why it matters: the profile used to be a dozen independent
// random radii handed straight to `relax()`, whose whole job is to round
// corners toward MIN_RADIUS — so every circuit came out a lumpy oval, and four
// of the eighteen campaign challenges produced the *identical* loop. The
// profile is now COMPOSED from features — hairpins, chicanes, S-bends,
// straights, long sweeps — placed between anchors, and legalised in the radius
// domain before it ever reaches the drawing pipeline.
//
// Legalising in r rather than in x,y is the point. Blending radii can only open
// a corner outward along its own ray: it cannot translate a straight, cannot
// close the mouth of a hairpin, and cannot break the single-valued invariant.
// `relax()` blends in x,y and therefore flattens exactly the features worth
// generating, which is why it must not be the thing that makes a generated
// shape legal.

const Generate = {
  MAX_TRIES: 240,
  // Samples around the circle. The line is resampled to NODE_SPACING (9 units)
  // downstream, which on a ~1900-unit loop is ~210 points — so 240 here is
  // already a slight oversample and 480 was pure cost in the curvature limiter.
  GRID: 240,
  INSET: HALF_W + EDGE_MARGIN + 4,

  /* ------------------------------------------------------------ helpers -- */

  // How much field there is in direction `a` from `c`, as a smooth
  // quarter-ellipse. The old version measured to the field RECTANGLE, which has
  // a curvature kink at each of the four corners — and a kink in the room
  // budget becomes a kink in any profile that leans on it.
  roomAt(c, a) {
    const dx = Math.cos(a), dy = Math.sin(a);
    const ax = Math.max(40, dx >= 0 ? FIELD.w - Generate.INSET - c.x : c.x - Generate.INSET);
    const ay = Math.max(40, dy >= 0 ? FIELD.h - Generate.INSET - c.y : c.y - Generate.INSET);
    return 1 / Math.hypot(dx / ax, dy / ay);
  },

  cyc(a) { return ((a % TAU) + TAU) % TAU; },

  /* ----------------------------------------------------------- features -- */

  // Each returns a radius for t in [0,1] between two anchors. `ra`/`rb` are the
  // anchor radii, `span` the angular width, `r` a seeded generator.
  FEATURES: {
    // A long constant-ish corner.
    sweep(t, ra, rb, span, r, memo) {
      if (memo.bulge === undefined) memo.bulge = (r() * 2 - 1) * 0.13;
      const s = t * t * (3 - 2 * t);
      return (ra + (rb - ra) * s) * (1 + memo.bulge * Math.sin(Math.PI * t));
    },

    // Genuinely zero curvature: the polar equation of the chord between the two
    // anchor points, so it meets both exactly and is dead straight between them.
    straight(t, ra, rb, span, r, memo) {
      if (!memo.line) {
        const A = { x: ra * Math.cos(memo.a0), y: ra * Math.sin(memo.a0) };
        const B = { x: rb * Math.cos(memo.a0 + span), y: rb * Math.sin(memo.a0 + span) };
        let nx = -(B.y - A.y), ny = B.x - A.x;
        const m = Math.hypot(nx, ny) || 1;
        nx /= m; ny /= m;
        let d = nx * A.x + ny * A.y;
        if (d < 0) { d = -d; nx = -nx; ny = -ny; }
        memo.line = d > 8 ? { d, phi: Math.atan2(ny, nx) } : null;
      }
      if (!memo.line) return Generate.FEATURES.sweep(t, ra, rb, span, r, memo);
      const cosd = Math.cos(memo.a0 + span * t - memo.line.phi);
      if (cosd < 0.12) return Generate.FEATURES.sweep(t, ra, rb, span, r, memo);
      return memo.line.d / cosd;
    },

    // Alternating curvature, tapered to zero at both anchors so the joins stay
    // smooth. `cycles` is what separates a chicane from a run of esses.
    esses(t, ra, rb, span, r, memo) {
      if (memo.amp === undefined) {
        memo.amp = (0.06 + r() * 0.07) * (r() < 0.5 ? -1 : 1);
        memo.cycles = 1.0 + r() * 0.5;
      }
      const s = t * t * (3 - 2 * t);
      const base = ra + (rb - ra) * s;
      return base * (1 + memo.amp * Math.sin(TAU * memo.cycles * t) * Math.sin(Math.PI * t));
    },

    chicane(t, ra, rb, span, r, memo) {
      if (memo.amp === undefined) {
        memo.amp = (0.09 + r() * 0.07) * (r() < 0.5 ? -1 : 1);
        memo.cycles = 1;
      }
      return Generate.FEATURES.esses(t, ra, rb, span, r, memo);
    },

    // Shoulders dropping to a flat inner arc — the flat bottom IS the U-turn,
    // and its radius is the inner radius. At 96 the two legs sit 192 apart,
    // comfortably clear of the linter's 74-unit self-proximity threshold, so a
    // real hairpin is legal geometry and always was.
    hairpin(t, ra, rb, span, r, memo) {
      if (memo.inner === undefined) {
        memo.inner = Math.max(96, Math.min(ra, rb) * (0.42 + r() * 0.22));
        memo.sh = 0.26 + r() * 0.06;
      }
      const sh = memo.sh, ss = (u) => u * u * (3 - 2 * u);
      if (t < sh) return ra + (memo.inner - ra) * ss(t / sh);
      if (t > 1 - sh) return memo.inner + (rb - memo.inner) * ss((t - (1 - sh)) / sh);
      return memo.inner;
    },
  },

  // Which features a gap of this angular width can hold, and how often.
  //
  // The pool is deliberately weighted toward fast shapes. An early version gave
  // every feature equal odds and produced a circuit whose every corner sat at
  // exactly MIN_RADIUS — technically varied, uniformly slow, and no more
  // interesting than the oval it replaced. Tight corners have to be punctuation
  // for the fast parts to mean anything.
  pickFeature(span, r) {
    const pool = ["sweep", "sweep", "sweep"];
    if (span > 0.50) pool.push("straight", "straight", "straight");
    if (span > 0.75) pool.push("esses");
    if (span > 0.90) pool.push("chicane");
    if (span > 1.15) pool.push("hairpin");
    return pool[Math.floor(r() * pool.length)];
  },

  /* ------------------------------------------------------------- build --- */

  // One candidate profile at free-anchor scale `k`. `profile` optionally seeds
  // the radius array directly (that is how `fromShape` reuses all of this).
  build(seed, spec, k, profile) {
    const N = Generate.GRID;
    const gates = spec.gates || [], obstacles = spec.obstacles || [];
    const r0 = RNG.sub(seed, "loop");
    const c = {
      x: FIELD.w / 2 + r0.range(-55, 55),
      y: FIELD.h / 2 + r0.range(-80, 80),
    };

    // The angles never change, so neither do their sines and cosines. The
    // curvature limiter below evaluates world positions a few hundred thousand
    // times; recomputing the trig each time made generating one circuit take a
    // third of a second, which is a visible freeze on a button press.
    const ang = new Array(N), cosA = new Array(N), sinA = new Array(N);
    for (let j = 0; j < N; j++) {
      ang[j] = -Math.PI + (j * TAU) / N;
      cosA[j] = Math.cos(ang[j]);
      sinA[j] = Math.sin(ang[j]);
    }
    const room = ang.map((a) => Generate.roomAt(c, a));
    let rad = new Array(N);

    if (profile) {
      for (let j = 0; j < N; j++) rad[j] = profile[j] * k;
    } else {
      // --- anchors: every gate, plus free ones filling any wide gap ---------
      const anchors = gates.map((g) => ({
        ang: Math.atan2(g.y - c.y, g.x - c.x),
        rad: Math.hypot(g.x - c.x, g.y - c.y),
        pin: true,
      })).sort((a, b) => a.ang - b.ang);

      // Two rings at nearly the same angle but very different distances would
      // need a near-radial leg between them: a hairpin with no room to turn in.
      // Refuse the SEED — the next one jitters the centre, which moves both —
      // rather than quietly dropping a ring the player must drive through, which
      // is what the old min-gap cull did.
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i], b = anchors[(i + 1) % anchors.length];
        if (anchors.length < 2) break;
        const span = Generate.cyc(b.ang - a.ang);
        if (span < 0.10 && Math.abs(a.rad - b.rad) > 60) return null;
      }

      // Corners need ROOM BETWEEN THEM. The racing line is the whole mechanic —
      // outside on entry, inside at the apex — and crossing the 78-unit track
      // takes a car about 90 units of travel, so corners packed 160 units apart
      // leave no room to use one. Measured: at a corner every ~160 units a
      // perfect driver averaged 117 and a car holding no input averaged 134,
      // because the good line cost distance that the next corner never let it
      // bank. Wider gaps mean fewer, better corners.
      const gapMax = 1.3 + r0() * 0.8;
      const filled = [];
      const src = anchors.length ? anchors : [{ ang: -Math.PI, rad: 0, pin: false, seedFree: true }];
      for (let i = 0; i < src.length; i++) {
        const a = src[i], b = src[(i + 1) % src.length];
        filled.push(a);
        const span = src.length === 1 ? TAU : Generate.cyc(b.ang - a.ang);
        const extra = Math.max(src.length === 1 ? 5 : 0, Math.floor(span / gapMax));
        for (let e = 1; e <= extra; e++) {
          const at = a.ang + (span * e) / (extra + 1);
          filled.push({ ang: at, rad: 0, pin: false });
        }
      }
      for (let i = 0; i < filled.length; i++) {
        if (filled[i].pin) continue;
        const rr = RNG.sub(seed, "anchor", i);
        filled[i].rad = Generate.roomAt(c, filled[i].ang) * (0.55 + rr() * 0.43) * k;
      }
      if (filled[0].seedFree) filled[0].rad = Generate.roomAt(c, filled[0].ang) * (0.55 + r0() * 0.43) * k;
      if (filled.length < 4) return null;

      // --- one feature per gap ---------------------------------------------
      const segs = filled.map((a, i) => {
        const b = filled[(i + 1) % filled.length];
        const span = filled.length === 1 ? TAU : Generate.cyc(b.ang - a.ang);
        const rf = RNG.sub(seed, "feat", i);
        return { a0: a.ang, span, ra: a.rad, rb: b.rad, kind: Generate.pickFeature(span, rf), rf, memo: { a0: a.ang } };
      });
      const base = segs[0].a0;
      const cum = []; let acc = 0;
      for (const s of segs) { cum.push(acc); acc += s.span; }

      // Evaluate PER SAMPLE, finding the segment that contains each grid angle.
      // Writing forward from a rounded start index leaves uncovered indices, and
      // a one-sample notch reads to the linter as both "corner too sharp" and
      // "crosses itself" — worth 90% of all failures while it was in.
      for (let j = 0; j < N; j++) {
        const u = Generate.cyc(ang[j] - base);
        let i = segs.length - 1;
        while (i > 0 && cum[i] > u) i--;
        const s = segs[i];
        const t = s.span > 1e-6 ? Math.max(0, Math.min(1, (u - cum[i]) / s.span)) : 0;
        rad[j] = Generate.FEATURES[s.kind](t, s.ra, s.rb, s.span, s.rf, s.memo);
      }
    }

    /* --------------------------------------------------- legalise in r --- */

    const clampField = () => {
      for (let j = 0; j < N; j++) rad[j] = Math.max(84, Math.min(room[j], rad[j]));
    };

    // Push the profile clear of each obstacle, choosing WHICH SIDE once. Deciding
    // per sample lets the profile flip in and out across a single obstacle and
    // draw a spike between the two answers.
    const pushObs = () => {
      for (const o of obstacles) {
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        const phi = Math.atan2(o.y - c.y, o.x - c.x);
        const need = o.r + HALF_W + 7;
        if (d < 1) continue;
        const jAt = Math.round(((phi + Math.PI) / TAU) * N) % N;
        const mid = d;                                   // band centre at the obstacle's own angle
        const outside = rad[(jAt + N) % N] >= mid;
        for (let j = 0; j < N; j++) {
          const dd = Math.abs(Generate.cyc(ang[j] - phi + Math.PI) - Math.PI);
          const across = d * Math.sin(dd);
          if (Math.abs(across) >= need) continue;
          const along = d * Math.cos(dd);
          const half = Math.sqrt(Math.max(0, need * need - across * across));
          const lo = along - half, hi = along + half;
          if (hi <= 0) continue;
          if (outside) rad[j] = Math.max(rad[j], hi);
          else if (lo > 90) rad[j] = Math.min(rad[j], lo);
          else rad[j] = Math.max(rad[j], hi);            // no room inside: go around
        }
      }
    };

    const pinGates = () => {
      for (const g of gates) {
        const ga = Math.atan2(g.y - c.y, g.x - c.x);
        const gr = Math.hypot(g.x - c.x, g.y - c.y);
        const win = 0.07 * TAU;
        for (let j = 0; j < N; j++) {
          const dd = Math.abs(Generate.cyc(ang[j] - ga + Math.PI) - Math.PI);
          if (dd > win) continue;
          const u = 1 - dd / win;
          const w = u * u * (3 - 2 * u);
          rad[j] = rad[j] + (gr - rad[j]) * w;
        }
      }
    };

    const worldAt = (j) => ({ x: c.x + rad[j] * cosA[j], y: c.y + rad[j] * sinA[j] });

    // Open any corner tighter than the cars can take, radially.
    const limit = (rounds) => {
      const want = MIN_RADIUS * 1.30;
      const wx = new Float64Array(N), wy = new Float64Array(N);
      const pull = new Float64Array(N);
      for (let it = 0; it < rounds; it++) {
        let moved = false;
        // One pass to place every point, instead of three lookups per sample.
        for (let j = 0; j < N; j++) { wx[j] = c.x + rad[j] * cosA[j]; wy[j] = c.y + rad[j] * sinA[j]; }
        pull.fill(0);
        for (let j = 0; j < N; j++) {
          const jm = j === 0 ? N - 1 : j - 1, jp = j === N - 1 ? 0 : j + 1;
          const ax = wx[j] - wx[jm], ay = wy[j] - wy[jm];
          const bx = wx[jp] - wx[j], by = wy[jp] - wy[j];
          const cx = wx[jp] - wx[jm], cy = wy[jp] - wy[jm];
          // sqrt rather than Math.hypot: this runs a third of a million times per
          // circuit and hypot is several times slower for the same answer here.
          const la = Math.sqrt(ax * ax + ay * ay);
          const lb = Math.sqrt(bx * bx + by * by);
          const lc = Math.sqrt(cx * cx + cy * cy);
          const denom = la * lb * lc;
          if (denom < 1e-6) continue;
          const kk = Math.abs((2 * (ax * by - ay * bx)) / denom);
          const rr = kk > 1e-9 ? 1 / kk : 1e9;
          if (rr >= want) continue;
          const w = Math.min(0.45, 0.10 + 0.35 * (1 - rr / want));
          if (w > pull[j]) pull[j] = w;
          if (w * 0.5 > pull[jm]) pull[jm] = w * 0.5;
          if (w * 0.5 > pull[jp]) pull[jp] = w * 0.5;
          moved = true;
        }
        if (!moved) break;
        const next = rad.slice();
        for (let j = 0; j < N; j++) {
          if (!pull[j]) continue;
          const mid = (rad[j === 0 ? N - 1 : j - 1] + rad[j === N - 1 ? 0 : j + 1]) / 2;
          next[j] = rad[j] + (mid - rad[j]) * pull[j];
        }
        rad = next;
        if (it % 6 === 5) { clampField(); pushObs(); pinGates(); }
      }
      clampField(); pushObs(); pinGates();
    };

    clampField(); pushObs(); pinGates();
    limit(90);
    limit(40);

    const pts = [];
    for (let j = 0; j < N; j++) pts.push(worldAt(j));
    let len = 0;
    for (let j = 0; j < N; j++) {
      const a = pts[j], b = pts[(j + 1) % N];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return { pts, len, rad, c, ang };
  },

  /* -------------------------------------------------------------- loop --- */

  // A candidate centre line, fitted to the challenge's length window.
  //
  // Length fitting is the single biggest win here: 71% of raw candidates failed
  // for being longer than the maximum, and each failure burned a whole seed.
  // Only FREE anchors scale, so gates stay exactly where they are.
  loop(seed, spec = {}) {
    const lo = spec.minLen || MIN_LOOP, hi = spec.maxLen || MAX_LOOP;
    const want = Math.max(lo * 1.12, Math.min(hi * 0.88, (lo * 1.18 + hi * 0.5) / 2));
    let k = 1, best = null;
    for (let it = 0; it < 5; it++) {
      const b = Generate.build(seed, spec, k, spec.profile);
      if (!b) return null;
      best = b;
      if (b.len > lo * 1.05 && b.len < hi * 0.95) return b.pts;
      k *= Math.pow(want / b.len, 0.8);          // damped, or it oscillates
      k = Math.max(0.28, Math.min(1.7, k));
    }
    return best.pts;
  },

  // The corner profile of a finished circuit: how many corners it has, how many
  // are genuinely slow, and how much of the lap is flat out. A corner is a
  // maximal run under radius 200, and its difficulty is the radius at its APEX,
  // not at the moment you enter it.
  shapeOf(track) {
    const step = 5, rs = [];
    for (let s = 0; s < track.len; s += step) {
      const k = track.curvAt(s);
      rs.push(Math.abs(k) > 1e-6 ? 1 / Math.abs(k) : 1e9);
    }
    const n = rs.length, apex = [];
    let run = null;
    for (let i = 0; i < n * 2; i++) {
      const j = i % n;
      if (rs[j] < 200) {
        if (!run) { if (i >= n) break; run = rs[j]; } else run = Math.min(run, rs[j]);
      } else if (run !== null) { apex.push(run); run = null; if (i >= n) break; }
    }
    return {
      corners: apex.length,
      tight: apex.filter((r) => r < 120).length,
      fast: rs.filter((r) => r > 400).length / n,
    };
  },

  // Is this circuit worth racing?
  //
  // Not a stylistic bar — a balance one. A lap made only of fast sweeps is one a
  // player who never touches the controls can take flat out, and the control bot
  // duly started winning races on exactly those circuits. Requiring real corners
  // is what makes braking worth doing, so it belongs in the generator rather
  // than in a difficulty dial. There is room to be fussy: candidates pass on the
  // first try, against a budget of 240.
  // Does driving this circuit actually beat NOT driving it?
  //
  // Asked by racing the thing against itself: one solo lap steered and braked
  // properly, one solo lap holding no input at all. If the second is not clearly
  // slower, the circuit does not reward the only skill the game has, and a child
  // who never touches the screen will beat a field of seven on it.
  //
  // This is a direct measurement rather than a geometric proxy because every
  // proxy I tried was wrong somewhere: corner count, tight-corner count, the
  // fraction of the lap at full speed and the spacing between corners all
  // passed circuits that a passive car then won. Two solo laps cost a few
  // milliseconds, and there is a budget of 240 tries to spend.
  PROBE_SECONDS: 16,
  SOFT_TRIES: 16,             // latency bound; see `solve`
  HARD_TRIES: 56,
  DRIVE_BAR: 1.15,
  OK_BAR: 1.10,

  // How much further a driven lap gets than a passive one in the same time.
  // Returned as a RATIO rather than a yes/no so `solve` can keep the best
  // candidate it has seen instead of only the first acceptable one.
  drivingScore(track) {
    if (typeof Game === "undefined" || !Game.start) return 99;
    const frames = Generate.PROBE_SECONDS * 60;
    // Compare DISTANCE covered in a fixed slice of time, not the time taken to
    // finish a lap. A passive car on the grass can take minutes to complete one,
    // and an unbounded probe made generating a circuit take seconds instead of
    // milliseconds. `laps: 99` simply stops either probe finishing early.
    const solo = (driven) => {
      Game.start({
        track, mode: "free", laps: 99, rivals: 0, silent: true,
        obstacles: [], gates: [], stats: Game.stockStats(),
        assist: false, skin: { body: "#fff", trim: "#000" }, profile: { name: "probe", avatar: "🤖" },
      });
      const me = Game.cars[0];
      Game.phase = "race"; Game.countdown = 0;
      for (let f = 0; f < frames && Game.running; f++) {
        if (driven) {
          Game.input.steer = Game.aim(me);
          Game.input.brake = Game.needBrake(me, 0.95);
        } else { Game.input.steer = 0; Game.input.brake = false; }
        Game.update(1 / 60);
      }
      return me.raced;
    };
    const driven = solo(true), passive = solo(false);
    Game.running = false;
    return driven / Math.max(1, passive);
  },

  // Cheap geometry gate. Corners need ROOM between them — a corner every ~160
  // units is close enough that a car is still crossing the track from the last
  // one, so the racing line never pays.
  wellShaped(track) {
    const s = Generate.shapeOf(track);
    const gap = track.len / Math.max(1, s.corners);
    return s.corners >= 5 && s.tight >= 3 && s.fast < 0.55 && gap > 190;
  },

  interesting(track) {
    return Generate.wellShaped(track) && Generate.drivingScore(track) >= Generate.DRIVE_BAR;
  },

  // The best circuit this seed can find, within a latency budget.
  //
  // This runs behind a button, and an obstacle-heavy challenge could otherwise
  // search fifty candidates — six seconds of frozen UI. But the budget must not
  // be allowed to hand back a circuit a passive player can win on, which is
  // exactly what a flat cap did. So the cap is conditional on quality:
  //
  //   * clears both bars              -> take it immediately;
  //   * good enough after SOFT_TRIES  -> take the best seen, and stop;
  //   * still poor                    -> keep looking to HARD_TRIES, because a
  //                                      circuit this flowing is one a child who
  //                                      never touches the screen can win on;
  //   * nothing has even lint-passed  -> keep going to MAX_TRIES, since THAT is
  //                                      the anti-stuck guarantee.
  solve(spec = {}, { seed = 1, tries = Generate.MAX_TRIES } = {}) {
    let best = null, bestScore = -1;
    for (let t = 0; t < tries; t++) {
      const raw = Generate.loop((seed ^ RNG.seedFrom("try" + t)) >>> 0, spec);
      if (!raw) continue;
      // `clean: true` skips the finger de-noiser in fromScribble — a generated
      // line has no wobble to remove, and that pass is what turns a deliberate
      // chord back into a gentle bend.
      const res = Track.fromScribble(raw, { ...spec, clean: true });
      if (!res.ok) continue;
      const out = { track: res.track, line: res.line, tries: t + 1 };
      const shaped = Generate.wellShaped(res.track);
      const score = shaped ? Generate.drivingScore(res.track) : 0;
      if (shaped && score >= Generate.DRIVE_BAR) return out;
      if (score > bestScore) { bestScore = score; best = out; }
      if (!best) continue;
      const done = t + 1 >= (bestScore >= Generate.OK_BAR ? Generate.SOFT_TRIES : Generate.HARD_TRIES);
      if (done) return best;
    }
    return best;
  },

  // A legal circuit shaped like a drawing the player already made — the last
  // resort behind "Fix my track". Their line is resampled into the same angular
  // profile the composer uses, taking the FURTHEST point in each bin, so a
  // figure-8 or a scribble contributes its outer envelope, which is what a
  // person means by "the shape I drew".
  fromShape(line, spec = {}, seed = 1) {
    const N = Generate.GRID;
    if (!line || line.length < 8) return null;
    let cx = 0, cy = 0;
    for (const p of line) { cx += p.x; cy += p.y; }
    cx /= line.length; cy /= line.length;

    for (let pass = 0; pass < 6; pass++) {
      const bins = new Array(N).fill(0);
      for (const p of line) {
        const a = Math.atan2(p.y - cy, p.x - cx);
        const j = Math.min(N - 1, Math.max(0, Math.round(((a + Math.PI) / TAU) * N) % N));
        bins[j] = Math.max(bins[j], Math.hypot(p.x - cx, p.y - cy));
      }
      // Fill the gaps between samples, then smooth a little more on every pass,
      // so a hopeless scrawl converges toward a clean loop of its proportions.
      let last = -1;
      for (let j = 0; j < N * 2; j++) if (bins[j % N] > 0) { last = j % N; break; }
      if (last < 0) return null;
      let prev = last;
      for (let s = 1; s <= N; s++) {
        const j = (last + s) % N;
        if (bins[j] > 0) { prev = j; continue; }
        let nxt = j;
        for (let q = 1; q <= N; q++) { const jj = (j + q) % N; if (bins[jj] > 0) { nxt = jj; break; } }
        const gap = Generate.cyc((nxt - j) * TAU / N) + 1e-9;
        const back = Generate.cyc((j - prev) * TAU / N);
        const t = back / (back + gap);
        bins[j] = bins[prev] + (bins[nxt] - bins[prev]) * t;
      }
      for (let sm = 0; sm < 2 + pass * 3; sm++) {
        const out = bins.slice();
        for (let j = 0; j < N; j++) out[j] = (bins[(j - 1 + N) % N] + 2 * bins[j] + bins[(j + 1) % N]) / 4;
        for (let j = 0; j < N; j++) bins[j] = out[j];
      }
      const raw = Generate.loop((seed ^ RNG.seedFrom("shape" + pass)) >>> 0, { ...spec, profile: bins });
      if (!raw) continue;
      const res = Track.fromScribble(raw, { ...spec, clean: true });
      if (res.ok) return { track: res.track, line: res.line };
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
