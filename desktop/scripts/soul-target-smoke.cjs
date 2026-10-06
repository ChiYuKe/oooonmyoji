const { readExpandedHtml, readExpandedCss } = require('./renderer-templates.cjs');
// Target analysis with a real inventory and production worker. No device writes.
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), project = path.dirname(root), out = path.join(project, 'artifacts/soul-ui');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(out, 'target-user-data'));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  protocol.handle('onmyoji-resource', request => {
    const match = new URL(request.url).pathname.match(/^\/assets\/(hero|soul)-icons\/(\d+)\.png$/);
    if (!match) return new Response('', { status: 404 });
    const file = path.join(project, 'assets', match[1] + '-icons', match[2] + '.png');
    return fs.existsSync(file) ? net.fetch(pathToFileURL(file).href) : new Response('', { status: 404 });
  });
  const snapshot = await new (require('../dist-electron/main/soulService').SoulService)(project).load('mumu-1');
  if (!snapshot) throw Error('Missing saved local inventory');
  const css = readExpandedCss(path.join(root, 'src/renderer/styles/workbench.css')).replace(/^@import[^;]*;/, '');
  const palette = ['workbench-light.css', 'theme.css'].map(name => fs.readFileSync(path.join(root, 'public/theme', name), 'utf8')).join('\n');
  const font = pathToFileURL(path.join(root, 'public/fonts/harmonyos-sans-sc/Regular.css')).href;
  const html = path.join(out, 'soul-target.html');
  fs.writeFileSync(html, `<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><link rel="stylesheet" href="${font}"><style>${css}\n${palette}\n#host{height:100vh}</style><body><section id="host"></section></body></html>`);
  const workerFile = fs.readdirSync(path.join(root, 'dist/renderer/assets')).find(name => /^soul-optimizer-worker-.*\.js$/.test(name));
  if (!workerFile) throw Error('Build the production worker first');
  const workerURL = pathToFileURL(path.join(root, 'dist/renderer/assets', workerFile)).href;
  const win = new BrowserWindow({ show: false, width: 1360, height: 1050, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadFile(html);
  const result = await win.webContents.executeJavaScript(`(async () => {
    try {
    const assert = require('node:assert/strict');
    const { installSoulOptimizer } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/soul-optimizer-view.js'))});
    const { soulCatalog } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/soul-catalog-data.js'))});
    const { evaluatePlan, planScore, formatPlanScore } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/soul-optimizer.js'))});
    const { SIX_STAR_SUBSTAT_ROLLS } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/soul-target-analysis.js'))});
    const snapshot = ${JSON.stringify(snapshot)}, store = new Map(), tick = ms => new Promise(resolve => setTimeout(resolve, ms));
    let workers = 0;
    const controller = installSoulOptimizer(document.getElementById('host'), { readLayout: key => store.get(key) ?? null, writeLayout: (key, val) => store.set(key, val) }, () => {
      workers++; return new Worker(${JSON.stringify(workerURL)}, { type: 'module' });
    });
    window.targetController = controller; window.targetSnapshot = snapshot;
    controller.update(snapshot);
    const panel = document.getElementById('soul-optimizer'), el = name => panel.querySelector('[data-ui="' + name + '"]');
    const set = (name, value) => { el(name).value = value; el(name).dispatchEvent(new Event('change', { bubbles: true })); };
    set('target', '27000'); assert.match(el('target-analysis').textContent, /请先计算/);
    set('hero', String(soulCatalog.heroes.find(hero => hero.name === '须佐之男').id));
    set('four', String(soulCatalog.suits.find(suit => suit.name === '海月火玉').id));
    set('two', String(soulCatalog.suits.find(suit => suit.name === '荒骷髅').id));
    panel.querySelector('[data-action="full-crit"]').click();
    const run = async () => {
      panel.querySelector('[data-action="start"]').click();
      const until = Date.now() + 45000;
      while (el('settings').disabled) { if (Date.now() > until) throw Error('Search did not finish'); await tick(25); }
      assert.ok(el('results').querySelector('.soul-optimizer-plan'));
    };
    await run();
    assert.equal(el('target-analysis').querySelectorAll('.soul-target-slot').length, 6, el('target-analysis').textContent);
    const targetHost=el('target-analysis');
    set('target','30000');
    assert.equal(targetHost.querySelectorAll('.soul-target-plan').length,0,'future route cards have been removed');
    assert.equal(targetHost.querySelectorAll('.soul-target-current,.soul-target-arrow,.soul-target-original').length,0,'there are no predicted attributes or comparisons');
    assert.match(targetHost.textContent,/属性已固定.*更换实际御魂/);
    assert.doesNotMatch(targetHost.textContent,/未来属性|推算|最高参考|路线/);
    assert.match(targetHost.querySelector('.soul-target-constraints').textContent,/海月火玉.*四件套效果.*荒骷髅.*首领套/);
    const originalIds=el('results').firstElementChild.dataset.planIds.split('|');
    const gear=originalIds.map(id=>snapshot.souls.find(soul=>soul.id===id));
    const checkActual=()=>{
      const slots=[...targetHost.querySelectorAll('.soul-target-slot')];assert.equal(slots.length,6);
      slots.forEach((slot,i)=>{
        assert.equal(slot.dataset.soulId,gear[i].id);assert.equal(Number(slot.dataset.suitId),gear[i].suitId);
        const attrs=[...slot.querySelectorAll('.soul-target-attributes li')].map(row=>({name:row.dataset.attribute,value:Number(row.dataset.value),rolls:Number(row.dataset.rolls)}));
        assert.deepEqual(attrs,gear[i].subAttributes.map(({name,value,rolls})=>({name,value,rolls})),'every actual substat value and allocation stays exact');
        for(const row of slot.querySelectorAll('.soul-target-attributes li'))assert.ok(row.dataset.substatStatus,'actual substat classification is present');
      });
    };
    checkActual();
    const actualMarkup=targetHost.querySelector('.soul-target-slots').innerHTML;
    set('target',String(Number(el('results').firstElementChild.dataset.score)+10));
    checkActual();assert.equal(targetHost.querySelector('.soul-target-slots').innerHTML,actualMarkup,'changing a goal only changes the comparison, not gear');
    set('target','30000');
    targetHost.querySelector('.soul-target-view-original').click();
    const detail=document.getElementById('soul-plan-detail');assert.equal(detail.open,true);
    assert.deepEqual([...detail.querySelectorAll('.soul-plan-ring-soul')].map(slot=>slot.dataset.soulId),originalIds);
    detail.querySelector('[aria-label="关闭配装详情"]').click();
    set('target-source','1');
    assert.match(targetHost.querySelector('[data-kind="current"]').textContent,new RegExp(formatPlanScore(Number(el('results').children[1].dataset.score),'damage').replace('.','\\.')));
    const sourceBeforeSort=el('target-source').value;
    set('result-sort','speed');assert.equal(el('target-source').value,sourceBeforeSort);
    const analyzeCard=el('results').children[3];analyzeCard.querySelector('[data-action="analyze-plan"]').click();
    assert.ok(el('target-source').selectedOptions[0].textContent.includes(formatPlanScore(Number(analyzeCard.dataset.score),'damage')));
    set('target-source','0');set('result-sort','score');
    const disclosure=el('target-section'),summary=disclosure.querySelector(':scope > summary');
    assert.equal(disclosure.open,true);summary.click();await tick(200);
    assert.equal(disclosure.open,false);assert.ok(disclosure.getBoundingClientRect().height<80,'collapsing hides the entire analysis block');
    set('target','30000');assert.equal(disclosure.open,false);assert.equal(workers,1,'target updates preserve collapsed state without restarting search');
    summary.click();await tick(200);assert.equal(disclosure.open,true);assert.equal(el('target-analysis').querySelectorAll('.soul-target-slot').length,6);
    const top = Math.max(...Array.from(el('results').children, card => Number(card.dataset.score)));
    assert.ok(el('target-analysis').textContent.includes(top.toFixed(2)));
    const originalPlanIds = Array.from(el('results').children, card => card.dataset.planIds).sort();
    const analysis = el('target-analysis').textContent;
    set('result-sort', 'speed'); assert.equal(el('target-analysis').textContent, analysis);
    set('target', String(top - 1)); assert.equal(el('target-analysis').dataset.achieved, 'true');
    assert.match(el('target-analysis').textContent, /已达到目标/); assert.equal(workers, 1);

    set('target-max',String(top+1));assert.equal(targetHost.dataset.achieved,'true');
    assert.ok(targetHost.querySelector('[data-kind="goal"]').textContent.includes((top+1).toFixed(2)));
    set('target-max',String(top-.5));assert.equal(targetHost.dataset.achieved,'false');assert.match(targetHost.textContent,/超过目标上限/);
    set('target-max',String(top-2));assert.match(targetHost.textContent,/下限不能大于上限/);assert.equal(el('target-max').getAttribute('aria-invalid'),'true');
    set('target','');set('target-max',String(top+1));assert.equal(targetHost.dataset.achieved,'true','upper-only ranges are supported');
    set('target-max','');assert.equal(targetHost.children.length,0);
    set('target','10000');el('target-min-slider').value='15000';el('target-min-slider').dispatchEvent(new Event('input',{bubbles:true}));el('target-min-slider').dispatchEvent(new Event('change',{bubbles:true}));
    assert.equal(el('target').value,'15000');panel.querySelector('[data-target-adjust="plus"]').click();assert.equal(el('target').value,'15100');
    set('target-max','16000');el('target-min-slider').value='20000';el('target-min-slider').dispatchEvent(new Event('input',{bubbles:true}));el('target-min-slider').dispatchEvent(new Event('change',{bubbles:true}));assert.equal(el('target').value,'16000','slider endpoints never cross');
    set('target-max','');set('target','60000');assert.ok(Number(el('target-min-slider').max)>=60000,'typed values expand the scale');
    assert.equal(workers,1,'range changes do not restart the inventory search');

    set('target', '30000'); assert.equal(el('target-analysis').querySelectorAll('.soul-target-slot').length, 6);
    assert.equal(targetHost.dataset.achieved, 'false');

    assert.deepEqual(Array.from(el('results').children, card => card.dataset.planIds).sort(), originalPlanIds);
    set('target', '-10'); assert.match(el('target-analysis').textContent, /非负数/); assert.equal(el('target').getAttribute('aria-invalid'), 'true');
    set('target', ''); assert.equal(el('target-analysis').children.length, 0);
    set('target','25400');set('target-max','26000');
    const sourceMarkup=targetHost.querySelector('.soul-target-plan-detail').innerHTML;
    const generate=targetHost.querySelector('[data-action="generate-references"]');generate.click();
    while(generate.disabled)await tick(25);
    const references=targetHost.querySelector('.soul-system-references'),tabs=[...references.querySelectorAll('[data-reference]')];
    assert.equal(tabs.length,3,'real cache source generates multiple system references');
    assert.match(references.textContent,/参考御魂需另行获得/);
    const sourceCards=[...targetHost.querySelector('.soul-target-plan-detail').querySelectorAll('.soul-target-slot')];
    for(const tab of tabs){
      assert.equal(tab.dataset.meetsTarget,'true');assert.ok(Number(tab.dataset.score)>=25400&&Number(tab.dataset.score)<=26000);
      tab.click();assert.equal(tab.getAttribute('aria-pressed'),'true');
      const generated=[...references.querySelectorAll('.soul-target-slot')];assert.equal(generated.length,6);
      generated.forEach((card,i)=>{
        assert.match(card.dataset.soulId,/^reference-slot-/);assert.equal(card.dataset.suitId,sourceCards[i].dataset.suitId);
        const main=card.querySelector('.soul-target-main').textContent;
        if(i===5)assert.match(main,/主属性 暴击(?:伤害)? 55\.00%|主属性 暴击伤害 89\.00%/,'slot six follows the checked crit and crit damage options');
        else assert.equal(main,sourceCards[i].querySelector('.soul-target-main').textContent);
        const rows=[...card.querySelectorAll('.soul-target-attributes li')];assert.equal(rows.length,4);
        assert.equal(new Set(rows.map(row=>row.dataset.attribute)).size,4);assert.equal(rows.reduce((sum,row)=>sum+Number(row.dataset.rolls),0),9);
        assert.ok(rows.every(row=>Number(row.dataset.rolls)>=1&&Number(row.dataset.rolls)<=6));
        for(const row of rows){
          const maximum=SIX_STAR_SUBSTAT_ROLLS[row.dataset.attribute]*Number(row.dataset.rolls);
          assert.ok(Number(row.dataset.value)<maximum-1e-8,'actual reference rendering excludes perfect theoretical substats');
          assert.ok(Number(row.dataset.value)<=maximum*.98+1e-8);
        }
      });
      const crit=[...references.querySelectorAll('.soul-target-panel-values > div')].find(row=>row.querySelector('small').textContent==='暴击');
      assert.ok(parseFloat(crit.querySelector('strong').textContent)>=100,'every selectable reference satisfies the full-crit button, including new boss intrinsic choices');
    }
    assert.equal(targetHost.querySelector('.soul-target-plan-detail').innerHTML,sourceMarkup,'reference generation never changes actual gear');
    assert.equal(workers,1,'references do not rerun inventory search');
    assert.match(references.textContent,/暴击 100\.00%/,'reference section explicitly shows the inherited full-crit restriction');
    assert.match(references.textContent,/6 号位 暴击／暴击伤害/,'all checked main attributes are visible in reference restrictions');
    assert.match(references.textContent,/逐次采用浮动收益/);
    set('target-max','');set('target','1000000000');
    const impossibleGenerate=targetHost.querySelector('[data-action="generate-references"]');impossibleGenerate.click();while(impossibleGenerate.disabled)await tick(25);
    assert.equal(targetHost.querySelectorAll('[data-reference]').length,0,'no below-target fallback is displayed');
    assert.match(targetHost.querySelector('.soul-system-references').textContent,/未找到.*全部限制/);
    set('target-max','');set('target', '30000');
    window.targetDarkReady = true;
    return { inventory: snapshot.souls.length, systemReferences:3, referencesMeetGoal:true, fullCritEnforced:true, noPerfectRolls:true, noRelaxedFallback:true, actualSubstatsOnly: true, noFutureRoutes: true, fixedValuesAcrossGoals: true, preservedFourPieceAndBoss: true, selectedScheme: true, viewOriginalDetails: true, top, goal: 30000, liveGoalChanges: true, stableSorting: true, sixSlots: true, collapsibleAnalysis: true };
    } catch(error) { return { error: String(error), stack: error.stack }; }
  })()`);
  if (result.error) throw Error(result.stack || result.error);
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(out, 'soul-target-dark.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('document.documentElement.dataset.theme="light"');
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.writeFileSync(path.join(out, 'soul-target-light.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(1960, 1050);
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'; for (const d of document.querySelectorAll('.soul-target-slot details')) d.open=false;`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const wide = await win.webContents.executeJavaScript(`(() => {
    const assert=require('node:assert/strict'),cards=[...document.querySelectorAll('.soul-target-slot')];
    for (const button of document.querySelectorAll('.soul-target-plan')) {
      const rect=button.getBoundingClientRect();
      assert.ok([...button.children].every(child=>child.getBoundingClientRect().bottom<=rect.bottom),'candidate text stays inside its card');
    }
    assert.equal(cards.length,6);assert.ok(cards.every(card=>Math.abs(card.getBoundingClientRect().top-cards[0].getBoundingClientRect().top)<1),'six slots form one row on wide panels');
    assert.ok(cards.every(card=>card.getBoundingClientRect().bottom-card.lastElementChild.getBoundingClientRect().bottom<=30),'slot cards have no forced empty space below their content');
    const section=document.querySelector('.soul-target-section').getBoundingClientRect(),content=document.querySelector('.soul-target-content').getBoundingClientRect();
    assert.ok(content.left-section.left<=20 && section.right-content.right<=20,'analysis uses the available panel width');
    const range=document.querySelector('.soul-target-range').getBoundingClientRect(),stats=document.querySelector('.soul-target-stats').getBoundingClientRect();
    assert.ok(stats.top<range.bottom && stats.right<range.left,'score summary and target inputs share the top area');
    assert.equal(document.querySelector('.soul-target-rules').open,false,'detailed rules are collapsed initially');
    for (const row of document.querySelectorAll('.soul-target-attributes li')) {
      const cells=[...row.children].map(node=>node.getBoundingClientRect());
      for(let i=1;i<cells.length;i++)assert.ok(cells[i-1].right<=cells[i].left+1,'current and reference values never overlap');
    }
    return {sixColumns:true,alignedValues:true,candidateTextFits:true};
  })()`);
  fs.writeFileSync(path.join(out, 'soul-target-wide.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('node:assert/strict'),host=document.querySelector('[data-ui="target-analysis"]');
    for(const [name,value]of [['target','25400'],['target-max','26000']]){const input=document.querySelector('[data-ui="'+name+'"]');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}
    const button=host.querySelector('[data-action="generate-references"]');button.click();while(button.disabled)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(host.querySelectorAll('[data-reference]').length,3);
    host.querySelector('.soul-system-references').scrollIntoView({block:'start'});
  })()`);
  await new Promise(resolve=>setTimeout(resolve,150));
  fs.writeFileSync(path.join(out,'soul-system-references-wide.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.soul-target-toggle').click();document.querySelector('.soul-target-toggle').focus();`);
  await new Promise(resolve=>setTimeout(resolve,200));
  fs.writeFileSync(path.join(out,'soul-target-collapsed.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.soul-target-toggle').click();`);
  await new Promise(resolve=>setTimeout(resolve,200));
  await win.webContents.executeJavaScript(`require('node:assert/strict').equal(document.querySelector('.soul-target-section').open,true,'clicking reopens the disclosure');`);
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';`);
  win.setSize(390, 1000);
  await new Promise(resolve => setTimeout(resolve, 150));
  const narrow = await win.webContents.executeJavaScript(`(() => {
    const panel = document.getElementById('soul-optimizer');
    if (panel.scrollWidth > panel.clientWidth) throw Error('Target view overflows narrow panel');
    for (const button of document.querySelectorAll('.soul-target-plan')) {
      if ([...button.children].some(child=>child.getBoundingClientRect().bottom>button.getBoundingClientRect().bottom)) throw Error('Candidate text overflows narrow card');
    }
    return { width: panel.clientWidth, scroll: panel.scrollWidth };
  })()`);
  fs.writeFileSync(path.join(out, 'soul-target-narrow.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.soul-system-references').scrollIntoView({block:'start'});`);
  await new Promise(resolve=>setTimeout(resolve,150));
  fs.writeFileSync(path.join(out,'soul-system-references-narrow.png'),(await win.webContents.capturePage()).toPNG());
  const lifecycle = await win.webContents.executeJavaScript(`(async () => {
    const assert=require('node:assert/strict'), panel=document.getElementById('soul-optimizer'), el=name=>panel.querySelector('[data-ui="'+name+'"]');
    const set=(name,value)=>{el(name).value=value;el(name).dispatchEvent(new Event('change',{bubbles:true}));};
    set('target-max','50000');set('objective','critDamage'); assert.equal(el('target').value,'');assert.equal(el('target-max').value,''); assert.equal(el('target-unit').textContent,'%');
    assert.equal(el('target-analysis').querySelector('.soul-target-stats'),null);
    set('target','250');set('target-max','300'); panel.querySelector('[data-action="start"]').click();
    const until=Date.now()+45000; while(el('settings').disabled){if(Date.now()>until)throw Error('Percent search timed out');await new Promise(resolve=>setTimeout(resolve,25));}
    assert.match(el('target-analysis').querySelector('.soul-target-stats').textContent,/250.00%.*300.00%/);
    set('six',''); el('six').checked=false; el('six').dispatchEvent(new Event('change',{bubbles:true}));
    assert.equal(el('target-analysis').querySelector('.soul-target-stats'),null);
    window.targetController.update({...window.targetSnapshot,instanceId:'another'});
    assert.equal(el('target-analysis').querySelector('.soul-target-slot'),null);
    window.targetController.dispose(); assert.equal(document.getElementById('soul-optimizer'),null);
    return { percentInput: true, staleConditions: true, instanceIsolation: true, disposal: true };
  })()`);
  console.log(JSON.stringify({ ...result, ...lifecycle, wide, narrow })); win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
