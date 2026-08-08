// Sound — gamekit's synthesized Sfx plus one thing it does not have: an engine.
//
// A racing game needs a note that BENDS with the speed rather than a sample
// that fires on an event, so `Engine` holds two oscillators open for the length
// of a race and slides their pitch every frame. Everything else is a one-shot
// on top of GK.Sfx.

const Sfx = GK.Sfx;

Object.assign(Sfx, {
  pen() { this.tone({ freq: 320 + Math.random() * 90, type: "sine", dur: 0.03, vol: 0.05 }); },
  snap() {
    this.tone({ freq: 520, type: "triangle", dur: 0.09, vol: 0.16 });
    this.tone({ freq: 780, type: "triangle", dur: 0.16, vol: 0.14, when: 0.08 });
  },
  nope() { this.tone({ freq: 240, type: "sine", dur: 0.16, vol: 0.13, slide: -50 }); },
  beep() { this.tone({ freq: 520, type: "square", dur: 0.16, vol: 0.16 }); },
  go() {
    this.tone({ freq: 880, type: "square", dur: 0.32, vol: 0.2 });
    this.tone({ freq: 1320, type: "square", dur: 0.36, vol: 0.14, when: 0.04 });
  },
  lap() {
    this.tone({ freq: 740, type: "triangle", dur: 0.1, vol: 0.16 });
    this.tone({ freq: 988, type: "triangle", dur: 0.18, vol: 0.14, when: 0.09 });
  },
  screech() { this.noise({ dur: 0.16, vol: 0.05 }); },
  bump() { this.tone({ freq: 120, type: "square", dur: 0.09, vol: 0.14, slide: -40 }); },
  thud() { this.noise({ dur: 0.2, vol: 0.12 }); this.tone({ freq: 90, type: "sine", dur: 0.18, vol: 0.16 }); },
  star(n) { this.tone({ freq: 660 * Math.pow(1.26, n - 1), type: "triangle", dur: 0.26, vol: 0.2 }); },
  newBest() {
    [784, 988, 1175, 1568].forEach((f, i) =>
      this.tone({ freq: f, type: "triangle", dur: 0.3, vol: 0.22, when: i * 0.11 }));
  },
});

// A two-oscillator engine whose pitch follows the car. Kept deliberately quiet
// and slightly detuned — a pure tone at this length is unpleasant, and two
// close frequencies beat against each other into something that reads as a
// motor.
const Engine = {
  on: false,
  nodes: null,

  start() {
    if (this.on || !Sfx.enabled || !Sfx.ctx) return;
    const ctx = Sfx.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.connect(ctx.destination);
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = "sawtooth"; b.type = "square";
    a.frequency.setValueAtTime(70, ctx.currentTime);
    b.frequency.setValueAtTime(35, ctx.currentTime);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.35, ctx.currentTime);
    a.connect(g); b.connect(bg).connect(g);
    a.start(); b.start();
    this.nodes = { g, a, b };
    this.on = true;
  },

  // speed 0..1, load 0..1 (how hard the car is working)
  set(speed, load) {
    if (!this.on || !Sfx.ctx) return;
    const t = Sfx.ctx.currentTime;
    const f = 64 + speed * 210;
    this.nodes.a.frequency.setTargetAtTime(f, t, 0.05);
    this.nodes.b.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.nodes.g.gain.setTargetAtTime(0.012 + load * 0.022, t, 0.08);
  },

  stop() {
    if (!this.on) return;
    const { g, a, b } = this.nodes;
    const t = Sfx.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t, 0.05);
    try { a.stop(t + 0.4); b.stop(t + 0.4); } catch (e) { /* already stopped */ }
    this.on = false;
    this.nodes = null;
  },
};
