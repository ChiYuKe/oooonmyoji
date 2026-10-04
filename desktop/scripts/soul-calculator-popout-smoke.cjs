// Actual native popout, production Dockview/menus/calculator/optimizer and a saved inventory. No device writes.
const {app,BrowserWindow,ipcMain,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),project=path.dirname(root),out=path.join(project,'artifacts/soul-popout');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');app.commandLine.appendSwitch('no-sandbox');app.setPath('userData',path.join(out,'user-data'));
let server;
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const snapshot=await new(require('../dist-electron/main/soulService').SoulService)(project).load('mumu-1');assert.ok(snapshot);
  protocol.handle('onmyoji-resource',request=>{
    const relative=new URL(request.url).pathname.slice(1),file=require('../dist-electron/main/iconResources').iconResourcePath(project,relative);
    return file&&fs.existsSync(file)?new Response(fs.readFileSync(file),{headers:{'Content-Type':'image/png'}}):new Response('',{status:404});
  });
  const owner=event=>BrowserWindow.fromWebContents(event.sender);
  ipcMain.on('appearance:read',event=>{event.returnValue='dark';});
  const layouts=new Map([['onmyoji-studio.souls.instance','mumu-1']]);ipcMain.on('layout:read',(event,key)=>{event.returnValue=layouts.get(key)??null;});
  ipcMain.on('layout:write',(_event,key,value)=>layouts.set(key,value));
  ipcMain.handle('window:is-always-on-top',event=>owner(event).isAlwaysOnTop());
  ipcMain.handle('window:set-always-on-top',(event,flag)=>owner(event)?.setAlwaysOnTop(Boolean(flag)));
  ipcMain.handle('window:close',event=>owner(event).close());
  ipcMain.handle('window:minimize',event=>owner(event).minimize());
  ipcMain.handle('window:toggle-maximize',event=>{const win=owner(event);win.isMaximized()?win.unmaximize():win.maximize();});
  const main=fs.readFileSync(path.join(root,'src/renderer/main.ts'),'utf8');
  const handlers=main.slice(main.indexOf("  document.querySelectorAll<HTMLElement>('[data-app-command]')"),main.indexOf('  settings.bind();'));
  assert.ok(handlers.includes("popout('soulCalculator')"));
  const entry=`import {createWorkbenchFrame} from '../../desktop/src/renderer/docking';
import {createTitlebarMenus,installTitlebarMenuBar} from '../../desktop/src/renderer/titlebar-menus';
import {installSoulCalculator} from '../../desktop/src/renderer/soul-calculator';
import {installSoulOptimizer} from '../../desktop/src/renderer/soul-optimizer-view';
const stored=new Map([['onmyoji-studio.souls.instance','mumu-1']]);
const api={readLayout:k=>stored.get(k)??null,writeLayout:(k,v)=>stored.set(k,v),
listSoulInstances:async()=>[{id:'mumu-1',backend:'mumu',mumuIndex:1,online:false}],loadSouls:async()=>window.fixtureSnapshot,onSoulFetchProgress:()=>()=>{},fetchSouls:()=>{throw Error('No device writes')},cancelSoulFetch:async()=>{},isAlwaysOnTop:async()=>false};
window.frame=createWorkbenchFrame();const workbenchFrame=window.frame;
const optimizer=installSoulOptimizer(document.getElementById('module-soul-optimizer'),api,undefined,{open:()=>workbenchFrame.show('soulOptimizer')});
installSoulCalculator(document.getElementById('team-builder-soul-calculator'),api,optimizer);
const menus=createTitlebarMenus(()=>{});installTitlebarMenuBar(menus.close);const closeTitlebarMenus=menus.close;
${handlers}`;
  const entryFile=path.join(out,'entry.ts');fs.writeFileSync(entryFile,entry);
  const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
  await build({configFile:false,logLevel:'error',build:{lib:{entry:entryFile,name:'soulPopoutTest',formats:['iife'],fileName:()=> 'check.js'},outDir:path.join(out,'bundle'),emptyOutDir:true}});
  let html=fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/g,'');
  const css=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8').replace(/^@import[^;]*;/,'')+fs.readFileSync(path.join(root,'node_modules/dockview/dist/styles/dockview.css'),'utf8');
  html=html.replace('</head>',`<style>${css}</style></head>`).replace('</body>',`<script>window.fixtureSnapshot=${JSON.stringify(snapshot)};</script><script src="/check.js"></script></body>`);
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');let file;
    if(url.pathname==='/check.html'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(url.pathname==='/check.js')file=path.join(out,'bundle/check.js');
    else { file=path.resolve(root,'dist/renderer','.'+decodeURIComponent(url.pathname));if(!file.startsWith(path.join(root,'dist/renderer')+path.sep)){res.writeHead(403);res.end();return;} }
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[ext]||'application/octet-stream');res.end(fs.readFileSync(file));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const win=new BrowserWindow({show:false,width:1280,height:850,webPreferences:{preload:path.join(root,'dist-electron/preload/preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  let created=0;win.webContents.on('did-create-window',child=>{created++;});
  win.webContents.setWindowOpenHandler(({url})=>new URL(url).origin===base&&new URL(url).pathname==='/popout.html'?{action:'allow',overrideBrowserWindowOptions:{show:false,frame:false,width:new URL(url).searchParams.get('panel')==='soulCalculator'?1100:720,height:new URL(url).searchParams.get('panel')==='soulCalculator'?800:520,minWidth:320,minHeight:220,webPreferences:{preload:path.join(root,'dist-electron/preload/preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}}}:{action:'deny'});
  await win.loadURL(base+'/check.html');win.showInactive();
  const run=async source=>{const r=await win.webContents.executeJavaScript(`(async()=>{try{const assert={ok:(v,m)=>{if(!v)throw Error(m||'Assertion failed');},equal:(a,b,m)=>{if(a!==b)throw Error(m||('Expected '+a+' to equal '+b));}},wait=async test=>{const until=Date.now()+15000;while(!test()){if(Date.now()>until)throw Error('Condition timed out');await new Promise(r=>setTimeout(r,25));}};${source}}catch(e){return {error:e.stack||String(e)}}})()`);assert.ok(!r?.error,r?.error);return r;};
  await run(`await wait(()=>document.getElementById('soul-grid').dataset.total==='${snapshot.souls.length}');window.calc=document.getElementById('module-soul-calculator');document.querySelector('[data-app-command="soulCalculator"]').click();document.querySelector('[data-app-command="soulCalculator"]').click();await wait(()=>frame.dockviewApi.getPanel('soulCalculator').api.location.type==='popout');assert.ok(calc.ownerDocument!==document);assert.equal(document.querySelector('.dv-resize-container'),null);await wait(()=>calc.querySelectorAll('.soul-card').length>0);const input=calc.querySelector('#soul-search');input.value='针女';input.dispatchEvent(new Event('input',{bubbles:true}));assert.ok(Number(calc.querySelector('#soul-grid').dataset.total)>0);document.querySelector('[data-app-command="soulCalculator"]').click();return {ok:true};`);
  assert.equal(created,1,'rapid and repeated clicks reuse the native window');
  let child=BrowserWindow.getAllWindows().find(w=>w!==win);assert.ok(child);
  assert.ok(await child.webContents.executeJavaScript(`document.querySelector('#soul-search').value==='针女' && document.querySelectorAll('.soul-card').length>0`),'the native renderer contains the filtered inventory');
  await run(`
    const original=JSON.stringify(window.fixtureSnapshot);
    const soul=window.fixtureSnapshot.souls.find(s=>s.name==='针女' && s.subAttributes?.some(a=>a.name==='debuffEnhance') && s.subAttributes?.some(a=>a.name==='attackAdditionRate'||a.name==='attackAdditionVal'));
    assert.ok(soul,'real output soul with hit and attack substats');
    const input=calc.querySelector('#soul-search');
    assert.equal(calc.querySelector('#soul-substat-usage'),null,'no usage selector in native inventory');
    input.value=soul.id;input.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(()=>calc.querySelector('.soul-card'));calc.querySelector('.soul-card').click();
    assert.equal(calc.querySelector('.soul-sub-attribute[data-substat-status]'),null,'ordinary inventory attributes have no usage classification');
    assert.equal(calc.querySelector('#soul-detail .soul-substat-indicator'),null,'ordinary detail has no status icons');
    assert.equal(calc.querySelector('#soul-detail .soul-substat-summary'),null,'ordinary detail has no status counts');
    assert.ok(!calc.querySelector('#soul-detail').textContent.includes('套装默认用途'),'ordinary detail has no usage note');
    assert.equal(calc.querySelector('.soul-card').title,'','inventory cards have no usage tooltip');
    assert.ok(calc.querySelector('#soul-detail-window').matches(':popover-open'),'ordinary hover detail opens');
    assert.equal(JSON.stringify(window.fixtureSnapshot),original,'classification never changes cached gear');
    input.value='针女';input.dispatchEvent(new Event('input',{bubbles:true}));
    return {defaultUsage:true};
  `);
  await run(`calc.querySelector('#soul-optimize').click();await wait(()=>frame.dockviewApi.getPanel('soulOptimizer'));assert.equal(frame.dockviewApi.getPanel('soulOptimizer').group,frame.dockviewApi.getPanel('soulCalculator').group);assert.equal(frame.dockviewApi.getPanel('soulOptimizer').api.location.type,'popout');frame.show('soulCalculator');return {ok:true};`);
  child.showInactive();
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.ok(await child.webContents.executeJavaScript(`document.querySelector('.soul-card').getBoundingClientRect().height>0 && document.querySelector('#soul-search').getBoundingClientRect().width>0`),'filtered cards are visible in the native window');
  const screenshot=await child.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
  assert.ok(!screenshot.isEmpty(),'the native window renders a complete frame');
  fs.writeFileSync(path.join(out,'soul-calculator-window.png'),screenshot.toPNG());
  await child.webContents.executeJavaScript(`document.getElementById('popout-close').click()`);
  await run(`await wait(()=>frame.dockviewApi.getPanel('soulCalculator').api.location.type!=='popout');assert.equal(calc.querySelector('#soul-search').value,'针女');document.querySelector('[data-app-command="soulCalculator"]').click();await wait(()=>frame.dockviewApi.getPanel('soulCalculator').api.location.type==='popout');assert.equal(calc.querySelector('#soul-search').value,'针女');assert.equal(frame.dockviewApi.panels.filter(p=>p.id==='soulCalculator').length,1);return {ok:true};`);
  assert.equal(created,2);console.log(JSON.stringify({nativeWindow:true,rapidClicksReuse:true,closeAndReopen:true,preservedFilter:true,inventory:snapshot.souls.length,optimizerInSameWindow:true,defaultUsage:true,cacheUnchanged:true}));
  for(const w of BrowserWindow.getAllWindows())w.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);for(const w of BrowserWindow.getAllWindows())w.destroy();server?.close();app.exit(1);});
