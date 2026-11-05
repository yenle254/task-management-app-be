// Native smoke test: own MongoDB/API/Metro, existing disposable emulator, real Expo Go APIs.
// No .env, production endpoints, remote pushes, native builds or dependency installation.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '../../project');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const serial = process.env.NATIVE_TEST_SERIAL;
if (!serial || !/^emulator-\d+$/.test(serial)) throw Error('Set NATIVE_TEST_SERIAL to the disposable emulator started for this task');
const directory = path.resolve(__dirname, '../coverage/native-notification-verification', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(path.join(directory, 'mongo'), { recursive: true });
const events = [], children = [];
const adb = args => execFileSync('adb', ['-s', serial, ...args], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
function start(command, args, options = {}) {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child); const log = fs.createWriteStream(path.join(directory, `process-${children.length}.log`));
  child.stdout.pipe(log); child.stderr.pipe(log); child.on('error', error => { events.push({ error: error.message }); }); return child;
}

function entrySource(base, imports) {
  return `import React, { useEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { AppState, Button, ScrollView, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import apiClient from '${imports}/src/services/api';
import socketService from '${imports}/src/services/socketService';
import * as manager from '${imports}/src/services/pushNotificationService';
import useNotificationStore from '${imports}/store/notificationStore';
import { notificationTarget } from '${imports}/src/utils/notificationTarget';
const base = ${JSON.stringify(base)};
apiClient.defaults.baseURL = base + '/api';
let prefs, userId, received = 0, tapped = false, running = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const post = (route, data = {}) => fetch(base + route, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const report = async (name, passed, details = {}) => { await post('/result', {name, status:passed?'PASS':'FAIL', details}); if(!passed) throw Error(name); };
function NativeFixture() {
 const [status,setStatus] = useState('Native notification fixture ready. Test account only.');
 useEffect(() => { post('/result',{name:'native-mounted',status:'INFO',details:{appState:AppState.currentState}}); return () => {manager.stopNotificationManager();socketService.socket?.disconnect();}; },[]);
 const run = async () => {
  if(running) return; running=true; setStatus('Preparing isolated test account…');
  try {
   const bootstrap = await (await fetch(base+'/bootstrap')).json(); userId=bootstrap.userId;
   await AsyncStorage.setItem('authToken',bootstrap.token);
   prefs=(await apiClient.get('/notifications/preferences')).data;
   const socket=io(base,{auth:{token:bootstrap.token},transports:['websocket'],reconnection:false});
   await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
   socketService.socket=socket; socketService.connected=true;
   manager.initNotificationManager(userId, async notification => {
    received++;useNotificationStore.getState().handleRealtimeNotification(notification);
    try {await manager.showForegroundNotification(notification,prefs);}catch(error){await post('/result',{name:'local-display',status:'FAIL',details:{message:error.message}});}
   },()=>prefs);
   manager.setTargetHandler(async()=>{
    if(tapped) return; tapped=true;
    try {
     const data=await manager.consumePendingTarget(userId);const target=notificationTarget(data,'employee');
     await report('native-local-tap-target',target?.screen==='MyLeaves',{screen:target?.screen});
     setStatus('Tap target consumed. Checking cleanup…');
     await manager.cleanupNotifications();useNotificationStore.getState().reset();socket.disconnect();
     await AsyncStorage.removeItem('authToken');
     const after=await Notifications.getPresentedNotificationsAsync();
     await report('native-cleanup-presented-and-store',after.length===0&&useNotificationStore.getState().notifications.length===0,{presented:after.length});
     setStatus('Native local checks passed. Remote push was not tested.');await post('/done');
    }catch(error){setStatus(error.message);await post('/result',{name:'tap-cleanup',status:'FAIL',details:{message:error.message}});await post('/done');}
   });
   await manager.registerPushToken(true);
   await report('native-notification-permission',await manager.permissionGranted());
   await Notifications.dismissAllNotificationsAsync();
   setStatus('Checking socket and local notification…');
   await post('/trigger');
   for(let i=0;i<40&&received===0;i++)await wait(100);
   await wait(1200);
   const shown=await Notifications.getPresentedNotificationsAsync();
   await report('native-socket-local-once',received===1&&shown.filter(n=>n.request.content.title==='Native fixture alert').length===1,{socketEvents:received,presented:shown.length});
   prefs=(await apiClient.put('/notifications/preferences',{categories:{leave:{inApp:false}}})).data;
   await post('/trigger');await wait(1200);
   await report('native-category-disabled-no-banner',received===1&&(await Notifications.getPresentedNotificationsAsync()).length===shown.length,{socketEvents:received});
   prefs=(await apiClient.put('/notifications/preferences',{categories:{leave:{inApp:true}}})).data;
   setStatus('Open notification shade and tap Native fixture alert to test tap routing and cleanup.');
   await post('/result',{name:'native-awaiting-notification-tap',status:'INFO'});
  }catch(error){setStatus('FAIL: '+error.message);await post('/result',{name:'native-run',status:'FAIL',details:{message:error.message}});await post('/done');}
 };
 return <ScrollView contentContainerStyle={{padding:24,paddingTop:60,gap:24}}><Text style={{fontSize:22}}>Isolated native notification test</Text><Text>{status}</Text><Button title="Run native checks" onPress={run}/><Text>Fixture only · No production data · No remote push</Text></ScrollView>;
}
registerRootComponent(NativeFixture);
`;
}

async function main() {
  process.env.NODE_ENV = 'test'; delete process.env.EXPO_ACCESS_TOKEN;
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  let server, io, metro, done = false, apiPort, metroPort;
  try {
    const dbPort = await freePort(); apiPort = await freePort(); metroPort = await freePort();
    start(process.env.NOTIFICATION_MONGOD || 'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe', ['--dbpath',path.join(directory,'mongo'),'--port',String(dbPort),'--bind_ip','127.0.0.1','--quiet']);
    await mongoose.connect(`mongodb://127.0.0.1:${dbPort}/native_notification_verification`, {serverSelectionTimeoutMS:15000});
    assert.equal(mongoose.connection.name,'native_notification_verification');
    const User=require('../models/user.model'), Notification=require('../models/notification.model');
    const user=await User.create({email:'native-fixture@notification.invalid',password:crypto.randomBytes(24).toString('hex'),role:'employee',profile:{fullName:'Native Fixture',employeeId:'native-fixture'}});
    const token=require('jsonwebtoken').sign({id:String(user._id)},process.env.JWT_SECRET,{expiresIn:'30m'});
    const app=require('express')();app.use(require('express').json());
    app.get('/bootstrap',(_req,res)=>res.json({userId:String(user._id),token}));
    app.use('/api/notifications',require('../routes/notification.routes'));
    const notifications=require('../services/notification.service');
    app.post('/trigger',async(_req,res)=>{await notifications.createNotification(user._id,'leave_starting','Native fixture alert','Tap this isolated test notification.');res.json({ok:true});});
    app.post('/result',(req,res)=>{events.push(req.body);fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(events,null,2));console.log(req.body.status,req.body.name,JSON.stringify(req.body.details||{}));res.json({ok:true});});
    app.post('/done',(_req,res)=>{done=true;res.json({ok:true});});
    server=http.createServer(app);io=new(require('socket.io').Server)(server);require('../utils/socket-handler.utils')(io);notifications.initDelivery(io);
    await new Promise(resolve=>server.listen(apiPort,'127.0.0.1',resolve));
    const appDir=path.join(directory,'app');fs.mkdirSync(appDir);
    fs.symlinkSync(path.join(project,'node_modules'),path.join(appDir,'node_modules'),'junction');
    fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'native-notification-fixture',version:'1.0.0',private:true,main:'index.js',dependencies:{expo:'~54.0.23',react:'19.1.0','react-native':'0.81.5'}},null,2));
    fs.writeFileSync(path.join(appDir,'app.json'),JSON.stringify({expo:{name:'Notification Native Fixture',slug:'notification-native-fixture',version:'1.0.0',sdkVersion:'54.0.0',newArchEnabled:true}},null,2));
    const relative=path.relative(appDir,project).replace(/\\/g,'/');
    fs.writeFileSync(path.join(appDir,'index.js'),entrySource(`http://127.0.0.1:${apiPort}`,relative.startsWith('.')?relative:'./'+relative));
    fs.writeFileSync(path.join(appDir,'metro.config.js'),`const {getDefaultConfig}=require('expo/metro-config');const config=getDefaultConfig(__dirname);config.watchFolders=[${JSON.stringify(project)}];config.resolver.nodeModulesPaths=[${JSON.stringify(path.join(project,'node_modules'))}];module.exports=config;`);
    metro=start(process.execPath,[path.join(project,'node_modules/expo/bin/cli'),'start','--offline','--port',String(metroPort)],{cwd:appDir,env:{...process.env,NODE_ENV:'development',CI:'1',EXPO_OFFLINE:'1'}});
    let ready=false;for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${metroPort}/status`)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,'Own Metro ready');
    adb(['reverse',`tcp:${apiPort}`,`tcp:${apiPort}`]);adb(['reverse',`tcp:${metroPort}`,`tcp:${metroPort}`]);
    adb(['shell','am','start','-a','android.intent.action.VIEW','-d',`exp://127.0.0.1:${metroPort}`,'host.exp.exponent']);
    fs.writeFileSync(path.join(directory,'runtime.json'),JSON.stringify({serial,apiPort,metroPort,metroPid:metro.pid},null,2));
    console.log('NATIVE_READY',directory);
    for(let i=0;i<1200&&!done;i++)await delay(500);
    if(!done){events.push({name:'native-completion',status:'FAIL',details:{message:'Timed out waiting for native UI'}});}
    if(done) {
      const latest=await User.findById(user._id).select('+pushToken');
      events.push({name:'fixture-unregister-and-persistence',status:!latest.pushToken&&(await Notification.countDocuments({userId:user._id}))===2?'PASS':'FAIL'});
    }
  } finally {
    if(io)await new Promise(resolve=>io.close(resolve));if(server?.listening)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();
    if(apiPort)try{adb(['reverse','--remove',`tcp:${apiPort}`]);}catch{}
    if(metroPort)try{adb(['reverse','--remove',`tcp:${metroPort}`]);}catch{}
    for(const child of children.reverse())if(child.exitCode===null){if(child===metro&&process.platform==='win32')try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});}catch{}else child.kill();}
    fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(events,null,2));
    console.log('Evidence:',directory);
  }
  if(events.some(event=>event.status==='FAIL'))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
