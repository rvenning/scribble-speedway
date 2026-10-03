const test=require('node:test');
const assert=require('node:assert/strict');
const {Game,Track,Generate,RaceCourses,FIELD}=require('./load');
const circle=()=>Track.make(Array.from({length:160},(_,i)=>({x:350+220*Math.cos(i/160*Math.PI*2),y:500+300*Math.sin(i/160*Math.PI*2)})));
test('wide courses keep the drawing shape, expand lap distance and preserve the source',()=>{
  const source=circle(),snapshot=JSON.stringify(source.pts),course=RaceCourses.make(source,{obstacles:[{x:350,y:500,r:30}],gates:[{x:570,y:500,r:70}]});
  assert.equal(course.track.halfW*2,110);assert.ok(course.track.len>2990);assert.ok(course.track.len/source.len>=1.39);
  assert.equal(JSON.stringify(source.pts),snapshot);assert.equal(source.halfW*2,78);
  assert.ok(Math.abs(course.track.toWorld(0,0).x-source.toWorld(0,0).x*course.scale)<.1);
  assert.equal(course.obstacles[0].x,350*course.scale);assert.equal(course.gates[0].r,70*course.scale);
  assert.equal(course.track.courseField.w,FIELD.w*course.scale);
  for(let i=0;i<100;i++) assert.ok(course.track.advance(course.track.len*i/100,course.track.halfW)>.25);
});
function race(source,laps,difficulty) {
  const course=RaceCourses.make(source);Game.start({...course,mode:'race',handling:3,laps,rivals:7,difficulty,silent:true});Game.phase='race';
  const me=Game.cars[0];let i=0;
  while(Game.running && i++<120*180) {Game.input.steer=Game.aim(me);Game.update(1/120);}
  assert.ok(Game.result && !Game.result.timedOut);return Game.result;
}
test('standard generated races last substantially longer and long races add real distance',()=>{
  for(const seed of [100,101,102]) {
    const generated=Generate.solve({obstacles:[],gates:[],minLen:1500,maxLen:3000},{seed});assert.ok(generated);
    const normal=race(generated.track,3,.75);const long=race(generated.track,5,.75);
    assert.ok(normal.time>45 && normal.time<100,`seed ${seed}: ${normal.time}s`);
    assert.ok(long.time>normal.time*1.45);assert.equal(normal.handling,3);assert.equal(normal.stars,0);assert.ok(normal.coins>0);assert.equal(normal.field,8);
    console.log(`seed ${seed}: 3 laps ${normal.time.toFixed(1)}s, 5 laps ${long.time.toFixed(1)}s`);
  }
});
test('opponent difficulty is independent of former level definitions',()=>{
  const source=circle(),course=RaceCourses.make(source);
  Game.start({...course,mode:'race',difficulty:.25,rivals:7,silent:true});const easy=Game.cars[1].stats.top;
  Game.start({...course,mode:'race',difficulty:1,rivals:7,silent:true});assert.ok(Game.cars[1].stats.top>easy*1.5);assert.equal(Game.challenge,null);
});
