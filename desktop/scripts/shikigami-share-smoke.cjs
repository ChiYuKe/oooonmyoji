const {app,BrowserWindow,protocol,net,ipcMain,dialog,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),project=path.dirname(root),out=path.join(project,'artifacts/soul-ui');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData',path.join(out,'share-user-data'));
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});
  protocol.handle('onmyoji-resource',request=>{
    const match=new URL(request.url).pathname.match(/^\/assets\/(hero|skill|soul)-icons\/(\d+)\.png$/);
    if(!match)return new Response('',{status:404});
    const file=path.join(project,'assets',match[1]+'-icons',match[2]+'.png');return fs.existsSync(file)?net.fetch(pathToFileURL(file).href):new Response('',{status:404});
  });
  const {ProjectService}=require('../dist-electron/main/projectService');
  const {copyPngToClipboard}=require('../dist-electron/main/clipboardImage');
  const assert=require('node:assert/strict');
  const service=new ProjectService(project);
  ipcMain.handle('smoke:artwork',(_,paths)=>{if(paths.length>64)throw Error('Too many assets');return service.readAssetData(paths);});
  let saveMode='save',saveRequest,copyMode='copy',copiedImage,copyCalls=0,copyMatches=false;
  // Exercise the native PNG clipboard payload without changing the user's clipboard.
  const copyWriter=async items=>{
    copyCalls++;
    assert.deepEqual(items[0].types,['image/png']);
    const png=await items[0].getType('image/png');
    copiedImage=nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer()));
    if(copyMode==='fail')throw Error('剪贴板暂时不可用');
    await new Promise(resolve=>setTimeout(resolve,50));
  };
  const empty=nativeImage.createEmpty();
  await assert.rejects(copyPngToClipboard('data:text/plain;base64,YQ==',copyWriter,nativeImage.createFromDataURL),/图片数据无效/);
  await assert.rejects(copyPngToClipboard('data:image/png;base64,YQ==',copyWriter,()=>empty),/图片无法读取/);
  await assert.rejects(copyPngToClipboard('data:image/png;base64,YQ==',copyWriter,()=>({isEmpty:()=>false,getSize:()=>({width:10000,height:10000})})),/尺寸过大/);
  assert.equal(copyCalls,0);
  const originalDialog=dialog.showSaveDialog;
  dialog.showSaveDialog=async (_,options)=>{
    if(options.title!=='保存式神图鉴分享图片'||options.buttonLabel!=='保存')throw Error('Wrong save dialog');
    return saveMode==='cancel'?{canceled:true}:{canceled:false,filePath:path.join(out,'shikigami-share-export.png')};
  };
  const css=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8').replace(/^@import[^;]*;/,'');
  const palette=['workbench-light.css','theme.css'].map(name=>fs.readFileSync(path.join(root,'public/theme',name),'utf8')).join('\n');
  const font=pathToFileURL(path.join(root,'public/fonts/harmonyos-sans-sc/Regular.css')).href;
  const file=path.join(out,'shikigami-share.html');
  const csp=fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  fs.writeFileSync(file,`<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8">${csp}<link rel="stylesheet" href="${font}"><style>${css}\n${palette}\n#atlas{height:100vh}</style><body><section id="atlas" class="shikigami-atlas"></section></body></html>`);
  const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
  ipcMain.handle('smoke:save',(_,request)=>{saveRequest=request;return service.saveCanvas(win,request);});
  ipcMain.handle('smoke:mode',(_,value)=>{saveMode=value;});
  ipcMain.handle('smoke:copy',async(_,dataUrl)=>{
    await copyPngToClipboard(dataUrl,copyWriter,nativeImage.createFromDataURL);
    copyMatches=copiedImage.toBitmap().equals(nativeImage.createFromDataURL(dataUrl).toBitmap());
  });
  ipcMain.handle('smoke:copy-mode',(_,value)=>{copyMode=value;});
  ipcMain.handle('smoke:copied',()=>({calls:copyCalls,samePixels:copyMatches,size:copiedImage?.getSize()}));
  await win.loadFile(file);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    try {
    const assert=require('node:assert/strict'),{ipcRenderer}=require('electron');
    const violations=[];document.addEventListener('securitypolicyviolation',event=>violations.push(event.effectiveDirective));
    const {installShikigamiAtlas}=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/shikigami-atlas.js'))});
    const {soulCatalog}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/soul-catalog-data.js'))});
    const actual=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(path.join(project,'artifacts/soul-research/hero-ownership-live.json'))},'utf8'));
    let current=actual;window.atlas=document.getElementById('atlas');window.el=name=>atlas.querySelector('[data-atlas="'+name+'"]');
    window.api={readLayout:()=>null,writeLayout:()=>{},listHeroInstances:async()=>[{id:'mumu-0',displayName:'吃鱼',online:false}],loadHeroOwnership:async()=>current,
      onHeroDetectionProgress:()=>()=>{},saveCanvas:request=>ipcRenderer.invoke('smoke:save',request),readAssetData:paths=>ipcRenderer.invoke('smoke:artwork',paths),copyImageToClipboard:dataUrl=>ipcRenderer.invoke('smoke:copy',dataUrl)};
    window.dispose=installShikigamiAtlas(atlas,api);for(let i=0;i<8;i++)await Promise.resolve();
    el('search').value='大天狗';el('search').dispatchEvent(new Event('input'));el('rarities').querySelector('[data-rarity="4"]').click();el('ownership-filter').value='owned';el('ownership-filter').dispatchEvent(new Event('change'));
    assert.equal(el('cards').querySelectorAll('button').length,1);
    window.popup=()=>document.querySelector('.shikigami-share:not(.shikigami-owned-share)');window.se=name=>popup().querySelector('[data-share="'+name+'"]');
    window.ready=async()=>{for(let i=0;i<250;i++){if(se('preview').querySelector('canvas'))return se('preview').querySelector('canvas');await new Promise(resolve=>setTimeout(resolve,20));}throw Error(se('status').textContent);};
    el('share').click();assert.ok(popup().open);let canvas=await ready();
    assert.equal(canvas.dataset.cardCount,'280');assert.equal(canvas.dataset.loadedPortraits,'280');assert.equal(canvas.width,2480);
    assert.ok(canvas.height>8000);assert.ok(se('preview').scrollHeight>se('preview').clientHeight);
    const bottom=canvas.getContext('2d').getImageData(100,canvas.height-100,1,1).data;assert.equal(bottom[3],255);
    const before=canvas.toDataURL('image/png');assert.ok(before.startsWith('data:image/png;base64,'));
    se('save').click();for(let i=0;i<100&&!se('status').textContent.includes('图片已保存');i++)await new Promise(resolve=>setTimeout(resolve,20));assert.match(se('status').textContent,/图片已保存/);
    const saved=require('node:fs').readFileSync(${JSON.stringify(path.join(out,'shikigami-share-export.png'))});assert.equal(saved.toString('base64'),before.split(',')[1]);
    se('copy').click();assert.equal(se('copy').disabled,true);se('copy').click();
    for(let i=0;i<100&&!se('status').textContent.includes('图片已复制');i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(se('status').textContent,/图片已复制/);assert.equal(se('copy').disabled,false);
    const copied=await ipcRenderer.invoke('smoke:copied');assert.equal(copied.calls,1);assert.deepEqual(copied.size,{width:canvas.width,height:canvas.height});
    assert.equal(copied.samePixels,true);
    await ipcRenderer.invoke('smoke:copy-mode','fail');se('copy').click();
    for(let i=0;i<100&&se('copy').disabled;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(se('status').textContent,/剪贴板暂时不可用/);assert.equal(se('copy').disabled,false);assert.equal(se('preview').querySelector('canvas'),canvas);
    await ipcRenderer.invoke('smoke:copy-mode','copy');
    assert.equal(violations.filter(v=>v==='connect-src'||v==='img-src').length,0);
    se('scope').value='owned';se('scope').dispatchEvent(new Event('change'));canvas=await ready();
    const owned=soulCatalog.heroes.filter(h=>actual.counts[h.id]).length;assert.equal(Number(canvas.dataset.cardCount),owned);
    se('columns').value='8';se('columns').dispatchEvent(new Event('change'));canvas=await ready();assert.equal(canvas.dataset.columns,'8');assert.equal(canvas.width,2000);
    await ipcRenderer.invoke('smoke:mode','cancel');se('save').click();for(let i=0;i<100&&!se('status').textContent.includes('已取消保存');i++)await new Promise(resolve=>setTimeout(resolve,20));assert.match(se('status').textContent,/已取消保存/);assert.equal(se('save').disabled,false);
    popup().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(popup().open,false);assert.equal(document.activeElement,el('share'));
    assert.equal(el('search').value,'大天狗');assert.equal(el('cards').querySelectorAll('button').length,1);assert.equal(el('ownership-filter').value,'owned');
    // Render unknown ownership without falsely labeling an empty warehouse.
    current=null;el('refresh').click();for(let i=0;i<8;i++)await Promise.resolve();el('share').click();canvas=await ready();assert.equal(canvas.dataset.cardCount,'280');assert.equal(se('scope').disabled,true);se('close').click();
    current=actual;el('refresh').click();for(let i=0;i<8;i++)await Promise.resolve();el('share').click();await ready();
    return {allCards:280,ownedCards:owned,loadedPortraits:280,strictCsp:true,fullImageClipboard:true,copyFailureRecovery:true,missingArtFallback:true,fullHeight:true,exactPng:true,offlineSharing:true,preservedFilters:true,columns:true,cancelSave:true,unknownOwnership:true,escapeFocus:true};
    } catch(error) {console.error(error.stack);throw error;}
  })()`);
  await new Promise(resolve=>setTimeout(resolve,100));fs.writeFileSync(path.join(out,'shikigami-share-dark.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`se('preview').scrollTop=se('preview').scrollHeight`);await new Promise(resolve=>setTimeout(resolve,100));
  fs.writeFileSync(path.join(out,'shikigami-share-bottom.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{se('close').click();document.documentElement.dataset.theme='light';el('share').click();await ready();})()`);await new Promise(resolve=>setTimeout(resolve,100));
  fs.writeFileSync(path.join(out,'shikigami-share-light.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(480,760);await new Promise(resolve=>setTimeout(resolve,150));
  const narrow=await win.webContents.executeJavaScript(`(()=>{const assert=require('node:assert/strict'),d=popup(),r=d.getBoundingClientRect();assert.ok(r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight);assert.ok(d.scrollWidth<=d.clientWidth);se('zoom').click();assert.ok(se('preview').scrollWidth>se('preview').clientWidth);assert.equal(se('preview').querySelector('canvas').getBoundingClientRect().width,1240);se('zoom').click();return {width:r.width,scroll:d.scrollWidth,originalSize:true};})()`);
  fs.writeFileSync(path.join(out,'shikigami-share-narrow.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`se('close').click();window.dispose();api.readAssetData=()=>new Promise(resolve=>{window.resolveArtwork=resolve;});window.dispose=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/shikigami-atlas.js'))}).installShikigamiAtlas(atlas,api);void 0;`);
  await win.webContents.executeJavaScript(`(async()=>{for(let i=0;i<8;i++)await Promise.resolve();el('share').click();await document.fonts.ready;await Promise.resolve();window.dispose();if(window.resolveArtwork)window.resolveArtwork([]);await Promise.resolve();require('node:assert/strict').equal(document.querySelector('.shikigami-share'),null);})()`);
  const size=nativeImage.createFromPath(path.join(out,'shikigami-share-export.png')).getSize();
  if(size.width!==2480||size.height<8000||saveRequest.purpose!=='share')throw Error('Wrong PNG output');
  dialog.showSaveDialog=originalDialog;console.log(JSON.stringify({...result,narrow,png:size,cleanup:true}));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
