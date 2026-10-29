const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async ({ apiPort, directory, users, tokens, check }) => {
    const project = path.resolve(__dirname, '../../project');
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve));
    const metroPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const metro = spawn(process.execPath, ['node_modules/expo/bin/cli','start','--offline','--port',String(metroPort)],
        { cwd:project, windowsHide:true, env:{...process.env,CI:'1',EXPO_OFFLINE:'1'}, stdio:['ignore','pipe','pipe'] });
    const metroLogs=[];metro.stdout.on('data',data=>metroLogs.push(data.toString()));metro.stderr.on('data',data=>metroLogs.push(data.toString()));
    let browser, preview;
    try {
        const bundle=`http://127.0.0.1:${metroPort}/tests/leave-browser.entry.bundle?platform=web&dev=true&minify=false`;
        let ready=false;
        for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${metroPort}/status`)).ok){ready=true;break;}}catch{}await delay(250);}
        assert.ok(ready,'Own Metro instance ready');
        const bundled=await fetch(bundle,{signal:AbortSignal.timeout(180000)});
        if(!bundled.ok) fs.writeFileSync(path.join(directory,'bundle-error.txt'),await bundled.text());
        assert.ok(bundled.ok,`Leave bundle HTTP ${bundled.status}`);
        preview=http.createServer((req,res)=>{
            if(req.url.startsWith('/api/')||req.url.startsWith('/assets/')){
                const port=req.url.startsWith('/assets/')?metroPort:apiPort;
                const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
                upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);return;
            }
            res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script src="${bundle}"></script></body></html>`);
        });
        await new Promise(resolve=>preview.listen(0,'127.0.0.1',resolve));
        const origin=`http://127.0.0.1:${preview.address().port}`;
        browser=await chromium.launch({headless:true});
        const errors=[];
        const open = async (name,width=430) => {
            const context=await browser.newContext({viewport:{width,height:930},timezoneId:'Asia/Ho_Chi_Minh'});
            await context.addInitScript(({token,user})=>{localStorage.setItem('authToken',token);localStorage.setItem('user',JSON.stringify(user));},
                {token:tokens[name],user:JSON.parse(JSON.stringify(users[name]))});
            const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
            await expect(page.getByText('My leaves verification',{exact:true})).toBeVisible({timeout:30000});return {page,context};
        };
        let leaveId;
        const employee=await open('employee');const page=employee.page;
        await check('browser draft creation, existing form/date selectors, submit and history at narrow width',async()=>{
            await page.getByRole('button',{name:'Submit Leave',exact:true}).click();
            await page.getByText('Select leave category',{exact:true}).click();
            await page.getByText('Vacation Leave',{exact:true}).click();
            await page.getByText('Confirm',{exact:true}).click();
            await page.getByText('Select leave duration',{exact:true}).click();
            const date=new Date();date.setDate(date.getDate()+20);
            const months=(date.getFullYear()-new Date().getFullYear())*12+date.getMonth()-new Date().getMonth();
            for(let i=0;i<months;i++)await page.getByLabel('Next month').click();
            await page.getByText(String(date.getDate()),{exact:true}).click();
            await page.getByText(String(date.getDate()),{exact:true}).click();
            await page.getByText('Confirm',{exact:true}).click();
            await page.getByPlaceholder('Enter reason for leave...').fill('Browser workflow request');
            await page.getByRole('button',{name:'Save Draft',exact:true}).click();
            await expect(page.getByText('Permission to escape!',{exact:true})).toBeVisible();
            await page.getByText('Draft',{exact:true}).first().click();
            await page.getByText('Browser workflow request',{exact:true}).click();
            await expect(page.getByText('No recorded workflow history.',{exact:true})).toBeVisible();
            await page.getByRole('button',{name:'Edit and submit draft',exact:true}).click();
            await page.getByRole('button',{name:'Submit Request',exact:true}).click();
            await page.getByText('Review',{exact:true}).click();
            await page.getByText('Browser workflow request',{exact:true}).click();
            await expect(page.getByText('History',{exact:true})).toBeVisible();
            leaveId=await page.evaluate(()=>window.leaveVerificationState().leaves.find(l=>l.reason==='Browser workflow request')._id);
            await page.waitForTimeout(450);
            await page.getByText('History',{exact:true}).scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(directory,'leave-history-mobile.png'),fullPage:true});
            await page.getByRole('button',{name:'Close',exact:true}).click();
        });
        await check('browser TL inbox hands off to HR, HR approves, requester cancels and keeps record',async()=>{
            assert.ok(leaveId,'Created leave from prior UI flow');
            const lead=await open('lead',1280);
            await lead.page.getByText('Leave inbox verification',{exact:true}).click();
            await lead.page.getByText('Browser workflow request',{exact:true}).click();
            await lead.page.getByText('Approve',{exact:true}).last().click();
            await lead.page.getByText('Yes, Approve',{exact:true}).click();
            await expect(lead.page.getByText('Browser workflow request',{exact:true})).toHaveCount(0);
            const hr=await open('hr',1280);
            await hr.page.getByText('Leave inbox verification',{exact:true}).click();
            await hr.page.getByText('Browser workflow request',{exact:true}).click();
            await expect(hr.page.getByText('Waiting for HR',{exact:true}).last()).toBeVisible();
            await hr.page.waitForTimeout(450);
            await hr.page.getByText('History',{exact:true}).scrollIntoViewIfNeeded();
            await hr.page.screenshot({path:path.join(directory,'leave-inbox-hr-wide.png'),fullPage:true});
            await hr.page.getByText('Approve',{exact:true}).last().click();
            await hr.page.getByText('Yes, Approve',{exact:true}).click();
            await page.reload();await page.getByText('Approved',{exact:true}).first().click();
            await page.getByText('Browser workflow request',{exact:true}).click();
            await page.getByRole('button',{name:'Cancel leave',exact:true}).click();
            await page.getByText('Cancelled',{exact:true}).first().click();
            await expect(page.getByText('Browser workflow request',{exact:true})).toBeVisible();
            await page.waitForTimeout(450);
            await page.screenshot({path:path.join(directory,'leave-cancelled-mobile.png'),fullPage:true});
            await lead.context.close();await hr.context.close();
        });
        await check('browser edit/resubmit and optional-reason HR rejection at TL step',async()=>{
            const date=new Date();date.setDate(date.getDate()+24);date.setHours(0,0,0,0);
            const created=await fetch(`http://127.0.0.1:${apiPort}/api/leaves`,{method:'POST',headers:{Authorization:`Bearer ${tokens.employee}`,'Content-Type':'application/json'},
                body:JSON.stringify({type:'personal',startDate:date.toISOString(),endDate:date.toISOString(),reason:'Browser edit request'})});
            assert.equal(created.status,201);
            await page.reload();await page.getByText('Review',{exact:true}).click();await page.getByText('Browser edit request',{exact:true}).click();
            await page.getByRole('button',{name:'Edit and resubmit',exact:true}).click();
            await page.getByPlaceholder('Enter reason for leave...').fill('Browser edited request');
            await page.getByRole('button',{name:'Submit Request',exact:true}).click();
            // goBack only runs after the edit mutation has committed, so the MyLeaves header
            // proves the updated leave (reason + revision) is already in the store.
            await expect(page.getByText('Permission to escape!',{exact:true})).toBeVisible({timeout:15000});
            assert.equal(await page.evaluate(()=>window.leaveVerificationState().leaves.find(l=>l.reason==='Browser edited request')?.revision),1);
            const hr=await open('hr',430);await hr.page.getByText('Leave inbox verification',{exact:true}).click();
            await hr.page.getByText('Browser edited request',{exact:true}).click();
            await hr.page.getByText('Reject',{exact:true}).last().click();
            await hr.page.getByText('Confirm Reject',{exact:true}).click();
            await expect(hr.page.getByText('Browser edited request',{exact:true})).toHaveCount(0);
            await page.reload();await page.getByText('Rejected',{exact:true}).first().click();await page.getByText('Browser edited request',{exact:true}).click();
            await expect(page.getByText('No reason provided',{exact:true}).last()).toBeVisible();
            await expect(page.getByRole('button',{name:'Edit and resubmit',exact:true})).toHaveCount(0);
            await page.getByRole('button',{name:'Close',exact:true}).click();await hr.context.close();
        });
        await check('browser error/retry, empty state and session expiry clear private store',async()=>{
            await page.route('**/api/leaves/my?**',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,error:'Fixture unavailable'})}));
            await page.reload();await expect(page.getByText('Fixture unavailable · Retry',{exact:true})).toBeVisible();
            await page.unroute('**/api/leaves/my?**');await page.getByText('Fixture unavailable · Retry',{exact:true}).click();
            await expect(page.getByText('Fixture unavailable · Retry',{exact:true})).toHaveCount(0);
            await page.getByText('Draft',{exact:true}).first().click();await expect(page.getByText('No leave requests to display.',{exact:true})).toBeVisible();
            await page.route('**/api/leaves/my?**',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({success:false,error:'Token expired'})}));
            await page.reload();await expect(page.getByText('Session expired verification',{exact:true})).toBeVisible();
            assert.equal(await page.evaluate(()=>window.leaveVerificationState().leaves.length),0);
        });
        await check('browser no runtime render exceptions',async()=>assert.deepEqual(errors,[]));
        await employee.context.close();
    } finally {
        if(browser)await browser.close();if(preview)await new Promise(resolve=>preview.close(resolve));
        if(metro.exitCode===null) {
            if(process.platform==='win32') await new Promise(resolve=>{const stop=spawn('taskkill',['/PID',String(metro.pid),'/T','/F'],{windowsHide:true});stop.on('exit',resolve);});
            else metro.kill();
        }
        fs.writeFileSync(path.join(directory,'metro.log'),metroLogs.join(''));
    }
};
