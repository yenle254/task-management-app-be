const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');

module.exports = async ({ apiPort, directory, users, password, secret, check }) => {
  const bundle = 'http://127.0.0.1:8097/tests/task-browser.entry.bundle?platform=web&dev=true&minify=false';
  const bundled = await fetch(bundle); assert.ok(bundled.ok, `Task web bundle: ${bundled.status}`);
  const preview = http.createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/') || req.url.startsWith('/assets/')) {
      const port = req.url.startsWith('/assets/') ? 8097 : apiPort;
      const upstream = http.request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script src="${bundle}"></script></body></html>`);
  });
  await new Promise(resolve=>preview.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${preview.address().port}`;
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'Asia/Ho_Chi_Minh'});
  const page=await context.newPage();
  const searchBox=()=>page.locator('input[placeholder="Search title, description or tags"]:visible');
  const input=label=>page.getByText(label,{exact:true}).filter({visible:true}).locator('..').locator('input');
  const errors=[];page.on('pageerror',e=>errors.push(e.stack || e.message));
  const back=async()=>{await page.getByText('Task list verification',{exact:true}).click();await expect(searchBox()).toBeVisible();};
  try {
    await check('browser real employee sign-in, list filter, empty and error/retry',async()=>{
      await page.goto(origin);
      await page.getByPlaceholder('My Email').fill(users.employee.email);
      await page.getByPlaceholder('My Password').fill(password);
      await page.getByText('Sign In',{exact:true}).last().click();
      const search=searchBox();await expect(search).toBeVisible({timeout:30000});
      await search.fill('Paged');await expect(page.getByText('125 matching tasks',{exact:true})).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>window.taskVerificationState().myTasks.length)).toBeGreaterThanOrEqual(20);
      // Scroll the actual FlatList to exercise onEndReached, not store actions.
      for(let i=0;i<30;i++){await page.mouse.move(900,750);await page.mouse.wheel(0,2500);await page.waitForTimeout(100);if(await page.evaluate(()=>!window.taskVerificationState().hasMore))break;}
      await expect.poll(()=>page.evaluate(()=>window.taskVerificationState().myTasks.length)).toBe(125);
      await search.fill('No fixture matches this');await expect(page.getByText('No tasks match these filters.',{exact:true})).toBeVisible();
      await page.route('**/api/tasks/my?**',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,error:'Verification failure'})}));
      await search.fill('Paged');await expect(page.getByText('Verification failure · Retry',{exact:true})).toBeVisible();
      await page.unroute('**/api/tasks/my?**');await page.getByText('Verification failure · Retry',{exact:true}).click();await expect(page.getByText('125 matching tasks',{exact:true})).toBeVisible();
      let release, started;
      const held=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{started=resolve;});
      await page.route('**/api/tasks/my?**',async route=>{if(new URL(route.request().url()).searchParams.get('search')==='Paged 0'){started();await held;}await route.continue();});
      await search.fill('Paged 0');await seen;await search.fill('Paged 1');await expect(page.getByText('25 matching tasks',{exact:true})).toBeVisible();
      const late=page.waitForResponse(r=>r.url().includes('/tasks/my?')&&new URL(r.url()).searchParams.get('search')==='Paged 0');release();await late;
      await expect(page.getByText('25 matching tasks',{exact:true})).toBeVisible();await page.unroute('**/api/tasks/my?**');
      await page.screenshot({path:path.join(directory,'task-list.png'),fullPage:true});
    });
    await check('browser calendar multi-day tasks and weekly timeline above one page',async()=>{
      await back();await page.getByText('Calendar',{exact:true}).click();
      await expect(page.getByText('Task calendar',{exact:true})).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>window.taskVerificationState().calendarTasks.filter(t=>t.title.startsWith('Paged')).length)).toBe(125);
      assert.ok(await page.getByText('Paged 000',{exact:true}).count()>1,'Multi-day task repeats across month weeks');
      await page.screenshot({path:path.join(directory,'task-calendar.png'),fullPage:true});
      await back();await page.getByText('Timeline',{exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.taskVerificationState().timelineTasks.filter(t=>t.title.startsWith('Paged')).length)).toBe(125);
      assert.equal(await page.locator('svg path[d*="NaN"]').count(),0);
      await page.screenshot({path:path.join(directory,'task-timeline.png'),fullPage:true});
      const chart=page.locator('svg').filter({has:page.locator('text').filter({hasText:'Authorized task'})});
      assert.ok(Number(await chart.getAttribute('height'))<1600,'Timeline bitmap height must be bounded');
      for(let i=0;i<30;i++) {
        if(await page.getByText('Paged 124',{exact:true}).count())break;
        await page.mouse.move(600,700);await page.mouse.wheel(0,1200);await page.waitForTimeout(100);
      }
      await expect(page.getByText('Paged 124',{exact:true})).toBeVisible();
      await page.screenshot({path:path.join(directory,'task-timeline-last.png'),fullPage:true});
    });
    await check('browser detail checklist/estimate/time/history real backend',async()=>{
      await back();await searchBox().fill('Authorized task');
      await page.getByText('Authorized task',{exact:true}).filter({visible:true}).click();
      await expect(page.getByText('Checklists',{exact:true})).toBeVisible();
      await expect(page.getByText('Activity / History',{exact:true})).toBeVisible();
      await page.getByText('Add checklist',{exact:true}).click();await input('title').fill('Browser checklist');await page.getByText('Save',{exact:true}).click();
      await expect(page.getByText('Browser checklist · 0/0',{exact:true})).toBeVisible();
      await page.getByText('Add item',{exact:true}).click();await input('text').fill('Browser item');await page.getByText('Save',{exact:true}).click();
      await page.getByText('☐ Browser item',{exact:true}).click();await expect(page.getByText('Browser checklist · 1/1',{exact:true})).toBeVisible();
      assert.equal(await page.evaluate(()=>window.taskVerificationState().selectedTask.progress),42);
      await page.getByText('Edit estimate',{exact:true}).click();await input('estimatedMinutes').fill('120');await page.getByText('Save',{exact:true}).click();
      await page.getByText('Log time',{exact:true}).click();await input('minutes').fill('25');await input('note').fill('Browser fixture');await page.getByText('Save',{exact:true}).click();
      await expect(page.getByText('Estimate: 120 min · Actual: 25 min',{exact:true})).toBeVisible();
      await page.getByText('Edit tags',{exact:true}).click();await page.getByPlaceholder('Enter a tag').fill('browser');await page.getByText('Add tag',{exact:true}).click();await page.getByText('Save',{exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.taskVerificationState().selectedTask.tags.includes('browser'))).toBe(true);
      await page.getByText('Set parent',{exact:true}).click();await input('Search tasks').fill('Failure parent');await page.getByText('Failure parent · todo',{exact:true}).filter({visible:true}).click();
      await expect(page.getByText('Remove parent',{exact:true})).toBeVisible();await page.getByText('Remove parent',{exact:true}).click();await expect(page.getByText('Set parent',{exact:true})).toBeVisible();
      await page.getByText('Add dependency',{exact:true}).click();await input('Search tasks').fill('Client mutation');await page.getByText('Client mutation · todo',{exact:true}).filter({visible:true}).click();
      await expect(page.getByText('This task is blocked by unfinished or unavailable dependencies.',{exact:true})).toBeVisible();await page.getByText('Remove dependency',{exact:true}).click();
      await expect(page.getByText('No dependencies',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Add watcher',exact:true}).click();await page.getByPlaceholder('Search members...').fill('Verification employee');
      const memberDialog=page.getByPlaceholder('Search members...').locator('..').locator('..');
      await memberDialog.getByText('Verification employee',{exact:true}).click();await memberDialog.getByText('Confirm',{exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.taskVerificationState().selectedTask.watchers.length)).toBe(1);
      await page.screenshot({path:path.join(directory,'task-detail.png'),fullPage:true});
    });
    await check('browser expired session returns to sign-in and clears Task state',async()=>{
      await back();
      const expired=require('jsonwebtoken').sign({id:String(users.employee._id)},secret,{expiresIn:-1});
      await page.evaluate(token=>localStorage.setItem('authToken',token),expired);
      await searchBox().fill('Expire request');
      await expect(page.getByPlaceholder('My Email')).toBeVisible({timeout:10000});
      assert.equal(await page.evaluate(()=>window.taskVerificationState().myTasks.length),0);
    });
    await check('browser HR Kanban drag changes status through real API',async()=>{
      await page.getByPlaceholder('My Email').fill(users.hr.email);await page.getByPlaceholder('My Password').fill(password);await page.getByText('Sign In',{exact:true}).last().click();
      await expect(searchBox()).toBeVisible();await page.getByText('Board',{exact:true}).click();
      const card=page.getByText('Client mutation',{exact:true});await card.scrollIntoViewIfNeeded();
      const source=await card.boundingBox();const target=await page.getByText(/^In progress \(/).boundingBox();assert.ok(source&&target);
      await page.screenshot({path:path.join(directory,'task-board-before-drag.png'),fullPage:true});
      const changed=page.waitForResponse(r=>r.url().endsWith('/status')&&r.request().method()==='PUT',{timeout:10000}).catch(()=>null);
      await page.mouse.move(source.x+20,source.y+8);await page.mouse.down();await page.waitForTimeout(400);
      await page.mouse.move(source.x+25,source.y+13,{steps:3});await page.waitForTimeout(100);
      await page.mouse.move(target.x+80,Math.max(120,target.y+80),{steps:25});await page.waitForTimeout(150);await page.mouse.up();
      await page.screenshot({path:path.join(directory,'task-board-after-drag.png'),fullPage:true});
      const response=await changed;assert.ok(response,`No status request after drag from ${JSON.stringify(source)} to ${JSON.stringify(target)}`);assert.equal(response.status(),200);
      await expect.poll(()=>page.evaluate(()=>window.taskVerificationState().taskBoard.in_progress.some(t=>t.title==='Client mutation'))).toBe(true);
      await page.screenshot({path:path.join(directory,'task-board.png'),fullPage:true});
    });
    await check('browser has no uncaught render/runtime errors',()=>assert.deepEqual(errors,[]));
  } finally {await browser.close();await new Promise(resolve=>preview.close(resolve));}
};
