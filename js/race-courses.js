// Drawings stay in their original coordinates for saves and the editor.
// The playable course expands that same shape and gives karts more road room.
const RaceCourses = {
  width: 110, minLength: 3000, scale: 1.4,
  make(source, spec = {}) {
    const scale = Math.max(this.scale, this.minLength/source.len);
    const track = Track.make(source.pts.map(p=>({x:p.x*scale,y:p.y*scale})));
    track.halfW = this.width/2;
    track.courseField = {w:FIELD.w*scale,h:FIELD.h*scale};
    track.courseVersion = 3;
    const transform = o=>({...o,x:o.x*scale,y:o.y*scale,r:(o.r||0)*scale});
    return {track,scale,obstacles:(spec.obstacles||[]).map(transform),gates:(spec.gates||[]).map(transform)};
  }
};
