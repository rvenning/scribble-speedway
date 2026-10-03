// Avatar silhouettes remain recognisable from the chase camera behind the kart.
// Everything is baked into the chassis: no extra draws or simulation changes.
const DriverArt = {
  avatars: {
    "🏎️": "helmet", "🏁": "flag", "🦊": "fox", "🐰": "rabbit", "🐇": "rabbit",
    "🐱": "cat", "🦄": "unicorn", "🐼": "panda", "🐸": "frog", "🐥": "chick",
    "🦖": "rex", "🐙": "octopus", "🦉": "owl", "🐢": "turtle", "🐧": "penguin",
    "🦔": "hedgehog", "🐝": "bee", "🐬": "dolphin"
  },
  palettes: {
    helmet: [0xffd7a8,0xffffff], flag: [0xffd7a8,0xffffff], fox: [0xf39344,0xfff3dc],
    rabbit: [0xfff5ed,0xf8adc6], cat: [0xf2bc74,0xffefd2], unicorn: [0xfff1fc,0xd998ed],
    panda: [0xfffaf2,0x293344], frog: [0x75d663,0xd6f4a2], chick: [0xffdf55,0xff982f],
    rex: [0x55ba8b,0xfbe48b], octopus: [0xce86e3,0xf6bae3], owl: [0xad805c,0xf8dfb1],
    turtle: [0x8dcc70,0x416b46], penguin: [0x334254,0xfff5df],
    hedgehog: [0xc69a79,0x654841], bee: [0xffd654,0x30323b], dolphin: [0x74c9e5,0xd4f5fa]
  },
  build(view, parent, avatar, paint) {
    const species = this.avatars[avatar] || "helmet", [fur, accent] = this.palettes[species];
    const box = (x,y,z,w,h,d,c) => view.box(parent,x,y,z,w,h,d,c);
    const round = (x,y,z,w,h,d,c) => {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1,0),view.material(c));
      m.position.set(x,y,z); m.scale.set(w,h,d); parent.add(m); return m;
    };
    const cone = (x,y,z,r,h,c) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r,h,6),view.material(c));
      m.position.set(x,y,z); parent.add(m); return m;
    };
    // Larger than the old helmet, with all details inside the kart's wheel span.
    round(0,14,-3,4.6,4,4,fur);
    round(0,21,-3,6,5.8,5,fur);
    box(0,19,1.7,6,3,1.6,accent);
    for (const x of [-2.5,2.5]) box(x,22,1.9,1.2,1.8,1,0x202b38);
    const ears = (long, triangular, c=fur) => {
      for (const x of [-4,4]) {
        if (triangular) cone(x,27,-3,2.7,long,c);
        else round(x,27+long/3,-3,2,long/2,1.8,c);
        box(x,27+long/3,-1.3,1,long*.48,.5,accent);
      }
    };
    switch (species) {
      case "helmet": case "flag":
        round(0,23,-3,6.6,5,5.5,paint);
        box(0,23,2,9,2.8,1.2,0x263b50);
        box(0,26,-3,2,2,10,accent);
        if (species === "flag") for(let x=0;x<3;x++) for(let y=0;y<2;y++)
          box((x-1)*2,22+y*2,-8.1,2,2,.5,(x+y)%2?0x202b38:0xffffff);
        break;
      case "rabbit": ears(11,false); round(0,13,-9,3,3,3,fur); break;
      case "fox": ears(7,true); round(0,12,-11,3.3,3.3,5,fur); round(0,12,-15,2.5,2.5,2.5,accent); break;
      case "cat": ears(5,true); box(0,12,-11,2,2,8,fur); box(0,15,-14,2,6,2,fur); break;
      case "unicorn":
        ears(4,true); cone(0,30,0,1.8,8,0xffd66a);
        for(let y=15;y<28;y+=3) round(0,y,-8,2,2.4,2,accent);
        box(0,12,-12,3,3,7,accent); break;
      case "panda":
        for(const x of [-4,4]) { round(x,27,-3,2.5,2.5,2.1,accent); round(x*.6,22,1,1.9,2,1.8,accent); box(x*.6,22,2.5,.8,1,.5,0xffffff); }
        box(0,15,-7,9,2,2,accent); break;
      case "frog":
        for(const x of [-4,4]) { round(x,26,0,2.5,2.8,2,fur); box(x,26,1.9,1.2,1.7,.7,0x202b38); }
        box(0,19,2.5,6,.8,.8,0x427b3e); break;
      case "chick": case "penguin":
        box(0,20,3,3,2,3,0xffad35);
        for(const x of [-5,5]) round(x,15,-3,1.4,3.5,2,fur);
        if(species === "chick") cone(0,28,-3,1.5,4,fur);
        break;
      case "rex":
        box(0,21,2,8,5,6,fur);
        for(const x of [-3,3]) box(x,19,5,1.1,1.5,1,0xffffff);
        for(let y=15;y<28;y+=4) cone(0,y,-8,2.3,4,accent);
        round(0,11,-12,2.8,2.5,5,fur); break;
      case "octopus":
        for(let i=0;i<6;i++) { const a=i*Math.PI/3; round(Math.cos(a)*6,12,-3+Math.sin(a)*5,2.7,2,2.7,fur); }
        round(0,23,-6,6,6,4,fur); break;
      case "owl":
        ears(4,true); for(const x of [-2.8,2.8]) { round(x,22,1.7,2.8,3,1,accent); box(x,22,2.7,1,1.8,.8,0x202b38); }
        cone(0,20,3,1.4,3,0xe8aa42);
        for(const x of [-5,5]) round(x,15,-3,1.8,4,2,fur); break;
      case "turtle":
        round(0,14,-8,6,5,3,accent);
        box(0,15,-11,1,7,.8,0xc5db8b); box(0,15,-11,9,1,.8,0xc5db8b); break;
      case "hedgehog":
        for(let i=0;i<7;i++) { const a=i*Math.PI/6; cone(Math.cos(a)*5.5,23+Math.sin(a)*4,-7,2.1,6,accent); }
        box(0,20,3,2,2,2,0x353139); break;
      case "bee":
        for(let y=14;y<=23;y+=4) box(0,y,-7.8,9,1.8,1.4,accent);
        for(const x of [-5,5]) { round(x,15,-8,3,4,1.1,0xe7f5fa); box(x*.6,29,-3,.8,5,.8,accent); round(x*.6,32,-3,1.2,1.2,1.2,accent); }
        break;
      case "dolphin":
        round(0,20,3,3,2.5,5,fur);
        cone(0,25,-8,3,6,fur);
        for(const x of [-5,5]) round(x,14,-3,2,1,3,fur); break;
    }
    // Hands hug the cockpit and preserve the road-facing silhouette.
    for(const x of [-4,4]) round(x,13,1,1.5,1.5,1.5,fur);
    return species;
  }
};
