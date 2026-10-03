// Arcade handling in track coordinates. Heading is free: releasing the wheel
// keeps the kart travelling straight instead of automatically following bends.
// Track coordinates retain the authored drawings, lap rules and compact ghosts.
const Kart = {
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  angle(v) { return Math.atan2(Math.sin(v), Math.cos(v)); },
  turnRate(car) { return 1.95 * Math.min(1, car.v / 95); },
  aim(car) {
    const t = Game.track;
    const look = 42 + car.v * 0.34;
    const curvature = t.curvAt(car.s + look * .7);
    let lane = Math.sign(curvature) * Math.min(1, Math.abs(curvature) * 160) * t.halfW * .64 * car.line;
    lane += Math.sin(car.grid * 2.1) * 5;
    const block = Game.carAhead(car, 85, RULES.carW * 1.5);
    if (block) lane = Kart.clamp(block.car.n + (block.car.n > 0 ? -1 : 1) * 29, -t.halfW * .74, t.halfW * .74);
    const p = t.toWorld(car.s, car.n), goal = t.toWorld(car.s + look, lane);
    const desired = Math.atan2(goal.y - p.y, goal.x - p.x);
    const actual = t.headingAt(car.s) + (car.yaw || 0);
    return Kart.clamp(Kart.angle(desired - actual) * 4.1 / Math.max(.5, Kart.turnRate(car)), -1, 1);
  },
  step(car, dt) {
    const t = Game.track, clamp = Kart.clamp;
    if (car.yaw === undefined) Object.assign(car, { yaw: 0, wheel: 0, driftCharge: 0, boosting: 0, driftHeld: false, driftDir: 0 });
    const oldHeading = t.headingAt(car.s);
    car.grass = clamp((Math.abs(car.n) - (t.halfW - 7)) / 18, 0, 1);
    const steer = clamp(car.steer || 0, -1, 1);
    car.wheel += (steer - car.wheel) * (1 - Math.exp(-12 * dt));
    const held = car.isPlayer && !!Game.input.drift && car.v > 65 && car.grass < .25 && !car.brake;
    if (held && !car.driftHeld && Math.abs(steer) > .18) car.driftDir = Math.sign(steer);
    const drifting = held && car.driftDir !== 0;
    if (drifting) {
      // Charge only through a real bend in the held direction, not on straights.
      const bend = t.curvAt(car.s) * car.driftDir;
      if (bend > .0015 && Math.abs(car.yaw) > .04 && Math.abs(car.n) < t.halfW) car.driftCharge = Math.min(2.6, car.driftCharge + dt);
    } else {
      if (car.driftHeld && !Game.input.drift && car.driftCharge >= .65 && car.grass < .3 && !car.brake) {
        const tier = car.driftCharge >= 1.65 ? 2 : 1;
        car.boosting = tier === 2 ? 1.45 : .85;
        if (car.isPlayer) Game.events.push({ kind: "boost", tier });
      }
      car.driftCharge = 0; car.driftDir = 0;
    }
    car.driftHeld = drifting;
    car.boosting = Math.max(0, car.boosting - dt);
    const boost = car.boosting > 0 && car.grass < .4;
    const top = car.stats.top * (1 - .57 * car.grass) * (boost ? 1.27 : 1);
    const throttle = car.throttle ?? 1;
    const drag = .10 + car.grass * .65;
    if (car.brake) car.v -= car.stats.brake * dt;
    else car.v += car.stats.accel * (boost ? 1.8 : 1) * throttle * Math.max(.2, 1 - car.v / top) * dt;
    car.v = clamp(car.v - car.v * drag * dt, 0, top * 1.08);
    // A drift turns the nose farther than the travel vector. Countersteering
    // changes the arc, and release restores grip with a short earned boost.
    let rate = car.wheel * Kart.turnRate(car) * (1 - .38 * car.grass);
    if (drifting) rate = (car.driftDir * .34 + car.wheel * .83) * Kart.turnRate(car);
    // Keep the nose consistent with the forward-only travel model. A held
    // button must not spin the artwork backwards while the kart moves forwards.
    const nose = oldHeading + clamp(car.yaw + rate * dt, -1.12, 1.12);
    const slip = drifting ? car.driftDir * .24 : 0;
    const travel = clamp(Kart.angle(nose - oldHeading) - slip, -1.12, 1.12);
    // Modest tyre scrub conveys pushing too hard without the old runaway
    // grip-loss cycle that dumped the car onto grass and killed its speed.
    const gripLimit = t.limitAt(car.s, car.n, car.stats.grip * (drifting ? 1.22 : 1));
    const over = Math.max(0, car.v - gripLimit);
    if (!boost) car.v = Math.max(0, car.v - over * .8 * dt);
    car.sliding = drifting ? .65 : clamp(over / 55, 0, 1);
    car.vn = Math.sin(travel) * car.v;
    car.n += car.vn * dt;
    const ds = Math.cos(travel) * car.v * dt / t.advance(car.s, car.n);
    car.raced += ds; car.s = t.wrap(car.raced);
    car.yaw = clamp(Kart.angle(nose - t.headingAt(car.s)), -1.2, 1.2);
    // Gentle verge assistance only near the barrier. Steering still owns
    // corners; this stops young drivers getting wedged facing the edge.
    if (Math.abs(car.n) > t.halfW + 18) {
      const outward = Math.sign(car.n);
      if (car.yaw * outward > 0) car.yaw -= outward * Math.min(Math.abs(car.yaw), dt * (Game.assist && car.isPlayer ? 2.8 : 1.8));
    }
    if (Math.abs(car.n) > RULES.wall) {
      car.n = Math.sign(car.n) * RULES.wall;
      car.yaw = -Math.sign(car.n) * .22; car.v *= .88;
      if (car.isPlayer) Game.events.push({ kind: "wall", car });
    }
    if (car.isPlayer) Game.sampleGhost(car);
    const lapNow = Math.max(0, Math.floor(car.raced / t.len));
    if (lapNow > car.lap) {
      const lapTime = Game.time - car.lapStart;
      car.lap = lapNow; car.lapStart = Game.time;
      if (car.isPlayer) Game.lapDone(lapTime);
      if (car.lap >= Game.laps) Game.finish(car);
    }
  },
};

// Install handling behind the existing game shell and persistence interface.
Game.step = Kart.step;
Game.aim = Kart.aim;
// The old engine treated any slide as damage to grip. An intentional drift
// must not make auto-brake repeatedly cancel the drift it just allowed.
const settledGrip = Game.gripOf;
Game.gripOf = function(car) {
  const drifting = car.isPlayer && this.input.drift;
  return drifting ? car.stats.grip * (1 - car.grass * .65) * 1.22 : settledGrip.call(this,car);
};
Game.input.drift = false;
const startRace = Game.start;
Game.start = function(opts) { this.input.drift = false; return startRace.call(this, opts); };
