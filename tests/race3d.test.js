const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./load');
const root=path.join(__dirname,'..');
const context=vm.createContext({console,Game:S.Game,Kart:S.Kart,FIELD:S.FIELD,CHAPTERS:S.CHAPTERS,RULES:S.RULES,Ghost:S.Ghost,
  window:{matchMedia:()=>({matches:false})}});
vm.runInContext(fs.readFileSync(path.join(root,'vendor/three/three.min.js'),'utf8'),context);
context.window.THREE=context.THREE;
vm.runInContext(fs.readFileSync(path.join(root,'js/driver-art.js'),'utf8')+';globalThis.art=DriverArt;',context);
vm.runInContext(fs.readFileSync(path.join(root,'js/race3d.js'),'utf8')+';globalThis.view=Race3D;',context);
const T=context.THREE,view=context.view;
function setup() {
  const track=S.Track.make(Array.from({length:150},(_,i)=>({x:350+220*Math.cos(i/150*Math.PI*2),y:500+300*Math.sin(i/150*Math.PI*2)})));
  S.Game.start({track,rivals:7,laps:3,silent:true});
  view.scene=new T.Scene();view.world=new T.Group();view.scene.add(view.world);
  view.camera=new T.OrthographicCamera(-1,1,1,-1,1,3600);
  view.build();return track;
}
test('the locally vendored Three.js builds every kart and finite batched road geometry',()=>{
  setup();assert.equal(view.models.length,8);
  let meshes=0;
  view.world.traverse(o=>{if(o.isMesh){meshes++;const p=o.geometry.getAttribute('position');for(const v of p.array)assert.ok(Number.isFinite(v));}});
  assert.ok(meshes<70,`${meshes} draws exceeds mobile budget`);
});
test('rebuilding the 3D world disposes all previous GPU assets',()=>{
  setup(); const assets=new Set();
  view.world.traverse(o=>{if(o.geometry)assets.add(o.geometry);if(o.material)assets.add(o.material);});
  let disposed=0;for(const asset of assets)asset.addEventListener('dispose',()=>disposed++);
  view.build();assert.equal(disposed,assets.size);assert.equal(view.models.length,8);
});
test('3D kart centres are drawn from exactly the same geometry as lap progression',()=>{
  const track=setup();const car=S.Game.cars[0];car.s=track.len*.37;car.n=19;car.yaw=.25;
  view.renderer={setSize(){},render(){}};view.ready=true;
  view.render(1/60,390,740);
  const p=track.toWorld(car.s,car.n),model=view.models[0];
  assert.ok(Math.abs(model.position.x-p.x)<1e-8);assert.ok(Math.abs(model.position.z-p.y)<1e-8);
  assert.ok(Math.abs(model.rotation.y-(Math.PI/2-track.headingAt(car.s)-car.yaw))<1e-8);
  assert.ok(view.camera.projectionMatrix.elements.every(Number.isFinite));
});

test('every profile avatar and rival has finite, distinct driver geometry',()=>{
  const avatars=["🏎️","🏁","🦊","🐰","🐱","🦄","🐼","🐸","🐥","🦖","🐙","🦉","🐢","🐧","🦔","🐝","🐬"];
  const signatures=new Set();
  for(const avatar of avatars) {
    const model=view.kart('#ff4d5e','#ffd166',false,avatar);
    assert.equal(model.userData.driver,context.art.avatars[avatar]);
    const positions=model.userData.chassis.children.find(o=>o.isMesh).geometry.getAttribute('position').array;
    assert.ok(Array.from(positions).every(Number.isFinite));
    signatures.add(require('node:crypto').createHash('sha256').update(Buffer.from(positions.buffer)).digest('hex'));
    const assets=new Set();model.traverse(o=>{if(o.geometry)assets.add(o.geometry);if(o.material)assets.add(o.material);});assets.forEach(a=>a.dispose());
  }
  assert.equal(signatures.size,avatars.length,'avatars must have different silhouettes');
});
test('tyre marks use a bounded reusable buffer and respect paused frames',()=>{
  setup();view.renderer={setSize(){},render(){}};view.ready=true;
  const geometry=view.skids.geometry, size=geometry.getAttribute('position').array.length;
  for(let i=0;i<1100;i++) view.skidSegment({x:i,z:20},{x:i+1,z:21});
  assert.equal(view.skidCount,480);assert.equal(view.skids.geometry,geometry);
  assert.equal(geometry.getAttribute('position').array.length,size);
  assert.ok(Array.from(geometry.getAttribute('position').array).every(Number.isFinite));
  S.Game.paused=true;const cursor=view.skidCursor;view.render(0,390,740);assert.equal(view.skidCursor,cursor);
});

test('a rematch on the same track refreshes a changed player avatar',()=>{
  const track=setup();view.renderer={setSize(){},render(){}};view.ready=true;
  S.Game.start({track,rivals:7,laps:3,silent:true,profile:{name:'Fox',avatar:'🦊'}});
  view.render(1/60,390,740);
  assert.equal(view.models[0].userData.avatar,'🦊');assert.equal(view.models[0].userData.driver,'fox');
});

test('reduced motion removes hopping, chassis lean and camera banking immediately',()=>{
  setup();view.renderer={setSize(){},render(){}};view.ready=true;
  const me=S.Game.cars[0];me.hopTime=.16;me.wheel=.8;me.driftHeld=true;me.boosting=.8;view.cameraRoll=.2;
  context.window.matchMedia=()=>({matches:true});
  try {
    view.render(1/60,390,740);
    const chassis=view.models[0].userData.chassis;
    assert.equal(chassis.position.y,0);assert.equal(chassis.rotation.x,0);assert.equal(Math.abs(chassis.rotation.z),0);assert.equal(view.cameraRoll,0);
  } finally {context.window.matchMedia=()=>({matches:false});}
});
