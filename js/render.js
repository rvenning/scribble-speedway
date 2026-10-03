// The race view, and the one animation loop the whole game runs on.
//
// The camera rotates with the car so the road always comes toward you from the
// top of the screen. That is the only arrangement in which "hold the left side
// of the screen" means the same thing all the way round a loop — with a fixed
// camera, left stops meaning left the moment you are driving back the other
// way, which is unusable for a child and merely annoying for an adult.
//
// The cost of a rotating camera is that you can no longer see the circuit you
// drew, which in this game is half the point. The minimap in the corner buys
// that back, and doubles as the position display.

const Render = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1, scale: 1, t: 0, last: 0,

  boot() {
    this.cv = document.getElementById("cv");
    this.ctx = this.cv.getContext("2d");
    this.stage = document.getElementById("race-stage");
    Race3D.boot(this.stage);
    Draw.boot();

    /* ------------------------------------------------------ steering --- */
    // Where on the screen the finger is decides which way the car goes, and
    // how far from the middle decides how hard. A held side gives full lock,
    // which is all a five-year-old will ever do; the proportional middle is
    // what makes a clean racing line possible for everyone else.
    const steerFrom = (clientX) => {
      const r = this.cv.getBoundingClientRect();
      const f = (clientX - r.left - r.width / 2) / (r.width * 0.33);
      Game.input.steer = Math.max(-1, Math.min(1, f));
    };
    let steeringPointer = null;
    const release = (e) => {
      if (e && steeringPointer !== null && e.pointerId !== steeringPointer) return;
      steeringPointer = null; Game.input.steer = 0;
    };

    this.cv.addEventListener("pointerdown", (e) => {
      if (steeringPointer !== null) return;
      steeringPointer = e.pointerId;
      e.preventDefault();
      try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
      Sfx.init();
      steerFrom(e.clientX);
    }, { passive: false });
    this.cv.addEventListener("pointermove", (e) => {
      // pressure is 0 for ordinary touch on iOS — ask what kind of pointer it
      // is instead, or every move of a real swipe is dropped.
      if (e.pointerId === steeringPointer) { e.preventDefault(); steerFrom(e.clientX); }
    }, { passive: false });
    this.cv.addEventListener("pointerup", release);
    this.cv.addEventListener("pointercancel", release);
    this.cv.addEventListener("lostpointercapture", release);

    this.bindPedal(document.getElementById("btn-brake"), (on) => { Game.input.brake = on; });
    this.bindPedal(document.getElementById("btn-throttle"), (on) => { Game.input.throttle = on ? 1 : 0; });
    this.bindPedal(document.getElementById("btn-drift"), (on) => { Game.input.drift = on; });
    const steering = { left: false, right: false };
    this.bindPedal(document.getElementById("btn-left"), (on) => { steering.left = on; Game.input.steer = Number(steering.right) - Number(steering.left); });
    this.bindPedal(document.getElementById("btn-right"), (on) => { steering.right = on; Game.input.steer = Number(steering.right) - Number(steering.left); });

    const stick = document.getElementById("steer-stick");
    const centerStick = () => { stick.value = "0"; Game.input.steer = 0; };
    stick.addEventListener("input", () => { Game.input.steer = Number(stick.value)/100; });
    stick.addEventListener("pointerdown", e => { try { stick.setPointerCapture(e.pointerId); } catch(err) {} });
    for(const event of ["pointerup","pointercancel","lostpointercapture","blur"]) stick.addEventListener(event,centerStick);
    window.addEventListener("blur",centerStick);

    const keys = new Set();
    const keySteer = () => { Game.input.steer = Number(keys.has("ArrowRight") || keys.has("d")) - Number(keys.has("ArrowLeft") || keys.has("a")); };
    document.addEventListener("keydown", (e) => {
      if (!Game.active || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
      if (e.key === "Shift") Game.input.drift = true;
      keys.add(e.key);
      if (["ArrowLeft", "ArrowRight", "a", "d"].includes(e.key)) keySteer();
      if (e.key === "ArrowDown" || e.key === " ") Game.input.brake = true;
      if (e.key === "ArrowUp" || e.key === "w") Game.input.throttle = 1;
      if ((e.key === "p" || e.key === "P") && !e.repeat) { if (Game.running) (Game.paused ? Game.resume() : Game.pause()); }
    });
    document.addEventListener("keyup", (e) => {
      keys.delete(e.key);
      if (e.key === "Shift") Game.input.drift = false;
      if (["ArrowLeft", "ArrowRight", "a", "d"].includes(e.key)) keySteer();
      if (e.key === "ArrowDown" || e.key === " ") Game.input.brake = false;
      if (e.key === "ArrowUp" || e.key === "w") Game.input.throttle = 0;
    });
    window.addEventListener("blur", () => {
      release(); keys.clear(); steering.left = false; steering.right = false; Game.input.brake = false; Game.input.drift = false;
      if (Game.active && Game.running && !Game.paused) Game.pause();
    });

    // iOS keeps a pinch zoom forever once it happens, and JS cannot reset one.
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 350));
    this.resize();
    requestAnimationFrame((t) => this.loop(t));
  },

  // A held on-screen pedal.
  //
  // Two traps, both of which the old brake handler walked into. `pressure` is 0
  // for ordinary touch on iOS, so nothing here may gate on it. And the pointer
  // must be CAPTURED on press: without it, a thumb that drifts off the button
  // mid-corner fires `pointerleave` and silently lifts off the brake — which is
  // exactly when you are least likely to notice why you went straight on.
  // `pointerleave` is deliberately not bound; with capture it fires spuriously,
  // and `lostpointercapture` covers the case it was there for.
  bindPedal(el, set) {
    if (!el) return;
    const down = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
      el.classList.add("held");
      set(true);
    };
    const up = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      el.classList.remove("held");
      set(false);
    };
    el.addEventListener("pointerdown", down, { passive: false });
    el.addEventListener("pointerup", up, { passive: false });
    el.addEventListener("pointercancel", up, { passive: false });
    el.addEventListener("lostpointercapture", up, { passive: false });
    // Some iOS builds are stingy with pointer events during fast multi-touch,
    // and steering with one thumb while pedalling with the other IS multi-touch.
    el.addEventListener("touchstart", (e) => { e.preventDefault(); down({}); }, { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); up(); }, { passive: false });
  },

  resize() {
    if (!this.cv) return;
    const b = this.stage.getBoundingClientRect();
    if (b.width < 50 || b.height < 50) return;
    this.dpr = window.devicePixelRatio || 1;
    this.W = b.width; this.H = b.height;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // About three and a half track widths across, and roughly two seconds of
    // road ahead of the car at racing speed. Zoomed further out the car turns
    // into a dot on a lawn; further in and a corner arrives with no warning.
    this.scale = Math.min(this.H / 330, this.W / 280);
    if (Draw) Draw.resize();
  },

  /* ------------------------------------------------------------- loop -- */

  loop(now) {
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000 || 0));
    this.last = now;
    const screen = GK.UI.screen;
    if (screen === "draw") Draw.render(dt);
    else if (screen === "game") {
      // One edge detector covers every route into and out of pause — the ⏸
      // button, the P key and Quit — and keeps the audio out of game.js, which
      // has to stay a pure simulation.
      if (Game.paused !== this._paused) {
        this._paused = Game.paused;
        if (Game.paused) Engine.duck(); else Engine.unduck();
      }
      if (Game.paused) {
        // A single static frame. `Game.update` already returns early when
        // paused, but everything AROUND it kept running: the engine held one
        // note, the checkpoint rings kept pulsing, dust kept spawning and a car
        // frozen mid-slide kept screeching. Passing dt = 0 stops the lot.
        this.render(0);
      } else {
        this.accumulator = (this.accumulator || 0) + dt;
        while (this.accumulator >= 1 / 120) {
          Game.update(1 / 120); this.accumulator -= 1 / 120;
          if (!Game.running) { this.accumulator = 0; break; }
        }
        Fx.update(dt);
        this.drainEvents();
        this.render(dt);
        this.hud();
      }
    }
    GK.Debug.frame(dt);
    requestAnimationFrame((t) => this.loop(t));
  },

  drainEvents() {
    for (const e of Game.events) {
      if (e.kind === "go") { Sfx.go(); Engine.start(); }
      else if (e.kind === "lap") Sfx.lap();
      else if (e.kind === "bump") Sfx.bump();
      else if (e.kind === "wall") { Sfx.thud(); Fx.addShake(6); }
      else if (e.kind === "boost") { Sfx.boost(e.tier); }
      else if (e.kind === "drift-start") Sfx.hop();
      else if (e.kind === "drift-ready") Sfx.charge(e.tier);
    }
    Game.events.length = 0;
  },

  /* ----------------------------------------------------------- render -- */

  render(dt) {
    const ctx = this.ctx, t = Game.track;
    const b = this.stage.getBoundingClientRect();
    if (b.width > 50 && (Math.abs(b.width - this.W) > 1 || Math.abs(b.height - this.H) > 1)) this.resize();
    if (!t) return;
    this.t += dt;

    const me = Game.cars[0];
    const pos = t.toWorld(me.s, me.n);
    const head = t.headingAt(me.s);
    const ch = Game.chapter || CHAPTERS[0];

    if (Race3D.ready) {
      Race3D.render(dt, this.W, this.H);
      ctx.clearRect(0, 0, this.W, this.H);
      this.speedFeedback(ctx, me);
      this.minimap(ctx, t);
      if (Game.phase === "countdown") this.countdown(ctx);
      this.racingFeedback(me);
      if (Engine.on) Engine.set(Math.min(1, me.v / RULES.topSpeed), me.brake ? .2 : 1 - me.grass * .5);
      return;
    }

    ctx.fillStyle = ch.grassAlt;
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.save();
    const [shx, shy] = Fx.shakeOffset();
    ctx.translate(this.W / 2 + shx, this.H * 0.72 + shy);
    ctx.rotate(-Math.PI / 2 - head);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-pos.x, -pos.y);

    const view = { s: 1, ox: 0, oy: 0 };
    // Grass painted well past the field edge, so a corner of the circuit near
    // the boundary never shows a hard edge with nothing beyond it.
    ctx.fillStyle = ch.grass;
    ctx.fillRect(-600, -600, FIELD.w + 1200, FIELD.h + 1200);
    ctx.fillStyle = "rgba(255,255,255,.05)";
    for (let x = -600; x < FIELD.w + 600; x += 84) ctx.fillRect(x, -600, 42, FIELD.h + 1200);

    Paint.ribbon(ctx, t.pts, view);
    Paint.startLine(ctx, t.pts, view);
    Paint.obstacles(ctx, Game.obstacles, view);
    Paint.gates(ctx, Game.gates, view, this.t);

    if (Game.ghost) this.drawGhost(ctx, t);
    for (let i = Game.cars.length - 1; i >= 0; i--) this.drawCar(ctx, Game.cars[i], i === 0);

    Fx.render(ctx);
    ctx.restore();

    this.minimap(ctx, t);
    if (Game.phase === "countdown") this.countdown(ctx);
    this.racingFeedback(me);

    // The engine note follows the car rather than firing on events.
    if (Engine.on) Engine.set(Math.min(1, me.v / RULES.topSpeed), me.brake ? 0.2 : 1 - me.grass * 0.5);
  },

  speedFeedback(ctx, car) {
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches || Game.paused) return;
    const intensity = car.boosting > 0 ? 1 : Math.max(0,(car.v/car.stats.top-.62)*1.5);
    if(intensity < .05) return;
    // Only the screen edges move; the road and braking point stay clear.
    ctx.save();ctx.strokeStyle = car.boosting > 0 ? "#c6f5ff" : "#ffffff";ctx.lineWidth=2;
    for(let i=0;i<12;i++) {
      const a=(i/12)*Math.PI*2, phase=(this.t*(car.boosting>0?2.8:1.5)+i*.137)%1;
      const x=this.W/2+Math.cos(a)*this.W*(.42+phase*.12),y=this.H*.55+Math.sin(a)*this.H*(.39+phase*.15);
      ctx.globalAlpha=intensity*.32*Math.sin(phase*Math.PI);
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*this.W*.06,y+Math.sin(a)*this.H*.07);ctx.stroke();
    }
    ctx.restore();
  },

  drawCar(ctx, car, isMe) {
    const t = Game.track;
    const p = t.toWorld(car.s, car.n);
    const head = t.headingAt(car.s);
    // A car pushed sideways points a little into the slide — cheap, and the
    // only cue that tells you you are losing the back of it.
    const slip = Math.max(-0.4, Math.min(0.4, car.vn / 260)) + (car.sliding > 0.2 ? 0.12 * Math.sign(t.curvAt(car.s) || 1) : 0);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(head + (car.yaw || 0));
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(-13, -8, 30, 17);
    ctx.fillStyle = car.body;
    ctx.fillRect(-15, -9, 30, 18);
    ctx.fillStyle = car.trim;
    ctx.fillRect(2, -9, 8, 18);                 // bonnet flash
    ctx.fillStyle = "rgba(20,26,34,.85)";
    ctx.fillRect(-6, -7, 9, 14);                // cockpit

    // The driver, sitting IN the seat. This used to be drawn at a world-space
    // offset outside the car and counter-rotated by the camera, so the animal
    // orbited its own car as the player turned and hung off the bodywork.
    // Inside the car's own transform it simply rides in it.
    //
    // The quarter turn: a glyph's up-vector is (0,-1), and rotate(t) maps that
    // to (sin t, -cos t). The car's nose is local (1,0), so t = +PI/2 — without
    // it the animal sits side-saddle looking out of the window.
    if (car.emoji) {
      ctx.save();
      ctx.translate(-1.5, 0);                   // centre of the cockpit (x -6..+3)
      ctx.rotate(Math.PI / 2);
      ctx.font = "11px serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(car.emoji, 0, 0);
      ctx.restore();
    }

    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(-12, -11, 7, 3); ctx.fillRect(-12, 8, 7, 3);
    ctx.fillRect(6, -11, 7, 3); ctx.fillRect(6, 8, 7, 3);
    if (isMe) {
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 1.6;
      ctx.strokeRect(-15, -9, 30, 18);
    }
    ctx.restore();

    if (!Game.paused && car.sliding > 0.35 && car.v > 60) {
      Fx.dust(p.x, p.y, 1, car.grass > 0.3 ? "#6f9a4e" : "#c9c4b4");
      if (isMe && Math.random() < 0.10) Sfx.screech();
    }
  },

  drawGhost(ctx, t) {
    const g = Game.ghost;
    const me = Game.cars[0];
    const lapT = Game.time - me.lapStart;
    const gp = Ghost.posAt(g, lapT);
    // Station 0 is the start line, and the player's grid slot is s = 0, so a
    // fraction around the lap IS an arc length. Both cars measure from the
    // same place or the ghost is a lie.
    const s = t.wrap(gp.frac * t.len);
    const p = t.toWorld(s, gp.n);
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.translate(p.x, p.y);
    ctx.rotate(t.headingAt(s));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-15, -9, 30, 18);
    ctx.fillStyle = "rgba(80,120,160,.8)";
    ctx.fillRect(-6, -7, 9, 14);
    ctx.restore();
  },

  // The circuit the player drew, small, with everybody on it.
  minimap(ctx, t) {
    const w = Math.min(112, this.W * 0.3), h = (w * FIELD.h) / FIELD.w;
    const x = this.W - w - 8, y = 8;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = "rgba(12,20,14,.6)";
    ctx.fillRect(x, y, w, h);
    const v = { s: w / FIELD.w, ox: x, oy: y };
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = Math.max(2, TRACK_W * v.s * 0.8);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    t.pts.forEach((p, i) => (i ? ctx.lineTo(v.ox + p.x * v.s, v.oy + p.y * v.s) : ctx.moveTo(v.ox + p.x * v.s, v.oy + p.y * v.s)));
    ctx.closePath(); ctx.stroke();
    for (let i = Game.cars.length - 1; i >= 0; i--) {
      const c = Game.cars[i];
      const p = t.toWorld(c.s, c.n);
      ctx.fillStyle = c.body;
      ctx.beginPath(); ctx.arc(v.ox + p.x * v.s, v.oy + p.y * v.s, i === 0 ? 3.6 : 2.6, 0, TAU); ctx.fill();
      if (i === 0) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    ctx.restore();
  },

  countdown(ctx) {
    const n = Math.ceil(Game.countdown - 0.2);
    const txt = n <= 0 ? "GO!" : String(Math.min(3, n));
    if (this._lastCount !== txt) {
      this._lastCount = txt;
      if (n > 0) Sfx.beep();
    }
    ctx.save();
    ctx.font = "800 78px 'Baloo 2', system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.strokeText(txt, this.W / 2, this.H * 0.42);
    ctx.fillStyle = "#ffc23d";
    ctx.fillText(txt, this.W / 2, this.H * 0.42);
    ctx.restore();
  },

  /* -------------------------------------------------------------- HUD -- */

  racingFeedback(me) {
    const el = document.getElementById("race-message");
    const txt = me.boosting > 0 ? "BOOST!" : me.driftCharge >= 1.65 ? "SUPER BOOST READY · RELEASE" : me.driftCharge >= .65 ? "BOOST READY · RELEASE" : me.driftHeld ? "HOLD THE BEND…" : me.grass > .5 ? "STEER BACK TO THE ROAD" : "";
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle("boost", me.boosting > 0);
    document.getElementById("btn-drift").classList.toggle("charged", me.driftCharge >= .65);
    const meter = document.getElementById("drift-meter");
    meter.classList.toggle("active", !!me.driftHeld);
    meter.classList.toggle("super", me.driftCharge >= 1.65);
    meter.firstElementChild.style.width = `${Math.min(100, (me.driftCharge || 0) / 1.65 * 100)}%`;
    this.rivalFeedback();
  },

  rivalFeedback() {
    const el = document.getElementById("rival-message");
    if (this._rivalCars !== Game.cars) {
      this._rivalCars = Game.cars; this._rivalUntil = 0; this._rivalLast = -10; this._rivalPlaces = new Map(); el.textContent = "";
    }
    const me = Game.cars[0], rivals = Game.cars.slice(1);
    if (!rivals.length) { el.textContent = ""; return; }
    if (Game.phase === "countdown") {
      const rival = rivals[Math.min(rivals.length-1, Math.floor((3.2-Game.countdown)*rivals.length/3.2))];
      el.textContent = `${rival.emoji} ${rival.name} · ${rival.personality.title}: “${rival.personality.intro}”`;
      return;
    }
    for(const rival of rivals) {
      const ahead = rival.raced > me.raced, before = this._rivalPlaces.get(rival.id);
      if(before !== undefined && ahead !== before && Game.time-this._rivalLast > 5 && Math.abs(rival.raced-me.raced)<50) {
        el.textContent = `${rival.emoji} ${rival.name}: “${ahead ? rival.personality.pass : rival.personality.behind}”`;
        this._rivalUntil = Game.time + 3.2; this._rivalLast = Game.time;
      }
      this._rivalPlaces.set(rival.id,ahead);
    }
    if(Game.time > this._rivalUntil) el.textContent = "";
  },

  hud() {
    const me = Game.cars[0];
    const el = (id) => document.getElementById(id);
    const field = Game.cars.length;
    el("hud-pos").textContent = field > 1 ? `${this.ord(Game.playerPlace())}/${field}` : "⏱";
    el("hud-lap").textContent = `Lap ${Math.min(Game.laps, me.lap + 1)}/${Game.laps}`;
    el("hud-time").textContent = Game.time.toFixed(1);
    el("hud-best").textContent = Game.bestLap ? `⚡ ${Game.bestLap.toFixed(2)}` : "";
    // Only meaningful when the player owns the throttle — without a readout a
    // manual driver has no feel for where the corner limit is.
    el("hud-speed").textContent = `${Math.round(me.v)} km/h`;
  },

  ord(n) { return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th"; },
};
