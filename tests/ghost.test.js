// Ghost laps.
//
// A ghost is the only thing in this game that crosses between two people, so
// the encoding has to survive a round trip through a Firestore document and
// come back pointing at the same piece of tarmac. A ghost that is subtly wrong
// is worse than no ghost: it silently tells a child they are behind when they
// are ahead.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Ghost } = S;

function lap(fn, lapTime) {
  const rec = Ghost.recorder();
  for (let i = 0; i < Ghost.STATIONS; i++) {
    Ghost.capture(rec, i, (i / Ghost.STATIONS) * lapTime, fn(i / Ghost.STATIONS));
  }
  return rec;
}

test("a lap survives the round trip", () => {
  const rec = lap((f) => Math.sin(f * 6) * 30, 18.42);
  const g = Ghost.decode(Ghost.encode(rec, 18.42));
  assert.ok(g);
  assert.ok(Math.abs(g.lap - 18.42) < 0.01);
  for (let i = 0; i < Ghost.STATIONS; i++) {
    assert.ok(Math.abs(g.t[i] - rec.t[i]) < 0.01, `station ${i} time drifted`);
    assert.ok(Math.abs(g.n[i] - rec.n[i]) < 0.51, `station ${i} offset drifted`);
  }
});

test("it is small enough to live inside a progress document", () => {
  const enc = Ghost.encode(lap(() => 40, 59.99), 59.99);
  assert.ok(enc.length < 600, `${enc.length} chars`);
});

test("playback lands where the lap actually was", () => {
  const lapTime = 20;
  const g = Ghost.decode(Ghost.encode(lap((f) => f * 60 - 30, lapTime), lapTime));
  assert.ok(Math.abs(Ghost.posAt(g, 0).frac) < 0.02);
  assert.ok(Math.abs(Ghost.posAt(g, lapTime / 2).frac - 0.5) < 0.02);
  // Halfway round, the offset was halfway along the ramp.
  assert.ok(Math.abs(Ghost.posAt(g, lapTime / 2).n - 0) < 1.5);
});

test("a quicker ghost laps you rather than stopping at the line", () => {
  const g = Ghost.decode(Ghost.encode(lap(() => 0, 10), 10));
  const p = Ghost.posAt(g, 25);
  assert.equal(p.laps, 2, "two full laps done");
  assert.ok(p.frac > 0.4 && p.frac < 0.6, "and half way round a third");
});

test("a corrupt ghost is nothing, not a car in the wrong place", () => {
  for (const junk of ["", "abc", null, undefined, "z".repeat(100)]) {
    assert.equal(Ghost.decode(junk), null, `decoded ${JSON.stringify(junk)}`);
  }
});

test("an offset beyond the barriers still encodes without wrapping round", () => {
  // Offsets are packed with a +128 bias; a car shoved onto the verge must not
  // come back on the opposite side of the track.
  const rec = lap((f) => (f < 0.5 ? -120 : 120), 12);
  const g = Ghost.decode(Ghost.encode(rec, 12));
  assert.ok(g.n[2] < -100 && g.n[Ghost.STATIONS - 4] > 100);
});
