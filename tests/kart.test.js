const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, Track, Kart } = require('./load');
const circuit = () => Track.make(Array.from({length: 160}, (_, i) => ({
  x: 350 + 230 * Math.cos(i / 160 * Math.PI * 2),
  y: 500 + 300 * Math.sin(i / 160 * Math.PI * 2),
})));
function start() {
  Game.start({track: circuit(), laps: 3, rivals: 0, mode: 'free', silent: true, assist: false});
  Game.phase = 'race'; const car = Game.cars[0]; car.n = 0; return car;
}
test('steering changes the world heading rather than shifting a car that follows the road', () => {
  const car = start(); car.v = 120;
  const before = Game.track.headingAt(car.s);
  for (let i = 0; i < 30; i++) { Game.input.steer = .6; Game.update(1/120); }
  const after = Game.track.headingAt(car.s) + car.yaw;
  assert.ok(Kart.angle(after - before) > .12);
});
test('letting go keeps a straight world heading until the verge assists recovery', () => {
  const car = start(); car.v = 120;
  const before = Game.track.headingAt(car.s);
  for (let i = 0; i < 20; i++) Game.update(1/120);
  assert.ok(Math.abs(Kart.angle(Game.track.headingAt(car.s) + car.yaw - before)) < .001);
});
test('negative and invalid frame times cannot reverse or corrupt a race', () => {
  const car = start(); const before = car.raced;
  for (const dt of [-1, NaN, Infinity]) Game.update(dt);
  assert.equal(car.raced, before); assert.equal(Game.time, 0);
});
test('a new race resets drift input and all earned boost state', () => {
  start(); Game.input.drift = true;
  const car = start(); Game.update(1/120);
  assert.equal(Game.input.drift, false); assert.equal(car.boosting, 0);
});
test('releasing a charged drift rewards a boost, tapping drift does not', () => {
  const car = start(); car.v = 130; Game.update(1/120);
  car.driftHeld = true; car.driftCharge = 1.8; car.driftDir = 1;
  Game.update(1/120);
  assert.ok(car.boosting > 1); assert.ok(Game.events.some(e => e.kind === 'boost' && e.tier === 2));
  start(); Game.input.drift = true; Game.update(1/120); Game.input.drift = false; Game.update(1/120);
  assert.equal(Game.cars[0].boosting, 0);
});
test('a real held corner drift charges and releases a boost with auto-brake enabled', () => {
  const car = start();Game.assist = true;
  let peak=0,released=false;
  for(let i=0;i<2400;i++) {
    Game.input.steer=Game.aim(car);
    Game.input.drift=i>500&&i<900;
    Game.update(1/120);peak=Math.max(peak,car.driftCharge);
    if(Game.events.some(e=>e.kind==='boost'))released=true;
    Game.events.length=0;
  }
  assert.ok(peak>=.65,`drift charged only ${peak}`);assert.ok(released,'auto-brake cancelled every drift');
});
test('losing drift conditions while still holding the button cancels charge without boosting', () => {
  for(const situation of ['slow','grass','brake']) {
    const car=start();car.v=130;Game.update(1/120);
    car.driftHeld=true;car.driftCharge=1.8;car.driftDir=1;Game.input.drift=true;
    if(situation==='slow')car.v=50;
    if(situation==='grass')car.n=Game.track.halfW-2;
    if(situation==='brake')Game.input.brake=true;
    Game.update(1/120);
    assert.equal(car.boosting,0,situation);
    assert.ok(!Game.events.some(e=>e.kind==='boost'),situation);
    assert.equal(car.driftCharge,0,situation);
  }
});
test('the same driver stays stable at 60 and 120 simulation steps per second', () => {
  const run = (hz) => {
    const car = start();
    for(let i = 0; i < hz * 25; i++) {
      Game.input.steer = Game.aim(car); Game.input.brake = Game.needBrake(car, .95); Game.update(1/hz);
      assert.ok(Number.isFinite(car.n) && Number.isFinite(car.yaw) && car.v >= 0);
      assert.ok(Math.abs(car.n) <= 100);
    }
    return car.raced;
  };
  const a = run(60), b = run(120); assert.ok(Math.abs(a-b)/b < .015, `${a} vs ${b}`);
});
