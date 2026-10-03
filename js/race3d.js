// Three.js is the same locally vendored build used by Chicken Cross.
// The road is made from the player's drawing, never a replacement circuit.
const Race3D = {
  ready: false, failed: false, track: null, models: [],
  boot(stage) {
    if (this.ready || this.failed) return this.ready;
    try {
      const T = window.THREE;
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
      this.renderer.domElement.id = "race-3d";
      stage.prepend(this.renderer.domElement);
      this.scene = new T.Scene();
      // Chicken Cross's trimmed library exports OrthographicCamera. Its base
      // camera supports the same perspective matrix, so reuse that bundle.
      this.camera = new T.OrthographicCamera(-1, 1, 1, -1, 1, 3600);
      this.camera.isOrthographicCamera = false;
      this.camera.isPerspectiveCamera = true;
      this.camera.fov = 62; this.camera.aspect = 1;
      this.camera.updateProjectionMatrix = function() {
        const top = this.near * Math.tan(this.fov * Math.PI / 360), right = top * this.aspect;
        this.projectionMatrix.makePerspective(-right, right, top, -top, this.near, this.far);
        this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
      };
      this.camera.updateProjectionMatrix();
      this.scene.add(new T.HemisphereLight(0xffffff, 0x47603a, 2.1));
      const sun = new T.DirectionalLight(0xfff0d0, 2.4); sun.position.set(-250, 600, 120); this.scene.add(sun);
      this.world = new T.Group(); this.scene.add(this.world);
      this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
        e.preventDefault(); this.failed = true; this.ready = false;
        this.renderer.domElement.style.display = "none";
        document.getElementById("cv").classList.remove("overlay");
      });
      this.ready = true;
      document.getElementById("cv").classList.add("overlay");
      return true;
    } catch (err) {
      this.failed = true;
      if (this.renderer) this.renderer.domElement.remove();
      return false;
    }
  },
  material(color, extra = {}) { return new THREE.MeshLambertMaterial({ color, ...extra }); },
  box(parent, x, y, z, w, h, d, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.material(color));
    m.position.set(x, y, z); parent.add(m); return m;
  },
  clear() {
    const geometries = new Set(), materials = new Set();
    this.world.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) materials.add(m);
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    this.world.clear(); this.models = [];
  },
  batchOpaque(parent) {
    // Combine stationary solid meshes into one vertex-coloured draw. Keep
    // moving wheels, translucent shadows and boost flames separate.
    parent.updateMatrixWorld(true);
    const positions = [], normals = [], colors = [], meshes = [];
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    const inverse = parent.matrixWorld.clone().invert();
    parent.traverse(o => { if (o.isMesh && !o.material.transparent && !Array.isArray(o.material)) meshes.push(o); });
    const geometries = new Set(), materials = new Set();
    for (const mesh of meshes) {
      const geo = mesh.geometry, transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
      const pos = geo.getAttribute('position'), normal = geo.getAttribute('normal'), vertexColor = geo.getAttribute('color');
      const count = geo.index ? geo.index.count : pos.count;
      for(let j = 0; j < count; j++) {
        const i = geo.index ? geo.index.getX(j) : j;
        p.fromBufferAttribute(pos, i).applyMatrix4(transform); positions.push(p.x,p.y,p.z);
        n.fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix); normals.push(n.x,n.y,n.z);
        const c = mesh.material.color;
        colors.push(c.r * (vertexColor ? vertexColor.getX(i) : 1), c.g * (vertexColor ? vertexColor.getY(i) : 1), c.b * (vertexColor ? vertexColor.getZ(i) : 1));
      }
      mesh.removeFromParent(); geometries.add(geo); materials.add(mesh.material);
    }
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
    parent.add(new THREE.Mesh(geometry,this.material(0xffffff,{vertexColors:true,side:THREE.DoubleSide})));
  },
  ribbon(track, inner, outer, height, color, stripe) {
    const verts = [], colors = [];
    const count = Math.ceil(track.len / 9);
    const emit = (p, c) => { verts.push(p.x, height, p.y); colors.push(c.r, c.g, c.b); };
    for (let i = 0; i < count; i++) {
      const a = track.toWorld(i / count * track.len, inner), b = track.toWorld(i / count * track.len, outer);
      const c = track.toWorld((i + 1) / count * track.len, inner), d = track.toWorld((i + 1) / count * track.len, outer);
      const paint = new THREE.Color(stripe && Math.floor(i / 3) % 2 ? stripe : color);
      [a, b, c, b, d, c].forEach(p => emit(p, paint));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    this.world.add(mesh);
  },
  kart(body, trim, ghost = false) {
    const root = new THREE.Group(), chassis = new THREE.Group(); root.add(chassis);
    const shadow = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, .2, 16), new THREE.MeshBasicMaterial({ color: 0x183225, transparent: true, opacity: .28 }));
    shadow.scale.set(1, 1, 1.35); shadow.position.y = .5; root.add(shadow);
    this.box(chassis, 0, 6, 0, 20, 6, 29, body);
    this.box(chassis, 0, 9, 9, 17, 4, 10, trim);
    this.box(chassis, 0, 10, -5, 10, 8, 8, 0x283541);
    this.box(chassis, 0, 17, -3, 7, 7, 7, 0xffd7a8);
    this.box(chassis, 0, 21, -3, 9, 4, 9, body);
    this.box(chassis, 0, 10, -14, 25, 2, 4, trim);
    this.box(chassis, 0, 3, 16, 22, 3, 3, 0xd6e0e5);
    this.batchOpaque(chassis);
    const wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(5, 5, 4, 10), wheelMat = this.material(0x18212b);
    for (const x of [-12, 12]) for (const z of [-9, 10]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat); wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 5, z); chassis.add(wheel); wheels.push(wheel);
    }
    const flames = [];
    for (const x of [-7, 7]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(3.5, 16, 7), new THREE.MeshBasicMaterial({ color: 0x6de8ff }));
      flame.rotation.x = -Math.PI / 2; flame.position.set(x, 6, -23); chassis.add(flame); flames.push(flame);
    }
    if (ghost) root.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = .3; o.material.depthWrite = false; } });
    root.userData = { chassis, wheels, flames }; return root;
  },
  build() {
    this.clear(); const t = Game.track, ch = Game.chapter || CHAPTERS[0];
    this.track = t; this.scene.background = new THREE.Color(0x9eddfa);
    this.box(this.world, FIELD.w / 2, -3, FIELD.h / 2, 6000, 5, 6000, ch.grass);
    this.ribbon(t, -t.halfW - 8, t.halfW + 8, .1, 0x518143);
    this.ribbon(t, -t.halfW, t.halfW, .4, 0x4b5964);
    this.ribbon(t, -t.halfW - 4, -t.halfW + 3, .65, 0xffffff, 0xf36d59);
    this.ribbon(t, t.halfW - 3, t.halfW + 4, .65, 0xffffff, 0xf36d59);
    // Sparse road dashes and chequered start line give speed and direction cues.
    for (let s = 0; s < t.len; s += 65) {
      const p = t.at(s), m = this.box(this.world, p.x, .7, p.y, 2, .2, 18, 0xd3dce0);
      m.rotation.y = Math.PI / 2 - t.headingAt(s);
    }
    for (let lane = -4; lane <= 4; lane++) for (let row = 0; row < 2; row++) {
      const p = t.toWorld(row * 5, lane * t.halfW / 4.5);
      const m = this.box(this.world, p.x, .85, p.y, t.halfW / 4.5, .3, 5, (lane + row) % 2 ? 0xffffff : 0x1b2835);
      m.rotation.y = Math.PI / 2 - t.headingAt(0);
    }
    for (const o of Game.obstacles) {
      const g = new THREE.Group(); g.position.set(o.x, 0, o.y); this.world.add(g);
      if (o.kind === "tree") {
        this.box(g, 0, 15, 0, 8, 30, 8, 0x8e6243);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(o.r, 66, 7), this.material(0x2a805a)); crown.position.y = 53; g.add(crown);
      } else if (o.kind === "pond") {
        const water = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, 1, 24), this.material(0x4cbbdf)); water.position.y = .3; g.add(water);
      } else if (o.kind === "barn") {
        this.box(g, 0, 22, 0, o.r * 1.3, 44, o.r * 1.2, 0xc76352);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.2, 28, 4), this.material(0x6c4653)); roof.rotation.y = Math.PI / 4; roof.position.y = 56; g.add(roof);
      } else {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r, 0), this.material(o.kind === "haystack" ? 0xdcb85f : 0x87969f)); rock.scale.y = .65; rock.position.y = o.r * .4; g.add(rock);
      }
    }
    for (const gate of Game.gates) {
      const s = t.nearest(gate.x, gate.y).s, p = t.at(s);
      const arch = new THREE.Group(); arch.position.set(p.x, 0, p.y); arch.rotation.y = Math.PI / 2 - t.headingAt(s);
      this.box(arch, -t.halfW - 7, 30, 0, 5, 60, 5, 0xffc64a);
      this.box(arch, t.halfW + 7, 30, 0, 5, 60, 5, 0xffc64a);
      this.box(arch, 0, 61, 0, t.halfW * 2 + 19, 6, 5, 0xffd97a); this.world.add(arch);
    }
    // Deterministic scenery, screened against the road and authored obstacles.
    for (let i = 0; i < 75; i++) {
      const x = ((i * 173 + 73) % (FIELD.w + 700)) - 350, z = ((i * 269 + 41) % (FIELD.h + 700)) - 350;
      if (t.nearest(x, z).d < t.halfW + 55) continue;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(15 + i % 12, 48 + i % 24, 6), this.material(i % 2 ? 0x46916c : 0x337e64));
      tree.position.set(x, 25, z); this.world.add(tree);
    }
    this.batchOpaque(this.world);
    for (const car of Game.cars) { const model = this.kart(car.body, car.trim); this.world.add(model); this.models.push(model); }
    this.ghost = Game.ghost ? this.kart(0xbfefff, 0xffffff, true) : null;
    if (this.ghost) this.world.add(this.ghost);
    const me = Game.cars[0], p = t.toWorld(me.s, me.n), head = t.headingAt(me.s);
    this.cameraHeading = head; this.camera.position.set(p.x - Math.cos(head) * 120, 76, p.y - Math.sin(head) * 120);
    this.look = new THREE.Vector3(p.x + Math.cos(head) * 90, 9, p.y + Math.sin(head) * 90);
  },
  render(dt, w, h) {
    if (!this.ready) return;
    if (this.track !== Game.track || this.models.length !== Game.cars.length) this.build();
    if (this.w !== w || this.h !== h) {
      this.w = w; this.h = h; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    const t = Game.track, me = Game.cars[0], blend = 1 - Math.exp(-5 * dt);
    Game.cars.forEach((car, i) => {
      const model = this.models[i], p = t.toWorld(car.s, car.n);
      model.position.set(p.x, 0, p.y); model.rotation.y = Math.PI / 2 - t.headingAt(car.s) - (car.yaw || 0);
      model.userData.chassis.rotation.z = -(car.wheel || 0) * .045;
      model.userData.wheels.forEach((wheel, j) => { if (j % 2) wheel.rotation.y = (car.wheel || 0) * .35; });
      model.userData.flames.forEach(flame => {
        flame.visible = car.boosting > 0 || car.driftCharge > .65;
        flame.material.color.set(car.driftCharge > 1.65 ? 0xffc44c : 0x62ddff);
        flame.scale.y = car.boosting > 0 ? 1.2 : .35;
      });
    });
    if (this.ghost) {
      const q = Ghost.posAt(Game.ghost, Game.time - me.lapStart), p = t.toWorld(q.frac * t.len, q.n);
      this.ghost.position.set(p.x, 0, p.y); this.ghost.rotation.y = Math.PI / 2 - t.headingAt(q.frac * t.len);
    }
    const p = t.toWorld(me.s, me.n), heading = t.headingAt(me.s) + (me.yaw || 0) * .4;
    this.cameraHeading += Kart.angle(heading - this.cameraHeading) * blend;
    const dirX = Math.cos(this.cameraHeading), dirZ = Math.sin(this.cameraHeading);
    const behind = w < h ? 155 : 125, height = w < h ? 98 : 76;
    this.camera.position.lerp(new THREE.Vector3(p.x - dirX * behind, height, p.y - dirZ * behind), blend);
    this.look.lerp(new THREE.Vector3(p.x + dirX * 110, 7, p.y + dirZ * 110), blend);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fov = 62 + (reduced ? 0 : Math.min(9, me.v / RULES.topSpeed * 5 + (me.boosting > 0 ? 4 : 0)));
    this.camera.fov += (fov - this.camera.fov) * blend; this.camera.updateProjectionMatrix(); this.camera.lookAt(this.look);
    this.renderer.render(this.scene, this.camera);
  },
};
