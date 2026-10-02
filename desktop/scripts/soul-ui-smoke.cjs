// Real Electron DOM checks using local snapshots; does not connect to any device.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const project = path.dirname(root);
const artifacts = path.join(project, 'artifacts', 'soul-ui');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(artifacts, 'user-data'));

app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const hash = createHash('sha256').update('mumu-0').digest('hex').slice(0, 16);
  const acquired = JSON.parse(fs.readFileSync(path.join(project, 'artifacts', 'souls', hash, 'snapshot.json'), 'utf8')).result;
  const source = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const panel = source.match(/<div id="team-builder-soul-calculator"[\s\S]*?\n            <\/div>/)[0];
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8').replace(/^@import[^;]*;/, '');
  const file = path.join(artifacts, 'soul-calculator.html');
  fs.writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><style>${css}</style><body><section class="team-builder-content" style="height:100vh"><header class="team-builder-pane-header">御魂计算</header>${panel}</section></body></html>`);
  const win = new BrowserWindow({ show: false, width: 1000, height: 730,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true } });
  await win.loadFile(file);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const assert = require('node:assert/strict');
    const { installSoulCalculator } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/soul-calculator.js'))});
    const snapshot = ${JSON.stringify(acquired)};
    const el = id => document.getElementById('soul-' + id);
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    let pending, progressListener, failure = false;
    window.disposeSoul = installSoulCalculator(document.getElementById('team-builder-soul-calculator'), {
      listInstances: async () => [{ id:'mumu-0', displayName:'扫地工', backend:'mumu', mumuIndex:0 }, { id:'mumu-1', displayName:'吃鱼', backend:'mumu', mumuIndex:1 }],
      readLayout: () => null, writeLayout() {},
      onSoulFetchProgress: listener => { progressListener=listener; return () => {}; },
      fetchSouls: id => new Promise((resolve,reject) => { pending={id,resolve,reject}; }),
      cancelSoulFetch: async id => { assert.equal(id,pending.id); pending.resolve(null); },
    });
    await tick(); assert.equal(el('instance').options.length,3); assert.equal(el('fetch').disabled,true);
    el('instance').value='mumu-0'; el('instance').dispatchEvent(new Event('change')); el('fetch').click();
    assert.equal(pending.id,'mumu-0'); assert.equal(el('instance').disabled,true); assert.equal(el('refresh').disabled,true);
    progressListener({instanceId:'mumu-0',message:'正在读取御魂',completed:123,total:4490}); assert.equal(el('progress').value,123);
    pending.resolve(snapshot); await tick();
    assert.equal(el('rows').children.length,100); assert.match(el('summary').textContent,/扫地工/);
    el('next').click(); assert.match(el('page-info').textContent,/第 2/);
    el('search').value=snapshot.souls[0].id; el('search').dispatchEvent(new Event('input')); assert.equal(el('rows').children.length,1);
    el('search').value=''; el('search').dispatchEvent(new Event('input'));
    el('instance').value='mumu-1'; el('instance').dispatchEvent(new Event('change'));
    assert.equal(el('rows').children.length,0); assert.equal(el('summary').textContent,'');
    el('fetch').click(); assert.equal(pending.id,'mumu-1'); el('cancel').click(); await tick();
    assert.match(el('status').textContent,/取消/); assert.equal(el('fetch').disabled,false);
    el('instance').value='mumu-0'; el('instance').dispatchEvent(new Event('change'));
    assert.equal(el('rows').children.length,100);
    el('fetch').click(); pending.reject(Error('实例已离线')); await tick();
    assert.match(el('status').textContent,/失败/); assert.equal(el('rows').children.length,100);
    return { selectionAndIsolation:true, progress:true, cancellation:true, filterAndPagination:true, preservedOnFailure:true, displayed:snapshot.souls.length };
  })()`);
  fs.writeFileSync(path.join(artifacts, 'wide.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(440, 720);
  await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,100))`);
  const narrow = await win.webContents.executeJavaScript(`({ width:document.getElementById('team-builder-soul-calculator').clientWidth, height:document.querySelector('.soul-results').clientHeight, fetchVisible:document.getElementById('soul-fetch').getBoundingClientRect().right<=innerWidth })`);
  if (!narrow.fetchVisible || narrow.height < 80) throw Error('Narrow panel controls are clipped');
  fs.writeFileSync(path.join(artifacts, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`window.disposeSoul()`);
  console.log(JSON.stringify({ ...result, narrow }));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
