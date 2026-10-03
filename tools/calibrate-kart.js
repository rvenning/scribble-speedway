// Run the actual campaign test driver, without its expensive wide-net suite.
// No parallel copy of the driver: extract the definitions from the test itself.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const testFile = path.join(__dirname,'../tests/bot.test.js');
const source = fs.readFileSync(testFile,'utf8').split('const TRACKS =')[0];
const ctx = vm.createContext({require:createRequire(testFile), console, process});
vm.runInContext(source + '\nglobalThis.probe={race,Track,Generate,CHALLENGES,Game,UPGRADES};',ctx);
const {race,Generate,CHALLENGES,UPGRADES} = ctx.probe;
let wins=0,stars=0;
const prog={coinsEarned:0,coinsSpent:0,upgrades:{}};
for(let i=0;i<CHALLENGES.length;i++) {
  const ch=CHALLENGES[i];
  const g=Generate.solve({obstacles:ch.obstacles,gates:ch.gates,minLen:ch.minLen,maxLen:ch.maxLen},{seed:100+i});
  const result=race(g.track,ch,'kid',prog,7000+i);
  prog.coinsEarned+=result.coins; stars+=result.stars; wins+=result.place===1;
  for(;;) {
    let next=null;
    for(const u of UPGRADES) {
      const level=prog.upgrades[u.id]||0,cost=u.costs[level];
      if(cost!==undefined&&cost<=prog.coinsEarned-prog.coinsSpent&&(!next||cost<next.cost)) next={id:u.id,cost};
    }
    if(!next)break;prog.coinsSpent+=next.cost;prog.upgrades[next.id]=(prog.upgrades[next.id]||0)+1;
  }
  console.log(JSON.stringify({challenge:i+1,place:result.place,stars:result.stars,time:+result.time.toFixed(2),garage:prog.upgrades}));
}
console.log(JSON.stringify({wins,stars}));
