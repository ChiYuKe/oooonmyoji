const { readExpandedHtml, readExpandedCss } = require('./renderer-templates.cjs');
const {app,BrowserWindow,protocol,net,ipcMain,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),project=path.dirname(root),out=path.join(project,'artifacts/soul-ui');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');app.setPath('userData',path.join(out,'plan-share-user-data'));
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});
  protocol.handle('onmyoji-resource',request=>{
    const match=new URL(request.url).pathname.match(/^\/assets\/(hero|soul)-icons\/(\d+)\.png$/);
    if(!match)return new Response('',{status:404});const file=path.join(project,'assets',match[1]+'-icons',match[2]+'.png');
    return fs.existsSync(file)?net.fetch(pathToFileURL(file).href):new Response('',{status:404});
  });
  const {SoulService}=require('../dist-electron/main/soulService'),{ProjectService}=require('../dist-electron/main/projectService');
  const {copyPngToClipboard}=require('../dist-electron/main/clipboardImage');
  const full=await new SoulService(project).load('mumu-1');assert.ok(full);
  const souls=Array.from({length:6},(_,i)=>full.souls.find(s=>s.position===i+1&&s.suitId===([1,5].includes(i)?300076:300030)&&s.level===15&&s.attributesComplete)
    ??full.souls.find(s=>s.position===i+1&&s.level===15&&s.attributesComplete));assert.ok(souls.every(Boolean));
  const snapshot={...full,souls,total:6};
  const service=new ProjectService(project);let saveData,copied,mode='save',copyCalls=0;
  ipcMain.handle('plan-share:art',(_,paths)=>{assert.ok(paths.length<=64);return service.readAssetData(paths);});
  ipcMain.handle('plan-share:save',(_,request)=>{assert.equal(request.purpose,'share');assert.match(request.filename,/大天狗-配装方案/);saveData=request.dataUrl;return mode==='cancel'?null:'image.png';});
  ipcMain.handle('plan-share:mode',(_,value)=>{mode=value;});
  ipcMain.handle('plan-share:copy',(_,dataUrl)=>copyPngToClipboard(dataUrl,async items=>{
    copyCalls++;if(mode==='fail')throw Error('剪贴板测试失败');const blob=await items[0].getType('image/png');copied=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    await new Promise(resolve=>setTimeout(resolve,30));
  },nativeImage.createFromDataURL));
  ipcMain.handle('plan-share:check',()=>{
    const saved=nativeImage.createFromDataURL(saveData);assert.ok(saved.toBitmap().equals(copied.toBitmap()));
    fs.writeFileSync(path.join(out,'soul-plan-share-export.png'),saved.toPNG());return {copyCalls,size:saved.getSize()};
  });
  const css=readExpandedCss(path.join(root,'src/renderer/styles/workbench.css')).replace(/^@import[^;]*;/,''),palette=['workbench-light.css','theme.css'].map(n=>fs.readFileSync(path.join(root,'public/theme',n),'utf8')).join('\n');
  const csp=readExpandedHtml(path.join(root,'src/renderer/index.html')).match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0],font=pathToFileURL(path.join(root,'public/fonts/harmonyos-sans-sc/Regular.css')).href;
  const html=path.join(out,'soul-plan-share.html');fs.writeFileSync(html,`<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8">${csp}<link rel="stylesheet" href="${font}"><style>${css}\n${palette}\n#host{height:100vh}</style><body><section id="host"></section></body></html>`);
  const win=new BrowserWindow({show:false,width:1360,height:950,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true,backgroundThrottling:false}});await win.loadFile(html);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('node:assert/strict'),{ipcRenderer}=require('electron');
    const {installSoulPlanDetail}=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/soul-plan-detail.js'))});
    const {evaluatePlan}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/soul-optimizer.js'))});
    const {soulCatalog}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/soul-catalog-data.js'))});
    const snapshot=${JSON.stringify(snapshot)},hero=soulCatalog.heroes.find(h=>h.name==='大天狗'),base=hero.base;
    const panel=evaluatePlan(snapshot.souls,base,soulCatalog.suits),counts=new Map();for(const soul of snapshot.souls)counts.set(soul.suitId,(counts.get(soul.suitId)||0)+1);
    const plan={ids:snapshot.souls.map(s=>s.id),panel,score:panel.attack*(1+Math.min(1,panel.crit)*(panel.critDamage-1)),suits:[...counts].map(([id,count])=>({id,count}))};
    const painted=[],commands=[],paint=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,...args){painted.push(value);commands.push({value,x:args[0],y:args[1],font:this.font,color:this.fillStyle});return paint.call(this,value,...args);};
    const host=document.getElementById('host');window.api={readAssetData:p=>ipcRenderer.invoke('plan-share:art',p),saveCanvas:r=>ipcRenderer.invoke('plan-share:save',r),copyImageToClipboard:r=>ipcRenderer.invoke('plan-share:copy',r)};
    window.controller=installSoulPlanDetail(host,soulCatalog.suits,()=>{},()=>{},api);window.showPlan=()=>controller.show(plan,hero,snapshot,base,'damage');showPlan();
    window.detail=()=>document.querySelector('.soul-plan-detail');window.share=()=>document.querySelector('.soul-plan-share');window.el=n=>share().querySelector('[data-build-share="'+n+'"]');
    window.ready=async()=>{for(let i=0;i<200;i++){const image=el('preview').querySelector('canvas');if(image)return image;await new Promise(r=>setTimeout(r,20));}throw Error(el('status').textContent);};
    const button=detail().querySelector('[data-plan-share]');assert.equal(button.textContent,'分享');button.click();let canvas=await ready();
    assert.equal(canvas.dataset.slots,'6');assert.ok(Number(canvas.dataset.loadedPortraits)>=2);assert.equal(canvas.width,Math.ceil(detail().getBoundingClientRect().width)*2);
    assert.ok(painted.join('').includes(detail().querySelector('[data-plan="note"]').textContent.trim()),'score and objective unchanged');
    for(const slot of detail().querySelectorAll('.soul-plan-ring-soul')){
      const name=slot.querySelector('.soul-plan-soul-name'),range=document.createRange();range.selectNodeContents(name);
      const rect=range.getBoundingClientRect(),source=detail().getBoundingClientRect();
      const command=commands.find(p=>p.value===name.textContent&&Math.abs(p.x-(rect.left-source.left))<1);
      assert.ok(command,'export uses the displayed slot text coordinates');
      assert.ok(command.font.includes(getComputedStyle(name).fontSize),'export uses the displayed font size');
    }
    assert.ok(!painted.includes('阴阳师 · 御魂配装'));assert.ok(!painted.includes('分享'));assert.ok(!painted.includes('×'));
    assert.ok(painted.includes(hero.name));
    for(const slot of detail().querySelectorAll('.soul-plan-ring-soul')){assert.ok(painted.includes(slot.querySelector('small').textContent));assert.ok(painted.includes(slot.querySelector('.soul-plan-soul-name').textContent));}
    for(const row of detail().querySelectorAll('[data-panel-key]'))for(const cell of row.querySelectorAll('th,td'))assert.ok(painted.includes(cell.textContent.trim()),'all eight additions and totals match detail');
    for(const effect of detail().querySelectorAll('.soul-plan-effects p'))assert.ok(painted.join('').includes(effect.textContent),'complete wrapped set effect');
    assert.equal(canvas.getContext('2d').getImageData(10,canvas.height-10,1,1).data[3],255);
    el('save').click();for(let i=0;i<100&&!el('status').textContent.includes('图片已保存');i++)await new Promise(r=>setTimeout(r,20));assert.match(el('status').textContent,/图片已保存/);
    el('copy').click();el('copy').click();assert.equal(el('copy').disabled,true);for(let i=0;i<100&&el('copy').disabled;i++)await new Promise(r=>setTimeout(r,20));assert.match(el('status').textContent,/图片已复制/);
    const copied=await ipcRenderer.invoke('plan-share:check');assert.equal(copied.copyCalls,1);assert.deepEqual(copied.size,{width:canvas.width,height:canvas.height});
    await ipcRenderer.invoke('plan-share:mode','cancel');el('save').click();for(let i=0;i<100&&el('save').disabled;i++)await new Promise(r=>setTimeout(r,20));assert.match(el('status').textContent,/已取消保存/);
    await ipcRenderer.invoke('plan-share:mode','fail');el('copy').click();for(let i=0;i<100&&el('copy').disabled;i++)await new Promise(r=>setTimeout(r,20));assert.match(el('status').textContent,/剪贴板测试失败/);assert.ok(el('preview').querySelector('canvas'));
    share().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(share().open,false);assert.equal(detail().open,true);assert.equal(document.activeElement,button);
    // Old favorites keep the recorded final panel when individual souls/base are absent.
    controller.show(plan,undefined,undefined,undefined,'crit');painted.length=0;detail().querySelector('[data-plan-share]').click();canvas=await ready();
    assert.ok(painted.includes('当前背包中未找到'));assert.ok(painted.includes('—'));assert.ok(painted.join('').includes('此历史方案未保存基础属性'));assert.ok(painted.join('').includes('暴击评分')&&painted.join('').includes('%'));
    controller.close();assert.equal(share().open,false);showPlan();detail().querySelector('[data-plan-share]').click();await ready();
    CanvasRenderingContext2D.prototype.fillText=paint;return {sameDetailLayout:true,sameSlotCoordinates:true,sameFontSizes:true,noExportFooter:true,sixPieceRing:true,exactScore:true,exactPanel:true,fullSetEffects:true,localArt:true,strictCsp:true,exactSaveAndCopy:true,cancelAndRetry:true,returnToDetail:true,legacySavedPlan:true};
  })()`);
  await new Promise(resolve=>setTimeout(resolve,250));fs.writeFileSync(path.join(out,'soul-plan-share-dark.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`controller.close();document.documentElement.dataset.theme='light';showPlan();detail().querySelector('[data-plan-share]').click();void 0;`);await win.webContents.executeJavaScript(`ready().then(()=>true)`);
  await new Promise(resolve=>setTimeout(resolve,250));fs.writeFileSync(path.join(out,'soul-plan-share-light.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(480,760);await new Promise(resolve=>setTimeout(resolve,100));
  await win.webContents.executeJavaScript(`controller.close();showPlan();detail().querySelector('.soul-plan-detail-body').scrollTop=120;detail().querySelector('[data-plan-share]').click();void 0;`);
  await win.webContents.executeJavaScript(`ready().then(canvas=>{const assert=require('node:assert/strict'),source=detail();assert.equal(canvas.width,Math.ceil(source.getBoundingClientRect().width)*2);assert.ok(canvas.height>=source.querySelector('.soul-plan-detail-body').scrollHeight*2);return true;})`);
  const narrow=await win.webContents.executeJavaScript(`(()=>{const assert=require('node:assert/strict'),d=share(),r=d.getBoundingClientRect();assert.ok(r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight);assert.ok(d.scrollWidth<=d.clientWidth);el('zoom').click();const image=el('preview').querySelector('canvas');assert.equal(image.getBoundingClientRect().width,image.width/2);assert.ok(el('preview').scrollWidth>el('preview').clientWidth);el('zoom').click();return true;})()`);
  const narrowExport=await win.webContents.executeJavaScript(`el('preview').querySelector('canvas').toDataURL('image/png')`);
  fs.writeFileSync(path.join(out,'soul-plan-share-narrow-export.png'),Buffer.from(narrowExport.split(',')[1],'base64'));
  await new Promise(resolve=>setTimeout(resolve,250));
  fs.writeFileSync(path.join(out,'soul-plan-share-narrow.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{controller.close();api.readAssetData=()=>new Promise(r=>window.releaseArt=r);showPlan();detail().querySelector('[data-plan-share]').click();await document.fonts.ready;await Promise.resolve();controller.dispose();releaseArt([]);await Promise.resolve();require('node:assert/strict').equal(document.querySelector('.soul-plan-share'),null);})()`);
  console.log(JSON.stringify({...result,narrow,cleanup:true}));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
