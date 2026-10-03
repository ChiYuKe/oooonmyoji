// Offline history uses real captured backpacks, without launching/contacting MuMu.
const {app,BrowserWindow,protocol,net,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const desktop=path.resolve(__dirname,'..'),project=path.dirname(desktop),artifacts=path.join(project,'artifacts/soul-ui');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');app.setPath('userData',path.join(artifacts,'history-user-data'));
app.whenReady().then(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});
  const {SoulService}=require(path.join(desktop,'dist-electron/main/soulService.js'));
  const fixture=fs.mkdtempSync(path.join(artifacts,'history-fixture-')),sourceService=new SoulService(project);
  const service=new SoulService(fixture);
  fs.mkdirSync(path.join(fixture,'assets/soul-icons'),{recursive:true});
  for(const name of fs.readdirSync(path.join(project,'assets/soul-icons')).filter(name=>name.endsWith('.png')))fs.copyFileSync(path.join(project,'assets/soul-icons',name),path.join(fixture,'assets/soul-icons',name));
  for(const id of ['mumu-0','mumu-1']){
    const snapshot=await sourceService.load(id);if(!snapshot)throw Error('Missing local fixture '+id);
    const file=service.snapshotPath(id);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(snapshot));
  }
  let live=[{id:'mumu-0',displayName:'扫地工',backend:'mumu',mumuIndex:0}];
  ipcMain.handle('history:list',()=>service.listInstances(live));ipcMain.handle('history:load',(_event,id)=>service.load(id));
  ipcMain.handle('history:connection',(_event,online)=>{live=online?[{id:'mumu-0',displayName:'扫地工',backend:'mumu',mumuIndex:0}]:[];});
  protocol.handle('onmyoji-resource',request=>{
    const match=new URL(request.url).pathname.match(/^\/assets\/(soul|hero)-icons\/(\d+)\.png$/);if(!match)return new Response('',{status:404});
    const file=path.join(project,'assets',match[1]+'-icons',match[2]+'.png');return fs.existsSync(file)?net.fetch(pathToFileURL(file).href):new Response('',{status:404});
  });
  const source=fs.readFileSync(path.join(desktop,'src/renderer/index.html'),'utf8'),panel=source.match(/<div id="team-builder-soul-calculator"[\s\S]*?\n            <\/div>/)[0];
  const css=fs.readFileSync(path.join(desktop,'src/renderer/styles.css'),'utf8').replace(/^@import[^;]*;/,'');
  const palette=['workbench-light.css','theme.css'].map(name=>fs.readFileSync(path.join(desktop,'public/theme',name),'utf8')).join('\n');
  const file=path.join(artifacts,'soul-history.html');fs.writeFileSync(file,`<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><style>${css}\n${palette}</style><body><section class="team-builder-content" style="height:100vh"><header class="team-builder-pane-header">御魂计算</header>${panel}</section></body></html>`);
  const win=new BrowserWindow({show:false,width:1280,height:850,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});await win.loadFile(file);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    try {
    const assert=require('node:assert/strict'),{ipcRenderer}=require('electron');
    const {installSoulCalculator}=require(${JSON.stringify(path.join(desktop,'dist-test-renderer/renderer/soul-calculator.js'))});
    const root=document.getElementById('team-builder-soul-calculator'),markup=root.innerHTML,el=id=>document.getElementById('soul-'+id);
    const layout=new Map([['onmyoji-studio.souls.instance','mumu-1']]);let calls=0;
    const api={listSoulInstances:()=>ipcRenderer.invoke('history:list'),loadSouls:id=>ipcRenderer.invoke('history:load',id),
      readLayout:key=>layout.get(key)||null,writeLayout:(key,value)=>layout.set(key,value),onSoulFetchProgress:()=>()=>{},cancelSoulFetch:async()=>{},fetchSouls:async()=>{calls++;throw Error('Offline test must not acquire');}};
    const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('History view did not settle');};
    window.disposeHistory=installSoulCalculator(root,api);
    await until(()=>Number(el('grid').dataset.total)>0);
    assert.equal(el('instance').options.length,3);assert.match(el('instance').options[1].textContent,/在线/);assert.match(el('instance').options[2].textContent,/历史/);
    assert.equal(el('instance').value,'mumu-1');assert.equal(el('fetch').disabled,true);assert.match(el('summary').textContent,/历史实例 · 离线/);
    assert.match(el('status').textContent,/离线查看和计算配装/);assert.equal(el('optimize').disabled,false);
    const offlineCount=Number(el('grid').dataset.total);el('optimize').click();assert.equal(document.getElementById('soul-optimizer').open,true);document.getElementById('soul-optimizer').close();
    el('search').value='针女';el('search').dispatchEvent(new Event('input'));assert.ok(Number(el('grid').dataset.total)>0);el('search').value='';el('search').dispatchEvent(new Event('input'));
    await ipcRenderer.invoke('history:connection',false);el('refresh').click();await until(()=>!el('refresh').disabled);
    assert.equal(el('instance').value,'mumu-1');assert.equal(Number(el('grid').dataset.total),offlineCount);
    assert.ok(Array.from(el('instance').options).slice(1).every(option=>option.textContent.includes('历史')));
    // Reopen with every emulator closed: discover caches from disk rather than renderer memory.
    window.disposeHistory();root.innerHTML=markup;window.disposeHistory=installSoulCalculator(root,api);
    await until(()=>Number(el('grid').dataset.total)>0);assert.equal(el('instance').value,'mumu-1');assert.equal(el('fetch').disabled,true);
    assert.equal(Number(el('grid').dataset.total),offlineCount);assert.equal(el('instance').options.length,3);
    await ipcRenderer.invoke('history:connection',true);el('refresh').click();await until(()=>!el('refresh').disabled);
    assert.equal(el('instance').options.length,3);el('instance').value='mumu-0';el('instance').dispatchEvent(new Event('change'));
    await until(()=>el('summary').textContent.includes('扫地工'));assert.equal(el('fetch').disabled,false);assert.match(el('instance').selectedOptions[0].textContent,/在线/);
    await ipcRenderer.invoke('history:connection',false);el('refresh').click();await until(()=>!el('refresh').disabled);
    assert.equal(el('instance').value,'mumu-0');assert.equal(el('fetch').disabled,true);assert.equal(calls,0);assert.equal(el('optimize').disabled,false);
    return {oneClosed:true,allClosedOnReopen:true,offlineFiltering:true,offlineOptimizer:true,selectionPreserved:true,reconnectDeduplicated:true,offlineFetchBlocked:true};
    }catch(error){console.error(error.stack);throw error;}
  })()`);
  await new Promise(resolve=>setTimeout(resolve,150));fs.writeFileSync(path.join(artifacts,'soul-history-offline.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(result));await win.webContents.executeJavaScript('window.disposeHistory()');win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
