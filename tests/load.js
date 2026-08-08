// Shared loader for the test suites.
//
// The game ships plain <script> files with top-level `const` and no bundler, so
// the suites run the real sources in a vm sandbox with just enough of a browser
// stubbed out. `browser: true`, because every gk-* module opens with
// `window.GK = window.GK || {}` and track.js hangs itself off the same global.
//
// Order must match index.html's, or a file that reads another's top-level const
// crashes on load.

const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const noop = () => {};

const S = loadScripts({
  baseDir: ROOT,
  files: [
    "tests/seed.js",
    "lib/gk-util.js",
    "js/track.js",
    "js/rng.js",
    "js/generate.js",
    "js/cars.js",
    "js/upgrades.js",
    "js/challenges.js",
    "js/ghost.js",
    "js/game.js",
  ],
  exports: [
    "GK", "__reseed", "__rand",
    "FIELD", "TRACK_W", "HALF_W", "MIN_RADIUS", "MIN_LOOP", "MAX_LOOP",
    "NODE_SPACING", "EDGE_MARGIN", "TAU", "Track",
    "RNG", "Generate",
    "CARS", "RIVALS", "SKINS", "rivalFor",
    "UPGRADES", "upgradeValue", "carStats",
    "CHAPTERS", "CHALLENGES", "parTime",
    "Ghost",
    "RULES", "Game",
  ],
  browser: true,
  globals: {
    GK: { UI: { showScreen: noop, openModal: noop, closeModal: noop, toast: noop } },
    Sfx: new Proxy({}, { get: () => noop }),
    Music: { enabled: false, start: noop, stop: noop },
    App: { raceOver: noop },
    Storage: { getProgress: () => ({ upgrades: {} }) },
    Draw: { onTrack: noop },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null },
    performance: { now: () => 0 },
    requestAnimationFrame: noop,
  },
});

module.exports = S;
