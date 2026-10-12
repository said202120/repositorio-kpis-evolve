const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1743,height:1347}});
await p.goto('file://'+__dirname+'/org.html');await p.waitForTimeout(600);
await p.screenshot({path:__dirname+'/../../assets/organigrama-spin-master.jpg',type:'jpeg',quality:90});await b.close();})();
