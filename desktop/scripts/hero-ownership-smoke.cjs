const { readExpandedHtml, readExpandedCss } = require('./renderer-templates.cjs');
// Offline DOM verification with the production atlas and a captured inventory.
const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),project=path.dirname(root),artifacts=path.join(project,'artifacts/soul-ui');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData',path.join(artifacts,'hero-ownership-user-data'));
app.whenReady().then(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});
  protocol.handle('onmyoji-resource',request=>{
    const match=new URL(request.url).pathname.match(/^\/assets\/(hero|skill)-icons\/(\d+)\.png$/);
    if(!match)return new Response('',{status:404});
    const file=path.join(project,'assets',match[1]+'-icons',match[2]+'.png');return fs.existsSync(file)?net.fetch(pathToFileURL(file).href):new Response('',{status:404});
  });
  const source=readExpandedHtml(path.join(root,'src/renderer/index.html'));
  const start=source.indexOf('<section id="module-onmyoji-team-builder"');
  const panel=source.slice(start,source.indexOf('<section id="module-variable-references"',start));
  const css=readExpandedCss(path.join(root,'src/renderer/styles/workbench.css')).replace(/^@import[^;]*;/,'');
  const palette=['workbench-light.css','theme.css'].map(name=>fs.readFileSync(path.join(root,'public/theme',name),'utf8')).join('\n');
  const file=path.join(artifacts,'hero-ownership.html');
  fs.writeFileSync(file,`<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><style>${css}\n${palette}\n#module-onmyoji-team-builder{height:100vh}</style><body>${panel}</body></html>`);
  const win=new BrowserWindow({show:false,width:1280,height:850,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true,backgroundThrottling:false}});
  await win.loadFile(file);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('node:assert/strict'),{installTeamBuilderPages}=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/shikigami-atlas.js'))});
    const {readHeroOwnership}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/hero-ownership.js'))});
    const actual=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(path.join(project,'artifacts/soul-research/hero-ownership-live.json'))},'utf8'));
    assert.ok(readHeroOwnership(actual,'mumu-0'));
    let progress,finish,failure,mode='success',cancelled=0,calls=0;
    const caches=new Map(),layout=new Map();
    window.live={id:'mumu-0',displayName:'扫地工 · MuMu 0',online:true};
    const api={
      readLayout:key=>layout.get(key)||null,writeLayout:(key,value)=>layout.set(key,value),
      listHeroInstances:async()=>[window.live,{id:'mumu-1',displayName:'MuMu 1',online:false}],
      loadHeroOwnership:async id=>caches.get(id)||null,
      detectHeroOwnership:id=>{calls++;return new Promise((resolve,reject)=>{finish=value=>{if(value&&readHeroOwnership(value,id))caches.set(id,value);resolve(value);};failure=reject;});},
      cancelHeroDetection:async()=>{cancelled++;finish(null);},
      onHeroDetectionProgress:listener=>{progress=listener;return()=>{progress=null;};},
    };
    window.disposeAtlas=installTeamBuilderPages(document.getElementById('module-onmyoji-team-builder'),api);
    document.querySelector('.team-builder-category').click();
    window.atlas=document.getElementById('team-builder-shikigami-atlas');window.el=name=>atlas.querySelector('[data-atlas="'+name+'"]');
    const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};await settle();
    assert.equal(el('instance').value,'mumu-0');assert.equal(el('detect').disabled,false);
    assert.equal(el('cards').querySelectorAll('.shikigami-atlas-card-ownership').length,280);
    assert.ok(Array.from(el('cards').querySelectorAll('.shikigami-atlas-card-ownership')).every(x=>x.textContent==='未检测'));
    assert.equal(el('ownership-filter').disabled,true);
    el('detect').click();assert.equal(el('instance').disabled,true);assert.equal(el('detect').disabled,true);
    progress({instanceId:'mumu-0',message:'正在读取式神仓库',completed:100,total:actual.total});assert.match(el('ownership-status').textContent,/100/);
    finish(actual);await settle();assert.equal(el('instance').disabled,false);assert.equal(el('ownership-filter').disabled,false);
    for(const card of el('cards').querySelectorAll('[data-hero-id]')) {
      const count=actual.counts[card.dataset.heroId]||0;
      assert.equal(card.querySelector('.shikigami-atlas-card-ownership').textContent,count?'已拥有 × '+count:'未拥有');
    }
    el('ownership-filter').value='owned';el('ownership-filter').dispatchEvent(new Event('change'));
    assert.ok(el('cards').children.length>0);assert.ok(Array.from(el('cards').querySelectorAll('[data-hero-id]')).every(x=>actual.counts[x.dataset.heroId]));
    el('ownership-filter').value='missing';el('ownership-filter').dispatchEvent(new Event('change'));
    assert.ok(Array.from(el('cards').querySelectorAll('[data-hero-id]')).every(x=>!actual.counts[x.dataset.heroId]));
    el('ownership-filter').value='all';el('ownership-filter').dispatchEvent(new Event('change'));
    const labels=()=>Array.from(el('cards').querySelectorAll('.shikigami-atlas-card-ownership'),x=>x.textContent);
    const old=labels();el('detect').click();failure(new Error('请先切到式神录'));await settle();assert.deepEqual(labels(),old);assert.match(el('ownership-status').textContent,/保留上次/);
    el('detect').click();el('cancel').click();await settle();assert.equal(cancelled,1);assert.deepEqual(labels(),old);assert.equal(el('cancel').hidden,true);
    el('detect').click();finish({...actual,instanceId:'mumu-1'});await settle();assert.deepEqual(labels(),old);assert.match(el('ownership-status').textContent,/与所选实例不一致/);
    el('instance').value='mumu-1';el('instance').dispatchEvent(new Event('change'));await settle();assert.equal(el('detect').disabled,true);
    assert.ok(labels().every(x=>x==='未检测'));assert.equal(el('ownership-filter').disabled,true);
    window.live.online=false;el('refresh').click();await settle();
    el('instance').value='mumu-0';el('instance').dispatchEvent(new Event('change'));await settle();assert.equal(el('detect').disabled,true);
    assert.deepEqual(labels(),old);assert.match(el('ownership-status').textContent,/历史数据（离线）/);
    assert.equal(calls,4);
    // A stale disk load cannot replace a newer scan or cross an instance change.
    window.disposeAtlas();api.loadHeroOwnership=id=>id==='mumu-0'?new Promise(resolve=>{window.stale=resolve;}):Promise.resolve(null);
    window.live.online=true;layout.set('hero-ownership.selected-instance','mumu-0');
    window.disposeAtlas=installTeamBuilderPages(document.getElementById('module-onmyoji-team-builder'),api);await settle();
    el('detect').click();finish(actual);await settle();window.stale(null);await settle();assert.match(el('cards').textContent,/已拥有/);
    api.loadHeroOwnership=async id=>caches.get(id)||null;
    el('rarities').querySelector('[data-rarity="4"]').click();el('cards').querySelector('[data-hero-id="217"]').click();
    assert.match(el('detail').textContent,/已拥有/);assert.match(el('detail').textContent,/风袭/);
    return {liveTotal:actual.total,liveTypes:Object.keys(actual.counts).length,unknownBeforeScan:true,ownedCounts:true,ownershipFilters:true,instanceIsolation:true,offlineCache:true,failedScanPreserved:true,cancellation:true,staleCacheGuard:true,skillsPreserved:true};
  })()`);
  await new Promise(resolve=>setTimeout(resolve,200));
  fs.writeFileSync(path.join(artifacts,'hero-ownership-dark.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);await new Promise(resolve=>setTimeout(resolve,100));
  fs.writeFileSync(path.join(artifacts,'hero-ownership-light.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(480,760);await new Promise(resolve=>setTimeout(resolve,150));
  const narrow=await win.webContents.executeJavaScript(`(()=>{const r=atlas.getBoundingClientRect();require('node:assert/strict').ok(atlas.scrollWidth<=atlas.clientWidth);return {width:r.width,scroll:atlas.scrollWidth};})()`);
  fs.writeFileSync(path.join(artifacts,'hero-ownership-narrow.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`window.disposeAtlas()`);console.log(JSON.stringify({...result,narrow}));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
