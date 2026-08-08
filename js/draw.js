// The drawing board — where the level actually gets designed.
//
// The player draws a closed loop on the field with a finger. On release the
// scribble goes through track.js's fix-up pipeline and either becomes a real
// circuit, drawn as tarmac right there so they can see what they made, or comes
// back with one friendly sentence about what to change. Nothing is ever wiped
// for them: a rejected drawing stays on screen as the smoothed grey line, so
// the fix is a redraw of one corner rather than a fresh start.
//
// `Paint` lives here rather than in render.js because both screens draw the
// same world — the drawing board flat and whole, the minimap small — and two
// copies of "what does a track look like" would drift apart.

const Paint = {
  // Fit the 1000x700 field into a box, letterboxed.
  fit(W, H, pad = 0) {
    const s = Math.min((W - pad * 2) / FIELD.w, (H - pad * 2) / FIELD.h);
    return { s, ox: (W - FIELD.w * s) / 2, oy: (H - FIELD.h * s) / 2 };
  },

  grass(ctx, W, H, ch, view) {
    ctx.fillStyle = ch ? ch.grassAlt : "#6cb44e";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ch ? ch.grass : "#7cc45a";
    ctx.fillRect(view.ox, view.oy, FIELD.w * view.s, FIELD.h * view.s);
    // Mown stripes, so the field reads as a place rather than a green rectangle.
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, FIELD.w * view.s, FIELD.h * view.s);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,.055)";
    for (let x = 0; x < FIELD.w; x += 84) ctx.fillRect(view.ox + x * view.s, view.oy, 42 * view.s, FIELD.h * view.s);
    ctx.restore();
  },

  obstacles(ctx, list, view, showIcons = true) {
    for (const o of list || []) {
      const x = view.ox + o.x * view.s, y = view.oy + o.y * view.s, r = o.r * view.s;
      ctx.fillStyle = o.kind === "pond" ? "#4aa8d8" : "rgba(0,0,0,.22)";
      ctx.beginPath(); ctx.arc(x, y + r * 0.12, r, 0, TAU); ctx.fill();
      if (o.kind !== "pond") {
        ctx.fillStyle = o.kind === "rock" ? "#8d8f95" : o.kind === "barn" ? "#b4553c" : "#3f7d34";
        ctx.beginPath(); ctx.arc(x, y, r * 0.86, 0, TAU); ctx.fill();
      }
      if (showIcons && r > 12) {
        ctx.font = `${Math.round(r * 1.15)}px serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(o.icon || "🌳", x, y);
      }
    }
  },

  gates(ctx, list, view, t = 0) {
    for (const g of list || []) {
      const x = view.ox + g.x * view.s, y = view.oy + g.y * view.s, r = g.r * view.s;
      ctx.lineWidth = Math.max(2, 7 * view.s);
      ctx.strokeStyle = "rgba(255,194,61,.95)";
      ctx.beginPath(); ctx.arc(x, y, r * (0.92 + Math.sin(t * 2) * 0.05), 0, TAU); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.45)";
      ctx.lineWidth = Math.max(1, 2.4 * view.s);
      ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, TAU); ctx.stroke();
    }
  },

  // Tarmac. Stroking the centre line with a round-capped line of the track's
  // own width is the whole renderer: the road drawn is the road the physics
  // uses, because both come from the same points.
  ribbon(ctx, line, view, { road = "#4d5661", verge = "#e8e2cf", dashes = true } = {}) {
    if (!line || line.length < 3) return;
    const path = new Path2D();
    path.moveTo(view.ox + line[0].x * view.s, view.oy + line[0].y * view.s);
    for (let i = 1; i < line.length; i++) path.lineTo(view.ox + line[i].x * view.s, view.oy + line[i].y * view.s);
    path.closePath();

    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = verge;
    ctx.lineWidth = (TRACK_W + 12) * view.s;
    ctx.stroke(path);
    ctx.strokeStyle = road;
    ctx.lineWidth = TRACK_W * view.s;
    ctx.stroke(path);

    if (dashes && view.s > 0.12) {
      ctx.setLineDash([16 * view.s, 20 * view.s]);
      ctx.strokeStyle = "rgba(255,233,168,.55)";
      ctx.lineWidth = Math.max(1, 3 * view.s);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
  },

  startLine(ctx, line, view) {
    if (!line || line.length < 3) return;
    const a = line[0], b = line[1];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d;
    const x = view.ox + a.x * view.s, y = view.oy + a.y * view.s;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(ny, nx));
    const w = HALF_W * view.s, h = 7 * view.s;
    for (let i = -3; i < 3; i++) {
      ctx.fillStyle = i % 2 ? "#ffffff" : "#1b1b1b";
      ctx.fillRect(-h, (i * w) / 3, h * 2, w / 3);
    }
    ctx.restore();
  },
};

const Draw = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1,
  raw: [], drawing: false, result: null, spec: null, opts: null,
  t: 0, reveal: 0,

  boot() {
    this.cv = document.getElementById("cv-draw");
    this.ctx = this.cv.getContext("2d");
    this.stage = document.getElementById("draw-stage");

    const pos = (e) => {
      const r = this.cv.getBoundingClientRect();
      return {
        x: (e.clientX - r.left - this.view.ox) / this.view.s,
        y: (e.clientY - r.top - this.view.oy) / this.view.s,
      };
    };

    this.cv.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
      this.drawing = true;
      this.raw = [pos(e)];
      this.result = null;
      this.reveal = 0;
      Sfx.init();
      this.updateBar();
    }, { passive: false });

    // `pressure` is ZERO for ordinary touch on iOS, so a `pressure > 0` guard
    // silently drops every move of a real finger swipe. Ask what KIND of
    // pointer it is, and add a raw touchmove because some iOS builds are stingy
    // with pointermove during a fast stroke.
    const move = (x, y) => {
      if (!this.drawing) return;
      const last = this.raw[this.raw.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < 4) return;
      this.raw.push({ x, y });
      if (this.raw.length % 6 === 0) Sfx.pen();
      this.updateBar();
    };
    this.cv.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" || e.buttons || e.pointerType === "mouse") {
        e.preventDefault();
        const p = pos(e); move(p.x, p.y);
      }
    }, { passive: false });
    this.cv.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const r = this.cv.getBoundingClientRect(), t = e.touches[0];
      if (t) move((t.clientX - r.left - this.view.ox) / this.view.s, (t.clientY - r.top - this.view.oy) / this.view.s);
    }, { passive: false });

    const end = () => { if (this.drawing) { this.drawing = false; this.build(); } };
    this.cv.addEventListener("pointerup", end);
    this.cv.addEventListener("pointercancel", end);
    this.cv.addEventListener("pointerleave", end);

    this.view = { s: 1, ox: 0, oy: 0 };
    window.addEventListener("resize", () => this.resize());
    this.resize();
  },

  resize() {
    if (!this.cv) return;
    const b = this.stage.getBoundingClientRect();
    if (b.width < 50 || b.height < 50) return;           // hidden screen reads 0x0
    this.dpr = window.devicePixelRatio || 1;
    this.W = b.width; this.H = b.height;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.view = Paint.fit(this.W, this.H, 6);
  },

  /* --------------------------------------------------------------- open -- */

  // spec: { obstacles, gates, minLen, maxLen, chapter }
  // opts: { title, hint, onRace(track, line), allowAuto }
  open(spec, opts) {
    this.spec = spec;
    this.opts = opts;
    this.raw = [];
    this.result = null;
    this.reveal = 0;
    document.getElementById("draw-title").textContent = opts.title || "Draw a circuit";
    document.getElementById("btn-auto").style.display = opts.allowAuto === false ? "none" : "";
    App.showScreen("draw");
    this.resize();
    this.setHint(opts.hint || "Draw a big loop with your finger.", "");
    this.updateBar();
  },

  setHint(msg, cls) {
    const el = document.getElementById("draw-hint");
    el.textContent = msg;
    el.className = "draw-hint" + (cls ? " " + cls : "");
  },

  clear() {
    Sfx.click();
    this.raw = []; this.result = null; this.reveal = 0;
    this.setHint(this.opts.hint || "Draw a big loop with your finger.", "");
    this.updateBar();
  },

  build() {
    if (this.raw.length < 8) { this.raw = []; this.updateBar(); return; }
    const res = Track.fromScribble(this.raw, this.spec);
    this.result = res;
    if (res.ok) {
      Sfx.snap();
      this.reveal = 0.0001;
      this.setHint("Nice circuit! Tap 🏁 Race! when you are ready.", "good");
    } else {
      Sfx.nope();
      this.setHint(res.problems[0], "bad");
    }
    this.updateBar();
  },

  // A valid circuit, generated. The anti-stuck escape hatch: no drawing a child
  // can fail to produce blocks the game, because this button always works.
  auto() {
    Sfx.click();
    const btn = document.getElementById("btn-auto");
    btn.disabled = true; btn.textContent = "🎲 thinking…";
    // Let the button repaint before the search, which is synchronous.
    setTimeout(() => {
      const g = Generate.solve(this.spec, { seed: (Math.random() * 4294967295) >>> 0 });
      btn.disabled = false; btn.textContent = "🎲 Draw it for me";
      if (!g) { this.setHint("Hmm, that one is tricky — have a go yourself!", "bad"); return; }
      this.raw = g.line.map((p) => ({ x: p.x, y: p.y }));
      this.result = { ok: true, track: g.track, line: g.line, problems: [] };
      this.reveal = 0.0001;
      Sfx.snap();
      this.setHint("There you go! Tap 🏁 Race! when you are ready.", "good");
      this.updateBar();
    }, 30);
  },

  race() {
    if (!this.result || !this.result.ok) return;
    Sfx.click();
    this.opts.onRace(this.result.track, this.result.line);
  },

  updateBar() {
    const ok = !!(this.result && this.result.ok);
    document.getElementById("btn-race").disabled = !ok;
    const len = this.result && this.result.line
      ? Math.round(this.result.line.reduce((a, p, i, arr) => a + (i ? Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) : 0), 0))
      : 0;
    const need = this.spec && this.spec.minLen ? this.spec.minLen : MIN_LOOP;
    document.getElementById("draw-len").textContent = len ? `📏 ${len} / ${need}` : "";
  },

  /* ------------------------------------------------------------- render -- */

  render(dt) {
    if (!this.ctx) return;
    const b = this.stage.getBoundingClientRect();
    if (b.width > 50 && (Math.abs(b.width - this.W) > 1 || Math.abs(b.height - this.H) > 1)) this.resize();
    this.t += dt;
    if (this.reveal > 0) this.reveal = Math.min(1, this.reveal + dt * 2.2);

    const ctx = this.ctx, v = this.view;
    const ch = this.spec && this.spec.chapter ? this.spec.chapter : CHAPTERS[0];
    Paint.grass(ctx, this.W, this.H, ch, v);

    // The repaired line, faded in behind the tarmac so a rejected drawing still
    // shows what the game made of it.
    if (this.result && this.result.line && !this.result.ok) {
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = Math.max(2, 5 * v.s);
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      this.result.line.forEach((p, i) => (i ? ctx.lineTo(v.ox + p.x * v.s, v.oy + p.y * v.s) : ctx.moveTo(v.ox + p.x * v.s, v.oy + p.y * v.s)));
      ctx.closePath(); ctx.stroke();
    }

    if (this.result && this.result.ok && this.reveal > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.reveal * 1.3);
      Paint.ribbon(ctx, this.result.line, v);
      Paint.startLine(ctx, this.result.line, v);
      ctx.restore();
    }

    Paint.obstacles(ctx, this.spec ? this.spec.obstacles : [], v);
    Paint.gates(ctx, this.spec ? this.spec.gates : [], v, this.t);

    // The live stroke, on top of everything, as chalk.
    if (this.raw.length > 1 && (!this.result || !this.result.ok)) {
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = Math.max(3, 8 * v.s);
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      this.raw.forEach((p, i) => (i ? ctx.lineTo(v.ox + p.x * v.s, v.oy + p.y * v.s) : ctx.moveTo(v.ox + p.x * v.s, v.oy + p.y * v.s)));
      ctx.stroke();
      // Where the loop will be closed to.
      const a = this.raw[0];
      ctx.fillStyle = "rgba(255,194,61,.95)";
      ctx.beginPath(); ctx.arc(v.ox + a.x * v.s, v.oy + a.y * v.s, Math.max(4, 9 * v.s), 0, TAU); ctx.fill();
    }
  },
};
