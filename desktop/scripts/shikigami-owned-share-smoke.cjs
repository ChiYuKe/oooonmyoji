const {app,BrowserWindow,protocol,net,ipcMain,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),project=path.dirname(root),out=path.join(project,'artifacts/soul-ui');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData',path.join(out,'owned-share-user-data'));
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});
  protocol.handle('onmyoji-resource',request=>{
    const match=new URL(request.url).pathname.match(/^\/assets\/(hero|skill|soul)-icons\/(\d+)\.png$/);
    if(!match)return new Response('',{status:404});
    const file=path.join(project,'assets',match[1]+'-icons',match[2]+'.png');return fs.existsSync(file)?net.fetch(pathToFileURL(file).href):new Response('',{status:404});
  });
  const {ProjectService}=require('../dist-electron/main/projectService'),service=new ProjectService(project);
  const {copyPngToClipboard}=require('../dist-electron/main/clipboardImage');
  let saved,copied,mode='copy',calls=0;
  ipcMain.handle('owned-share:art',(_,paths)=>{assert.ok(paths.length<=64);return service.readAssetData(paths);});
  ipcMain.handle('owned-share:save',(_,request)=>{assert.equal(request.purpose,'share');assert.match(request.filename,/配置 1/);saved=request.dataUrl;return 'image.png';});
  ipcMain.handle('owned-share:mode',(_,value)=>{mode=value;});
  ipcMain.handle('owned-share:copy',(_,dataUrl)=>copyPngToClipboard(dataUrl,async items=>{
    calls++;if(mode==='fail')throw Error('复制测试失败');
    const blob=await items[0].getType('image/png');copied=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    await new Promise(resolve=>setTimeout(resolve,30));
  },nativeImage.createFromDataURL));
  ipcMain.handle('owned-share:check',()=>{
    assert.ok(copied.toBitmap().equals(nativeImage.createFromDataURL(saved).toBitmap()));
    const png=nativeImage.createFromDataURL(saved);fs.writeFileSync(path.join(out,'shikigami-owned-share-export.png'),png.toPNG());
    return {calls,size:png.getSize()};
  });
  const css=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8').replace(/^@import[^;]*;/,'');
  const palette=['workbench-light.css','theme.css'].map(n=>fs.readFileSync(path.join(root,'public/theme',n),'utf8')).join('\n');
  const csp=fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  const font=pathToFileURL(path.join(root,'public/fonts/harmonyos-sans-sc/Regular.css')).href;
  const html=path.join(out,'shikigami-owned-share.html');
  fs.writeFileSync(html,`<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8">${csp}<link rel="stylesheet" href="${font}"><style>${css}\n${palette}\n#atlas{height:100vh}</style><body><section id="atlas" class="shikigami-atlas"></section></body></html>`);
  const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true,backgroundThrottling:false}});
  await win.loadFile(html);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('node:assert/strict'),{ipcRenderer}=require('electron');
    const {installShikigamiOwnedDetail}=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/shikigami-owned-detail.js'))});
    const {soulCatalog}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/soul-catalog-data.js'))});
    const {groupOwnedHeroes}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/hero-ownership.js'))});
    const actual=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(path.join(project,'artifacts/soul-research/hero-ownership-live.json'))},'utf8'));
    const hero=soulCatalog.heroes.find(h=>h.id===354),fixture=structuredClone(actual),original=groupOwnedHeroes(fixture,354)[0].hero;
    fixture.heroes.push({...structuredClone(original),id:'share-duplicate'});fixture.counts[354]++;fixture.total++;
    window.root=document.getElementById('atlas');const origin=document.createElement('button');origin.textContent='仓库详情';root.append(origin);
    window.api={saveCanvas:r=>ipcRenderer.invoke('owned-share:save',r),copyImageToClipboard:r=>ipcRenderer.invoke('owned-share:copy',r),readAssetData:p=>ipcRenderer.invoke('owned-share:art',p)};
    let resolveBase;window.details=installShikigamiOwnedDetail(root,()=>new Promise(resolve=>resolveBase=resolve),api);
    window.showDetail=()=>details.show(hero,fixture,'离线实例',origin);window.showDetail();
    window.detail=()=>document.querySelector('.shikigami-owned-detail');window.share=()=>document.querySelector('.shikigami-owned-share');window.el=n=>share().querySelector('[data-build-share="'+n+'"]');
    const button=detail().querySelector('[data-owned-share="0"]');assert.equal(button.disabled,false);
    const source=detail().querySelector('[data-owned-group="0"]');assert.match(source.querySelector('.shikigami-owned-quantity').textContent,/× 2/);
    const painted=[],paintCommands=[],paint=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,...args){painted.push(value);paintCommands.push({value,x:args[0],y:args[1],color:this.fillStyle,align:this.textAlign,font:this.font});return paint.call(this,value,...args);};
    const expectedPaths=[...new Set([...source.querySelectorAll('img'),...detail().querySelector('[data-owned="heading"]').querySelectorAll('img')].map(img=>new URL(img.src).pathname.slice(1)))];
    const expectedArt=await api.readAssetData(expectedPaths);
    window.ready=async()=>{for(let i=0;i<200;i++){const canvas=el('preview').querySelector('canvas');if(canvas)return canvas;await new Promise(r=>setTimeout(r,20));}throw Error(el('status').textContent);};
    button.click();let canvas=await ready();assert.equal(canvas.dataset.heroName,hero.name);assert.equal(canvas.dataset.configuration,'配置 1');assert.equal(canvas.dataset.slots,'6');
    assert.equal(Number(canvas.dataset.loadedPortraits),expectedArt.length);assert.ok(expectedArt.length>=5);assert.equal(canvas.width,2240);assert.ok(canvas.height>1500);
    for(const skill of source.querySelectorAll('.shikigami-owned-skill'))assert.ok(painted.includes(skill.querySelector(':scope > div > span').textContent),'complete skill name');
    for(const value of source.querySelectorAll('.soul-detail-attribute-value,.shikigami-owned-total,.shikigami-owned-addition'))assert.ok(painted.includes(value.textContent.trim()),'visible attribute '+value.textContent);
    assert.ok(painted.includes('× 2'));CanvasRenderingContext2D.prototype.fillText=paint;
    const swatch=document.createElement('canvas').getContext('2d');
    const normalize=color=>{swatch.fillStyle=color;return swatch.fillStyle;};
    const rgb=color=>{swatch.fillStyle=color;swatch.fillRect(0,0,1,1);return [...swatch.getImageData(0,0,1,1).data];};
    const badges=paintCommands.filter(p=>p.align==='center'&&/^\\d+$/.test(p.value));assert.ok(badges.length>2);
    const liveBadge=source.querySelector('.soul-upgrade-count'),badgeStyle=getComputedStyle(liveBadge);
    const cardColor=getComputedStyle(liveBadge.closest('.shikigami-owned-soul')).backgroundColor;
    for(const badge of badges){
      assert.equal(badge.color,normalize(badgeStyle.color));
      const pixel=(dx,dy)=>[...canvas.getContext('2d').getImageData(Math.floor((badge.x+dx)*2),Math.floor((badge.y-3.5+dy)*2),1,1).data];
      assert.deepEqual(pixel(7,7),rgb(cardColor),'badge corner stays outside the circle');
      assert.deepEqual(pixel(6,0),rgb(badgeStyle.backgroundColor),'circle uses the detail badge color');
    }
    for(const slot of source.querySelectorAll('.shikigami-owned-soul')){
      const slotIndex=Number(slot.dataset.position)-1,left=24+slotIndex%3*((1072-284-18-24)/3+12);
      const normalRows=[...slot.querySelectorAll('.soul-main-attribute,.soul-sub-attribute')];
      const coordinates=normalRows.map(row=>paintCommands.find(p=>p.align==='right'&&p.value===row.querySelector('.soul-detail-attribute-value')?.textContent.trim()&&p.x>left&&p.x<left+249));
      assert.ok(coordinates.every(Boolean));assert.equal(new Set(coordinates.map(p=>p.x)).size,1,'values align whether or not a roll badge is present');
      for(const row of slot.querySelectorAll('.soul-intrinsic-attribute'))for(const value of row.querySelectorAll('.soul-detail-attribute-label,.soul-detail-attribute-value')){
        const expected=normalize(getComputedStyle(value).color);
        assert.ok(paintCommands.some(p=>p.value===value.textContent.trim()&&p.color===expected),'intrinsic attribute preserves the detail color');
      }
    }
    assert.equal(canvas.getContext('2d').getImageData(20,canvas.height-20,1,1).data[3],255);
    el('save').click();for(let i=0;i<100&&!el('status').textContent.includes('图片已保存');i++)await new Promise(r=>setTimeout(r,20));assert.match(el('status').textContent,/图片已保存/);
    el('copy').click();assert.equal(el('copy').disabled,true);el('copy').click();for(let i=0;i<100&&el('copy').disabled;i++)await new Promise(r=>setTimeout(r,20));assert.match(el('status').textContent,/图片已复制/);
    const copied=await ipcRenderer.invoke('owned-share:check');assert.equal(copied.calls,1);assert.deepEqual(copied.size,{width:canvas.width,height:canvas.height});
    await ipcRenderer.invoke('owned-share:mode','fail');el('copy').click();for(let i=0;i<100&&el('copy').disabled;i++)await new Promise(r=>setTimeout(r,20));assert.match(el('status').textContent,/复制测试失败/);assert.equal(el('copy').disabled,false);
    share().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(share().open,false);assert.ok(detail().open);assert.equal(document.activeElement,button);
    // Share snapshots just the selected group, including six explicit empty slots.
    details.close();const low=structuredClone(original);low.id='empty-build';low.level=1;low.stars=2;low.equips=Array(6).fill(null);
    const empty={...fixture,heroes:[low],counts:{354:1},total:1};details.show(hero,empty,'离线实例',origin);
    const emptyButton=detail().querySelector('[data-owned-share]');assert.equal(emptyButton.disabled,true);
    resolveBase({attack:100,hp:1000,defense:100,speed:115,crit:.12,critDamage:1.5,hit:0,resist:0});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(emptyButton.disabled,false);
    emptyButton.click();canvas=await ready();assert.equal(canvas.dataset.slots,'6');assert.equal(detail().querySelector('.shikigami-owned-total').textContent,'100.00');
    details.close();assert.equal(share().open,false);showDetail();detail().querySelector('[data-owned-share="0"]').click();await ready();
    return {fullConfiguration:true,roundUpgradeBadges:true,alignedAttributeValues:true,intrinsicColors:true,groupQuantity:true,localPortraits:true,strictCsp:true,exactSaveAndCopy:true,duplicateCopyGuard:true,copyFailureRecovery:true,nestedEscapeFocus:true,emptySlots:true,resolvedActualLevel:true};
  })()`);
  await new Promise(resolve=>setTimeout(resolve,250));fs.writeFileSync(path.join(out,'shikigami-owned-share-dark.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`details.close();document.documentElement.dataset.theme='light';showDetail();detail().querySelector('[data-owned-share="0"]').click();void 0;`);
  await win.webContents.executeJavaScript(`ready().then(()=>true)`);await new Promise(resolve=>setTimeout(resolve,250));fs.writeFileSync(path.join(out,'shikigami-owned-share-light.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(480,760);await new Promise(resolve=>setTimeout(resolve,100));
  const narrow=await win.webContents.executeJavaScript(`(()=>{const assert=require('node:assert/strict'),d=share(),rect=d.getBoundingClientRect();assert.ok(rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight);assert.ok(d.scrollWidth<=d.clientWidth);el('zoom').click();assert.equal(el('preview').querySelector('canvas').getBoundingClientRect().width,1120);assert.ok(el('preview').scrollWidth>el('preview').clientWidth);el('zoom').click();return true;})()`);
  fs.writeFileSync(path.join(out,'shikigami-owned-share-narrow.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{details.close();api.readAssetData=()=>new Promise(r=>window.releaseArt=r);showDetail();detail().querySelector('[data-owned-share="0"]').click();await document.fonts.ready;await Promise.resolve();details.dispose();releaseArt([]);await Promise.resolve();require('node:assert/strict').equal(document.querySelector('.shikigami-owned-share'),null);})()`);
  console.log(JSON.stringify({...result,narrow,cleanup:true}));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
