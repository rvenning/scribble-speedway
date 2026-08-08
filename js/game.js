// The race — a simulation with no DOM, no canvas and no Math.random in it.
//
// A car's entire state is (s, n, v): how far around the centre line it is, how
// far across the tarmac, and how fast. There are no world coordinates in here
// at all — the renderer asks the track to turn (s, n) into a point, and so does
// the collision code, so the picture and the physics cannot disagree about
// where the road is.
//
// Two consequences worth stating, because they are the reason for the shape:
//
//   * Cornering is a property of the LINE, not the corner. The radius a car is
//     turning on is (1/curvature - offset), so the outside of a bend can be
//     carried faster and the inside covers less ground. That single equation is
//     the whole skill of the game, and it is why a five-year-old holding the
//     middle of the road still gets round while an adult hunting the apex is
//     playing something with depth.
//
//   * Nothing rolls dice. Rivals are three constants each, so a track plus a
//     loadout always produces the same race — which is what makes
//     tests/bot.test.js able to replay the campaign and treat a changed
//     finishing position as a real balance change.

const RULES = {
  laps: 3,
  grip: 190,             // v_limit = sqrt(grip * radius)
  topSpeed: 208,
  accel: 96,
  brake: 168,
  drag: 0.14,
  // Sliding has to COST, or a driver who never lifts is only a little slower
  // than one who reads the corners — and then the whole game is the throttle
  // being held down for you. These two numbers are the difference between
  // steering being a skill and steering being scenery.
  slideScrub: 2.7,       // speed lost per unit of overspeed per second
  slideBite: 0.09,       // ...and again per unit, so the cost grows with the sin
  // Exceeding grip costs you the LINE, not merely a little speed. Scrub alone
  // could not carry the mechanic: a small overspeed scrubbed far less than
  // braking cost, so running ten units over every corner was quicker than
  // driving properly, and a car holding no input outran the whole field on any
  // flowing circuit. A car past the limit runs wide, quickly — which a
  // steering player can fight and a passive one cannot.
  slidePush: 3.6,        // units across the track per second, per unit of overspeed
  slideGripLoss: 0.35,   // how much grip an unsettled car has already lost
  steerAcc: 340,
  steerDamp: 5.6,
  steerMax: 118,
  grassGrip: 0.22,
  grassTop: 0.42,
  carLen: 30,
  carW: 18,
  gridRow: 36,           // how far back each row of the grid starts
  gridLane: 17,          // and how far either side of the centre line
  playerGrid: 2,         // the player's slot — second row, so there is a pack
  contactDrag: 1.1,      // speed lost per second while nose-to-tail
  wall: HALF_W + 46,     // the barrier out past the verge
  assist: 0.90,          // auto-brake aims at this fraction of the real limit
  openPar: 1.40,         // par slack outside the campaign — see `parSlack`
  countdown: 3.2,
  maxRaceTime: 300,
};

const Game = {
  running: false,
  active: false,
  paused: false,

  // Set by the renderer's input handlers, or by a bot. -1..1 across the track,
  // and a brake flag; nothing else reaches the simulation.
  input: { steer: 0, brake: false },

  // A showroom car. Par is measured against this and never against what the
  // player has fitted, or the target would run away from the very upgrades
  // bought to catch it.
  stockStats() {
    return { grip: RULES.grip, top: RULES.topSpeed, accel: RULES.accel, brake: RULES.brake };
  },

  /* --------------------------------------------------------- starting -- */

  // opts: { track, mode, challenge, challengeIdx, stats, skin, ghost,
  //         laps, rivals, assist, profile }
  start(opts) {
    const t = opts.track;
    this.track = t;
    this.mode = opts.mode || "campaign";               // campaign | daily | free
    this.challenge = opts.challenge || null;
    this.challengeIdx = opts.challengeIdx ?? -1;
    // Scenery is not simulated — nothing can hit a tree, because the track was
    // required to go around it before the race could start. It is carried here
    // only so the renderer can paint the same field the circuit was drawn on.
    this.obstacles = opts.obstacles || (this.challenge ? this.challenge.obstacles : []);
    this.gates = opts.gates || (this.challenge ? this.challenge.gates : []);
    this.chapter = opts.chapter || (this.challenge ? CHAPTERS[this.challenge.chapter] : CHAPTERS[0]);
    this.laps = opts.laps || (this.challenge ? this.challenge.laps : RULES.laps);
    this.assist = opts.assist !== false;
    this.skin = opts.skin || SKINS[0];
    this.ghost = opts.ghost || null;                    // decoded, or null
    this.stats = opts.stats || { grip: RULES.grip, top: RULES.topSpeed, accel: RULES.accel, brake: RULES.brake };
    // Par always comes from the circuit's own ideal lap, never from a flat
    // speed. On the Daily that is what stops the leaderboard becoming a
    // drawing contest with one right answer: a flat rate would make a twisty
    // circuit unbeatable and a smooth one free, so everyone would draw the
    // same oval. Against its own ideal, a circuit is scored on how well it was
    // DRIVEN — and a flowing one still pays a little, because a lap with fewer
    // corners in it lands closer to perfect.
    this.par = this.challenge
      ? parTime(t, this.challenge)
      : this.laps * t.idealLap(Game.stockStats()) * RULES.openPar;

    this.time = 0;
    this.phase = "countdown";
    this.countdown = RULES.countdown;
    this.running = true;
    this.paused = false;
    this.input.steer = 0;
    this.input.brake = false;

    const rivalCount = opts.rivals ?? (this.challenge ? this.challenge.rivals : 0);
    const diff = this.challenge ? this.challenge.difficulty : 0.5;

    // Where the player starts on the grid. NOT pole, once there is a field to
    // speak of: the camera looks forward, so a player who leads from the lights
    // spends the race alone on an empty road with seven cars they never see.
    // From the second row there are cars to chase in front and cars filling the
    // mirrors behind, which is the entire point of a big grid — and it costs
    // only one row of track.
    const playerSlot = Math.min(RULES.playerGrid, rivalCount);

    this.cars = [];
    this.cars.push(this.makeCar({
      id: "you", name: opts.profile ? opts.profile.name : "You",
      emoji: opts.profile ? opts.profile.avatar : "🏎️",
      body: this.skin.body, trim: this.skin.trim, isPlayer: true,
    }, playerSlot));
    for (let i = 0, slot = 0; i < rivalCount; i++, slot++) {
      if (slot === playerSlot) slot++;
      this.cars.push(this.makeCar(rivalFor(i, diff), slot));
    }

    this.rec = Ghost.recorder();
    this.lapRec = Ghost.recorder();
    this.bestLap = 0;
    this.bestLapGhost = null;
    this.cleanTime = 0;                                  // seconds fully on tarmac
    this.slid = 0;                                       // seconds sliding — for the HUD
    this.events = [];                                    // {kind,...} drained by the renderer
    return this;
  },

  // The grid, two abreast. `raced` is the signed distance past the start line,
  // so a car further back has genuinely further to go — the grid is a real
  // handicap rather than decoration.
  //
  // It used to be decoration, and with three cars nobody would have noticed:
  // every car counted its own distance travelled from wherever it was parked,
  // so all of them crossed the finish having covered the same ground and the
  // grid only decided which stretch of tarmac each one drove. On a full grid
  // that shows immediately — the HUD calls you first while two cars are
  // visibly pulling away in front of you.
  makeCar(def, gridPos) {
    const t = this.track;
    const row = Math.floor(gridPos / 2);
    const startS = -row * RULES.gridRow;
    return {
      // `line`/`aggr` default even for the player, because tests/bot.test.js
      // drives the player car through the rivals' own `aim()` — the opponents
      // and the balance bot have to be the same brain or the report is about a
      // driver nobody is.
      line: 0.75, aggr: 0.93, pace: 1,
      ...def,
      grid: gridPos,
      startS,
      raced: startS,
      s: t.wrap(startS),
      n: (gridPos % 2 === 0 ? -1 : 1) * RULES.gridLane,
      v: 0, vn: 0,
      lap: 0, lapStart: 0, grass: 0, sliding: 0,
      brake: false, finished: false, finishTime: 0, place: 0,
      stats: def.isPlayer ? this.stats : {
        grip: RULES.grip * (def.grip ?? 1),
        top: RULES.topSpeed * def.pace,
        accel: RULES.accel * (0.9 + def.pace * 0.14),
        brake: RULES.brake * (0.9 + def.aggr * 0.2),
      },
    };
  },

  /* ------------------------------------------------------------- loop -- */

  update(dt) {
    if (!this.running || this.paused) return;
    dt = Math.min(0.05, dt);

    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = "race"; this.events.push({ kind: "go" }); }
      return;                                            // engines idle on the grid
    }

    this.time += dt;
    for (const car of this.cars) {
      if (car.finished) continue;
      this.drive(car, dt);
      this.step(car, dt);
    }
    this.collide(dt);

    const me = this.cars[0];
    this.cleanTime += me.grass < 0.05 ? dt : 0;
    if (me.sliding > 0) this.slid += dt;

    if (this.time > RULES.maxRaceTime) this.finish(me);
  },

  /* ---------------------------------------------------------- driving -- */

  // Decide steer/brake for one car. The player's comes from `input`; everyone
  // else uses the same brain, which is also what tests/bot.test.js drives the
  // player with — so the opponents ARE the balance bot.
  drive(car, dt) {
    if (car.isPlayer) {
      car.steer = this.input.steer;
      car.brake = this.input.brake;
      if (this.assist) {
        // The assist is deliberately a shade slower than a good manual driver:
        // it aims at 90% of what each corner would actually take. A child can
        // leave it on and never slide off; anyone chasing the leaderboard turns
        // it off and finds the time. One physics, no second game.
        if (this.needBrake(car, RULES.assist)) car.brake = true;
      }
      return;
    }
    car.steer = this.aim(car);
    car.brake = this.needBrake(car, car.aggr);

    // Lift for the car in front. Without this a rival simply drives into the
    // back of whoever is ahead and stays there: the field spent 40% of the
    // race nose-to-tail, bleeding speed to contact drag the whole time, and a
    // pack of seven was slower than one car driving round on its own. A queue
    // is what traffic is supposed to look like.
    const lead = this.carAhead(car, RULES.carLen * 1.35, RULES.carW);
    if (lead && car.v > lead.car.v) car.brake = true;
  },

  // The nearest car ahead of this one within `maxS` of track and `maxN` across
  // it, as { car, dS }, or null. Shared by the following rule and the
  // overtaking line so the two can never disagree about who is in the way.
  carAhead(car, maxS, maxN) {
    const t = this.track, half = t.len / 2;
    let best = null, closest = Infinity;
    for (const o of this.cars) {
      if (o === car || o.finished) continue;
      let dS = o.s - car.s;
      if (dS > half) dS -= t.len; else if (dS < -half) dS += t.len;
      if (dS <= 1 || dS > maxS) continue;
      if (Math.abs(o.n - car.n) > maxN) continue;
      if (dS < closest) { closest = dS; best = o; }
    }
    return best ? { car: best, dS: closest } : null;
  },

  // Should this car be on the brakes?
  //
  // Not "is it faster than the slowest corner in the next hundred units" —
  // that ignores the distance available to shed the speed in, so a driver
  // brakes on entry to a long gentle sweep for a hairpin at the far end of it.
  // The cost of that mistake is not small: it made NEVER BRAKING the quicker
  // strategy on any flowing circuit, so a bot holding no input at all outran a
  // field of seven that were all braking properly.
  //
  // The real question is whether the car can still be down to each corner's
  // limit by the time it arrives — the same v² = u² + 2as the ideal-lap solver
  // sweeps backwards with. `margin` is how much of the limit the driver is
  // willing to use, so a timid one brakes earlier for the same corner.
  needBrake(car, margin) {
    const t = this.track, grip = this.gripOf(car);
    const look = 26 + (car.v * car.v) / (2 * car.stats.brake);
    for (let d = 0; d <= look; d += 20) {
      const lim = t.limitAt(car.s + d, car.n, grip) * margin;
      if (car.v * car.v > lim * lim + 2 * car.stats.brake * d) return true;
    }
    return false;
  },

  // How far ahead a car has to be looking to stop in time.
  brakeLook(car) { return 30 + (car.v * car.v) / (2 * car.stats.brake); },

  // The racing line, as a steering command.
  //
  // Two lookahead windows rather than one: what the car is IN, and what is
  // coming. In a corner you want the inside (it is shorter); approaching one
  // you want the outside (it opens the radius). A single averaged curvature
  // gives neither and drives down the middle of everything.
  aim(car) {
    const t = this.track;
    const avg = (from, to) => {
      let a = 0, k = 0;
      for (let d = from; d <= to; d += 22) { a += t.curvAt(car.s + d); k++; }
      return a / Math.max(1, k);
    };
    const near = avg(8, 62);
    const far = avg(78, 78 + Math.max(120, car.v * 0.85));
    const inCorner = Math.abs(near) >= Math.abs(far) * 0.85;
    const k = inCorner ? near : far;
    const strength = Math.min(1, Math.abs(k) * 300);
    let ideal = (inCorner ? 1 : -1) * Math.sign(k) * t.halfW * 0.78 * car.line * strength;

    // Overtaking. On a two-car grid a driver who cannot see the car in front is
    // merely rude; in a pack of eight it is the difference between racing and
    // queueing.
    //
    // Two conditions, both learned from the pack crippling itself. Only move
    // for a car you are actually CATCHING — otherwise everyone in a queue
    // swerves for the car ahead forever. And BLEND the avoiding line with the
    // racing line rather than replacing it: a full override meant that with
    // seven rivals somebody was always in front of somebody, so nobody drove
    // the racing line at all and the whole field was slower than a car holding
    // no input, which is how this was found.
    const block = this.carAhead(car, 66, RULES.carW * 1.5);
    // Move for a car you are catching — OR one you are already stuck behind.
    // The second half is not optional: the following rule above pegs your
    // speed to the car in front, so "am I closing on it?" is false by
    // construction the moment you are held up, and a faster car could never
    // pull out. The whole field deadlocked into a train.
    if (block && (car.v > block.car.v + 2 || block.dS < RULES.carLen * 1.7)) {
      const room = t.halfW * 0.92;
      const side = block.car.n < 0 ? 1 : -1;
      const avoid = Math.max(-room, Math.min(room, block.car.n + side * RULES.carW * 1.9));
      ideal = ideal * 0.35 + avoid * 0.65;
    }

    // PD toward the ideal offset. The damping term matters: without it the
    // lateral spring overshoots the line every corner and the rivals weave.
    return Math.max(-1, Math.min(1, (ideal - car.n) * 0.055 - car.vn * 0.016));
  },

  // Grip, after the grass and after however unsettled the car already is.
  //
  // The second term is what makes a slide something you have to DRIVE out of.
  // Without it a slide was self-cancelling: being pushed toward the outside of
  // a bend raises the radius, which raises the limit, so the car quietly
  // stopped sliding on the fastest line available and never paid for the
  // mistake — which is how never lifting stayed competitive on open circuits.
  // Losing grip should cost grip. Lifting for half a second recovers all of
  // it, and the auto-brake never lets it start.
  gripOf(car) {
    return car.stats.grip
      * (1 - car.grass * (1 - RULES.grassGrip))
      * (1 - car.sliding * RULES.slideGripLoss);
  },

  /* --------------------------------------------------------- physics -- */

  step(car, dt) {
    const t = this.track;

    // How far off the tarmac the car is, 0..1 — grass costs grip and top speed
    // rather than ending the run. Nothing in this game crashes you out.
    const edge = t.halfW - RULES.carW * 0.35;
    car.grass = Math.max(0, Math.min(1, (Math.abs(car.n) - edge) / 16));

    const grip = this.gripOf(car);
    const top = car.stats.top * (1 - car.grass * (1 - RULES.grassTop));

    const k = t.curvAt(car.s);
    const lim = t.limitAt(car.s, car.n, grip);
    const sliding = car.v > lim;

    // Throttle eases off as the car approaches its top speed, so acceleration
    // is worth most where it is felt — coming out of a corner. And there is no
    // throttle at all past the limit: the tyres have nothing left to push
    // with.
    //
    // That last clause is load-bearing. With the throttle still running during
    // a slide it added back most of what the scrub took, so sliding through a
    // corner cost about nothing while braking cost a slow climb back to speed
    // — and on an open circuit the quickest way round was to never lift at
    // all. Cutting it is what finally made the corner limit mean something.
    if (car.brake) car.v -= car.stats.brake * dt;
    else if (!sliding) car.v += car.stats.accel * dt * Math.max(0.15, 1 - car.v / Math.max(40, top));
    car.v -= RULES.drag * car.v * dt;
    car.v = Math.max(0, Math.min(car.v, top * 1.25));

    // Cornering. Over the limit the car scrubs speed AND is pushed toward the
    // outside of the bend — understeer, not a spin, because a five-year-old
    // losing control of the car is where a racing game stops being fun.
    if (car.v > lim) {
      const over = car.v - lim;
      // Superlinear, and that shape is the point. A flat scrub made sliding
      // CHEAPER than braking: a bot that never lifted sat 30% over the limit,
      // never reached the grass on a gentle circuit, and averaged more speed
      // than one that respected every corner — so the whole skill of the game
      // paid nothing. Growing the cost with the overspeed leaves a small
      // overshoot forgiving (a child a few units over barely notices) while
      // making a big one unsurvivable.
      car.v -= over * (RULES.slideScrub + over * RULES.slideBite) * dt;
      car.n -= Math.sign(k || 1) * over * RULES.slidePush * dt;
      car.sliding = Math.min(1, car.sliding + dt * 3);
    } else {
      car.sliding = Math.max(0, car.sliding - dt * 2);
    }

    // Steering: a damped lateral spring, so a correction settles instead of
    // snapping, and a held input still has a definite top rate.
    car.vn += (car.steer || 0) * RULES.steerAcc * dt * (1 - car.grass * 0.55);
    car.vn *= Math.exp(-RULES.steerDamp * dt);
    car.vn = Math.max(-RULES.steerMax, Math.min(RULES.steerMax, car.vn));
    car.n += car.vn * dt;

    if (Math.abs(car.n) > RULES.wall) {
      car.n = Math.sign(car.n) * RULES.wall;
      car.vn = -car.vn * 0.2;
      car.v *= 0.86;
      if (car.isPlayer) this.events.push({ kind: "wall", car });
    }

    // Advance. `advance` is the world distance covered per unit of centre-line
    // arc length at this offset — less than 1 on the inside of a corner, which
    // is the entire reason cutting an apex is worth anything.
    const ds = (car.v * dt) / t.advance(car.s, car.n);
    car.raced += ds;
    car.s = t.wrap(car.raced);

    if (car.isPlayer) this.sampleGhost(car);

    // Laps completed since crossing the line, so a car on the third row is on
    // lap 0 until it actually reaches the start line.
    const lapNow = Math.max(0, Math.floor(car.raced / t.len));
    if (lapNow > car.lap) {
      const lapTime = this.time - car.lapStart;
      car.lap = lapNow;
      car.lapStart = this.time;
      if (car.isPlayer) this.lapDone(lapTime);
      if (car.lap >= this.laps) this.finish(car);
    }
  },

  // Push overlapping cars apart. Gentle by design: contact costs a little
  // speed and a shove sideways, never a spin or a stop.
  //
  // The speed loss is scaled by dt rather than applied as a flat multiplier.
  // It used to be `behind.v *= 0.965` per frame, which is not a nudge — held
  // for a second at 60fps it takes 88% of the car's speed, and it is worse on
  // a faster display. On a small grid that was rarely noticed; on a full one
  // it wrecked the whole field except whoever happened to be in front, and the
  // bot that never touched the controls started winning races.
  collide(dt) {
    const t = this.track, half = t.len / 2;
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        if (a.finished || b.finished) continue;
        let dS = a.s - b.s;
        if (dS > half) dS -= t.len; else if (dS < -half) dS += t.len;
        const dN = a.n - b.n;
        if (Math.abs(dS) > RULES.carLen || Math.abs(dN) > RULES.carW) continue;
        const push = (RULES.carW - Math.abs(dN)) / 2 + 0.5;
        const dir = Math.sign(dN) || (a.grid < b.grid ? 1 : -1);
        a.n += dir * push; b.n -= dir * push;
        const behind = dS < 0 ? a : b;                   // the one further back lifts
        behind.v -= behind.v * RULES.contactDrag * dt;
        if ((a.isPlayer || b.isPlayer) && Math.abs(dS) < RULES.carLen * 0.7) {
          this.events.push({ kind: "bump" });
        }
      }
    }
  },

  /* ----------------------------------------------------------- ghosts -- */

  sampleGhost(car) {
    const t = this.track;
    const size = t.len / Ghost.STATIONS;
    const inLap = car.raced - car.lap * t.len;
    const st = Math.floor(inLap / size);
    while (this.lapRec.next <= st && this.lapRec.next < Ghost.STATIONS) {
      Ghost.capture(this.lapRec, this.lapRec.next, this.time - car.lapStart, car.n);
      this.lapRec.next++;
    }
  },

  lapDone(lapTime) {
    this.events.push({ kind: "lap", time: lapTime, lap: this.cars[0].lap });
    if (!this.bestLap || lapTime < this.bestLap) {
      // Only a COMPLETE lap becomes a ghost. A lap whose recorder never
      // reached the last station is one the player crossed the line early on
      // (the first lap from a standing start on the grid), and replaying it
      // would show a ghost teleporting.
      this.bestLap = lapTime;
      if (this.lapRec.next >= Ghost.STATIONS) this.bestLapGhost = Ghost.encode(this.lapRec, lapTime);
    }
    this.lapRec = Ghost.recorder();
  },

  /* --------------------------------------------------------- finishing -- */

  finish(car) {
    if (car.finished) return;
    car.finished = true;
    car.finishTime = this.time;
    if (!car.isPlayer) return;

    this.running = false;
    this.phase = "done";

    // Finishing position is who CROSSED FIRST, not who has the larger `prog`.
    // Comparing progress looks equivalent and is not: a car that finished
    // twenty seconds ago has a frozen prog a hair either side of the winning
    // distance, so the comparison came down to which one happened to overshoot
    // the line by more. It handed a race to a bot that never touched the
    // controls, which is how it was found.
    let ahead = 0;
    for (const c of this.cars) {
      if (c === car) continue;
      if (c.finished || c.raced > car.raced) ahead++;  // the second case is the timeout path
    }
    const place = ahead + 1;
    const field = this.cars.length;
    const beat = field - place;

    const time = this.time;
    const underPar = time <= this.par;
    const clean = Math.max(0, Math.min(1, this.cleanTime / Math.max(0.001, time)));

    // Finishing is always worth a star. Losing a race is fine; being unable to
    // get past one is not, so the campaign never gates on beating anybody.
    // A podium, not "the top half" — on a grid of eight, beating four cars is
    // not a result a child would describe as one, and "get on the podium" is a
    // goal that explains itself. The min() keeps it honest if a race is ever
    // run with a smaller field.
    let stars = 0;
    if (this.mode === "campaign") {
      stars = 1;
      if (place <= Math.min(3, Math.ceil(field / 2))) stars = 2;
      if (place === 1 && underPar) stars = 3;
    }

    const ch = this.challenge;
    // Per rival beaten, scaled so a win on a full grid pays about what a win
    // on a small one used to. A bigger field must not quietly inflate the
    // economy — the Garage is balanced against what the progression bot earns.
    const coins = this.mode !== "campaign" ? 0 : Math.round(
      14 + beat * 7 + (underPar ? 22 : 0) + clean * 12 + (ch ? ch.chapter * 7 : 0)
    );

    const res = {
      mode: this.mode,
      challengeIdx: this.challengeIdx,
      place, field, beat, stars, coins,
      time, bestLap: this.bestLap, par: this.par, underPar, clean,
      laps: this.laps, trackLen: this.track.len,
      ghost: this.bestLapGhost,
      // 1000 is par. Above it you beat the target; the Daily leaderboard is
      // this number, which is why a short circuit is no advantage — par scales
      // with whatever the player drew.
      score: Math.round((1000 * this.par) / Math.max(0.001, time)),
      timedOut: time > RULES.maxRaceTime,
    };
    this.result = res;
    if (typeof App !== "undefined" && App.raceOver) App.raceOver(res);
    return res;
  },

  quit() {
    this.running = false;
    this.phase = "done";
    if (typeof App !== "undefined" && App.raceOver) App.raceOver(null, true);
  },

  pause() { if (this.running) { this.paused = true; if (typeof GK !== "undefined") GK.UI.openModal("modal-pause"); } },
  resume() { this.paused = false; if (typeof GK !== "undefined") GK.UI.closeModal("modal-pause"); },

  /* ------------------------------------------------------------- info -- */

  // Live standings for the HUD, best first.
  standings() {
    return this.cars.slice().sort((a, b) => b.raced - a.raced);
  },

  playerPlace() {
    const me = this.cars[0];
    let ahead = 0;
    for (const c of this.cars) if (c !== me && (c.finished || c.raced > me.raced)) ahead++;
    return ahead + 1;
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { RULES, Game });
