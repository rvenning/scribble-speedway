# Scribble Speedway 🏁

## Open racing — October 2026

The numbered campaign has been replaced by an open race lobby. Choose one of
four environments, Relaxed/Racing/Fast opponents, and a three- or five-lap race.
Quick Race generates a fresh circuit; Draw My Circuit keeps drawing optional.
Track Book circuits also race against seven rivals, with rematches and coins
for the Garage. Every choice is available immediately.

The playable road is 110 units wide, up from 78. The same drawing is enlarged
by at least 40%, with a minimum lap length of about 3000 units. Three stock-car
trials took 58–61 seconds for three laps and 95–101 seconds for five laps.
Original drawings, paint, upgrades, coins and historical results are retained.
Long-course lap records and Daily ghosts are kept separately from older times.

## Kart racing

Racing now uses Three.js, the same local library as Chicken Cross, with a
perspective chase camera, solid karts, striped kerbs, checkpoint arches and
scenery built around the circuit you actually drew. WebGL failure falls back
to the canvas view. The drawing editor remains in 2D.

Steering turns the kart's heading. Releasing it continues straight, so you
drive the bends rather than sliding a car sideways while it follows the road.
Hold **DRIFT** (or **Shift**) while steering through a bend. Blue sparks mean
a boost is charged; gold means a stronger boost. Release to use it. Brief taps
and drifting along a straight earn nothing. Grass slows the kart and cancels
charging; the verge helps a stranded driver recover.

On phones slide the spring-centred steering control with the left thumb and
hold Drift with the right. Sliding a finger across the race view also steers. Keyboard: left/right
arrows or A/D, Shift to drift, down/space to brake, up/W for manual throttle,
P to pause. Auto-brake remains available and allows a faster arc while Drift
is held. Simulation runs at a fixed 120 steps per second.

Existing drawings, stars, coins, paint and upgrades carry over. New Track Book
times and Daily scores use separate kart record fields; classic records remain
stored so old physics ghosts cannot become unbeatable targets in the new game.

Every profile avatar has its own 3D driver, including animal ears, horns, tails
and other silhouettes visible from behind. The eight rivals have distinct
personalities, preferred passing sides, introductions and friendly race reactions.
Steering eases at high speed; drift entry hops and release restores grip smoothly.
Tyre marks, sparks, a charge meter and sound cues show what the kart is doing.

`js/race-courses.js` converts drawings to wide, longer courses. `js/driver-art.js` owns procedural driver models. `js/kart.js` owns the rebuilt handling and rival steering, installed behind the
existing race-state interface in `game.js`. `js/race3d.js` owns the 3D scene.
The Three.js bundle and licence are vendored locally, cached for offline play.
Stationary scenery and each kart body are batched; per-race geometries and
materials are disposed when the circuit changes.

Developer checks: `node --test --test-concurrency=2 tests/*.test.js`.
`node tools/calibrate-kart.js` uses the campaign test's actual child driver to
measure progression. `tools/race-lab.html` supplies repeatable race views and a
600-frame geometry-count check for browser verification.

Draw a racetrack with your finger. The game turns your scribble into a real
circuit — smoothing the wobbles, opening out the corners, nudging the tarmac off
the trees — and then you race the thing you just made.

**Play it here: https://rvenning.github.io/scribble-speedway/**

Built for Robert's daughters: open racing, circuits they can draw themselves,
and a Daily time trial for the family.

## How it plays

- **Draw** a closed loop on the field with a finger. Trees, ponds and barns are
  in the way; golden rings have to be driven through. Let go and your drawing
  becomes tarmac.
- **Race** it. Automatic throttle lets you concentrate on turning, drifting
  and overtaking. Brake manually or leave auto-brake on while learning. Grass
  costs speed, and the edge helps you recover; you never crash out.
- The **outside of a bend can be carried faster and the inside covers less
  ground**, so there is a real racing line to find on a circuit nobody has ever
  driven before.

### Three ways to play

| Mode | What it is |
|---|---|
| **Open racing** | Choose the environment, opponent pace and lap count. Race a fresh generated circuit or draw your own. Earn coins, rematch or try another circuit. |
| **Daily Circuit** | The same field of scenery and rings for the whole family, every day. Draw your own circuit through it — it locks once you race it — and chase your own ghost. Your score is how far under par you got, and par comes from the circuit you drew, so a big loop is no disadvantage and a small one is no cheat. |
| **Track Book** | Save up to 12 circuits and race anybody's. Your best lap on a circuit becomes a **ghost car** for everyone else in the family — the drawing and the ghost both ride the ordinary family sync. |

### Features

- **The scribble pipeline** — resample, smooth, then relax corners, walls,
  obstacles and near-missed rings until the drawing is raceable. A shaky hand is
  repaired silently; only a shape that genuinely cannot be raced is refused, and
  it comes back with one friendly sentence saying which.
- **"Draw it for me"** generates a valid circuit for the drawing field, so nobody is
  ever stuck on the drawing. Circuits are composed from features — hairpins,
  chicanes, S-bends, long sweeps and genuine straights — and the generator
  refuses any circuit where driving does not measurably beat *not* driving.
- **"Fix my track"** appears whenever a drawing has a problem, and always
  produces something raceable: it relaxes the shape much harder than the live
  pipeline can afford to, resizes it, untangles a figure-8 by keeping the larger
  lobe, and failing all that rebuilds a circuit in the shape you drew.
- **Three driving modes, one physics.** *Easy* (the default) drives the throttle
  and brakes for you — one thumb, steering only. *Easy + brake* hands you the
  brake pedal. *Manual* gives you the throttle too, with a speed readout. The
  auto-brake is deliberately a shade slower than a good manual driver, so
  turning it off is where the time is.
- **A full classification** at the end of every race — all eight cars, gaps to
  the leader, and an estimate for anyone still on track.
- **Drift and boost.** Hold a slide through a bend to charge a mini-turbo,
  then release to accelerate out. A long controlled drift earns a stronger
  boost. Tyre scrub communicates overspeed without a runaway loss of grip.
- **Daily par from geometry** — your time-trial score compares with the course
  the circuit physically allows in a stock car, not a fixed clock.
- **Garage** — grip, top speed, acceleration, brakes and seven paint jobs,
  bought with coins earned by racing.
- Family profiles with PINs, a shared leaderboard, cross-device sync, and
  install-to-home-screen.

## Built on gamekit

Profiles, PINs, storage + family sync, the sound engine, screens/modals, canvas
juice and PWA install all come from the shared
[gamekit](https://github.com/rvenning/gamekit) library, vendored into `lib/`.

Re-vendor after a gamekit change:

```
node ../gamekit/tools/sync-to-game.js "../scribble-speedway"
```

## The code

No build step — plain `<script>` tags.

| File | Purpose |
|---|---|
| `js/track.js` | **The heart.** Scribble → circuit: resample, smooth, relax, lint. Arc-length sampling, curvature, `toWorld(s, n)`, corner speed limits, the ideal-lap solver, and save/load encoding. |
| `js/generate.js` | Seeded circuits: a radius profile composed from track features, built in polar coordinates so they cannot cross themselves, and legalised in the radius domain so the features survive. Powers "draw it for me", "fix my track" and the Daily field. |
| `js/game.js` · `js/kart.js` | DOM-free race state, lap progression, collisions and free-heading arcade handling with drift/boost state. |
| `js/ghost.js` | Ghost laps, sampled at 96 stations around the lap and packed into ~480 characters. |
| `js/draw.js` | The drawing board, plus the shared `Paint` helpers both canvases use. |
| `js/render.js` · `js/race3d.js` | 3D chase view, canvas fallback, controls, minimap and the fixed-step animation loop. |
| `js/challenges.js` · `cars.js` · `upgrades.js` | Content registries. |
| `js/storage.js` · `audio.js` · `main.js` | Persistence, sound, app shell. |

### Tests

Legacy campaign fixtures remain as regression coverage and save compatibility;
numbered challenges are no longer part of the app. `tests/courses.test.js` checks
the new course size, race durations and free selection of opponent difficulty.

```
npm test                        # 64 tests
node tests/bot.test.js --report # the per-challenge balance table
```

- `tests/track.test.js` — 160 synthetic hands must all become raceable circuits;
  the shapes that cannot be raced must be refused *by name*; and the "fix my
  track" ladder must rescue every one of them.
- `tests/generate.test.js` — every challenge and a year of Daily fields are
  solvable, from any seed. This is the anti-stuck guarantee.
- `tests/bot.test.js` — three drivers over the whole campaign: an `ace` that
  must be able to three-star everything, a `kid` (coarse steering, late
  reactions) that must finish everything but not win everything, and an `idle`
  control that must never win a race. The control bot is run over **six
  circuits per challenge**, because the player draws the track and one circuit
  each hid eleven races it could win.
- `tests/storage.test.js` — the merge that runs on every sync, tested hardest on
  never losing a drawing.
- `tests/ghost.test.js` — round trip, playback and corrupt input.

## Local development

```
npx http-server . -p 8114 -c-1
```
Then open http://localhost:8114/ — or use the `scribble-speedway` preview config.

## Storage

`ss_*` keys in localStorage, and the `scribblespeedway` Firestore collection in
the shared `wordvoyage-e5a5c` project used by all the family games. The Firebase
config in `js/firebase-config.js` is a client key restricted to the Firestore
API, not a secret.
