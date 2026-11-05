// Opt-in native acceptance runner. Real transport, dedicated loopback MongoDB and two fixture accounts.
// Reads ONLY EXPO_ACCESS_TOKEN from the local .env; never imports production server/env/database.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const root = path.resolve(__dirname, '..'), project = path.resolve(root, '../project');
const adbPath = 'C:\\Program Files (x86)\\Android\\android-sdk\\platform-tools\\adb.exe';
const serial = process.env.NATIVE_TEST_SERIAL;
assert.ok(serial, 'Explicit test device required');
const expectedProject = 'd3d53646-5766-4186-93bb-618d05d1c5a4';
const packageName = 'com.anonymous.project';
const directory = path.join(root, 'coverage/remote-native-verification', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(directory, { recursive: true });
const events = [], children = [], tickets = [], queue = [];
const nonce = crypto.randomUUID();
let done = false, lastCommand = '', server, io, apiPort, metroPort, User, Notification, users, activeTitle;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => { const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
const adb = args => execFileSync(adbPath, ['-s', serial, ...args], { encoding:'utf8', windowsHide:true, timeout:20000 });
const record = (name, status, details={}) => { const event={at:new Date().toISOString(),name,status,details};events.push(event);fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(events,null,2));console.log(name,status,JSON.stringify(details)); };
function start(command,args,options={}) { const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});children.push(child);const log=fs.createWriteStream(path.join(directory,`process-${children.length}.log`));child.stdout.pipe(log);child.stderr.pipe(log);child.on('error',()=>record('child-process','FAIL'));return child; }
async function snapshot() {
  const result={};
  for(const [alias,user] of Object.entries(users)) {const doc=await User.findById(user._id).select('+pushToken').lean();result[alias]={tokenPresent:Boolean(doc.pushToken),online:require('../utils/socket-handler.utils').isUserOnline(user._id),notifications:await Notification.countDocuments({userId:user._id})};}
  record('server-state','INFO',result);
}
async function command(value) {
  if(value.kind==='client'){queue.push(value);return;}
  if(value.kind==='snapshot')return snapshot();
  if(value.kind==='finish'){done=true;return;}
  if(value.kind==='trigger') {
    assert.ok(users[value.account], 'Fixture recipient only');
    assert.match(value.label,/^[a-z0-9-]{1,60}$/);
    activeTitle=`Fixture ${value.label}`;
    await require('../services/notification.service').createNotification(users[value.account]._id,'leave_starting',activeTitle,'Isolated notification acceptance test.');
    record(value.label,'TRIGGERED',{account:value.account});return;
  }
  if(value.kind==='receipts') {
    const ids=tickets.map(t=>t.id).filter(Boolean);
    if(!ids.length){record('expo-receipts','INFO',{count:0});return;}
    const response=await require('axios').post('https://exp.host/--/api/v2/push/getReceipts',{ids},{timeout:15000,headers:{Authorization:`Bearer ${process.env.EXPO_ACCESS_TOKEN}`}});
    record('expo-receipts','OBSERVED',{receipts:Object.values(response.data.data||{}).map(r=>({status:r.status,error:r.details?.error}))});return;
  }
  throw Error('Unknown fixture command');
}
function entry(base) {
return `import React,{useEffect,useRef,useState} from 'react';
import {registerRootComponent} from 'expo';
import {AppState,View,Text} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import {AuthProvider,useAuth} from '${project.replace(/\\/g,'/')}/src/contexts/authContext';
import RootNavigator from '${project.replace(/\\/g,'/')}/src/navigations/rootNavigator';
import * as manager from '${project.replace(/\\/g,'/')}/src/services/pushNotificationService';
import socketService from '${project.replace(/\\/g,'/')}/src/services/socketService';
import store from '${project.replace(/\\/g,'/')}/store/notificationStore';
const base=${JSON.stringify(base)},nonce=${JSON.stringify(nonce)};
const call=async(route,body)=>{const r=await fetch(base+'/fixture/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-fixture-key':nonce},body:body?JSON.stringify(body):undefined});return r.json();};
const event=(name,details={})=>call('event',{name,status:'OBSERVED',details});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function Probe(){const auth=useAuth(),ref=useRef(auth);ref.current=auth;
 useEffect(()=>{event('runtime',{projectId:Constants.expoConfig?.extra?.eas?.projectId,appOwnership:Constants.appOwnership,applicationId:Constants.expoConfig?.android?.package});
 const received=Notifications.addNotificationReceivedListener(n=>event('native-received',{title:n.request.content.title,trigger:n.request.trigger?.type,appState:AppState.currentState}));
 const response=Notifications.addNotificationResponseReceivedListener(r=>event('native-tapped',{title:r.notification.request.content.title,appState:AppState.currentState}));
 const state=AppState.addEventListener('change',s=>event('app-state',{state:s}));
 Notifications.getLastNotificationResponseAsync().then(r=>{if(r)event('last-native-response',{title:r.notification.request.content.title});});
 let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{const cmd=await call('command');if(!cmd.action)return;
  if(cmd.action==='login'){const b=await call('bootstrap');const u=b[cmd.account];await AsyncStorage.setItem('hasSeenOnboarding','true');const r=await ref.current.signIn(u.email,u.password);await event('login-result',{account:cmd.account,success:r.success});}
  else if(cmd.action==='logout'){await ref.current.signOut();await pause(300);await event('logout-result',{tokenPresent:Boolean(await AsyncStorage.getItem('authToken')),storedUserPresent:Boolean(await AsyncStorage.getItem('user')),storeCount:store.getState().notifications.length,presented:(await Notifications.getPresentedNotificationsAsync()).filter(n=>n.request.content.title?.startsWith('Fixture ')).length});}
  else if(cmd.action==='register'){const ok=await manager.registerPushToken(true);await event('registration-result',{registered:ok,permission:await manager.permissionGranted()});}
  else if(cmd.action==='disconnect'){socketService.disconnect();await event('socket-disconnected');}
  else if(cmd.action==='reconnect'){await socketService.connect();await event('socket-reconnected');}
  else if(cmd.action==='clear'){await Notifications.dismissAllNotificationsAsync();await Notifications.clearLastNotificationResponseAsync();await event('notifications-cleared');}
  else if(cmd.action==='state'){await event('client-state',{authenticated:ref.current.isAuthenticated,email:ref.current.user?.email,appState:AppState.currentState,storeCount:store.getState().notifications.length,pendingTargetPresent:Boolean(await AsyncStorage.getItem('pendingNotificationTarget')),presented:(await Notifications.getPresentedNotificationsAsync()).filter(n=>n.request.content.title?.startsWith('Fixture ')).map(n=>({title:n.request.content.title,trigger:n.request.trigger?.type}))});}
  await event('command-complete',{id:cmd.id,action:cmd.action});
 }catch(e){await event('command-error',{name:e?.name,message:typeof e?.message==='string'?e.message.slice(0,120):'request failed'});}finally{busy=false;}},750);
 return()=>{clearInterval(timer);received.remove();response.remove();state.remove();};},[]);
 return <View pointerEvents="none" style={{position:'absolute',top:0,left:0,right:0,backgroundColor:'#eee',padding:3}}><Text style={{fontSize:10}}>FIXTURE ONLY · {auth.user?.email||'signed out'}</Text></View>;
}
function FixtureApp(){const [ready,setReady]=useState(false),[blocked,setBlocked]=useState(false);
 useEffect(()=>{(async()=>{const raw=await AsyncStorage.getItem('user');if(raw&&!JSON.parse(raw).email?.endsWith('@notification.invalid')){setBlocked(true);await event('foreign-session-blocked');return;}
 const previous=await AsyncStorage.getItem('notification-fixture-run');if(previous!==nonce){await AsyncStorage.multiRemove(['authToken','user','pendingNotificationTarget']);await AsyncStorage.setItem('notification-fixture-run',nonce);}setReady(true);})();},[]);
 if(!ready)return <Text>{blocked?'STOP: non-fixture account stored':'Preparing isolated fixture'}</Text>;
 return <GestureHandlerRootView style={{flex:1}}><AuthProvider><RootNavigator/><Probe/></AuthProvider></GestureHandlerRootView>;
}
registerRootComponent(FixtureApp);`;
}
async function main(){
 process.env.NODE_ENV='test';process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
 const secret=require('dotenv').parse(fs.readFileSync(path.join(root,'.env'))).EXPO_ACCESS_TOKEN;
 assert.ok(secret,'EXPO_ACCESS_TOKEN required');process.env.EXPO_ACCESS_TOKEN=secret;
 const config=JSON.parse(fs.readFileSync(path.join(project,'app.json'))).expo;
 assert.equal(config.extra.eas.projectId,expectedProject);assert.equal(config.android.package,packageName);
 assert.match(adb(['shell','pm','path',packageName]),/base.apk/);
 let metro;
 try {
  const dbPort=await port();apiPort=await port();metroPort=await port();fs.mkdirSync(path.join(directory,'mongo'));
  start('C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',['--dbpath',path.join(directory,'mongo'),'--port',String(dbPort),'--bind_ip','127.0.0.1','--quiet']);
  await mongoose.connect(`mongodb://127.0.0.1:${dbPort}/remote_notification_fixture`,{serverSelectionTimeoutMS:15000});assert.equal(mongoose.connection.name,'remote_notification_fixture');
  User=require('../models/user.model');Notification=require('../models/notification.model');users={};const credentials={};
  for(const alias of ['A','B']){const password=crypto.randomBytes(24).toString('hex');const email=`remote-fixture-${alias.toLowerCase()}@notification.invalid`;users[alias]=await User.create({email,password:await require('bcryptjs').hash(password,10),role:'employee',profile:{fullName:`Remote Fixture ${alias}`,employeeId:`remote-${alias}`}});credentials[alias]={email,password};}
  // Observe real Expo transport, refusing any non-fixture recipient. Never log bearer/device tokens.
  const axios=require('axios');axios.interceptors.request.use(async request=>{
    if(request.url==='https://exp.host/--/api/v2/push/send'){const payload=typeof request.data==='string'?JSON.parse(request.data):request.data;const u=await User.findOne({_id:{$in:Object.values(users).map(u=>u._id)},pushToken:payload.to}).select('+pushToken');assert.ok(u,'Only registered fixture tokens may receive pushes');assert.ok(payload.title.startsWith('Fixture '));request.fixtureTitle=payload.title;record('expo-send','OBSERVED',{title:payload.title,account:u.email.endsWith('-a@notification.invalid')?'A':'B'});}
    return request;
  });axios.interceptors.response.use(response=>{if(response.config.url.endsWith('/push/send')){const ticket=response.data.data;tickets.push({id:ticket.id,title:response.config.fixtureTitle});record('expo-ticket','OBSERVED',{title:response.config.fixtureTitle,status:ticket.status,error:ticket.details?.error});}return response;});
  const app=require('express')();app.use(require('express').json());
  app.use('/fixture',(req,res,next)=>req.headers['x-fixture-key']===nonce?next():res.sendStatus(403));
  app.get('/fixture/bootstrap',(_q,res)=>res.json(credentials));
  app.get('/fixture/command',(_q,res)=>res.json(queue.shift()||{}));
  app.post('/fixture/event',(req,res)=>{record(req.body.name,req.body.status,req.body.details);res.json({ok:true});});
  app.use('/api/auth',(req,res,next)=>['/login','/me'].includes(req.path)?next():res.sendStatus(403),require('../routes/auth.routes'));
  app.use('/api/notifications',require('../routes/notification.routes'));
  for(const [route,module] of [['leaves','leave'],['tasks','task'],['employees','employee'],['teams','team'],['attendance','attendance'],['offices','office'],['users','user'],['messages','message'],['statistics','statistics']])app.use('/api/'+route,(req,res,next)=>req.method==='GET'?next():res.sendStatus(403),require('../routes/'+module+'.routes'));
  server=http.createServer(app);io=new(require('socket.io').Server)(server);require('../utils/socket-handler.utils')(io);require('../services/notification.service').initDelivery(io);
  await new Promise(resolve=>server.listen(apiPort,'127.0.0.1',resolve));
  const appDir=path.join(directory,'app');fs.mkdirSync(appDir);fs.symlinkSync(path.join(project,'node_modules'),path.join(appDir,'node_modules'),'junction');
  fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'project',private:true,version:'1.0.0',main:'index.js',dependencies:{expo:'~54.0.23',react:'19.1.0','react-native':'0.81.5','expo-dev-client':'*'}}));
  fs.writeFileSync(path.join(appDir,'app.json'),JSON.stringify({expo:{name:'project',slug:'project',scheme:'project',owner:'yenle25404',version:'1.0.0',sdkVersion:'54.0.0',newArchEnabled:true,android:{package:packageName},extra:{eas:{projectId:expectedProject}}}}));
  const base=`http://127.0.0.1:${apiPort}`;
  fs.writeFileSync(path.join(appDir,'index.js'),entry(base));
  fs.writeFileSync(path.join(appDir,'tsconfig.json'),JSON.stringify({extends:'expo/tsconfig.base',compilerOptions:{paths:{'@/*':[project.replace(/\\/g,'/')+'/*']}}}));
  fs.writeFileSync(path.join(appDir,'fixture-api.js'),`export const API_URL=${JSON.stringify(base+'/api')};export const API_CONFIG={BASE_URL:API_URL,TIMEOUT:30000};export default API_CONFIG;`);
  fs.writeFileSync(path.join(appDir,'metro.config.js'),`const {getDefaultConfig}=require('expo/metro-config');const path=require('path');const c=getDefaultConfig(__dirname);c.watchFolders=[${JSON.stringify(project)}];c.resolver.nodeModulesPaths=[${JSON.stringify(path.join(project,'node_modules'))}];c.transformer.babelTransformerPath=require.resolve('react-native-svg-transformer');c.resolver.assetExts=c.resolver.assetExts.filter(x=>x!=='svg');c.resolver.sourceExts.push('svg');c.resolver.resolveRequest=(ctx,name,platform)=>{const r=ctx.resolveRequest(ctx,name,platform);if(r.filePath&&r.filePath.replace(/\\\\/g,'/').endsWith('/src/config/api.config.js'))return {type:'sourceFile',filePath:path.join(__dirname,'fixture-api.js')};return r;};module.exports=c;`);
  const metroFile=path.join(appDir,'metro.config.js');
  fs.writeFileSync(metroFile,fs.readFileSync(metroFile,'utf8').replace('const r=ctx.resolveRequest(ctx,name,platform);',`if(name.startsWith('@/'))name=${JSON.stringify(project.replace(/\\/g,'/')+'/')}+name.slice(2);const r=ctx.resolveRequest(ctx,name,platform);`));
  const metroEnv={...process.env,NODE_ENV:'development',CI:'1',EXPO_OFFLINE:'1'};delete metroEnv.EXPO_ACCESS_TOKEN;delete metroEnv.GOOGLE_APPLICATION_CREDENTIALS;
  metro=start(process.execPath,[path.join(project,'node_modules/expo/bin/cli'),'start','--dev-client','--offline','--port',String(metroPort)],{cwd:appDir,env:metroEnv});
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${metroPort}/status`)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready);
  adb(['reverse',`tcp:${apiPort}`,`tcp:${apiPort}`]);adb(['reverse',`tcp:${metroPort}`,`tcp:${metroPort}`]);
  const launchUrl=`exp+project://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:'+metroPort)}`;
  fs.writeFileSync(path.join(directory,'runtime.json'),JSON.stringify({serial,apiPort,metroPort,launchUrl,packageName},null,2));
  record('preflight','PASS',{projectId:expectedProject,packageName,accessTokenPresent:true,serial});
  console.log('FIXTURE_READY',directory);
  adb(['shell','am','start','-a','android.intent.action.VIEW','-d',launchUrl,packageName]);
  for(let i=0;i<3600&&!done;i++){
    const file=path.join(directory,'command.json');if(fs.existsSync(file)){const raw=fs.readFileSync(file,'utf8');if(raw!==lastCommand){lastCommand=raw;try{await command(JSON.parse(raw));}catch(e){record('command-runner','FAIL',{name:e.name});}}}
    await delay(500);
  }
 } finally {
  if(users)await User.updateMany({_id:{$in:Object.values(users).map(u=>u._id)}},{$unset:{pushToken:''}}).catch(()=>{});
  if(io)await new Promise(resolve=>io.close(resolve));if(server?.listening)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();
  for(const p of [apiPort,metroPort])if(p)try{adb(['reverse','--remove',`tcp:${p}`]);}catch{}
  for(const child of children.reverse())if(child.exitCode===null){if(child===metro)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});}catch{}else child.kill();}
  fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(events,null,2));
  console.log('Evidence:',directory);
 }
}
main().catch(error=>{record('runner','FAIL',{name:error.name,message:error.code||'see isolated process log'});process.exitCode=1;});
