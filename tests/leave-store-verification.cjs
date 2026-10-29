const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '../../project');
const frontendRequire = createRequire(path.join(project, 'package.json'));
const babel = frontendRequire('@babel/core');
function load(service, api) {
    const cache = new Map();
    function moduleAt(filename) {
        const absolute = path.resolve(project, filename);
        if (service && absolute === path.join(project, 'src/services/leaveService.js')) return { default: service, __esModule: true };
        if (absolute === path.join(project, 'src/services/api.js')) return { default: api, __esModule: true };
        if (cache.has(absolute)) return cache.get(absolute).exports;
        const mod = { exports: {} }; cache.set(absolute, mod);
        const code = babel.transformSync(fs.readFileSync(absolute,'utf8'), { filename:absolute,babelrc:false,configFile:false,
            plugins:[frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
        const localRequire = name => name.startsWith('.') ? moduleAt(path.resolve(path.dirname(absolute), name + '.js')) : frontendRequire(name);
        new Function('require','module','exports',code)(localRequire,mod,mod.exports); return mod.exports;
    }
    return service ? moduleAt('store/leaveStore.js').default : moduleAt('src/services/leaveService.js').default;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const defaults = extra => ({ getMyLeaves: async()=>({data:[]}), getPendingLeaves: async()=>({data:[]}),
    getLeaveBalance:async()=>({data:{balance:{total:12,used:12,remaining:0}}}), ...extra });
test('service sends revision on approve/reject/cancel, draft and edit contracts',async()=>{
    const calls=[]; const api=Object.fromEntries(['get','post','put','delete'].map(method=>[method,async(...args)=>{calls.push([method,...args]);return {success:true};}]));
    const service=load(null,api);
    await service.approveLeave('a',3);await service.rejectLeave('a','',4);await service.cancelLeave('a',5);
    await service.submitDraft('a',{revision:0});await service.editLeave('a',{revision:1,reason:'changed'});await service.getPendingLeaves({step:'team_lead'});
    assert.deepEqual(calls.slice(0,3),[['put','/leaves/a/approve',{revision:3}],['put','/leaves/a/reject',{rejectionReason:'',revision:4}],['delete','/leaves/a',{data:{revision:5}}]]);
    assert.deepEqual(calls[5],['get','/leaves/pending',{params:{step:'team_lead'}}]);
});
test('personal list consumes all pages and preserves zero remaining balance',async()=>{
    const pages=[];const store=load(defaults({getMyLeaves:async p=>{pages.push(p.page);return {page:p.page,pages:2,data:[{_id:String(p.page)}]};}}));
    await store.getState().fetchLeaves();await store.getState().fetchLeaveBalance();
    assert.deepEqual(pages,[1,2]);assert.equal(store.getState().leaves.length,2);assert.equal(store.getState().leaveBalance.remaining,0);
});
test('double mutation shares one request and cancellation remains in personal list',async()=>{
    const held=deferred();let calls=0;
    const store=load(defaults({cancelLeave:()=>{calls++;return held.promise;},getMyLeaves:async()=>({data:[{_id:'a',status:'cancelled'}]})}));
    store.setState({leaves:[{_id:'a',status:'approved'}]});
    const a=store.getState().cancelLeave('a',1),b=store.getState().cancelLeave('a',1);assert.equal(calls,1);
    held.resolve({data:{_id:'a',status:'cancelled'}});await Promise.all([a,b]);
    assert.equal(store.getState().leaves[0].status,'cancelled');assert.equal(store.getState().isMutating,false);
});
test('late list response cannot replace newer refresh',async()=>{
    const old=deferred(),fresh=deferred();let calls=0;const store=load(defaults({getMyLeaves:()=>++calls===1?old.promise:fresh.promise}));
    const a=store.getState().fetchLeaves(),b=store.getState().fetchLeaves();fresh.resolve({data:[{_id:'new'}]});await b;
    old.resolve({data:[{_id:'old'}]});await a;assert.equal(store.getState().leaves[0]._id,'new');
});
test('logout invalidates in-flight reads and mutations without restoring private data',async()=>{
    const held=deferred();const store=load(defaults({submitLeave:()=>held.promise}));
    const request=store.getState().submitLeave({draft:true});store.getState().reset();held.resolve({data:{_id:'old-session',status:'draft'}});await request;
    assert.deepEqual(store.getState().leaves,[]);assert.equal(store.getState().isMutating,false);
});
test('stale mutation refreshes both lists and exposes a retry error',async()=>{
    let refreshed=0;const store=load(defaults({approveLeave:async()=>{throw {error:'Leave changed; refresh before deciding'};},
        getMyLeaves:async()=>{refreshed++;return {data:[]};},getPendingLeaves:async()=>{refreshed++;return {data:[]};}}));
    await assert.rejects(store.getState().approveLeave('a',0));assert.equal(refreshed,2);assert.match(store.getState().error,/changed/);
});
