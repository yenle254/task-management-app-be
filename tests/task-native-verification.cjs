const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Only emulator-5580, started by this verification session in read-only mode.
const adb = (...args) => exec('adb', ['-s','emulator-5580',...args], { windowsHide:true, timeout:30000, maxBuffer:8*1024*1024 });
module.exports = async ({apiPort,directory,users,password,check}) => {
  const manifest = await (await fetch('http://127.0.0.1:8097/',{headers:{'expo-platform':'android',accept:'application/expo+json'}})).json();
  manifest.launchAsset.url=manifest.launchAsset.url.replace('/index.bundle?','/tests/task-browser.entry.bundle?');
  const requests=[];
  const preview=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/')||req.url.startsWith('/assets/')||req.url.includes('.bundle')) {
      const target=req.url.startsWith('/api/')?apiPort:8097;
      if(target===apiPort)requests.push({method:req.method,path:req.url.split('?')[0]});
      const upstream=http.request({hostname:'127.0.0.1',port:target,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${target}`}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);return;
    }
    res.writeHead(200,{'Content-Type':'application/expo+json','expo-protocol-version':'0','expo-sfv-version':'0','cache-control':'no-cache'});res.end(JSON.stringify(manifest));
  });
  await new Promise(resolve=>preview.listen(0,'127.0.0.1',resolve));const port=preview.address().port;
  manifest.id=require('node:crypto').randomUUID();
  manifest.launchAsset.url+=`&taskVerificationRun=${port}`;
  manifest.extra.expoClient.hostUri=`127.0.0.1:${port}`;
  manifest.extra.expoGo.mainModuleName='tests/task-browser.entry';
  manifest.extra.expoClient.extra={...manifest.extra.expoClient.extra,taskVerificationApiURL:`http://127.0.0.1:${port}/api`};
  const ports=[8097,apiPort,port];
  const dump=async()=>{await adb('shell','uiautomator','dump','/sdcard/task-verification.xml');return (await adb('shell','cat','/sdcard/task-verification.xml')).stdout;};
  const nodes=xml=>[...xml.matchAll(/<node\b[^>]+>/g)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
  const center=node=>{const b=[...node.bounds.matchAll(/\d+/g)].map(m=>Number(m[0]));return [Math.round((b[0]+b[2])/2),Math.round((b[1]+b[3])/2)];};
  const tap=async text=>{const matches=nodes(await dump()).filter(n=>n.text===text||n['content-desc']===text||n.hint===text);const node=matches.find(n=>n.clickable==='true')||matches[0];assert.ok(node,`Native control missing: ${text}`);const [x,y]=center(node);await adb('shell','input','tap',String(x),String(y));};
  const waitText=async(text,seconds=40)=>{for(let i=0;i<seconds/2;i++){const xml=await dump();if(xml.includes(text))return xml;await delay(1000);}const xml=await dump();fs.writeFileSync(path.join(directory,'native-last-ui.xml'),xml.replaceAll(password,'[redacted]'));throw new Error(`Native UI did not show ${text}`);};
  const screenshot=async name=>{const result=await exec('adb',['-s','emulator-5580','exec-out','screencap','-p'],{windowsHide:true,encoding:'buffer',maxBuffer:12*1024*1024});fs.writeFileSync(path.join(directory,name),result.stdout);};
  try {
    for(const p of ports)await adb('reverse',`tcp:${p}`,`tcp:${p}`);
    await adb('shell','am','start','-a','android.intent.action.VIEW','-d',`exp://127.0.0.1:${port}`,'host.exp.exponent');
    await check('native Expo Go task harness loads and uses real fixture password login',async()=>{
      await waitText('My Email',90);
      await tap('My Email');await adb('shell','input','text',users.employee.email);
      await tap('My Password');await adb('shell','input','text',password);await adb('shell','input','keyevent','4');
      await tap('Sign In');await waitText('Your tasks');await screenshot('native-task-list.png');
      assert.ok(requests.some(r=>r.path==='/api/auth/login'),'Native login must reach this isolated backend');
    });
    await check('native Task calendar and timeline render actual fixture data',async()=>{
      await tap('Calendar');await waitText('Task calendar');await waitText('Paged 000');await screenshot('native-calendar.png');
      await tap('Task list verification');await waitText('Your tasks');await tap('Timeline');await waitText('Task timeline');await waitText('Authorized task');await screenshot('native-timeline.png');
      let reachedLast=false;
      for(let i=0;i<40;i++) {
        const xml=await dump();
        if(xml.includes('Paged 124')) { reachedLast=true;break; }
        const scroll=nodes(xml).find(n=>n.class==='android.widget.ScrollView'&&n.scrollable==='true');
        assert.ok(scroll,'Timeline must remain scrollable');
        const bounds=[...scroll.bounds.matchAll(/\d+/g)].map(m=>Number(m[0]));
        const x=Math.round((bounds[0]+bounds[2])/2);
        await adb('shell','input','swipe',String(x),String(bounds[3]-80),String(x),String(bounds[1]+80),'350');
      }
      assert.ok(reachedLast,'Native timeline must render the 125th fixture after scrolling');
      await screenshot('native-timeline-last.png');
      assert.ok(requests.some(r=>r.path==='/api/tasks/calendar'));assert.ok(requests.some(r=>r.path==='/api/tasks/timeline'));
    });
  } finally {
    await screenshot('native-final.png').catch(()=>{});
    fs.writeFileSync(path.join(directory,'native-requests.json'),JSON.stringify(requests,null,2));
    for(const p of ports)await adb('reverse','--remove',`tcp:${p}`).catch(()=>{});
    await new Promise(resolve=>preview.close(resolve));
  }
};
