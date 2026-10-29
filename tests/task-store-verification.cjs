const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./frontend-task-client.cjs');
const deferred = () => { let resolve, reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };
test('list late response cannot replace a newer filter/page',async()=>{
  const old=deferred(),fresh=deferred();let count=0;
  const {store}=load('', '', {getMyTasks:()=>++count===1?old.promise:fresh.promise});
  const a=store.getState().fetchTaskPage('my',{search:'old'}),b=store.getState().fetchTaskPage('my',{search:'new'});
  fresh.resolve({data:[{_id:'new'}],page:1,pages:1,total:1});await b;
  old.resolve({data:[{_id:'old'}],page:1,pages:1,total:1});await a;
  assert.equal(store.getState().myTasks[0]._id,'new');
});
test('detail late response cannot replace the newly opened task',async()=>{
  const old=deferred(),fresh=deferred();
  const {store}=load('', '', {getTaskById:id=>id==='old'?old.promise:fresh.promise});
  const a=store.getState().fetchTaskById('old'),b=store.getState().fetchTaskById('new');
  fresh.resolve({data:{_id:'new'}});await b;old.resolve({data:{_id:'old'}});await a;
  assert.equal(store.getState().selectedTask._id,'new');
});
test('stale view error cannot overwrite a successful newer request',async()=>{
  const old=deferred(),fresh=deferred();let count=0;
  const {store}=load('', '', {getCalendar:()=>++count===1?old.promise:fresh.promise});
  const a=store.getState().getCalendar({}).catch(()=>{}),b=store.getState().getCalendar({});
  fresh.resolve({data:[{_id:'new'}]});await b;old.reject({error:'Old error'});await a;
  assert.equal(store.getState().error,null);
});
test('reset during an in-flight view request does not restore the old session data',async()=>{
  const pending=deferred();const {store}=load('', '', {getCalendar:()=>pending.promise});
  const request=store.getState().getCalendar({});store.getState().reset();pending.resolve({data:[{_id:'private-old-session'}]});await request;
  assert.deepEqual(store.getState().calendarTasks,[]);
});
