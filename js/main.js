// App shell — splash, roster, chapter map, the drawing board's three callers,
// the garage, the track book, the daily and the family leaderboard. Profiles,
// PINs, sync and install all come from gamekit; this file only decides what
// goes on each screen and what happens between a drawing and a race.

const AVATARS = ["🏎️", "🏁", "🦊", "🐰", "🐱", "🦄", "🐼", "🐸", "🐥", "🦖", "🐙", "🦉"];

const App = {
  profile: null,
  pending: null,          // the circuit just raced, for "save this one"

  el(id) { return document.getElementById(id); },

  init() {
    const settings = Storage.getSettings();
    Sfx.enabled = settings.sound !== false;
    this.assist = settings.assist !== false;         // on by default: it is the kid setting
    this.manual = settings.manual === true;          // off by default, for the same reason

    GK.UI.onScreenChange = (name) => {
      Game.active = name === "game";
      if (name !== "game") Engine.stop();
      if (name === "splash") this.refreshSplash();
    };
    GK.UI.bindSoundToggle(Storage);
    // Every menu button clicks; buttons that make their own sound keep it.
    GK.UI.bindMenuClicks();

    GK.Profiles.init({
      storage: Storage,
      avatars: AVATARS,
      meta: (p, prog) =>
        `⭐ ${Storage.totalStars(prog)}/${CHALLENGES.length * 3} · 📓 ${(prog.tracks || []).length} · 🏆 ${prog.bestDaily || 0}`,
      onEnter: (p) => { this.profile = p; this.showMap(); },
      addLabel: "New Driver",
    });

    GK.initPWA({ appName: "Scribble Speedway" });
    Render.boot();

    GK.Debug.init({ storage: Storage, title: "SCRIBBLE SPEEDWAY" })
      .jump("challenge", CHALLENGES.length, (n) => this.startChallenge(n - 1))
      .action("finish lap", () => { if (Game.running) Game.cars[0].raced += Game.track.len * 0.98; })
      .action("+200 coins", () => {
        const p = Storage.getProgress(this.profile.id);
        p.coinsEarned += 200; Storage.saveProgress(this.profile.id, p);
      });

    this.showScreen("splash");
    Storage.initFirebase().then((ok) => {
      this.el("sync-badge").textContent = ok ? "☁️ family sync on" : "📴 offline";
      if (ok && GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (ok && GK.UI.screen === "splash") this.refreshSplash();
      if (ok && GK.UI.screen === "map") this.showMap();
      if (ok && GK.UI.screen === "leaderboard") this.showLeaderboard(true);
    });
  },

  showScreen(name) { GK.UI.showScreen(name); },
  progress() { return Storage.getProgress(this.profile.id); },

  // Three coherent rungs, from two flags. The fourth combination — a car that
  // decides when to slow down but not when to go — is incoherent, so manual
  // throttle forces auto-brake off and disables the control rather than
  // leaving a setting that does nothing.
  //
  //   Easy          throttle automatic, auto-brake on   no pedals
  //   Easy + brake  throttle automatic, you brake       brake pedal
  //   Manual        you do both                         both pedals
  //
  // Easy is the default and is untouched by any of this — that is where the
  // one-thumb guarantee for a five-year-old lives.
  toggleAssist(on) {
    this.assist = on;
    const s = Storage.getSettings();
    s.assist = on;
    Storage.saveSettings(s);
    Game.assist = on;
    this.syncDriving();
    Sfx.click();
  },

  setManual(on) {
    this.manual = on;
    if (on) this.assist = false;
    const s = Storage.getSettings();
    s.manual = on;
    s.assist = this.assist;
    Storage.saveSettings(s);
    Game.assist = this.assist;
    Game.manual = on;
    this.syncDriving();
    Sfx.click();
  },

  // The single place that decides what the driving controls look like. It used
  // to be copy-pasted across three call sites, which is how the pedal and the
  // checkboxes drifted apart.
  syncDriving() {
    for (const id of ["chk-assist", "chk-assist2"]) {
      const el = this.el(id);
      if (!el) continue;
      el.checked = this.assist;
      el.disabled = this.manual;                 // meaningless while you brake yourself
    }
    for (const id of ["chk-manual", "chk-manual2"]) {
      const el = this.el(id);
      if (el) el.checked = this.manual;
    }
    this.el("btn-brake").classList.toggle("on", this.manual || !this.assist);
    this.el("btn-throttle").classList.toggle("on", this.manual);
    this.el("hud-speed").style.display = this.manual ? "" : "none";
  },

  /* ------------------------------- splash -------------------------------- */
  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    const cont = this.el("btn-continue-as"), start = this.el("btn-start");
    if (last) {
      cont.style.display = "";
      cont.textContent = `🏎️ Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => { Sfx.init(); GK.Profiles.select(last); };
      start.className = "btn ghost";
      start.textContent = "👥 Switch Driver";
    } else {
      cont.style.display = "none";
      start.className = "btn big green";
      start.textContent = "✏️ Start Drawing";
    }
  },

  play() {
    Sfx.init(); Sfx.click();
    GK.Profiles.renderList();
    this.showScreen("profiles");
  },

  /* --------------------------------- map --------------------------------- */
  showMap() {
    if (!this.profile) return this.play();
    const prog = this.progress();
    const unlocked = Storage.unlocked(prog);

    this.el("map-player").innerHTML = `${this.profile.avatar} <b>${GK.util.esc(this.profile.name)}</b>`;
    this.el("map-stars").textContent = `⭐ ${Storage.totalStars(prog)}`;
    this.el("map-coins").textContent = `🪙 ${Storage.coins(prog)}`;
    this.syncDriving();

    const cont = this.el("btn-continue");
    cont.textContent = `✏️ ${CHALLENGES[unlocked].name}`;
    cont.onclick = () => this.startChallenge(unlocked);

    this.el("chapter-list").innerHTML = CHAPTERS.map((ch, ci) => {
      const items = CHALLENGES.map((c, i) => ({ c, i })).filter((e) => e.c.chapter === ci);
      const cells = items.map(({ c, i }) => {
        const done = prog.races && prog.races[i];
        const open = i <= unlocked;
        const stars = done ? done.stars : 0;
        return `<button class="ch${open ? "" : " locked"}${i === unlocked ? " next" : ""}"
          ${open ? `onclick="App.startChallenge(${i})"` : "disabled"}
          aria-label="${open ? `Challenge ${i + 1}, ${GK.util.esc(c.name)}, ${stars} stars` : `Challenge ${i + 1}, locked`}">
          <span class="ch-n">${open ? i + 1 : "🔒"}</span>
          <span class="ch-name">${open ? GK.util.esc(c.name) : "???"}</span>
          <span class="ch-stars">${open ? "★".repeat(stars) + "☆".repeat(3 - stars) : ""}</span>
        </button>`;
      }).join("");
      return `<section class="chapter" style="--cc:${ch.edge}">
        <h3>${ch.icon} ${GK.util.esc(ch.name)}</h3>
        <div class="ch-grid">${cells}</div>
      </section>`;
    }).join("");

    this.showScreen("map");
  },

  /* ----------------------------- campaign -------------------------------- */
  startChallenge(idx) {
    Sfx.init(); Sfx.click();
    const c = CHALLENGES[idx];
    const spec = {
      obstacles: c.obstacles, gates: c.gates,
      minLen: c.minLen || MIN_LOOP, maxLen: c.maxLen || MAX_LOOP,
      chapter: CHAPTERS[c.chapter],
    };
    Draw.open(spec, {
      title: `${idx + 1}. ${c.name}`,
      hint: c.hint,
      onRace: (track, line) => {
        this.pending = { line, spec, kind: "campaign" };
        const prog = this.progress();
        Game.start({
          track, challenge: c, challengeIdx: idx, mode: "campaign",
          obstacles: c.obstacles, gates: c.gates, chapter: CHAPTERS[c.chapter],
          stats: carStats(prog), skin: Storage.skinOf(prog), assist: this.assist, manual: this.manual, manual: this.manual,
          profile: this.profile,
        });
        this.enterRace();
      },
    });
  },

  leaveDraw() { Sfx.click(); this.showMap(); },

  enterRace() {
    this.showScreen("game");
    Render.resize();
    this.syncDriving();
  },

  /* ------------------------------- results ------------------------------- */
  raceOver(res, quit) {
    Engine.stop();
    if (quit || !res) { this.showMap(); return; }

    const emoji = this.el("res-emoji"), title = this.el("res-title");
    const stars = this.el("res-stars"), stats = this.el("res-stats");
    const next = this.el("res-next"), retry = this.el("res-retry");
    const save = this.el("res-save");
    const note = this.el("res-note");
    next.style.display = "none"; retry.style.display = "none"; save.style.display = "none";
    this.el("res-finished").style.display = "none";

    const fmt = (t) => `${t.toFixed(2)}s`;

    // The full finishing order, Mario-Kart style. Only when there was a field
    // to finish among — the Daily and the Track Book run without rivals.
    const cls = this.el("res-class");
    const rows = res.classification || [];
    cls.innerHTML = rows.length > 1 ? rows.map((r) => {
      const gap = r.place === 1 ? `🏁 ${r.time.toFixed(2)}`
        : r.lapsDown >= 1 ? `+${r.lapsDown} lap${r.lapsDown > 1 ? "s" : ""}`
        : r.finished ? `+${r.gap.toFixed(2)}`
        : `≈ +${r.gap.toFixed(1)}`;      // still out there — an estimate, marked as one
      return `<div class="lb-row${r.isPlayer ? " me" : ""}${r.finished ? "" : " out"}">
        <span class="lb-rank">${r.place}</span>
        <span class="lb-avatar">${r.emoji || "🏎️"}</span>
        <span class="lb-name">${GK.util.esc(r.name)}</span>
        <span class="lb-gap">${gap}</span>
      </div>`;
    }).join("") : "";

    if (res.mode === "campaign") {
      const prog = Storage.recordRace(this.profile.id, res);
      emoji.textContent = res.place === 1 ? "🏆" : res.stars >= 2 ? "🎉" : "🏁";
      title.textContent = res.place === 1 ? "Winner!" : `${Render.ord(res.place)} place`;
      stars.textContent = "★".repeat(res.stars) + "☆".repeat(3 - res.stars);
      this.el("res-score").textContent = fmt(res.time);
      stats.innerHTML = [
        `⚡ best lap ${fmt(res.bestLap || 0)}`,
        `🎯 par ${fmt(res.par)}`,
        `🪙 ${res.coins}`,
        `🛣️ ${Math.round(res.clean * 100)}% on track`,
      ].map((b) => `<div>${b}</div>`).join("");

      note.textContent = res.stars === 3 ? "A perfect drive on a circuit you designed. 🌟"
        : res.place !== 1 ? "Finish first to earn the second star — try a rounder circuit, or turn off auto-brake."
        : `Win it under par (${fmt(res.par)}) for the third star.`;

      retry.style.display = "";
      retry.textContent = "↻ Draw Again";
      retry.onclick = () => this.startChallenge(res.challengeIdx);

      const nextIdx = res.challengeIdx + 1;
      if (nextIdx < CHALLENGES.length) {
        next.style.display = "";
        next.textContent = `▶️ ${CHALLENGES[nextIdx].name}`;
        next.onclick = () => this.startChallenge(nextIdx);
      }
      this.el("res-finished").style.display = nextIdx >= CHALLENGES.length ? "" : "none";
      save.style.display = "";

      for (let i = 0; i < res.stars; i++) setTimeout(() => Sfx.star(i + 1), 400 + i * 260);
      if (res.place === 1) Fx.confetti(Render.W, Render.H, ["#ffc23d", "#8ee06a", "#4d9dff", "#ff9f2e"], 60);
    } else if (res.mode === "daily") {
      const date = RNG.today();
      const before = this.progress().daily || {};
      const best = res.score > (before.score || 0);
      Storage.recordDaily(this.profile.id, date, res);
      emoji.textContent = best ? "🏆" : "🏁";
      title.textContent = best ? "New best today!" : "Daily Circuit";
      stars.textContent = "";
      this.el("res-score").textContent = res.score;
      stats.innerHTML = [
        `⏱ ${fmt(res.time)}`, `🎯 par ${fmt(res.par)}`,
        `⚡ best lap ${fmt(res.bestLap || 0)}`, `📅 ${date}`,
      ].map((b) => `<div>${b}</div>`).join("");
      note.textContent = res.score >= 1000
        ? "Under par! Anything over 1000 means you beat the target."
        : "1000 means par. Smooth corners and a flowing circuit are worth more than a short one.";
      retry.style.display = "";
      retry.textContent = "↻ Race Again";
      retry.onclick = () => this.raceDaily();
      if (best) setTimeout(() => Sfx.newBest(), 320);
    } else {
      Storage.recordTrackLap(this.profile.id, this.pending.trackId, res);
      emoji.textContent = "⚡";
      title.textContent = "Lap done";
      stars.textContent = "";
      this.el("res-score").textContent = fmt(res.bestLap || res.time);
      stats.innerHTML = [`⏱ total ${fmt(res.time)}`, `🎯 par ${fmt(res.par)}`]
        .map((b) => `<div>${b}</div>`).join("");
      note.textContent = "Your best lap is now a ghost car for the rest of the family.";
      retry.style.display = "";
      retry.textContent = "↻ Again";
      retry.onclick = () => this.raceSavedTrack(this.pending.trackId);
    }

    this.showScreen("results");
  },

  /* ----------------------------- track book ------------------------------ */
  saveCurrentTrack() {
    if (!this.pending || !this.pending.line) return;
    Sfx.click();
    this.el("track-name").value = "";
    GK.UI.openModal("modal-name");
  },

  confirmSaveTrack() {
    const name = (this.el("track-name").value || "").trim().slice(0, 18) || `${this.profile.name}'s circuit`;
    const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const r = Storage.saveTrack(this.profile.id, {
      id, name, line: Track.encode(this.pending.line),
      by: this.profile.name, byId: this.profile.id,
    });
    GK.UI.closeModal("modal-name");
    if (!r.ok) { GK.UI.toast("Track Book is full — delete one first"); Sfx.wrong(); return; }
    Sfx.coin();
    GK.UI.toast("Saved to the Track Book!");
    this.el("res-save").style.display = "none";
  },

  newFreeTrack() {
    Sfx.click();
    const spec = { obstacles: [], gates: [], minLen: MIN_LOOP, maxLen: MAX_LOOP, chapter: CHAPTERS[0] };
    Draw.open(spec, {
      title: "New circuit",
      hint: "An empty field — draw whatever you like.",
      onRace: (track, line) => {
        const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        Storage.saveTrack(this.profile.id, {
          id, name: `${this.profile.name}'s circuit`, line: Track.encode(line),
          by: this.profile.name, byId: this.profile.id,
        });
        this.pending = { line, spec, kind: "free", trackId: id };
        this.raceSavedTrack(id);
      },
    });
  },

  showTracks() {
    Sfx.click();
    const list = Storage.familyTracks();
    const mine = this.progress().tracks || [];
    this.el("track-list").innerHTML = list.length ? list.map((t) => {
      const own = mine.find((x) => x.id === t.id);
      const laps = Storage.lapsOn(t.id);
      const lead = laps[0];
      return `<div class="track-card">
        <canvas class="track-thumb" width="124" height="88" data-line="${GK.util.esc(t.line)}"></canvas>
        <span class="track-info">
          <span class="track-name">${GK.util.esc(t.name)}</span>
          <span class="track-meta">${t.ownerAvatar || "🏎️"} ${GK.util.esc(t.by || t.ownerName || "")}${
            lead ? ` · ⚡ ${lead.best.toFixed(2)}s ${lead.profile.avatar}` : " · no lap yet"}${
            own && own.best ? ` · you ${own.best.toFixed(2)}s` : ""}</span>
        </span>
        <span class="track-acts">
          <button class="btn green small" onclick="App.raceSavedTrack('${t.id}')">🏁</button>
          ${own ? `<button class="btn grey small" onclick="App.deleteTrack('${t.id}')">🗑</button>` : ""}
        </span>
      </div>`;
    }).join("") : `<p class="nudge">Nothing here yet. Tap ✏️ New to draw one, or save a circuit after a campaign race.</p>`;
    this.showScreen("tracks");
    // Thumbnails after the markup is in the document, so the canvases exist.
    for (const cv of document.querySelectorAll(".track-thumb")) {
      const line = Track.decode(cv.dataset.line);
      if (!line) continue;
      const ctx = cv.getContext("2d");
      const v = Paint.fit(cv.width, cv.height, 3);
      ctx.fillStyle = "#5f9c46"; ctx.fillRect(0, 0, cv.width, cv.height);
      Paint.ribbon(ctx, line, v, { dashes: false });
    }
  },

  deleteTrack(id) {
    Sfx.click();
    Storage.deleteTrack(this.profile.id, id);
    this.showTracks();
  },

  raceSavedTrack(id) {
    const entry = Storage.familyTracks().find((t) => t.id === id);
    if (!entry) { GK.UI.toast("That circuit has gone"); return; }
    const line = Track.decode(entry.line);
    if (!line) { GK.UI.toast("That circuit could not be read"); return; }
    const track = Track.make(line);
    const prog = this.progress();
    // Make sure this profile owns a copy, so its own best lap has somewhere to
    // live and the drawing survives on this device too.
    if (!(prog.tracks || []).some((t) => t.id === id)) {
      Storage.saveTrack(this.profile.id, { id, name: entry.name, line: entry.line, by: entry.by, byId: entry.byId });
    }
    // The ghost to chase: the quickest lap anyone in the family has set here.
    const laps = Storage.lapsOn(id);
    const ghost = laps.length ? Ghost.decode(laps[0].ghost) : null;
    this.pending = { line, kind: "free", trackId: id };
    Sfx.init(); Sfx.click();
    Game.start({
      track, mode: "free", laps: 3, rivals: 0,
      obstacles: [], gates: [], chapter: CHAPTERS[0],
      stats: carStats(prog), skin: Storage.skinOf(prog), assist: this.assist, manual: this.manual,
      ghost, profile: this.profile,
    });
    this.enterRace();
  },

  /* --------------------------------- daily -------------------------------- */
  showDaily() {
    Sfx.click();
    const date = RNG.today();
    const prog = this.progress();
    const mine = Storage.dailyFor(prog, date);
    this.el("daily-date").textContent = date;

    this.el("daily-body").innerHTML = mine
      ? `<div class="daily-card">
           <span class="daily-big">${mine.score || "—"}</span>
           <span class="track-meta">your best today${mine.time ? ` · ${mine.time.toFixed(2)}s · ${mine.plays} run${mine.plays === 1 ? "" : "s"}` : ""}</span>
           <button class="btn green wide" onclick="App.raceDaily()">🏁 Race today's circuit</button>
           <span class="track-meta">Your circuit is locked in for today so every run is comparable.</span>
         </div>`
      : `<div class="daily-card">
           <span class="daily-big">📅</span>
           <span class="track-meta">You have not drawn today's circuit yet.</span>
           <button class="btn green wide" onclick="App.drawDaily()">✏️ Draw today's circuit</button>
         </div>`;

    // Today's family standings, from everyone's progress documents.
    const rows = [];
    for (const p of Storage.getProfiles()) {
      const d = Storage.getProgress(p.id).daily;
      if (d && d.date === date && d.score > 0) rows.push({ p, d });
    }
    rows.sort((a, b) => b.d.score - a.d.score);
    this.el("daily-rows").innerHTML = rows.length
      ? rows.map((r, i) => `<div class="lb-row${r.p.id === this.profile.id ? " me" : ""}">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-avatar">${r.p.avatar}</span>
          <span class="lb-name">${GK.util.esc(r.p.name)}</span>
          <span class="lb-stat">🏁 ${r.d.score}</span>
          <span class="lb-stat">⏱ ${r.d.time.toFixed(2)}</span>
        </div>`).join("")
      : `<p class="nudge">Nobody has set a time today. Be first!</p>`;

    this.showScreen("daily");
  },

  dailySpec() {
    const f = Generate.field(RNG.today());
    return { ...f, chapter: CHAPTERS[RNG.sub(f.seed, "look").int(0, CHAPTERS.length - 1)] };
  },

  drawDaily() {
    Sfx.click();
    const date = RNG.today();
    const spec = this.dailySpec();
    Draw.open(spec, {
      title: `📅 ${date}`,
      hint: "Everyone gets this same field today. Draw the circuit you want to race.",
      onRace: (track, line) => {
        Storage.startDaily(this.profile.id, date, Track.encode(line));
        this.raceDaily();
      },
    });
  },

  raceDaily() {
    const date = RNG.today();
    const prog = this.progress();
    const mine = Storage.dailyFor(prog, date);
    if (!mine) return this.drawDaily();
    const line = Track.decode(mine.line);
    if (!line) return this.drawDaily();
    const spec = this.dailySpec();
    Sfx.init(); Sfx.click();
    Game.start({
      track: Track.make(line), mode: "daily", laps: 3, rivals: 0,
      obstacles: spec.obstacles, gates: spec.gates, chapter: spec.chapter,
      stats: carStats(prog), skin: Storage.skinOf(prog), assist: this.assist, manual: this.manual,
      ghost: mine.ghost ? Ghost.decode(mine.ghost) : null,
      profile: this.profile,
    });
    this.pending = { line, spec, kind: "daily" };
    this.enterRace();
  },

  /* -------------------------------- garage -------------------------------- */
  showGarage() {
    Sfx.click();
    const prog = this.progress();
    this.el("garage-coins").textContent = `🪙 ${Storage.coins(prog)}`;
    this.el("upgrade-list").innerHTML = UPGRADES.map((u) => {
      const lvl = (prog.upgrades && prog.upgrades[u.id]) || 0;
      const maxed = lvl >= u.costs.length;
      const cost = maxed ? 0 : u.costs[lvl];
      const afford = Storage.coins(prog) >= cost;
      const pips = "●".repeat(lvl) + "○".repeat(u.costs.length - lvl);
      return `<div class="shop-card${maxed ? " maxed" : ""}">
        <span class="shop-icon">${u.icon}</span>
        <span class="shop-info">
          <span class="shop-name">${GK.util.esc(u.name)} <span class="shop-pips">${pips}</span></span>
          <span class="shop-desc">${GK.util.esc(u.desc)}${lvl ? ` — now ${GK.util.esc(String(u.fmt(u.value[lvl - 1])))}` : ""}</span>
        </span>
        ${maxed ? `<span class="shop-max">MAX</span>`
          : `<button class="btn small${afford ? " green" : " grey"}" ${afford ? "" : "disabled"}
               onclick="App.buy('${u.id}')">🪙 ${cost}</button>`}
      </div>`;
    }).join("");

    this.el("skin-list").innerHTML = SKINS.map((s) => {
      const owned = (prog.skins || []).includes(s.id);
      const on = prog.skin === s.id;
      return `<button class="skin${on ? " on" : ""}" onclick="App.pickSkin('${s.id}')"
        aria-label="${GK.util.esc(s.name)}${owned ? "" : `, costs ${s.cost} coins`}">
        <span class="skin-chip" style="background:${s.body};border-color:${s.trim}"></span>
        <span class="skin-name">${GK.util.esc(s.name)}</span>
        <span class="skin-cost">${owned ? (on ? "fitted" : "own") : `🪙 ${s.cost}`}</span>
      </button>`;
    }).join("");
    this.showScreen("garage");
  },

  buy(id) {
    const r = Storage.buyUpgrade(this.profile.id, id);
    if (!r.ok) { GK.UI.toast(r.reason === "coins" ? "Not enough coins" : "Already maxed"); Sfx.wrong(); return; }
    Sfx.coin(); GK.UI.toast("Fitted!");
    this.showGarage();
  },

  pickSkin(id) {
    const r = Storage.buySkin(this.profile.id, id);
    if (!r.ok) { GK.UI.toast("Not enough coins"); Sfx.wrong(); return; }
    Sfx.coin();
    this.showGarage();
  },

  /* ----------------------------- leaderboard ------------------------------ */
  showLeaderboard(silent) {
    if (!silent) Sfx.click();
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: (r) => `<span class="lb-stat">⭐ ${Storage.totalStars(r.progress)}</span>
        <span class="lb-stat">📓 ${(r.progress.tracks || []).length}</span>
        <span class="lb-stat">🏆 ${r.progress.bestDaily || 0}</span>`,
      sort: (a, b) => (b.progress.bestDaily || 0) - (a.progress.bestDaily || 0)
        || Storage.totalStars(b.progress) - Storage.totalStars(a.progress),
      meId: this.profile?.id,
      empty: "No drivers yet — tap Play!",
    });
    this.showScreen("leaderboard");
  },
};

// Run init on DOMContentLoaded, not inline at the bottom of <body>: rendering
// the first screen before layout settles resolves viewport-relative clamp()
// font sizes against the inherited value on that one render.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
else App.init();
