// Persistence — gamekit storage configured for Scribble Speedway.
// ss_* localStorage keys, "scribblespeedway" Firestore collection.
//
// Two things here are unusual for a family game.
//
// Coins are SPENT in the Garage, so a plain max() merge would resurrect them
// the next time two devices met. Both halves of the ledger are monotonic
// counters instead and the balance is derived.
//
// And tracks are content the players MAKE, which has to survive the same
// merge. A saved circuit is keyed by an id that travels with the drawing, so
// when Rosalie races a track Isabelle drew, both profiles end up holding the
// same `id` and the same `line` with their OWN best lap and their own ghost
// beside it. That is the entire multiplayer of this game and it needs no
// server work at all: family ghosts are just other profiles' progress
// documents, which sync already fetches.
//
// blank/merge are named before being handed to createStorage, because
// createStorage keeps them in a closure and never exposes them — and merge is
// the one function that can permanently destroy a save, so tests/storage.test.js
// has to be able to call it.

const MAX_TRACKS = 12;

const PROGRESS = {
  blank: () => ({
    coinsEarned: 0, coinsSpent: 0,
    races: {},            // { [challengeIdx]: { stars, place, time } } — best per challenge
    upgrades: {},         // { [upgradeId]: level }
    skins: ["red", "blue"],   // owned paint jobs — the two free ones to start
    skin: "red",          // the one fitted
    tracks: [],           // Track Book: { id, name, line, by, byId, best, ghost }
    daily: null,          // { date, line, score, time, ghost, plays }
    bestDaily: 0,         // all-time best Daily score — the leaderboard headline
    dailyDays: 0,
    races_run: 0,
    updated: 0,
  }),

  merge: (a, b) => {
    const races = { ...(a.races || {}) };
    for (const [idx, r] of Object.entries(b.races || {})) {
      const cur = races[idx];
      if (!cur) { races[idx] = r; continue; }
      races[idx] = {
        stars: Math.max(cur.stars || 0, r.stars || 0),
        place: Math.min(cur.place || 99, r.place || 99),
        time: Math.min(cur.time || 1e9, r.time || 1e9),
      };
    }

    const upgrades = { ...(a.upgrades || {}) };
    for (const [id, lvl] of Object.entries(b.upgrades || {})) upgrades[id] = Math.max(upgrades[id] || 0, lvl);

    // Tracks union by id, keeping each side's better lap. A track drawn on one
    // device and never raced on the other must not be dropped by the merge —
    // that would delete a child's drawing, which is unforgivable in a way a
    // lost high score is not.
    const byId = new Map();
    for (const t of (a.tracks || []).concat(b.tracks || [])) {
      if (!t || !t.id) continue;
      const cur = byId.get(t.id);
      if (!cur) { byId.set(t.id, { ...t }); continue; }
      if ((t.best || 0) > 0 && (!cur.best || t.best < cur.best)) { cur.best = t.best; cur.ghost = t.ghost; }
      cur.name = cur.name || t.name;
      cur.line = cur.line || t.line;
    }
    const tracks = [...byId.values()].slice(0, MAX_TRACKS);

    // The daily: same day, keep the better score; different days, keep the
    // later one, because yesterday's circuit is over.
    let daily = a.daily || null;
    if (b.daily) {
      if (!daily) daily = b.daily;
      else if (b.daily.date > daily.date) daily = b.daily;
      else if (b.daily.date === daily.date && (b.daily.score || 0) > (daily.score || 0)) daily = b.daily;
    }

    return {
      // Spread first so a field a newer client added survives an older
      // client's merge, then pin what we know how to reconcile.
      ...a, ...b,
      coinsEarned: Math.max(a.coinsEarned || 0, b.coinsEarned || 0),
      coinsSpent: Math.max(a.coinsSpent || 0, b.coinsSpent || 0),
      bestDaily: Math.max(a.bestDaily || 0, b.bestDaily || 0),
      dailyDays: Math.max(a.dailyDays || 0, b.dailyDays || 0),
      races_run: Math.max(a.races_run || 0, b.races_run || 0),
      skins: [...new Set([...(a.skins || []), ...(b.skins || [])])],
      races, upgrades, tracks, daily,
    };
  },
};

const Storage = GK.createStorage({
  prefix: "ss",
  collection: "scribblespeedway",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: PROGRESS.blank,
  mergeProgress: PROGRESS.merge,
});

Object.assign(Storage, {
  MAX_TRACKS,

  coins(p) { return Math.max(0, (p.coinsEarned || 0) - (p.coinsSpent || 0)); },

  totalStars(p) {
    return Object.values(p.races || {}).reduce((s, r) => s + (r.stars || 0), 0);
  },

  // Challenges unlock in order: the one after the furthest finished.
  unlocked(p) {
    let max = -1;
    for (const k of Object.keys(p.races || {})) max = Math.max(max, Number(k));
    return Math.min(max + 1, CHALLENGES.length - 1);
  },

  campaignDone(p) { return Object.keys(p.races || {}).length >= CHALLENGES.length; },

  recordRace(profileId, res) {
    const prog = this.getProgress(profileId);
    const cur = prog.races[res.challengeIdx];
    const next = { stars: res.stars, place: res.place, time: res.time };
    if (!cur) prog.races[res.challengeIdx] = next;
    else {
      cur.stars = Math.max(cur.stars || 0, res.stars);
      cur.place = Math.min(cur.place || 99, res.place);
      cur.time = Math.min(cur.time || 1e9, res.time);
    }
    prog.coinsEarned = (prog.coinsEarned || 0) + (res.coins || 0);
    prog.races_run = (prog.races_run || 0) + 1;
    this.saveProgress(profileId, prog);
    return prog;
  },

  /* ------------------------------------------------------ daily circuit -- */

  // The player's own drawing for today, locked once they have raced it so the
  // ghost they chase is a lap of the SAME track.
  dailyFor(p, date) {
    return p.daily && p.daily.date === date ? p.daily : null;
  },

  startDaily(profileId, date, lineStr) {
    const prog = this.getProgress(profileId);
    if (!prog.daily || prog.daily.date !== date) {
      prog.daily = { date, line: lineStr, score: 0, time: 0, ghost: null, plays: 0 };
      prog.dailyDays = (prog.dailyDays || 0) + 1;
    }
    this.saveProgress(profileId, prog);
    return prog.daily;
  },

  recordDaily(profileId, date, res) {
    const prog = this.getProgress(profileId);
    if (!prog.daily || prog.daily.date !== date) return prog;
    prog.daily.plays = (prog.daily.plays || 0) + 1;
    if (res.score > (prog.daily.score || 0)) {
      prog.daily.score = res.score;
      prog.daily.time = res.time;
      if (res.ghost) prog.daily.ghost = res.ghost;
    }
    prog.bestDaily = Math.max(prog.bestDaily || 0, res.score || 0);
    prog.races_run = (prog.races_run || 0) + 1;
    this.saveProgress(profileId, prog);
    return prog;
  },

  /* --------------------------------------------------------- track book -- */

  saveTrack(profileId, { id, name, line, by, byId }) {
    const prog = this.getProgress(profileId);
    prog.tracks = prog.tracks || [];
    const cur = prog.tracks.find((t) => t.id === id);
    if (cur) { cur.name = name; cur.line = line; }
    else {
      if (prog.tracks.length >= MAX_TRACKS) return { ok: false, reason: "full" };
      prog.tracks.push({ id, name, line, by, byId, best: 0, ghost: null });
    }
    this.saveProgress(profileId, prog);
    return { ok: true, progress: prog };
  },

  deleteTrack(profileId, id) {
    const prog = this.getProgress(profileId);
    prog.tracks = (prog.tracks || []).filter((t) => t.id !== id);
    this.saveProgress(profileId, prog);
    return prog;
  },

  recordTrackLap(profileId, id, res) {
    const prog = this.getProgress(profileId);
    const t = (prog.tracks || []).find((x) => x.id === id);
    if (!t) return prog;
    if (res.bestLap && (!t.best || res.bestLap < t.best)) {
      t.best = res.bestLap;
      if (res.ghost) t.ghost = res.ghost;
    }
    prog.races_run = (prog.races_run || 0) + 1;
    this.saveProgress(profileId, prog);
    return prog;
  },

  // Everyone's saved circuits, newest profile activity first — the browse list
  // for "race a track someone else drew".
  familyTracks() {
    const out = [];
    for (const p of this.getProfiles()) {
      const prog = this.getProgress(p.id);
      for (const t of prog.tracks || []) {
        if (out.some((x) => x.id === t.id)) continue;
        out.push({ ...t, ownerName: p.name, ownerAvatar: p.avatar });
      }
    }
    return out;
  },

  // Every family lap on one circuit, quickest first — the ghost picker.
  lapsOn(trackId) {
    const out = [];
    for (const p of this.getProfiles()) {
      const t = (this.getProgress(p.id).tracks || []).find((x) => x.id === trackId);
      if (t && t.best > 0 && t.ghost) out.push({ profile: p, best: t.best, ghost: t.ghost });
    }
    return out.sort((a, b) => a.best - b.best);
  },

  /* ------------------------------------------------------------- garage -- */

  buyUpgrade(profileId, upgradeId) {
    const prog = this.getProgress(profileId);
    const def = UPGRADES.find((u) => u.id === upgradeId);
    const lvl = (prog.upgrades && prog.upgrades[upgradeId]) || 0;
    if (!def || lvl >= def.costs.length) return { ok: false, reason: "maxed" };
    const cost = def.costs[lvl];
    if (this.coins(prog) < cost) return { ok: false, reason: "coins" };
    prog.coinsSpent = (prog.coinsSpent || 0) + cost;
    prog.upgrades = prog.upgrades || {};
    prog.upgrades[upgradeId] = lvl + 1;
    this.saveProgress(profileId, prog);
    return { ok: true, progress: prog };
  },

  buySkin(profileId, skinId) {
    const prog = this.getProgress(profileId);
    const def = SKINS.find((s) => s.id === skinId);
    if (!def) return { ok: false, reason: "unknown" };
    if ((prog.skins || []).includes(skinId)) { prog.skin = skinId; this.saveProgress(profileId, prog); return { ok: true, progress: prog }; }
    if (this.coins(prog) < def.cost) return { ok: false, reason: "coins" };
    prog.coinsSpent = (prog.coinsSpent || 0) + def.cost;
    prog.skins = [...new Set([...(prog.skins || []), skinId])];
    prog.skin = skinId;
    this.saveProgress(profileId, prog);
    return { ok: true, progress: prog };
  },

  skinOf(prog) {
    return SKINS.find((s) => s.id === prog.skin) || SKINS[0];
  },
});
