// Scribble Speedway — track geometry. THE file of this game.
//
// A four-year-old's finger is not a racing line, so everything here is about
// turning a shaky closed scribble into something a car can actually drive, and
// then refusing — kindly, and with a reason — the ones that cannot be saved.
//
// The pipeline is: resample -> smooth -> relax (corners, walls, obstacles) ->
// resample -> lint. Relaxing BEFORE linting is the whole trick: the fix-up pass
// silently repairs the wobbles, hairpins and clipped trees that make up almost
// every real drawing, so `lint()` only ever sees the problems that are really
// about the shape the player meant (a figure-8, a loop the size of a coin, a
// gate they never went near).
//
// The track is then addressed the way Rocket Rescue addresses a cave: a centre
// line sampled by ARC LENGTH `s`, with everything placed by an offset `n`
// ACROSS it. A car's whole state is (s, n) — no world coordinates in the
// simulation at all — which is what makes the sim deterministic, the ghosts a
// tiny array, and the renderer incapable of disagreeing with the physics about
// where the tarmac is.

window.GK = window.GK || {};

/* ------------------------------------------------------------ constants -- */

// The field every track is drawn on. Logical units; the view scales to fit.
//
// PORTRAIT, because the drawing surface is the game and these are played on
// phones and iPads held upright. A landscape field on a 375x600 stage fits at
// 0.36 scale with a third of the screen empty above and below it — a small hand
// drawing into a letterbox. Turned upright it fills the same stage at 0.54 and
// the whole field is within reach of a thumb. Every device must agree on this,
// or a circuit drawn on one is a different shape on another.
const FIELD = { w: 700, h: 1000 };

const TRACK_W = 78;               // tarmac width
const HALF_W = TRACK_W / 2;
const EDGE_MARGIN = 10;           // tarmac must stay this far inside the field

// The tightest corner a car may be asked to take. It MUST comfortably exceed
// HALF_W: the inside edge of a corner has radius (R - HALF_W), and the physics
// divides by (1 - curvature*offset), which goes to zero as the offset reaches
// the radius. At 64 vs 39 the worst case is 0.39 — nowhere near the cliff.
const MIN_RADIUS = 64;

const NODE_SPACING = 9;           // centre-line resolution
const MIN_LOOP = 950;             // shorter than this is a roundabout, not a track
const MAX_LOOP = 4600;            // longer than this and three laps is a chore

const TAU = Math.PI * 2;

/* -------------------------------------------------------- small helpers -- */

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function dist(a, b) { return Math.sqrt(dist2(a, b)); }

// Perimeter of a CLOSED polyline (the closing leg included).
function loopLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length; i++) L += dist(pts[i], pts[(i + 1) % pts.length]);
  return L;
}

// Even spacing around a closed loop. Everything downstream (curvature, the
// pair sweep, the physics) assumes uniform spacing, so this runs again after
// any pass that moves points.
function resampleClosed(pts, spacing = NODE_SPACING) {
  const src = [];
  for (const p of pts) {
    if (!src.length || dist(p, src[src.length - 1]) > 0.01) src.push({ x: p.x, y: p.y });
  }
  if (src.length > 2 && dist(src[0], src[src.length - 1]) < 0.01) src.pop();
  if (src.length < 3) return src;

  const m = src.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + dist(src[i], src[(i + 1) % m]));
  const L = cum[m];
  const n = Math.max(24, Math.round(L / spacing));
  const step = L / n;

  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const want = k * step;
    while (seg < m - 1 && cum[seg + 1] < want) seg++;
    const a = src[seg], b = src[(seg + 1) % m];
    const legLen = cum[seg + 1] - cum[seg] || 1;
    const t = (want - cum[seg]) / legLen;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

// One pass of cyclic 3-point averaging. `w` is how far each point moves toward
// the midpoint of its neighbours.
function smoothClosed(pts, passes = 1, w = 0.5) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
      out[i] = { x: b.x + w * ((a.x + c.x) / 2 - b.x), y: b.y + w * ((a.y + c.y) / 2 - b.y) };
    }
    cur = out;
  }
  return cur;
}

// Signed curvature at every point of a closed loop, from the circle through
// each point and its two neighbours.
//
// Sign convention, used by everything downstream: the normal is the tangent
// rotated a quarter turn, N = (-t.y, t.x), and k > 0 means the curve bends
// TOWARD N — so the centre of the corner sits at p + N/k, and a car at offset
// n is turning on a radius of (1/k - n). Positive offset is therefore the
// inside of a positive corner.
function curvatures(pts) {
  const n = pts.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const ax = p1.x - p0.x, ay = p1.y - p0.y;
    const bx = p2.x - p1.x, by = p2.y - p1.y;
    const cross = ax * by - ay * bx;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const lc = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    out[i] = la * lb * lc < 1e-6 ? 0 : (2 * cross) / (la * lb * lc);
  }
  return out;
}

// Smooth the curvature array itself (cyclic). Raw per-point curvature from a
// resampled polyline is spiky, and the spikes would read as corners that are
// not there — both to the speed limit and to the rivals' racing line.
function smoothCyclic(arr, passes = 3) {
  let cur = arr;
  for (let p = 0; p < passes; p++) {
    const n = cur.length, out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = (cur[(i - 1 + n) % n] + 2 * cur[i] + cur[(i + 1) % n]) / 4;
    cur = out;
  }
  return cur;
}

/* --------------------------------------------------------- the fix-up ---- */

// Nudge a drawn loop into something raceable. Every rule here is a PULL rather
// than a rejection, because a child redrawing a whole lap because one corner
// clipped a tree is a child who stops playing.
//
//   corners    a corner tighter than MIN_RADIUS is opened out
//   walls      tarmac that would hang off the field is pulled back in
//   obstacles  tarmac over a tree/pond is pushed off it
//   gates      the nearest point of the loop is drawn toward a missed gate
//
// The pulls fight each other by design; `lint()` afterwards is what decides
// whether they reached a truce.
function relax(pts, { obstacles = [], gates = [], iters = 90 } = {}) {
  let cur = pts.slice();
  const minK = 1 / MIN_RADIUS;
  const loX = HALF_W + EDGE_MARGIN, hiX = FIELD.w - HALF_W - EDGE_MARGIN;
  const loY = HALF_W + EDGE_MARGIN, hiY = FIELD.h - HALF_W - EDGE_MARGIN;

  for (let it = 0; it < iters; it++) {
    const n = cur.length;
    const k = curvatures(cur);
    let moved = false;

    // 1. corners — pull an over-tight point toward its neighbours' midpoint,
    //    and its neighbours half as hard so the fix spreads instead of
    //    denting the line.
    const pull = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const over = Math.abs(k[i]) / minK;
      if (over > 1) {
        const w = Math.min(0.5, 0.16 * (over - 1) + 0.05);
        pull[i] = Math.max(pull[i], w);
        pull[(i - 1 + n) % n] = Math.max(pull[(i - 1 + n) % n], w * 0.5);
        pull[(i + 1) % n] = Math.max(pull[(i + 1) % n], w * 0.5);
        moved = true;
      }
    }
    const next = cur.map((p, i) => {
      if (!pull[i]) return { x: p.x, y: p.y };
      const a = cur[(i - 1 + n) % n], c = cur[(i + 1) % n];
      return {
        x: p.x + pull[i] * ((a.x + c.x) / 2 - p.x),
        y: p.y + pull[i] * ((a.y + c.y) / 2 - p.y),
      };
    });

    // 2. walls
    for (const p of next) {
      if (p.x < loX) { p.x += (loX - p.x) * 0.7; moved = true; }
      if (p.x > hiX) { p.x += (hiX - p.x) * 0.7; moved = true; }
      if (p.y < loY) { p.y += (loY - p.y) * 0.7; moved = true; }
      if (p.y > hiY) { p.y += (hiY - p.y) * 0.7; moved = true; }
    }

    // 3. obstacles — push radially out of anything the tarmac overlaps.
    for (const o of obstacles) {
      const need = o.r + HALF_W + 3;
      for (const p of next) {
        const dx = p.x - o.x, dy = p.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d < need) {
          const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0;
          const push = (need - d) * 0.55;
          p.x += ux * push; p.y += uy * push;
          moved = true;
        }
      }
    }

    // 4. gates — the nearest stretch of the loop is drawn toward a ring it
    //    only just missed.
    //
    //    Two rules, both learned the hard way. The pull is spread over a run of
    //    points with a falloff, not applied to the single closest one: pulling
    //    one point draws a spike, and a spike long enough to reach the ring
    //    crosses its own neck, so the player was told their track crossed
    //    itself when what they had actually done was miss a checkpoint. And it
    //    only engages within a couple of ring widths — the repair is here to
    //    fix a wobbly hand, not to overrule where somebody meant to drive. A
    //    ring they went nowhere near stays missed, and they get told so.
    const SPREAD = 6;
    for (const g of gates) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < next.length; i++) {
        const d = dist2(next[i], g);
        if (d < bd) { bd = d; bi = i; }
      }
      const gap = Math.sqrt(bd);
      if (gap <= g.r * 0.8 || gap > g.r * 2.6) continue;
      const nb = next.length;
      for (let j = -SPREAD; j <= SPREAD; j++) {
        const w = 0.16 * (1 - Math.abs(j) / (SPREAD + 1));
        const p = next[(bi + j + nb) % nb];
        p.x += (g.x - p.x) * w; p.y += (g.y - p.y) * w;
      }
      moved = true;
    }

    cur = next;
    // Re-space periodically: the pulls bunch points up, and curvature measured
    // on unevenly spaced points is meaningless.
    if (it % 6 === 5) cur = resampleClosed(smoothClosed(cur, 1, 0.25));
    if (!moved && it > 4) break;
  }
  return resampleClosed(cur);
}

/* -------------------------------------------------------------- Track ---- */

const Track = {
  FIELD, TRACK_W, HALF_W, MIN_RADIUS, MIN_LOOP, MAX_LOOP, NODE_SPACING, EDGE_MARGIN,

  // Build the sampled model. `pts` must already be a clean, evenly spaced,
  // closed centre line — `fromScribble` is what produces one.
  make(pts) {
    const p = resampleClosed(pts);
    const n = p.length;
    const cum = new Array(n + 1);
    cum[0] = 0;
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + dist(p[i], p[(i + 1) % n]);
    const len = cum[n];
    const curv = smoothCyclic(curvatures(p), 3);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of p) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }

    const T = {
      pts: p, cum, len, curv, halfW: HALF_W,
      bbox: { x: minX - HALF_W, y: minY - HALF_W, w: maxX - minX + TRACK_W, h: maxY - minY + TRACK_W },

      // s wraps: the track is a loop, so there is no "past the end".
      wrap(s) { return ((s % len) + len) % len; },

      // Index-space position of arc length s — the shared front end of at/
      // tanAt/curvAt, so all three can never disagree about where s is.
      _ix(s) {
        const u = T.wrap(s) / len * n;
        const i = Math.floor(u);
        return { i: i % n, t: u - i };
      },

      at(s) {
        const { i, t } = T._ix(s);
        const a = p[i], b = p[(i + 1) % n];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      },

      tanAt(s) {
        const { i } = T._ix(s);
        const a = p[i], b = p[(i + 1) % n];
        const d = dist(a, b) || 1;
        return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
      },

      // The offset direction. n > 0 is this way.
      normAt(s) { const t = T.tanAt(s); return { x: -t.y, y: t.x }; },

      curvAt(s) {
        const { i, t } = T._ix(s);
        return curv[i] + (curv[(i + 1) % n] - curv[i]) * t;
      },

      // (s, n) -> world. The ONLY bridge between the simulation and the
      // screen, used by the renderer and the collision code alike.
      toWorld(s, off) {
        const c = T.at(s), nv = T.normAt(s);
        return { x: c.x + nv.x * off, y: c.y + nv.y * off };
      },

      headingAt(s) { const t = T.tanAt(s); return Math.atan2(t.y, t.x); },

      // Radius of the arc a car at offset `off` is actually turning on.
      radiusAt(s, off) {
        const k = T.curvAt(s);
        if (Math.abs(k) < 1e-5) return 1e5;
        return Math.abs(1 / k - off);
      },

      // How fast that arc can be taken with a given grip. This is the whole
      // difficulty of the game: it depends on the LINE, not just the corner,
      // so the outside of a bend is genuinely faster than the inside.
      limitAt(s, off, grip) {
        return Math.sqrt(grip * Math.max(10, T.radiusAt(s, off)));
      },

      // Slowest limit anywhere in the next `look` units — what a driver
      // (or the auto-brake) has to be slow enough for by the time they arrive.
      limitAhead(s, off, grip, look, step = 26) {
        let m = Infinity;
        for (let d = 0; d <= look; d += step) m = Math.min(m, T.limitAt(s + d, off, grip));
        return m;
      },

      // Arc length of the offset line per unit of world distance travelled.
      // A car on the inside of a corner covers the lap in less tarmac; this
      // one factor is why cutting the apex is worth anything.
      advance(s, off) {
        const k = T.curvAt(s);
        return Math.max(0.25, 1 - k * off);
      },

      minRadius() {
        let m = Infinity;
        for (const k of curv) if (Math.abs(k) > 1e-6) m = Math.min(m, 1 / Math.abs(k));
        return m;
      },

      // The fastest lap this circuit physically allows, in seconds.
      //
      // This is what the three-star target is built on, and it has to be
      // computed rather than assumed: the player DREW this track, so a fixed
      // "par speed" would hand an easy star to anyone who drew a flowing oval
      // and an impossible one to anyone who drew something interesting. Par
      // from the track's own geometry measures the driving instead.
      //
      // The standard racing-line speed profile: cap every point at what its
      // corner will take, then sweep backwards so the car can brake down to
      // each cap in time, then forwards so it cannot accelerate faster than it
      // can. Twice around, because on a loop the first sweep starts from a
      // guess.
      idealLap(stats) {
        const v = new Array(n);
        for (let i = 0; i < n; i++) {
          const r = Math.abs(curv[i]) < 1e-5 ? 1e5 : 1 / Math.abs(curv[i]);
          v[i] = Math.min(stats.top, Math.sqrt(stats.grip * r));
        }
        const seg = (i) => cum[i + 1] - cum[i];
        for (let pass = 0; pass < 2; pass++) {
          for (let j = n - 1; j >= 0; j--) {           // braking
            const i = j, nx = (j + 1) % n;
            v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * stats.brake * seg(i)));
          }
          for (let j = 0; j < n; j++) {                 // power
            const i = j, pv = (j - 1 + n) % n;
            v[i] = Math.min(v[i], Math.sqrt(v[pv] * v[pv] + 2 * stats.accel * seg(pv)));
          }
        }
        let time = 0;
        for (let i = 0; i < n; i++) time += seg(i) / Math.max(12, v[i]);
        return time;
      },

      // Distance from the centre line to a world point, plus where along it —
      // used to place trackside scenery and to hit-test decoration.
      nearest(x, y) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < n; i++) {
          const d = (p[i].x - x) ** 2 + (p[i].y - y) ** 2;
          if (d < bd) { bd = d; bi = i; }
        }
        return { s: cum[bi], d: Math.sqrt(bd) };
      },
    };
    return T;
  },

  /* ----------------------------------------------------------- linting -- */

  // Problems with a finished centre line, as friendly strings a five-year-old's
  // parent can read out. Returns an ARRAY (empty when fine) rather than
  // throwing, so a test names every offender in one run and the drawing screen
  // can show the first one as a toast.
  //
  // Ordered gentlest-first: the message the player sees is problems[0], and
  // "your loop is a bit small" is a kinder thing to be told than the geometry.
  lint(pts, { obstacles = [], gates = [], minLen = MIN_LOOP, maxLen = MAX_LOOP, label = "" } = {}) {
    const out = [];
    if (!pts || pts.length < 12) return [`${label}that is not a loop yet — draw a big circuit!`];
    const p = resampleClosed(pts);
    const n = p.length;
    const L = loopLength(p);

    if (L < minLen) out.push(`${label}that loop is too small — draw a bigger circuit!`);
    if (L > maxLen) out.push(`${label}that loop is enormous — try a shorter circuit!`);

    for (const g of gates) {
      let best = Infinity;
      for (const q of p) best = Math.min(best, dist(q, g));
      if (best > g.r) out.push(`${label}you missed a checkpoint — drive through every ring!`);
    }

    for (const o of obstacles) {
      let best = Infinity;
      for (const q of p) best = Math.min(best, dist(q, o));
      if (best < o.r + HALF_W - 1) { out.push(`${label}the track runs straight over the ${o.kind || "scenery"} — go around it!`); break; }
    }

    let offField = false;
    for (const q of p) {
      if (q.x < HALF_W + 1 || q.x > FIELD.w - HALF_W - 1 || q.y < HALF_W + 1 || q.y > FIELD.h - HALF_W - 1) offField = true;
    }
    if (offField) out.push(`${label}the track runs off the grass — keep it on the field!`);

    // Tarmac may never touch other tarmac. Skipping neighbours within a bit
    // over a track width of each other is what lets a normal corner pass; a
    // figure-8 or a doubled-back loop is what this catches.
    const skip = Math.ceil((TRACK_W * 1.35) / NODE_SPACING);
    const near = (TRACK_W * 0.95) ** 2;
    let crosses = false;
    for (let i = 0; i < n && !crosses; i++) {
      for (let j = i + skip + 1; j < n; j++) {
        // Cyclic distance, or the pair (1, n-1) — two points either side of the
        // seam — reads as far apart and every loop reports crossing itself.
        const gap = Math.min(j - i, n - (j - i));
        if (gap <= skip) continue;
        if (dist2(p[i], p[j]) < near) { crosses = true; break; }
      }
    }
    if (crosses) out.push(`${label}the track crosses over itself — one loop only!`);

    const k = smoothCyclic(curvatures(p), 2);
    let tightest = Infinity;
    for (const kk of k) if (Math.abs(kk) > 1e-6) tightest = Math.min(tightest, 1 / Math.abs(kk));
    if (tightest < MIN_RADIUS * 0.82) out.push(`${label}one corner is far too sharp — round it off a bit!`);

    return out;
  },

  /* --------------------------------------------------------- the entry -- */

  // Raw pointer samples -> a track, or the reason why not.
  // `{ ok, track, line, problems }` — `line` is the repaired centre line even
  // on a failure, so the drawing screen can show the player what it made of
  // their scribble instead of just wiping it.
  fromScribble(raw, opts = {}) {
    const pts = (raw || []).filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 2.5);
    if (pts.length < 8) return { ok: false, problems: ["draw a big loop with your finger!"], line: null };

    // The player almost never lands back on their own starting point, so the
    // loop is closed for them. Only a wildly open scribble is refused — the
    // gap has to be a real fraction of the whole drawing, not a fixed number
    // of pixels, or a small neat loop gets rejected for a gap a big sloppy one
    // gets away with.
    const open = dist(pts[0], pts[pts.length - 1]);
    const walked = pts.reduce((a, p, i) => (i ? a + dist(p, pts[i - 1]) : 0), 0);
    if (open > Math.max(150, walked * 0.34)) {
      return { ok: false, problems: ["finish where you started so the loop joins up!"], line: null };
    }

    let line = resampleClosed(pts, NODE_SPACING);
    // The five-pass smooth is a de-noiser for a shaky finger. A generated line
    // has no wobble to remove, and on a deliberate chord this pass is precisely
    // what bends a straight back into a curve — so callers who built their own
    // clean geometry opt out. Defaults off, so every DRAWN track is unchanged.
    if (!opts.clean) line = smoothClosed(line, 5, 0.5);
    line = relax(line, opts);
    line = smoothClosed(line, 2, 0.3);
    line = relax(line, { ...opts, iters: 40 });
    line = resampleClosed(line, NODE_SPACING);

    const problems = Track.lint(line, opts);
    return { ok: problems.length === 0, problems, line, track: problems.length ? null : Track.make(line) };
  },

  /* ------------------------------------------------------------ repair -- */

  // Try much harder to save a drawing than `fromScribble` does.
  //
  // `fromScribble` runs a fixed, cheap repair because it fires on every stroke.
  // This runs behind a button the player only presses when they have been told
  // something is wrong, so it can afford to be stubborn — and it must be,
  // because the promise attached to that button is that it always works.
  //
  // Three rungs, each re-linting and stopping the moment the drawing is
  // raceable. If all three fail the caller escalates to the generator; this
  // function's job is to save the player's own shape wherever that is possible.
  repair(raw, spec = {}) {
    const seed = Track.fromScribble(raw, spec);
    if (seed.ok) return seed;
    let line = seed.line || resampleClosed(raw, NODE_SPACING);
    const done = () => {
      const problems = Track.lint(line, spec);
      return problems.length ? null : { ok: true, problems: [], line, track: Track.make(line) };
    };
    let out;

    // Rung 1 — just keep relaxing. The default 90+40 iterations is a budget,
    // not a limit, and most "that corner is too sharp" / "over the tree" /
    // "off the grass" drawings settle given a few hundred more.
    for (let round = 0; round < 3; round++) {
      line = relax(line, { ...spec, iters: 400 });
      line = resampleClosed(smoothClosed(line, 1, 0.25), NODE_SPACING);
      if ((out = done())) return out;
    }

    // Rung 2 — the loop is the wrong size. Scale it about its own centroid,
    // relaxing after EVERY step: scaling slides the whole shape off its gates
    // and onto obstacles, and two scales in a row compound that into a mess.
    const minLen = spec.minLen || MIN_LOOP, maxLen = spec.maxLen || MAX_LOOP;
    for (let round = 0; round < 6; round++) {
      const L = loopLength(line);
      if (L >= minLen && L <= maxLen) break;
      const target = L < minLen ? minLen * 1.08 : maxLen * 0.92;
      let cx = 0, cy = 0;
      for (const p of line) { cx += p.x; cy += p.y; }
      cx /= line.length; cy /= line.length;
      let f = Math.pow(target / L, 0.7);
      // Growing must not push the tarmac off the field, so cap the factor by
      // how much room the bounding box actually has.
      if (f > 1) {
        let room = Infinity;
        for (const p of line) {
          const lo = HALF_W + EDGE_MARGIN;
          if (p.x > cx) room = Math.min(room, (FIELD.w - lo - cx) / Math.max(1, p.x - cx));
          if (p.x < cx) room = Math.min(room, (cx - lo) / Math.max(1, cx - p.x));
          if (p.y > cy) room = Math.min(room, (FIELD.h - lo - cy) / Math.max(1, p.y - cy));
          if (p.y < cy) room = Math.min(room, (cy - lo) / Math.max(1, cy - p.y));
        }
        f = Math.min(f, Math.max(1, room));
      }
      line = line.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
      line = relax(line, { ...spec, iters: 120 });
      line = resampleClosed(line, NODE_SPACING);
      if ((out = done())) return out;
    }

    // Rung 3 — the track crosses itself. First try easing the two strands
    // apart; if the neck survives that, the drawing is a figure-8 or has a
    // parasitic lobe, so keep the LONGER lobe and close it. That is
    // overwhelmingly the loop the player meant to draw.
    for (let round = 0; round < 4; round++) {
      const hit = Track.crossing(line);
      if (!hit) break;
      if (round < 2) {
        const { i, j } = hit;
        const n = line.length;
        const dx = line[j].x - line[i].x, dy = line[j].y - line[i].y;
        const d = Math.hypot(dx, dy) || 1;
        const push = (TRACK_W * 1.05 - d) / 2;
        for (let k = -5; k <= 5; k++) {
          const w = (1 - Math.abs(k) / 6) * push;
          const a = line[(i + k + n) % n], b = line[(j + k + n) % n];
          a.x -= (dx / d) * w; a.y -= (dy / d) * w;
          b.x += (dx / d) * w; b.y += (dy / d) * w;
        }
        line = relax(resampleClosed(line, NODE_SPACING), { ...spec, iters: 150 });
      } else {
        line = Track.keepLargerLobe(line, hit);
        line = relax(resampleClosed(line, NODE_SPACING), { ...spec, iters: 200 });
      }
      line = resampleClosed(line, NODE_SPACING);
      if ((out = done())) return out;
    }

    return { ok: false, problems: Track.lint(line, spec), line, track: null };
  },

  // The first pair of points that are far apart along the track but close
  // together in space — the same rule `lint` uses to call a track crossed.
  crossing(pts) {
    const p = resampleClosed(pts, NODE_SPACING), n = p.length;
    const skip = Math.ceil((TRACK_W * 1.35) / NODE_SPACING);
    const near = (TRACK_W * 0.95) ** 2;
    for (let i = 0; i < n; i++) {
      for (let j = i + skip + 1; j < n; j++) {
        const gap = Math.min(j - i, n - (j - i));
        if (gap <= skip) continue;
        if (dist2(p[i], p[j]) < near) return { i, j };
      }
    }
    return null;
  },

  // Split the loop at a crossing and keep whichever side is longer.
  keepLargerLobe(pts, { i, j }) {
    const p = resampleClosed(pts, NODE_SPACING), n = p.length;
    const a = [], b = [];
    for (let k = i; k !== j; k = (k + 1) % n) a.push(p[k]);
    for (let k = j; k !== i; k = (k + 1) % n) b.push(p[k]);
    const len = (arr) => arr.reduce((s, q, idx) => s + (idx ? dist(q, arr[idx - 1]) : 0), 0);
    const keep = len(a) >= len(b) ? a : b;
    return keep.length >= 12 ? keep : p;
  },

  /* ------------------------------------------------------- persistence -- */

  // A saved track is its centre line, decimated and packed two base36 chars
  // per coordinate. ~350 chars for a full circuit, which is small enough to
  // live inside a profile's progress document and ride the family sync.
  encode(line) {
    const c = (v) => Math.max(0, Math.min(1295, Math.round(v))).toString(36).padStart(2, "0");
    let out = "";
    for (let i = 0; i < line.length; i += 2) out += c(line[i].x) + c(line[i].y);
    return out;
  },

  decode(str) {
    if (typeof str !== "string" || str.length < 32 || str.length % 4) return null;
    const pts = [];
    for (let i = 0; i < str.length; i += 4) {
      pts.push({ x: parseInt(str.slice(i, i + 2), 36), y: parseInt(str.slice(i + 2, i + 4), 36) });
    }
    if (pts.some((p) => !isFinite(p.x) || !isFinite(p.y))) return null;
    return resampleClosed(smoothClosed(pts, 1, 0.3), NODE_SPACING);
  },
};

GK.Track = Track;
