// Exercise the actual browser DOM without connecting to or modifying the public community.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), out = path.join(root, '../artifacts/soul-ui');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(out, 'community-filter-user-data'));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8').replace(/^@import[^;]*;/, '');
  const palette = ['workbench-light.css', 'theme.css'].map(name => fs.readFileSync(path.join(root, 'public/theme', name), 'utf8')).join('\n');
  const font = pathToFileURL(path.join(root, 'public/fonts/harmonyos-sans-sc/Regular.css')).href;
  const html = path.join(out, 'soul-community-filters.html');
  fs.writeFileSync(html, `<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><link rel="stylesheet" href="${font}"><style>${css}\n${palette}\n#host{height:100vh;padding:18px;overflow:auto}#upload{display:none}</style><body><section id="host"></section><section id="upload"></section></body></html>`);
  const win = new BrowserWindow({ show: false, width: 1440, height: 1120, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(html);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const assert = require('node:assert/strict');
    const { installSoulCommunity } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/soul-community-view.js'))});
    const { soulCatalog } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/soul-catalog-data.js'))});
    const { createCommunityBuild, communityBuildTitle, matchesCommunityFilters } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/soul-community.js'))});
    const { evaluatePlan, planScore } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/soul-optimizer.js'))});
    const hero = soulCatalog.heroes.find(h => h.name === '大天狗');
    const attr = (name, value, rolls = 1) => ({ name, value, rolls });
    const mains = [['attackAdditionVal',486],['attackAdditionRate',.55],['defenseAdditionVal',104],['attackAdditionRate',.55],['maxHpAdditionVal',2052],['critRateAdditionVal',.55]];
    const inventory = mains.map(([name,value],i) => ({id:'local-'+i, position:i+1, stars:6, level:15, suitId:i<4?300083:300092, attributesComplete:true,
      mainAttribute:attr(name,value), subAttributes:[attr('critPowerAdditionVal',.15,4),attr('speedAdditionVal',3),attr('debuffResist',.04),attr(name==='attackAdditionRate'?'critRateAdditionVal':'attackAdditionRate',.08,3)], intrinsicAttributes:[],
      iconUrl:${JSON.stringify(pathToFileURL(path.join(root, '../assets/soul-icons')).href)}+'/'+(i<4?300083:300092)+'.png'}));
    const options = {base:hero.base,objective:'damage',ranges:{},requirements:[{suitId:300083,count:4}],mainAttributes:{},onlySix:true,onlyMaxLevel:true,unequipped:false,excludeDiscarded:true,excludedIds:[],seconds:10,limit:10};
    const panel = evaluatePlan(inventory,options.base,soulCatalog.suits), plan = {ids:inventory.map(s=>s.id),panel,score:planScore(panel,options.objective),suits:[{id:300083,count:4},{id:300092,count:2}]};
    const build = createCommunityBuild(plan,inventory,options,hero.id,communityBuildTitle(hero,inventory,soulCatalog.suits),'分享者');
    const entries = Array.from({length:65},(_,i) => {const e=structuredClone(build);e.souls[0].subAttributes[0].value=.144+(i%16)*.001; return {...e,id:(i+1).toString(16).padStart(64,'0'),author:'御魂玩家-'+String(i+1).padStart(3,'0'),createdAt:new Date(Date.parse('2026-10-05T00:00:00Z')+i*60000).toISOString()};});
    const store = new Map(), requests = [];
    window.communityController = installSoulCommunity(document.getElementById('host'), {readLayout:key=>store.get(key)??null,writeLayout:(key,value)=>store.set(key,value),async listCommunityBuilds(endpoint,query){
      requests.push(query);const all=entries.filter(e=>matchesCommunityFilters(e,query)).sort((a,b)=>query.order==='oldest'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));
      const start=query.cursor?all.findIndex(e=>e.id===query.cursor.split('|')[1])+1:0, rows=all.slice(start,start+50),last=rows.at(-1);
      return {entries:rows,cursor:start+rows.length<all.length?last.createdAt+'|'+last.id:null,filterVersion:1};
    }},soulCatalog.suits,document.getElementById('upload'));
    const context={hero,plan,inventory,options,target:{min:plan.score-1}};
    communityController.update(context);await new Promise(resolve=>setTimeout(resolve,20));
    window.el=name=>document.querySelector('[data-community="'+name+'"]');
    const choices=()=>el('results').querySelectorAll('button');
    assert.equal(choices().length,12); assert.equal(el('more').hidden,false);
    el('next').click(); assert.match(el('page').textContent,/第 2/);
    el('search').value='御魂玩家-001';el('filters').requestSubmit();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(choices().length,1);assert.equal(requests.at(-1).search,'御魂玩家-001');
    el('reset').click();await new Promise(resolve=>setTimeout(resolve,20));
    el('more').click();await new Promise(resolve=>setTimeout(resolve,20)); assert.equal(el('more').hidden,true);assert.match(el('summary').textContent,/已加载 65 个/);
    el('sort').value='score-desc';el('sort').dispatchEvent(new Event('change'));assert.equal(choices().length,12);
    document.querySelector('.soul-community-comparison-heading button').click();
    el('scope').value='favorites';el('scope').dispatchEvent(new Event('change'));assert.equal(choices().length,1);
    el('scope').value='all';el('scope').dispatchEvent(new Event('change'));
    el('score-min').value=String(plan.score+999);el('score-min').dispatchEvent(new Event('input'));assert.equal(choices().length,0);assert.equal(el('comparison').children.length,0);
    el('reset').click();await new Promise(resolve=>setTimeout(resolve,20));
    el('suit4').value='300083';el('suit2').value='300092';el('main6').value='critRateAdditionVal';el('apply').click();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(choices().length,12);assert.match(el('active-filters').textContent,/四件套/);
    window.checkOverflow=()=>{const host=document.getElementById('host');assert.ok(host.scrollWidth<=host.clientWidth+1,'panel overflow');for(const control of document.querySelectorAll('input,select,button')){if(!control.getClientRects().length||control.closest('#upload'))continue;const rect=control.getBoundingClientRect();assert.ok(rect.left>=-1&&rect.right<=innerWidth+1,'control outside window: '+control.outerHTML);}return {width:innerWidth,scroll:host.scrollWidth};};
    return {requests:requests.length,keyboardSubmit:true,remoteFilters:true,paging:true,favorites:true,emptyDetail:true,...checkOverflow()};
  })()`);
  await new Promise(resolve => setTimeout(resolve,150));
  fs.writeFileSync(path.join(out, 'soul-community-filters-wide.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(520, 1000);
  await win.webContents.executeJavaScript(`el('advanced').open=true;document.getElementById('host').scrollTop=0;checkOverflow()`);
  await new Promise(resolve => setTimeout(resolve,150));
  fs.writeFileSync(path.join(out, 'soul-community-filters-narrow.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';checkOverflow()`);
  await new Promise(resolve => setTimeout(resolve,150));
  fs.writeFileSync(path.join(out, 'soul-community-filters-light.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({...result,narrow:true,light:true}));win.destroy();app.quit();
}).catch(error => {console.error(error);app.exit(1);});
