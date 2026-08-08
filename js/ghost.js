// Ghost laps — the reason the family sync is worth having.
//
// A ghost is sampled by ARC LENGTH, not by time: 96 stations evenly spaced
// around the lap, each storing when the car got there and how far across the
// track it was. That choice does all the work:
//
//   * playback is frame-rate independent and needs no interpolation of world
//     coordinates — given an elapsed time, find the station pair, and the
//     position falls out of the track's own toWorld(s, n);
//   * it is tiny. 96 stations of (centiseconds, offset) pack into ~480 base36
//     characters, small enough to live inside a profile's progress document and
//     ride the ordinary family sync with no new infrastructure;
//   * two ghosts of the same track are directly comparable station by station,
//     so "you are 0.4s up on Dad" is a subtraction rather than a search.
//
// Ghosts only mean anything on shared geometry, which is why they live on the
// Daily Circuit (where your own track is locked once you first race it) and on
// saved Track Book circuits (where the whole family drives the same drawing) —
// and not on a campaign track, which is redrawn every attempt.

const Ghost = {
  STATIONS: 96,

  recorder() {
    return { t: new Array(Ghost.STATIONS).fill(0), n: new Array(Ghost.STATIONS).fill(0), next: 0 };
  },

  // Called as the car crosses each station of the lap it is currently on.
  capture(rec, station, timeSec, off) {
    if (station < 0 || station >= Ghost.STATIONS) return;
    rec.t[station] = timeSec;
    rec.n[station] = off;
  },

  reset(rec) { rec.next = 0; },

  // times in seconds, offsets in track units -> one compact string.
  encode(rec, lapTime) {
    const b = (v, w) => Math.max(0, Math.min(Math.pow(36, w) - 1, Math.round(v))).toString(36).padStart(w, "0");
    let s = b(lapTime * 100, 4);
    for (let i = 0; i < Ghost.STATIONS; i++) s += b(rec.t[i] * 100, 3);
    for (let i = 0; i < Ghost.STATIONS; i++) s += b(rec.n[i] + 128, 2);
    return s;
  },

  decode(str) {
    const N = Ghost.STATIONS;
    if (typeof str !== "string" || str.length !== 4 + N * 3 + N * 2) return null;
    const lap = parseInt(str.slice(0, 4), 36) / 100;
    const t = [], n = [];
    for (let i = 0; i < N; i++) t.push(parseInt(str.substr(4 + i * 3, 3), 36) / 100);
    for (let i = 0; i < N; i++) n.push(parseInt(str.substr(4 + N * 3 + i * 2, 2), 36) - 128);
    if (!isFinite(lap) || t.some((v) => !isFinite(v)) || n.some((v) => !isFinite(v))) return null;
    return { lap, t, n };
  },

  // Where the ghost was `tSec` into its lap, as a fraction around the lap plus
  // an offset across it. Past the end of the lap it keeps going round, so a
  // ghost of a quicker lap simply laps you — which is exactly the feedback you
  // want when you are losing.
  posAt(g, tSec) {
    const N = Ghost.STATIONS;
    const laps = Math.floor(tSec / g.lap);
    let t = tSec - laps * g.lap;
    // The times are increasing, so a linear scan from a guess is enough —
    // and a scan is what keeps this correct if a station was never reached.
    let i = 0;
    while (i < N - 1 && g.t[i + 1] <= t) i++;
    const t0 = g.t[i], t1 = i + 1 < N ? g.t[i + 1] : g.lap;
    const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
    const n0 = g.n[i], n1 = g.n[(i + 1) % N];
    return { frac: (i + f) / N, n: n0 + (n1 - n0) * f, laps };
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { Ghost });
