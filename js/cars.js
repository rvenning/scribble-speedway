// Cars — the player's paint jobs and the rival roster.
//
// Rivals carry no randomness at all. A rival is three numbers (how fast it is
// willing to go, how late it brakes, how hard it commits to the racing line),
// and the same three numbers on the same track always produce the same race.
// That is what lets tests/bot.test.js replay the whole campaign and read a
// changed finishing position as a real balance change rather than a bad roll.

const SKINS = [
  { id: "red",    name: "Chilli",     body: "#ff4d5e", trim: "#ffd166", cost: 0 },
  { id: "blue",   name: "Blueberry",  body: "#4d8cff", trim: "#b8e1ff", cost: 0 },
  { id: "mint",   name: "Mint Choc",  body: "#3ad6a4", trim: "#0d3b30", cost: 120 },
  { id: "purple", name: "Grape Fizz", body: "#a86bff", trim: "#ffe9a8", cost: 180 },
  { id: "gold",   name: "Honeycomb",  body: "#ffc23d", trim: "#5a3a00", cost: 320 },
  { id: "candy",  name: "Bubblegum",  body: "#ff7ac6", trim: "#fff0fa", cost: 420 },
  { id: "shadow", name: "Midnight",   body: "#2b2f52", trim: "#7ef0ff", cost: 640 },
];

// The whole field of possible opponents. A challenge names how many start and
// how quick they are; `rivalFor` scales a base racer to that challenge's pace.
// Eight of them, so a full grid of seven opponents never has to repeat a face.
// The colours are deliberately spread around the wheel and kept clear of the
// player's paint options — in a pack this size, "which one am I?" is answered
// by the white outline on the player's car, but only if nothing beside it is
// wearing the same shade.
const RIVALS = [
  { id: "dash",   name: "Dash",    emoji: "🐇", body: "#ffa03d", trim: "#5a3a00" },
  { id: "tilly",  name: "Tilly",   emoji: "🐢", body: "#3ad67a", trim: "#0d3b18" },
  { id: "bolt",   name: "Bolt",    emoji: "🦊", body: "#ff5fa8", trim: "#4a0a2c" },
  { id: "pip",    name: "Pip",     emoji: "🐧", body: "#5fd0ff", trim: "#08324a" },
  { id: "moss",   name: "Moss",    emoji: "🐸", body: "#8fe03a", trim: "#1d3a06" },
  { id: "nib",    name: "Nib",     emoji: "🦔", body: "#c58bff", trim: "#2a1140" },
  { id: "zip",    name: "Zip",     emoji: "🐝", body: "#ffe14d", trim: "#4a3a00" },
  { id: "reef",   name: "Reef",    emoji: "🐬", body: "#21b5a6", trim: "#04332e" },
];

// pace   fraction of the car's top speed it will use
// aggr   fraction of the corner limit it carries in — how late it brakes
// line   how far across the track it commits to the racing line (0 = middle)
// grip   fraction of the base grip its car has
//
// `grip` is the one that decides whether the Garage matters. Corner speed
// governs almost every lap on a hand-drawn circuit — top speed only shows up on
// a straight, and drawings rarely have long ones — so a rival scaled on pace
// alone is beatable in a stock car forever and the shop is decoration. The last
// chapter's rivals corner BETTER than a stock player, which is what makes
// Sticky Tyres the thing you save up for.
const CARS = {
  // The whole opposition, as five numbers. They live in one object rather than
  // inline so a tuning sweep can vary them without editing the engine — the
  // shape of the field is the campaign's difficulty curve and it gets measured,
  // not guessed.
  //
  // `drop` is the gap between consecutive rivals, and it is small on purpose:
  // spread across a seven-car field, the 0.035 that suited three opponents put
  // a third of a second a lap between first and last and strung the pack out
  // into a queue. The point of a full grid is that there is always somebody
  // beside you.
  // Swept against the three bots rather than chosen: a wide ramp (a genuinely
  // gentle chapter 1, a genuinely quick finale) is what lets a full grid be
  // both winnable by a child early on and a real fight at the end. Narrower
  // ramps put the field within a second of each other everywhere, and then the
  // child never finished better than fifth.
  tune: {
    paceBase: 0.74, paceSpan: 0.28,
    gripBase: 0.78, gripSpan: 0.18,
    drop: 0.025,
  },

  // A rival built from the challenge's difficulty. Index `i` spreads the field
  // out so the pack is not seven copies of one driver: the first is the one to
  // beat and the rest trail off, which is what makes a podium reachable.
  rivalFor(i, difficulty) {
    const T = CARS.tune;
    const base = RIVALS[i % RIVALS.length];
    const drop = i * T.drop;
    return {
      ...base,
      pace: Math.min(1.04, T.paceBase + difficulty * T.paceSpan - drop),
      aggr: Math.min(0.99, 0.80 + difficulty * 0.19 - drop * 0.6),
      line: Math.min(0.84, 0.42 + difficulty * 0.42 - drop),
      grip: T.gripBase + difficulty * T.gripSpan - drop * 0.5,
    };
  },
};

const rivalFor = CARS.rivalFor;

if (typeof window === "undefined") Object.assign(globalThis, { SKINS, RIVALS, CARS, rivalFor });
