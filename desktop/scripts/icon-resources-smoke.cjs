// Validate a deployed project containing only the archive, with no loose icon folders.
const {app, BrowserWindow, protocol, net, nativeImage} = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const originalFs = require('original-fs');
const {pathToFileURL} = require('node:url');
const project = path.resolve(__dirname, '../..'), out = path.join(project, 'artifacts/icon-resources');
fs.mkdirSync(out,{recursive:true});
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); app.setPath('userData',path.join(out,'user-data'));
protocol.registerSchemesAsPrivileged([{scheme:'onmyoji-resource',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let fixture, win;
app.whenReady().then(async()=>{
  const {ProjectService} = require('../dist-electron/main/projectService');
  const {SoulService} = require('../dist-electron/main/soulService');
  fixture = fs.mkdtempSync(path.join(out,'pack-only-'));
  fs.mkdirSync(path.join(fixture,'resources'));
  originalFs.copyFileSync(path.join(project,'resources/onmyoji-icons.asar'),path.join(fixture,'resources/onmyoji-icons.asar'));
  const service = new ProjectService(fixture);
  const requests = [];
  let count = 0;
  for (const folder of ['hero-icons','skill-icons','soul-icons']) {
    assert.ok(!fs.existsSync(path.join(fixture,'assets',folder)));
    const names = fs.readdirSync(path.join(fixture,'resources/onmyoji-icons.asar',folder)).filter(n=>n.endsWith('.png'));
    for (const name of names) {
      const relative = `assets/${folder}/${name}`, file = service.resolveResourceUrl(`onmyoji-resource://project/${relative}`);
      assert.ok(file.includes('onmyoji-icons.asar'));
      const bytes = fs.readFileSync(file);
      assert.ok(bytes.equals(fs.readFileSync(path.join(project,relative))));
      assert.ok(!nativeImage.createFromBuffer(bytes).isEmpty(),relative);
      count++;
    }
    requests.push(`assets/${folder}/${names[0]}`);
  }
  const data = await service.readAssetData(requests);
  assert.equal(data.length,3);
  for (const image of data) assert.ok(Buffer.from(image.dataUrl.split(',')[1],'base64').equals(fs.readFileSync(path.join(project,image.path))));
  assert.deepEqual(await service.readAssetData(['assets/hero-icons/999999999.png','../secret.png']),[]);
  const souls = new SoulService(fixture), snapshot = {instanceId:'offline',fetchedAt:'2026-10-01T00:00:00Z',total:1,failed:0,souls:[{suitId:300027,position:1}]};
  const snapshotFile = souls.snapshotPath('offline'); fs.mkdirSync(path.dirname(snapshotFile),{recursive:true}); fs.writeFileSync(snapshotFile,JSON.stringify(snapshot));
  assert.equal((await souls.load('offline')).souls[0].iconUrl,'onmyoji-resource://project/assets/soul-icons/300027.png');
  protocol.handle('onmyoji-resource',request=>{
    const file = service.resolveResourceUrl(request.url);
    return file ? net.fetch(pathToFileURL(file).href) : new Response('',{status:403});
  });
  win = new BrowserWindow({show:false,width:500,height:220,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});
  const html = path.join(fixture,'check.html');
  fs.writeFileSync(html,'<!doctype html><body style="background:#222"></body>'); await win.loadFile(html);
  const decoded = await win.webContents.executeJavaScript(`(async()=>{const paths=${JSON.stringify(requests)}; for(const path of paths){const img=new Image(); img.src='onmyoji-resource://project/'+path; await img.decode(); if(!img.naturalWidth)throw Error(path); document.body.append(img);}for(const entry of ${JSON.stringify(data)}){const img=new Image();img.src=entry.dataUrl;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);c.toDataURL('image/png');}return paths.length;})().catch(error=>({message:error.message,name:error.name}))`);
  assert.equal(decoded,3,JSON.stringify(decoded));
  const actual = new ProjectService(project);
  assert.ok(!(await actual.listAssets()).some(a=>/^assets\/(hero|skill|soul)-icons\//.test(a.path)));
  assert.ok(!(await actual.listContentFolders()).some(a=>/^assets\/(hero|skill|soul)-icons$/.test(a)));
  console.log(JSON.stringify({ok:true,packedImages:count,decoded,offlineCache:true,templatesExcludeIcons:true}));
}).catch(error=>{console.error(error?.stack || error?.message || String(error));process.exitCode=1;}).finally(()=>{
  win?.destroy();
  // Electron retains the ASAR descriptor until exit; retain the fixture for release inspection.
  app.exit(process.exitCode || 0);
});
