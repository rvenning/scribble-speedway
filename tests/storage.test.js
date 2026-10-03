// Progress and cross-device reconciliation.
//
// mergeProgress is the one function in the game that can permanently destroy a
// save — it runs on every sync, on every device, and a bad merge is not a bug
// you notice, it is a child's work quietly rolling backwards. Here that work
// includes the circuits they DREW, which is a great deal more personal than a
// high score, so the merge is tested hardest on never losing one.
//
// It lives in a closure inside createStorage, so js/storage.js declares it as a
// named PROGRESS object first purely so this file can reach it.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");

const S = loadScripts({
  baseDir: ROOT,
  files: [
    "lib/gk-util.js",
    "lib/gk-storage.js",
    "js/track.js",
    "js/rng.js",
    "js/generate.js",
    "js/cars.js",
    "js/upgrades.js",
    "js/challenges.js",
    "js/ghost.js",
    "js/storage.js",
  ],
  // browser:true — gk-storage needs window, localStorage and a document.
  exports: ["PROGRESS", "Storage", "CHALLENGES", "UPGRADES", "SKINS", "MAX_TRACKS"],
  browser: true,
});

const { PROGRESS, Storage, UPGRADES, SKINS } = S;
const blank = () => PROGRESS.blank();

test("kart records merge independently of classic records without losing drawings", () => {
  const a = {...blank(),tracks:[{id:'drawn',line:'keep-me',best:12,ghost:'classic-a',kartBest:22,kartGhost:'kart-a'}]};
  const b = {...blank(),tracks:[{id:'drawn',line:'keep-me',best:14,ghost:'classic-b',kartBest:20,kartGhost:'kart-b'}]};
  for (const merged of [PROGRESS.merge(a,b),PROGRESS.merge(b,a)]) {
    assert.equal(merged.tracks[0].line,'keep-me'); assert.equal(merged.tracks[0].best,12);
    assert.equal(merged.tracks[0].kartBest,20); assert.equal(merged.tracks[0].kartGhost,'kart-b');
  }
});
test("daily kart records survive sync with a better classic score", () => {
  const a = {...blank(),daily:{date:'2026-10-03',line:'same-track',score:1800,kartScore:1000,kartGhost:'kart-a'}};
  const b = {...blank(),daily:{date:'2026-10-03',line:'same-track',score:1500,kartScore:1200,kartGhost:'kart-b'}};
  for (const merged of [PROGRESS.merge(a,b),PROGRESS.merge(b,a)]) {
    assert.equal(merged.daily.score,1800); assert.equal(merged.daily.kartScore,1200); assert.equal(merged.daily.kartGhost,'kart-b');
  }
});
test("a daily ghost never gets attached to a different device's drawing", () => {
  const a = {...blank(),daily:{date:'2026-10-03',line:'oval',score:1800,kartScore:1000,kartGhost:'oval-ghost'}};
  const b = {...blank(),daily:{date:'2026-10-03',line:'hairpins',score:1500,kartScore:1200,kartGhost:'hairpin-ghost'}};
  for (const merged of [PROGRESS.merge(a,b),PROGRESS.merge(b,a)]) {
    assert.equal(merged.daily.line,'hairpins'); assert.equal(merged.daily.kartGhost,'hairpin-ghost');
  }
});

/* -------------------------------------------------------- the coin ledger */

test("coins are a two-sided ledger, so a sync cannot refund what was spent", () => {
  const a = { ...blank(), coinsEarned: 500, coinsSpent: 400 };
  const b = { ...blank(), coinsEarned: 500, coinsSpent: 0 };
  assert.equal(Storage.coins(PROGRESS.merge(a, b)), 100);
  assert.equal(Storage.coins(PROGRESS.merge(b, a)), 100, "the merge has to be order-independent");
});

test("two devices that each bought something keep both purchases", () => {
  const a = { ...blank(), coinsEarned: 1000, coinsSpent: 150, upgrades: { grip: 1 } };
  const b = { ...blank(), coinsEarned: 1000, coinsSpent: 240, upgrades: { top: 2 } };
  const m = PROGRESS.merge(a, b);
  assert.deepEqual(m.upgrades, { grip: 1, top: 2 });
  assert.equal(Storage.coins(m), 1000 - 240);
});

test("paint bought on one device shows up on the other", () => {
  const a = { ...blank(), skins: ["red", "blue", "gold"] };
  const b = { ...blank(), skins: ["red", "blue", "mint"] };
  const m = PROGRESS.merge(a, b);
  assert.deepEqual(m.skins.sort(), ["blue", "gold", "mint", "red"]);
});

/* ------------------------------------------------------------ the races -- */

test("a race result merges to the best of each field, not the latest", () => {
  const a = { ...blank(), races: { 0: { stars: 3, place: 1, time: 30 }, 1: { stars: 1, place: 3, time: 60 } } };
  const b = { ...blank(), races: { 1: { stars: 2, place: 2, time: 52 }, 2: { stars: 1, place: 2, time: 44 } } };
  const m = PROGRESS.merge(a, b);
  assert.deepEqual(m.races[0], { stars: 3, place: 1, time: 30 });
  assert.deepEqual(m.races[1], { stars: 2, place: 2, time: 52 }, "best stars, best place, best time");
  assert.deepEqual(m.races[2], { stars: 1, place: 2, time: 44 });
});

test("progress never rolls backwards when a stale device syncs", () => {
  const played = { ...blank(), coinsEarned: 800, races: { 0: { stars: 3, place: 1, time: 29 }, 1: { stars: 2, place: 2, time: 41 } } };
  const stale = blank();
  for (const m of [PROGRESS.merge(played, stale), PROGRESS.merge(stale, played)]) {
    assert.equal(Object.keys(m.races).length, 2);
    assert.equal(m.coinsEarned, 800);
  }
});

/* ----------------------------------------------------------- the tracks -- */

test("a circuit drawn on one device is never dropped by a merge on the other", () => {
  const a = { ...blank(), tracks: [{ id: "t1", name: "Rosalie's Loop", line: "aaaa".repeat(20), best: 0, ghost: null }] };
  const b = { ...blank(), tracks: [{ id: "t2", name: "Isabelle's Squiggle", line: "bbbb".repeat(20), best: 0, ghost: null }] };
  const m = PROGRESS.merge(a, b);
  assert.deepEqual(m.tracks.map((t) => t.id).sort(), ["t1", "t2"]);
  assert.equal(m.tracks.find((t) => t.id === "t1").name, "Rosalie's Loop");
});

test("the same circuit on two devices keeps the quicker lap and ITS ghost", () => {
  const line = "cccc".repeat(20);
  const a = { ...blank(), tracks: [{ id: "t1", name: "Loop", line, best: 22.4, ghost: "GHOST-A" }] };
  const b = { ...blank(), tracks: [{ id: "t1", name: "Loop", line, best: 19.8, ghost: "GHOST-B" }] };
  for (const m of [PROGRESS.merge(a, b), PROGRESS.merge(b, a)]) {
    const t = m.tracks.find((x) => x.id === "t1");
    assert.equal(t.best, 19.8);
    assert.equal(t.ghost, "GHOST-B", "the ghost must belong to the lap it came from");
  }
});

test("an unraced copy of a circuit cannot erase a raced one", () => {
  const line = "dddd".repeat(20);
  const raced = { ...blank(), tracks: [{ id: "t1", name: "Loop", line, best: 21.0, ghost: "G" }] };
  const fresh = { ...blank(), tracks: [{ id: "t1", name: "Loop", line, best: 0, ghost: null }] };
  for (const m of [PROGRESS.merge(raced, fresh), PROGRESS.merge(fresh, raced)]) {
    const t = m.tracks.find((x) => x.id === "t1");
    assert.equal(t.best, 21.0);
    assert.equal(t.ghost, "G");
  }
});

/* ------------------------------------------------------------ the daily -- */

test("the daily keeps the better score on the same day", () => {
  const a = { ...blank(), daily: { date: "2026-08-08", line: "x", score: 940, time: 40, ghost: "A", plays: 2 } };
  const b = { ...blank(), daily: { date: "2026-08-08", line: "x", score: 1080, time: 35, ghost: "B", plays: 1 } };
  for (const m of [PROGRESS.merge(a, b), PROGRESS.merge(b, a)]) {
    assert.equal(m.daily.score, 1080);
    assert.equal(m.daily.ghost, "B");
  }
});

test("and today's circuit always beats yesterday's, however good yesterday was", () => {
  const old = { ...blank(), daily: { date: "2026-08-07", line: "x", score: 1400, time: 30, ghost: "OLD", plays: 9 } };
  const now = { ...blank(), daily: { date: "2026-08-08", line: "y", score: 300, time: 70, ghost: "NEW", plays: 1 } };
  for (const m of [PROGRESS.merge(old, now), PROGRESS.merge(now, old)]) {
    assert.equal(m.daily.date, "2026-08-08");
  }
  // the all-time headline still remembers the good day
  assert.equal(PROGRESS.merge({ ...old, bestDaily: 1400 }, { ...now, bestDaily: 300 }).bestDaily, 1400);
});

/* ------------------------------------------------------- the shop rules -- */

test("nothing in the garage can be bought without the coins for it", () => {
  const p = { ...blank(), coinsEarned: 10 };
  Storage.getProgress = () => p;
  Storage.saveProgress = () => {};
  for (const u of UPGRADES) assert.equal(Storage.buyUpgrade("x", u.id).ok, false);
  for (const s of SKINS.filter((s) => s.cost > 0)) assert.equal(Storage.buySkin("x", s.id).ok, false);
});

test("an upgrade cannot be bought past its last level", () => {
  const u = UPGRADES[0];
  const p = { ...blank(), coinsEarned: 99999, upgrades: { [u.id]: u.costs.length } };
  Storage.getProgress = () => p;
  Storage.saveProgress = () => {};
  assert.equal(Storage.buyUpgrade("x", u.id).reason, "maxed");
});

test("every upgrade has a value for every level it can be bought to", () => {
  const bad = UPGRADES.filter((u) => u.costs.length !== u.value.length).map((u) => u.id);
  assert.deepEqual(bad, [], "a level with no value behind it does nothing at all");
});

test("upgrade costs only ever go up", () => {
  const bad = [];
  for (const u of UPGRADES) {
    for (let i = 1; i < u.costs.length; i++) if (u.costs[i] <= u.costs[i - 1]) bad.push(`${u.id} level ${i + 1}`);
  }
  assert.deepEqual(bad, []);
});

test('long-course records merge without overwriting previous lap records or purchases',()=>{
  const a={...blank(),openWins:4,wideBestDaily:1100,coinsEarned:300,coinsSpent:120,tracks:[{id:'t',line:'same',kartBest:12,kartGhost:'old',wideBest:30,wideGhost:'new-a'}]};
  const b={...blank(),openWins:2,tracks:[{id:'t',line:'same',wideBest:28,wideGhost:'new-b'}]};
  for(const merged of [PROGRESS.merge(a,b),PROGRESS.merge(b,a)]) {
    assert.equal(merged.openWins,4);assert.equal(merged.wideBestDaily,1100);assert.equal(Storage.coins(merged),180);
    assert.equal(merged.tracks[0].kartBest,12);assert.equal(merged.tracks[0].wideBest,28);assert.equal(merged.tracks[0].wideGhost,'new-b');
  }
});
test('new daily ghosts stay paired with their own expanded circuit drawing',()=>{
  const a={...blank(),daily:{date:'2026-10-03',line:'A',wideScore:1100,wideTime:60,wideGhost:'ghost-A'}};
  const b={...blank(),daily:{date:'2026-10-03',line:'B',wideScore:1200,wideTime:58,wideGhost:'ghost-B'}};
  const merged=PROGRESS.merge(a,b);assert.equal(merged.daily.line,'B');assert.equal(merged.daily.wideGhost,'ghost-B');
  assert.equal(Storage.dailyFor(merged,'2026-10-03',3).score,1200);
});
test('an open race awards coins and a win once without adding a numbered level',()=>{
  const p={...blank(),tracks:[{id:'t',line:'saved',kartBest:12}]};Storage.getProgress=()=>p;Storage.saveProgress=()=>{};
  const res={mode:'race',handling:3,place:1,coins:55,bestLap:30,ghost:'wide'};
  Storage.recordOpenRace('x',res);Storage.recordTrackLap('x','t',res);
  assert.equal(p.races_run,1);assert.equal(p.openWins,1);assert.equal(p.coinsEarned,55);assert.deepEqual(p.races,{});
  assert.equal(p.tracks[0].kartBest,12);assert.equal(p.tracks[0].wideBest,30);
});
