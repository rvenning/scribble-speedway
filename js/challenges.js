// The campaign — 18 challenges across 4 chapters.
//
// The unusual thing about content here: a challenge does not contain a track,
// because the player draws that. What it contains is the FIELD they have to
// draw on — what is in the way, which rings they have to route through, how
// long the loop has to be — plus who they race once they have. The level
// design is the constraint, and the level solution is the drawing.
//
// Which means par time cannot be a fixed number of seconds: it has to come out
// of whatever the player drew. See `parTime` at the bottom.
//
// Every challenge is asserted solvable by the generator in
// tests/generate.test.js — that is the anti-stuck guarantee, since the "draw it
// for me" button uses exactly that path. Two authoring rules keep it that way:
// gates belong out on the ring the track naturally runs on (one near the middle
// of the field asks for a spike in an otherwise round loop, and the corner it
// needs is tighter than any car can take), and obstacles want ~190 units of
// clear space between them so a track can pass between rather than only around.
//
// Coordinates are on the PORTRAIT 700x1000 field — x across, y down the screen.

const tree = (x, y) => ({ kind: "tree", icon: "🌳", x, y, r: 34 });
const pond = (x, y, r = 46) => ({ kind: "pond", icon: "🦆", x, y, r });
const rock = (x, y) => ({ kind: "rock", icon: "🪨", x, y, r: 32 });
const hay = (x, y) => ({ kind: "haystack", icon: "🌾", x, y, r: 30 });
const barn = (x, y) => ({ kind: "barn", icon: "🏠", x, y, r: 40 });
const ring = (x, y) => ({ x, y, r: 76 });

// `parSlack` multiplies `track.idealLap` — the theoretical fastest lap, driven
// on the centre line, braking exactly at the limit, with no reaction time at
// all. Nobody drives that: a good bot comes out ~1.30x it and a wandering child
// ~1.50x. So the numbers below look generous and are not — 1.60 on the first
// challenge is "just finish it", and 1.30 on the last is a lap with nothing
// left in it.

const CHAPTERS = [
  { id: "meadow", name: "Sunny Meadow", icon: "🌼", grass: "#7cc45a", grassAlt: "#6cb44e", edge: "#ffd166" },
  { id: "cove",   name: "Sandy Cove",   icon: "🏖️", grass: "#e8cf94", grassAlt: "#dcc084", edge: "#5fd0ff" },
  { id: "woods",  name: "Whispering Woods", icon: "🌲", grass: "#4e9a5e", grassAlt: "#438a53", edge: "#a8e06a" },
  { id: "peak",   name: "Frost Peak",   icon: "🏔️", grass: "#dbe7f2", grassAlt: "#c9d9e8", edge: "#7ec8ff" },
];

const CHALLENGES = [
  /* ---------------------------------------------- 1. Sunny Meadow ------- */
  { name: "First Lap", chapter: 0, laps: 2, rivals: 7, difficulty: 0.10, parSlack: 1.60,
    obstacles: [], gates: [], minLen: 950,
    hint: "Draw a big loop with your finger, then race it!" },

  { name: "Around the Oak", chapter: 0, laps: 2, rivals: 7, difficulty: 0.16, parSlack: 1.56,
    obstacles: [tree(350, 500)], gates: [], minLen: 1000,
    hint: "The old oak is in the middle — your track has to go around it." },

  { name: "Duck Pond", chapter: 0, laps: 3, rivals: 7, difficulty: 0.22, parSlack: 1.52,
    obstacles: [pond(300, 430), tree(440, 660)], gates: [], minLen: 1050,
    hint: "Ducks do not move for racing cars. Steer well clear!" },

  { name: "Through the Ring", chapter: 0, laps: 3, rivals: 7, difficulty: 0.28, parSlack: 1.50,
    obstacles: [tree(340, 470)], gates: [ring(350, 790)], minLen: 1100,
    hint: "Your track has to pass through the golden ring." },

  { name: "Two Rings", chapter: 0, laps: 3, rivals: 7, difficulty: 0.34, parSlack: 1.48,
    obstacles: [], gates: [ring(210, 230), ring(480, 780)], minLen: 1200,
    hint: "Both rings, one loop. Take the long way round if you have to." },

  /* ------------------------------------------------ 2. Sandy Cove ------- */
  { name: "Beach Run", chapter: 1, laps: 3, rivals: 7, difficulty: 0.38, parSlack: 1.46,
    obstacles: [pond(250, 360), pond(450, 660)], gates: [], minLen: 1250,
    hint: "Two rock pools to dodge. Smooth curves are faster than sharp ones." },

  { name: "Rock Pools", chapter: 1, laps: 3, rivals: 7, difficulty: 0.44, parSlack: 1.44,
    obstacles: [rock(200, 500), rock(500, 500), rock(350, 760)], gates: [], minLen: 1300,
    hint: "Three rocks in the way — thread your loop between them." },

  { name: "Wide Berth", chapter: 1, laps: 3, rivals: 7, difficulty: 0.48, parSlack: 1.43,
    obstacles: [pond(350, 500, 74)], gates: [ring(350, 210)], minLen: 1350,
    hint: "A big lagoon in the middle. Sweep around it and through the ring." },

  { name: "Slalom Sands", chapter: 1, laps: 3, rivals: 7, difficulty: 0.52, parSlack: 1.42,
    obstacles: [rock(240, 330), rock(350, 500), rock(460, 670)], gates: [ring(200, 760)], minLen: 1400,
    hint: "The rocks run diagonally. Pick a side and commit to it." },

  { name: "Long Way Round", chapter: 1, laps: 3, rivals: 7, difficulty: 0.56, parSlack: 1.41,
    obstacles: [pond(350, 500)], gates: [ring(480, 190), ring(210, 810)], minLen: 1900,
    hint: "This one has to be a LONG circuit — at least 1900 long." },

  /* ------------------------------------------- 3. Whispering Woods ------ */
  { name: "Into the Trees", chapter: 2, laps: 3, rivals: 7, difficulty: 0.60, parSlack: 1.39,
    obstacles: [tree(230, 380), tree(230, 620), tree(470, 380), tree(470, 620)], gates: [], minLen: 1350,
    hint: "Four trees in a square. Around the outside, or weave through?" },

  { name: "Tight Squeeze", chapter: 2, laps: 3, rivals: 7, difficulty: 0.64, parSlack: 1.38,
    obstacles: [tree(250, 500), tree(450, 500)], gates: [], minLen: 1000, maxLen: 1800,
    hint: "A SHORT circuit this time — no longer than 1800." },

  { name: "Three Rings", chapter: 2, laps: 3, rivals: 7, difficulty: 0.68, parSlack: 1.36,
    obstacles: [tree(350, 500)], gates: [ring(250, 220), ring(250, 780), ring(560, 500)], minLen: 1500,
    hint: "Three rings to collect. Plan the shape before you start drawing." },

  { name: "Forest Circuit", chapter: 2, laps: 3, rivals: 7, difficulty: 0.72, parSlack: 1.35,
    obstacles: [tree(300, 340), tree(300, 660), hay(520, 500), rock(180, 500)],
    gates: [ring(520, 190), ring(480, 820)], minLen: 1600,
    hint: "Busy in here. Find the gaps and keep your corners round." },

  { name: "The Old Barn", chapter: 2, laps: 3, rivals: 7, difficulty: 0.76, parSlack: 1.34,
    obstacles: [barn(330, 500), tree(200, 280), tree(200, 720), hay(570, 500)],
    gates: [ring(420, 160)], minLen: 1600,
    hint: "The barn takes up the whole middle. Go round the outside." },

  /* -------------------------------------------------- 4. Frost Peak ----- */
  { name: "Snow Line", chapter: 3, laps: 3, rivals: 7, difficulty: 0.82, parSlack: 1.32,
    obstacles: [rock(250, 300), rock(350, 500), rock(250, 700), rock(520, 400), rock(520, 660)],
    gates: [], minLen: 1600,
    hint: "Five boulders. There is a clean line through — find it." },

  { name: "Summit Gates", chapter: 3, laps: 3, rivals: 7, difficulty: 0.88, parSlack: 1.31,
    obstacles: [rock(210, 430), rock(490, 430), barn(350, 770)],
    gates: [ring(350, 190), ring(150, 650), ring(550, 650)], minLen: 1900,
    hint: "Three rings and a long lap. This is a proper mountain circuit." },

  { name: "Champion's Circuit", chapter: 3, laps: 3, rivals: 7, difficulty: 1.00, parSlack: 1.30,
    obstacles: [rock(200, 350), rock(200, 650), pond(430, 500), hay(560, 830)],
    gates: [ring(350, 180), ring(220, 820), ring(600, 560)], minLen: 2000,
    hint: "Everything you have learned, in one lap. Draw it well." },
];

// Par comes out of the circuit the player drew, not off a fixed clock.
//
// `track.idealLap` is the fastest lap the geometry physically allows in a STOCK
// car — so a twisty drawing gets a generous par and a flowing one a tight par,
// and `parSlack` is the only difficulty dial. Deliberately measured against a
// stock car rather than the player's: par has to stay still as the garage fills
// up, or upgrades would raise the bar they were bought to clear.
function parTime(track, ch) {
  const stock = { grip: RULES.grip, top: RULES.topSpeed, accel: RULES.accel, brake: RULES.brake };
  return ch.laps * track.idealLap(stock) * ch.parSlack;
}

function chapterOf(idx) { return CHAPTERS[CHALLENGES[idx].chapter]; }

if (typeof window === "undefined") Object.assign(globalThis, { CHAPTERS, CHALLENGES, parTime, chapterOf });
