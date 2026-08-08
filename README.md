# Scribble Speedway 🏁

Draw a racetrack with your finger. The game turns your scribble into a real
circuit — smoothing the wobbles, opening out the corners, nudging the tarmac off
the trees — and then you race the thing you just made.

**Play it here: https://rvenning.github.io/scribble-speedway/**

Built for Robert's daughters: an 18-challenge campaign an early reader can
finish, and a Daily Circuit with a clock on it for everybody else.

## How it plays

- **Draw** a closed loop on the field with a finger. Trees, ponds and barns are
  in the way; golden rings have to be driven through. Let go and your drawing
  becomes tarmac.
- **Race** it. The car drives itself forward — you steer across the track by
  holding the left or right of the screen, and brake if you have turned the
  auto-brake off. Take a corner too fast and you slide wide onto the grass; you
  never crash out.
- The **outside of a bend can be carried faster and the inside covers less
  ground**, so there is a real racing line to find on a circuit nobody has ever
  driven before.

### Three ways to play

| Mode | What it is |
|---|---|
| **Campaign** | 18 challenges across 4 chapters. Each one is a field to design a circuit for, then a race against rivals. One star for finishing, two for beating half the field, three for winning under par. |
| **Daily Circuit** | The same field of scenery and rings for the whole family, every day. Draw your own circuit through it — it locks once you race it — and chase your own ghost. Your score is how far under par you got, and par comes from the circuit you drew, so a big loop is no disadvantage and a small one is no cheat. |
| **Track Book** | Save up to 12 circuits and race anybody's. Your best lap on a circuit becomes a **ghost car** for everyone else in the family — the drawing and the ghost both ride the ordinary family sync. |

### Features

- **The scribble pipeline** — resample, smooth, then relax corners, walls,
  obstacles and near-missed rings until the drawing is raceable. A shaky hand is
  repaired silently; only a shape that genuinely cannot be raced is refused, and
  it comes back with one friendly sentence saying which.
- **"Draw it for me"** generates a valid circuit for any challenge, so nobody is
  ever stuck on the drawing.
- **Auto-brake** is on by default and slows the car for corners on its own. It
  is deliberately a shade slower than a good manual driver, so turning it off is
  where the time is — one physics model, no second game.
- **Par from geometry** — the third star is measured against the fastest lap the
  circuit physically allows in a stock car, not against a fixed clock.
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
| `js/generate.js` | Seeded circuits, built in polar coordinates so they cannot cross themselves. Powers "draw it for me" and the Daily field. |
| `js/game.js` | The race. DOM-free, canvas-free, no `Math.random` — a car's whole state is `(s, n, v)`. |
| `js/ghost.js` | Ghost laps, sampled at 96 stations around the lap and packed into ~480 characters. |
| `js/draw.js` | The drawing board, plus the shared `Paint` helpers both canvases use. |
| `js/render.js` | Race view (rotating camera + minimap) and the one animation loop. |
| `js/challenges.js` · `cars.js` · `upgrades.js` | Content registries. |
| `js/storage.js` · `audio.js` · `main.js` | Persistence, sound, app shell. |

### Tests

```
npm test                        # 61 tests
node tests/bot.test.js --report # the per-challenge balance table
```

- `tests/track.test.js` — 160 synthetic hands must all become raceable circuits;
  the shapes that cannot be raced must be refused *by name*.
- `tests/generate.test.js` — every challenge and a year of Daily fields are
  solvable, from any seed. This is the anti-stuck guarantee.
- `tests/bot.test.js` — three drivers over the whole campaign: an `ace` that
  must be able to three-star everything, a `kid` that must finish everything but
  not win everything, and an `idle` control that must never win a race.
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
