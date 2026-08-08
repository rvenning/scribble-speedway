// Deterministic randomness for the generated circuits.
//
// The rule, borrowed from Ricochet Spire and Rocket Rescue: never draw from a
// running stream. Derive a fresh generator from COORDINATES — RNG.sub(seed,
// "spoke", i) — so what a given part of a circuit contains depends only on
// WHICH part it is, never on how much was generated before it.
//
// Here that buys two specific things. The "draw it for me" helper can try seed
// after seed without its earlier attempts changing the later ones, so a
// challenge that is solvable is solvable identically in the game and in the
// test suite. And the Daily Circuit's field of trees, ponds and checkpoint
// rings is genuinely the same for everyone in the family, whatever order they
// play it in.

const RNG = {
  // FNV-1a: any string -> a 32-bit seed. "2026-08-08" -> today's field.
  seedFrom(str) {
    const s = String(str);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  make(seed = 0) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    return next;
  },

  sub(seed, ...parts) {
    return RNG.make((seed ^ RNG.seedFrom(parts.join("|"))) >>> 0);
  },

  // Today's date in the player's own timezone — the date on their calendar is
  // the circuit they get.
  today(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { RNG });
