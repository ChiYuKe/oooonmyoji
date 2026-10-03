// Real Electron DOM checks using local snapshots; does not connect to any device.
const { app, BrowserWindow, protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const project = path.dirname(root);
const artifacts = path.join(project, 'artifacts', 'soul-ui');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(artifacts, 'user-data'));

app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const { SoulService } = require(path.join(root, 'dist-electron/main/soulService.js'));
  const service = new SoulService(project);
  const saved = await service.load('mumu-1');
  if (!saved) throw Error('Missing captured soul snapshot');
  // Treat the captured data as a fixture under the mock instance, without modifying disk data.
  const acquired = { ...saved, instanceId: 'mumu-0' };
  const cachedSecond = saved;
  protocol.handle('onmyoji-resource', request => {
    const match = new URL(request.url).pathname.match(/^\/assets\/(soul|hero)-icons\/(\d+)\.png$/);
    if (!match) return new Response('', { status: 404 });
    const file = path.join(project, 'assets', match[1] + '-icons', match[2] + '.png');
    return fs.existsSync(file) ? net.fetch(pathToFileURL(file).href) : new Response('', { status: 404 });
  });
  const source = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const panel = source.match(/<div id="team-builder-soul-calculator"[\s\S]*?\n            <\/div>/)[0];
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8').replace(/^@import[^;]*;/, '');
  const palette = ['workbench-light.css', 'theme.css'].map(name => fs.readFileSync(path.join(root, 'public/theme', name), 'utf8')).join('\n');
  const font = pathToFileURL(path.join(root, 'public/fonts/harmonyos-sans-sc/Regular.css')).href;
  const file = path.join(artifacts, 'soul-calculator.html');
  fs.writeFileSync(file, `<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><link rel="stylesheet" href="${font}"><style>${css}\n${palette}</style><body><section class="team-builder-content" style="height:100vh"><header class="team-builder-pane-header">御魂计算</header>${panel}</section></body></html>`);
  const win = new BrowserWindow({ show: false, width: 1000, height: 730,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => {
    if (event.level === 'error') console.error(event.message);
  });
  win.webContents.setFrameRate(60);
  await win.loadFile(file);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  let metricsBefore;
  if (process.argv.includes('--benchmark')) {
    await win.webContents.debugger.sendCommand('Performance.enable');
    metricsBefore = (await win.webContents.debugger.sendCommand('Performance.getMetrics')).metrics;
  }
  const result = await win.webContents.executeJavaScript(`(async () => {
    const assert = require('node:assert/strict');
    const { installSoulCalculator } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/soul-calculator.js'))});
    const snapshot = ${JSON.stringify(acquired)};
    const cachedSecond = ${JSON.stringify(cachedSecond)};
    const el = id => document.getElementById('soul-' + id);
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    let pending, progressListener, failure = false;
    window.disposeSoul = installSoulCalculator(document.getElementById('team-builder-soul-calculator'), {
      listSoulInstances: async () => [{ id:'mumu-0', displayName:'扫地工', backend:'mumu', mumuIndex:0, online:true }, { id:'mumu-1', displayName:'吃鱼', backend:'mumu', mumuIndex:1, online:true }],
      readLayout: () => null, writeLayout() {},
      loadSouls: async id => id==='mumu-1' ? cachedSecond : null,
      onSoulFetchProgress: listener => { progressListener=listener; return () => {}; },
      fetchSouls: id => new Promise((resolve,reject) => { pending={id,resolve,reject}; }),
      cancelSoulFetch: async id => { assert.equal(id,pending.id); pending.resolve(null); },
    });
    await tick(); assert.equal(el('instance').options.length,3); assert.equal(el('fetch').disabled,true);
    el('instance').value='mumu-0'; el('instance').dispatchEvent(new Event('change')); el('fetch').click();
    assert.equal(pending.id,'mumu-0'); assert.equal(el('instance').disabled,true); assert.equal(el('refresh').disabled,true);
    progressListener({instanceId:'mumu-0',message:'正在读取御魂',completed:123,total:4490}); assert.equal(el('progress').value,123);
    pending.resolve(snapshot); await tick();
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.length); assert.match(el('summary').textContent,/扫地工/);
    assert.equal(getComputedStyle(el('grid')).display,'grid');
    assert.ok(el('grid').querySelectorAll('.soul-card').length<150);
    assert.ok(el('grid').querySelectorAll('.soul-card').length>1);
    const cards = el('grid').querySelectorAll('.soul-card');
    assert.equal(el('detail-window').matches(':popover-open'),false,'no automatic detail popup');
    assert.equal(el('filter-drawer').hidden,true,'no permanent sidebar');
    const fullWidth = el('grid').parentElement.clientWidth;
    assert.ok(fullWidth > 900,'grid uses the full result area');
    assert.equal(cards[0].getBoundingClientRect().top,cards[1].getBoundingClientRect().top);
    const originalFocus=document.activeElement;
    cards[1].dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
    assert.equal(el('detail-window').matches(':popover-open'),true,'hover shows details immediately, without a timer');
    assert.ok(el('detail').textContent.includes(snapshot.souls[1].id));
    assert.equal(document.activeElement,originalFocus,'hover does not steal focus');
    assert.equal(cards[1].getAttribute('aria-pressed'),'false','hover does not change selection');
    assert.equal(cards[1].title,'','native tooltip does not compete with details');
    assert.equal(getComputedStyle(el('detail-window')).pointerEvents,'none','details do not intercept card hovering');
    for (const card of Array.from(cards).slice(0,8)) {
      card.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
      assert.equal(el('detail-window').matches(':popover-open'),true,'rapid card switching keeps details visible');
      assert.ok(el('detail').textContent.includes(card.dataset.soulId),'rapid switching immediately updates the record');
    }
    cards[1].dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));
    assert.equal(el('detail-window').matches(':popover-open'),false,'leaving the card hides details');
    cards[1].dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
    cards[1].dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(el('detail-window').matches(':popover-open'),false,'a brief pass does not leave a delayed popup');
    cards[1].focus(); assert.equal(el('detail-window').matches(':popover-open'),true,'keyboard focus also previews details');
    cards[1].click();
    assert.equal(el('grid').querySelector('.soul-card[aria-pressed="true"]').dataset.soulId,snapshot.souls[1].id);
    assert.ok(el('detail').textContent.includes(snapshot.souls[1].id));
    assert.equal(el('detail-window').matches(':popover-open'),true);
    assert.equal(el('grid').parentElement.clientWidth,fullWidth,'popup does not reduce the grid width');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(el('detail-window').matches(':popover-open'),false,'Escape closes detail');
    assert.equal(document.activeElement,cards[1],'Escape keeps card focus');
    const viewport=el('grid').parentElement;
    cards[1].click();
    viewport.scrollTop=viewport.scrollHeight; await tick();
    assert.equal(el('detail-window').matches(':popover-open'),false,'scrolling hides recycled card details');
    const lastCard = el('grid').querySelector('li[data-index="'+(snapshot.souls.length-1)+'"] .soul-card');
    assert.ok(lastCard,'last soul is reachable');
    const retainedCard=el('grid').querySelector('li[data-index]');
    const scrollBefore = el('grid').parentElement.scrollTop;
    const clickStart = performance.now(); lastCard.click(); const selectionMs = performance.now()-clickStart;
    assert.ok(scrollBefore>0); assert.equal(el('grid').parentElement.scrollTop,scrollBefore);
    assert.equal(el('grid').querySelector('li[data-index]'),retainedCard);
    assert.equal(lastCard.dataset.soulId,snapshot.souls.at(-1).id);
    assert.ok(el('detail').textContent.includes(snapshot.souls.at(-1).id));
    assert.equal(el('prev'),null); assert.equal(el('next'),null);
    assert.equal(el('count').textContent,snapshot.souls.length.toLocaleString()+' 条御魂');
    lastCard.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    assert.equal(document.activeElement.dataset.soulId,snapshot.souls[0].id);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    assert.equal(document.activeElement.dataset.soulId,snapshot.souls.at(-1).id);
    el('search').value=snapshot.souls[0].id; el('search').dispatchEvent(new Event('input')); assert.equal(el('grid').querySelectorAll('.soul-card').length,1);
    el('search').value=''; el('search').dispatchEvent(new Event('input'));
    el('instance').value='mumu-1'; el('instance').dispatchEvent(new Event('change'));
    assert.equal(el('detail-window').matches(':popover-open'),false,'switching instance closes stale details');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(Number(el('grid').dataset.total),cachedSecond.souls.length); assert.match(el('summary').textContent,/吃鱼/);
    assert.ok(el('grid').querySelector('img').naturalWidth>0,'legacy instance icons load after switching');
    assert.ok(el('detail').querySelector('img').naturalWidth>0,'detail icon loads for legacy instance');
    el('fetch').click(); assert.equal(pending.id,'mumu-1'); el('cancel').click(); await tick();
    assert.match(el('status').textContent,/取消/); assert.equal(el('fetch').disabled,false);
    el('instance').value='mumu-0'; el('instance').dispatchEvent(new Event('change'));
    await tick(); assert.ok(el('grid').querySelector('img').naturalWidth>0,'icons survive switching back');
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.length);
    el('fetch').click(); pending.reject(Error('实例已离线')); await tick();
    assert.match(el('status').textContent,/失败/); assert.equal(Number(el('grid').dataset.total),snapshot.souls.length);
    el('search').value='阴摩罗'; el('search').dispatchEvent(new Event('input'));
    assert.ok(el('grid').children.length>0);
    el('search').value='6aa3110adc3582670c657cff'; el('search').dispatchEvent(new Event('input'));
    document.querySelector('.soul-card').click();
    for (const value of ['攻击 +486.00', '攻击 +23.01', '速度 +16.60', '暴击 +2.94%', '效果命中 +3.90%', '未装备'])
      assert.ok(el('detail').textContent.includes(value), value);
    assert.equal(el('detail').textContent.includes('强化'),false,'upgrade descriptions are not visible');
    const subRows=Array.from(el('detail').querySelectorAll('.soul-sub-attribute'));
    const speedBadge=subRows.find(row=>row.textContent.includes('速度 +16.60')).querySelector('.soul-upgrade-count');
    assert.equal(speedBadge.textContent,'5','upgrade count uses a compact numeric badge');
    assert.equal(speedBadge.getAttribute('aria-label'),'强化 5 次');
    assert.equal(getComputedStyle(speedBadge).borderRadius,'50%','upgrade badge is circular');
    assert.equal(subRows.find(row=>row.textContent.includes('攻击 +23.01')).querySelector('.soul-upgrade-count'),null,'unupgraded attributes have no badge');
    await tick();
    assert.ok(el('detail').querySelector('img').naturalWidth > 0, 'official local icon loads');
    for (const sample of [snapshot.souls.find(s=>s.locked && s.equipped), snapshot.souls.find(s=>s.discarded)].filter(Boolean)) {
      el('search').value=sample.id; el('search').dispatchEvent(new Event('input')); document.querySelector('.soul-card').click();
      const tags=el('detail').querySelector('.soul-detail-badges');
      assert.equal(tags.querySelector('.soul-card-lock')?.textContent ?? '',sample.locked ? '锁' : '');
      assert.equal(tags.querySelector('.soul-card-equipped')?.textContent ?? '',sample.equipped ? '已装备' : '');
      assert.equal(tags.querySelector('.soul-card-discarded')?.getAttribute('aria-label') ?? '',sample.discarded ? '已弃置' : '');
      assert.ok(!tags.textContent.includes(' · '),'state labels do not use a plain text separator');
    }
    const intrinsicSoul=snapshot.souls.find(s=>s.intrinsicAttributes?.length && s.subAttributes?.length);
    assert.ok(intrinsicSoul,'fixture includes an intrinsic attribute');
    el('search').value=intrinsicSoul.id; el('search').dispatchEvent(new Event('input')); document.querySelector('.soul-card').click();
    const intrinsicRow=el('detail').querySelector('.soul-intrinsic-attribute');
    const intrinsicGroup=el('detail').querySelector('.soul-intrinsic-attributes');
    assert.equal(intrinsicRow.parentElement,intrinsicGroup,'intrinsic attributes have their own section');
    const lastSub=Array.from(el('detail').querySelectorAll('.soul-sub-attribute')).at(-1);
    assert.ok(lastSub.compareDocumentPosition(intrinsicGroup)&Node.DOCUMENT_POSITION_FOLLOWING,'intrinsic attributes follow all subattributes');
    assert.equal(getComputedStyle(intrinsicGroup).borderTopStyle,'solid','intrinsic section is separated by a rule');
    assert.ok(parseFloat(getComputedStyle(intrinsicGroup).paddingTop)>0,'intrinsic section has spacing');
    assert.ok(intrinsicRow.textContent.startsWith('固有属性：'));
    const greenProbe=document.createElement('span'); greenProbe.style.color='var(--green)'; el('detail').append(greenProbe);
    assert.equal(getComputedStyle(intrinsicRow).color,getComputedStyle(greenProbe).color,'intrinsic attribute uses the theme green'); greenProbe.remove();
    el('status').textContent='获取完成，已显示所选实例的御魂背包。';
    el('status').classList.remove('error');
    el('search').value=''; el('search').dispatchEvent(new Event('input'));
    document.querySelector('.soul-card').click();
    el('filter-toggle').click(); assert.equal(el('filter-drawer').hidden,false);
    document.querySelector('.soul-card').click();
    assert.equal(el('filter-drawer').hidden,false,'selecting a soul card keeps the filter panel open');
    await tick();
    const gridRect=el('grid').parentElement.getBoundingClientRect(),drawerRect=el('filter-drawer').getBoundingClientRect();
    assert.ok(el('grid').parentElement.clientWidth<fullWidth,'opening filters reserves space for the panel');
    assert.ok(gridRect.right<=drawerRect.left,'cards are not covered by the filter panel');
    assert.ok(el('grid').querySelectorAll('.soul-card').length>1,'grid remains usable alongside filters');
    const narrowedColumns=getComputedStyle(el('grid')).gridTemplateColumns.split(' ').length;
    el('filter-close').click(); await tick();
    assert.equal(el('grid').parentElement.clientWidth,fullWidth,'closing filters restores full-width results');
    assert.ok(getComputedStyle(el('grid')).gridTemplateColumns.split(' ').length>narrowedColumns,'cards reflow when filters close');
    el('filter-toggle').click(); await tick();
    const previewCard=el('grid').querySelector('.soul-card');
    previewCard.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
    assert.equal(el('detail-window').matches(':popover-open'),true,'hover details remain available alongside filters');
    previewCard.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));
    const filterLayout = () => {
      const area=document.querySelector('.soul-results-layout').getBoundingClientRect();
      const toolbar=document.querySelector('.soul-filters').getBoundingClientRect();
      const drawer=el('filter-drawer').getBoundingClientRect();
      return [area.top,area.bottom,toolbar.height,drawer.top,drawer.bottom];
    };
    const stableFilterLayout=filterLayout();
    const sample = snapshot.souls.find(s=>[2,4,6].includes(s.position) && s.level===15 && s.stars===6 && s.subAttributes.length>=2);
    const change = (id,value) => {
      if (id==='suit') {
        el('type-picker').open=true;
        el('type-search').value=sample.name; el('type-search').dispatchEvent(new Event('input'));
        Array.from(el('type-options').querySelectorAll('button')).find(button=>button.dataset.value===value).click();
      } else Array.from(document.querySelector('[data-soul-choice="soul-'+id+'"]').querySelectorAll('button')).find(button=>button.dataset.value===value).click();
      assert.ok(Array.from(el(id).selectedOptions).some(option=>option.value===value));
      assert.deepEqual(filterLayout(),stableFilterLayout,'adding filter chips does not move the results or filter panel');
    };
    change('suit',String(sample.suitId)); change('position',String(sample.position));
    change('level','15'); change('main-attribute',sample.mainAttribute.name);
    change('stars','6'); change('state',sample.equipped ? 'equipped' : 'unequipped');
    const required = sample.subAttributes.slice(0,2).map(attr=>attr.name);
    for (const name of required) {
      const check = Array.from(el('sub-attributes').querySelectorAll('input')).find(input=>input.value===name);
      check.parentElement.click(); assert.equal(check.checked,true);
    }
    const expected = snapshot.souls.filter(s=>s.suitId===sample.suitId && s.position===sample.position && s.level===15 && s.stars===6
      && s.equipped===sample.equipped && s.mainAttribute?.name===sample.mainAttribute.name
      && required.every(name=>s.subAttributes?.some(attr=>attr.name===name)||s.attributeRolls?.some(attr=>attr.name===name)));
    assert.ok(expected.length>0); assert.equal(Number(el('grid').dataset.total),expected.length);
    assert.ok(el('filter-summary').textContent.includes('符合 '+expected.length.toLocaleString()));
    assert.equal(el('detail-window').matches(':popover-open'),false);
    assert.ok(el('active-filters').querySelectorAll('button').length>1);
    assert.deepEqual(filterLayout(),stableFilterLayout,'many conditions remain within the existing toolbar');
    el('active-filters').querySelector('button').click(); assert.equal(el('stars').value,'');
    assert.deepEqual(filterLayout(),stableFilterLayout,'removing a filter chip does not move the layout');
    assert.equal(document.querySelector('[data-soul-choice="soul-stars"] button[data-value=""]').getAttribute('aria-pressed'),'true');
    el('search').value='____no_matching_soul____'; el('search').dispatchEvent(new Event('input'));
    assert.equal(el('grid').querySelectorAll('.soul-card').length,0); assert.equal(el('empty').hidden,false);
    assert.ok(el('detail').textContent.includes('选择'));
    el('filter-reset').click(); assert.equal(Number(el('grid').dataset.total),snapshot.souls.length);
    assert.equal(el('active-filters').hidden,true); assert.equal(el('filter-reset').disabled,true);
    assert.deepEqual(filterLayout(),stableFilterLayout,'clearing all conditions does not move the layout');
    assert.equal(el('sub-attributes').querySelectorAll('input:checked').length,0);
    // Position-specific main choices, fixed odd slots, and stale-condition removal.
    const mainValues=()=>Array.from(el('main-attribute').options,o=>o.value).filter(Boolean);
    const mainGroup=document.querySelector('[data-soul-choice="soul-main-attribute"]');
    change('position','2');
    assert.deepEqual(mainValues(),['attackAdditionRate','defenseAdditionRate','maxHpAdditionRate','speedAdditionVal']);
    change('main-attribute','speedAdditionVal');
    change('position','4');
    assert.ok(mainValues().includes('speedAdditionVal') && mainValues().includes('debuffEnhance'),'multiple positions use the union');
    assert.equal(el('main-attribute').selectedOptions[0].value,'speedAdditionVal');
    document.querySelector('[data-soul-choice="soul-position"] button[data-value="2"]').click();
    assert.deepEqual(mainValues(),['attackAdditionRate','defenseAdditionRate','maxHpAdditionRate','debuffEnhance','debuffResist']);
    assert.equal(el('main-attribute').selectedOptions.length,0,'speed is cleared before filtering slot 4');
    assert.equal(el('active-filters').textContent.includes('速度'),false,'stale speed chip is removed');
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>s.position===4).length);
    el('filter-reset').click(); change('position','6');
    assert.deepEqual(mainValues(),['attackAdditionRate','defenseAdditionRate','maxHpAdditionRate','critRateAdditionVal','critPowerAdditionVal']);
    for(const [position,name,label] of [['1','attackAdditionVal','攻击'],['3','defenseAdditionVal','防御'],['5','maxHpAdditionVal','生命']]) {
      el('filter-reset').click(); change('position',position);
      assert.deepEqual(mainValues(),[name]);
      assert.equal(mainGroup.textContent,label+'（固定）');
      assert.equal(mainGroup.querySelectorAll('button').length,0,'fixed main stat does not offer invalid choices');
      assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>s.position===Number(position)).length);
    }
    el('filter-reset').click();
    assert.equal(mainValues().length,11,'clearing position restores all main stats');
    change('sub-count','2');
    const twoEntries=snapshot.souls.filter(s=>new Set([...(s.subAttributes||[]).map(a=>a.name),...(s.attributeRolls||[]).map(a=>a.name)]).size===2);
    assert.ok(twoEntries.length>0,'fixture includes souls with two subattributes');
    assert.equal(Number(el('grid').dataset.total),twoEntries.length);
    assert.equal(el('active-filters').textContent,'副属性 2 条 ×');
    change('stars','6');
    assert.equal(Number(el('grid').dataset.total),twoEntries.filter(s=>s.stars===6).length);
    Array.from(el('active-filters').querySelectorAll('button')).find(b=>b.textContent.includes('副属性 2 条')).click();
    assert.equal(el('sub-count').value,'');
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>s.stars===6).length);
    change('sub-count','4'); el('filter-reset').click();
    assert.equal(el('sub-count').value,'');
    assert.equal(el('active-filters').hidden,true);
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.length);
    // Verify union of counts, deselection, and removal of one chip without clearing its peers.
    change('sub-count','2'); change('sub-count','4');
    const subCount=s=>new Set([...(s.subAttributes||[]).map(a=>a.name),...(s.attributeRolls||[]).map(a=>a.name)]).size;
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>[2,4].includes(subCount(s))).length);
    assert.equal(document.querySelectorAll('[data-soul-choice="soul-sub-count"] button[aria-pressed="true"]').length,2);
    Array.from(el('active-filters').querySelectorAll('button')).find(b=>b.textContent.includes('副属性 2 条')).click();
    assert.deepEqual(Array.from(el('sub-count').selectedOptions,o=>o.value),['4']);
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>subCount(s)===4).length);
    document.querySelector('[data-soul-choice="soul-sub-count"] button[data-value="4"]').click();
    assert.equal(el('active-filters').hidden,true);
    // All choice groups permit two simultaneous selections and clear independently with 全部.
    for(const id of ['position','stars','level','sub-count','state','main-attribute','intrinsic-attribute']) {
      const group=document.querySelector('[data-soul-choice="soul-'+id+'"]');
      const buttons=Array.from(group.querySelectorAll('button')).filter(button=>button.dataset.value);
      buttons[0].click(); buttons[1].click();
      assert.equal(group.querySelectorAll('button[aria-pressed="true"]').length,2,id+' supports multi-select');
      assert.equal(Array.from(el(id).selectedOptions).filter(o=>o.value).length,2);
      group.querySelector('button[data-value=""]').click();
      assert.equal(Number(el('grid').dataset.total),snapshot.souls.length,id+' 全部 clears the group');
    }
    el('type-search').value=''; el('type-search').dispatchEvent(new Event('input')); el('type-picker').open=true;
    const typeButtons=Array.from(el('type-options').querySelectorAll('button')).filter(b=>b.dataset.value);
    const selectedTypes=typeButtons.slice(0,2).map(b=>Number(b.dataset.value));
    typeButtons[0].click(); typeButtons[1].click();
    assert.equal(el('type-picker').open,true,'type picker stays open for multiple choices');
    assert.equal(el('type-options').querySelectorAll('button[aria-pressed="true"]').length,2);
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>selectedTypes.includes(s.suitId)).length);
    el('instance').value='mumu-1'; el('instance').dispatchEvent(new Event('change')); await tick();
    assert.deepEqual(Array.from(el('suit').selectedOptions,o=>Number(o.value)),selectedTypes,'switching instance preserves available type selections');
    el('instance').value='mumu-0'; el('instance').dispatchEvent(new Event('change')); await tick();
    el('filter-reset').click(); el('type-picker').open=false;
    assert.equal(el('active-filters').hidden,true); assert.equal(Number(el('grid').dataset.total),snapshot.souls.length);
    const includeSpeed=el('sub-attributes').querySelector('button[data-name="speedAdditionVal"][data-mode="include"]');
    const excludeHit=el('sub-attributes').querySelector('button[data-name="debuffEnhance"][data-mode="exclude"]');
    const hasSub=(s,name)=>s.subAttributes?.some(a=>a.name===name)||s.attributeRolls?.some(a=>a.name===name);
    includeSpeed.click(); excludeHit.click();
    assert.equal(includeSpeed.getAttribute('aria-pressed'),'true'); assert.equal(excludeHit.getAttribute('aria-pressed'),'true');
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>hasSub(s,'speedAdditionVal')&&!hasSub(s,'debuffEnhance')).length);
    assert.ok(el('active-filters').textContent.includes('排除副属性：效果命中'));
    const includeHit=el('sub-attributes').querySelector('button[data-name="debuffEnhance"][data-mode="include"]');
    includeHit.click(); assert.equal(excludeHit.getAttribute('aria-pressed'),'false');
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>hasSub(s,'speedAdditionVal')&&hasSub(s,'debuffEnhance')).length);
    includeHit.click(); assert.equal(includeHit.getAttribute('aria-pressed'),'false');
    excludeHit.click();
    Array.from(el('active-filters').querySelectorAll('button')).find(b=>b.textContent.includes('排除副属性：效果命中')).click();
    assert.equal(excludeHit.getAttribute('aria-pressed'),'false');
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.filter(s=>hasSub(s,'speedAdditionVal')).length);
    el('filter-reset').click(); assert.equal(el('sub-attributes').querySelectorAll('button[aria-pressed="true"]').length,0);
    const speedOf = soul => soul.subAttributes?.find(attr=>attr.name==='speedAdditionVal')?.value;
    const knownSpeed = snapshot.souls.filter(soul=>Number.isFinite(speedOf(soul)));
    assert.ok(knownSpeed.length>1);
    const fastest = souls => souls.reduce((best,soul)=>speedOf(soul)>speedOf(best)?soul:best);
    const slowest = knownSpeed.reduce((best,soul)=>speedOf(soul)<speedOf(best)?soul:best);
    const setSort = value => { el('sort').value=value; el('sort').dispatchEvent(new Event('change')); };
    const firstSoulId = () => el('grid').querySelector('.soul-card').dataset.soulId;
    const sortLayout = filterLayout();
    el('grid').parentElement.scrollTop=el('grid').parentElement.scrollHeight; await tick();
    setSort('sub:speedAdditionVal');
    assert.equal(firstSoulId(),fastest(knownSpeed).id,'highest decoded subattribute speed is first across the full inventory');
    assert.equal(el('grid').parentElement.scrollTop,0,'sorting returns to the first result');
    assert.equal(Number(el('grid').dataset.total),snapshot.souls.length,'sorting does not hide missing values');
    assert.ok(el('grid').querySelectorAll('.soul-card').length<150,'sorting preserves virtualization');
    el('sort-direction').click(); assert.equal(firstSoulId(),slowest.id,'ascending speed starts with the lowest available value');
    setSort('level'); el('sort-direction').click();
    const highestLevel = Math.max(...snapshot.souls.map(s=>s.level??-1));
    assert.equal(snapshot.souls.find(s=>s.id===firstSoulId()).level,highestLevel,'level sorting reaches the highest level');
    setSort('sub:speedAdditionVal');
    document.querySelector('[data-soul-choice="soul-position"] button[data-value="2"]').click();
    assert.equal(firstSoulId(),fastest(knownSpeed.filter(s=>s.position===2)).id,'sorting applies after filtering');
    el('filter-reset').click();
    assert.equal(el('sort').value,'sub:speedAdditionVal','clearing filters preserves sorting');
    assert.equal(firstSoulId(),fastest(knownSpeed).id);
    el('instance').value='mumu-1'; el('instance').dispatchEvent(new Event('change')); await tick();
    assert.equal(el('sort').value,'sub:speedAdditionVal','instance switching keeps the selected ordering');
    assert.equal(firstSoulId(),fastest(knownSpeed).id);
    el('instance').value='mumu-0'; el('instance').dispatchEvent(new Event('change')); await tick();
    setSort('default'); assert.equal(firstSoulId(),snapshot.souls[0].id,'default restores acquisition order');
    assert.equal(el('sort-direction').disabled,true);
    assert.deepEqual(filterLayout(),sortLayout,'changing sort keys and directions does not move the layout');
    el('filter-panel').scrollTop=0;
    await new Promise(resolve=>setTimeout(resolve,120));
    let scrolling;
    if (${process.argv.includes('--benchmark')}) {
      el('filter-toggle').click();
      const viewport=el('grid').parentElement;
      const intervals=[]; let previous;
      const observer=new PerformanceObserver(list=>intervals.longTasks=(intervals.longTasks||0)+list.getEntries().length);
      observer.observe({entryTypes:['longtask']});
      await new Promise(resolve=>{
        let frames=0;
        const frame=stamp=>{
          if(previous!==undefined && frames>10) intervals.push(stamp-previous);
          previous=stamp; viewport.scrollTop=(frames*350)%(viewport.scrollHeight-viewport.clientHeight);
          if(++frames<160) requestAnimationFrame(frame); else resolve();
        }; requestAnimationFrame(frame);
      });
      observer.disconnect();
      const sorted=intervals.slice().sort((a,b)=>a-b);
      scrolling={p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),longTasks:intervals.longTasks||0,cards:el('grid').querySelectorAll('.soul-card').length};
      viewport.scrollTop=0; await tick();
    }
    return { selectionAndIsolation:true, legacyInstanceIcons:true, progress:true, cancellation:true, filterAndContinuousScroll:true, reachesLastSoul:true, selectionMs, combinedFilters:true, filterReset:true, chipRemoval:true, visualTypePicker:true, preservedOnFailure:true, detailedAttributes:true, localIcon:true, displayed:snapshot.souls.length,scrolling };
  })()`);
  if (metricsBefore) {
    const after=(await win.webContents.debugger.sendCommand('Performance.getMetrics')).metrics;
    result.scrolling.rendererWorkMs=Object.fromEntries(['LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].map(name=>[name,
      Math.round((after.find(m=>m.name===name).value-metricsBefore.find(m=>m.name===name).value)*1000)]));
    win.webContents.debugger.detach();
  }
  fs.writeFileSync(path.join(artifacts, 'wide.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(1600, 1000);
  await win.webContents.executeJavaScript(`document.fonts.ready.then(()=>new Promise(resolve=>setTimeout(resolve,100)))`);
  fs.writeFileSync(path.join(artifacts, 'workbench-layout.png'), (await win.webContents.capturePage()).toPNG());
  for(const [id,filename] of [['soul-instance','instance-dropdown-dark.png'],['soul-sort','sort-dropdown-feedback.png']]) {
    const pickerPoint=await win.webContents.executeJavaScript(`(()=>{
      const assert=require('node:assert/strict'),select=document.getElementById(${JSON.stringify(id)});
      assert.equal(CSS.supports('appearance','base-select'),true);
      assert.equal(getComputedStyle(select).appearance,'base-select');
      window.closedPickerIcon=getComputedStyle(select,'::picker-icon').transform;
      window.closedPickerBackground=getComputedStyle(select).backgroundColor;
      const r=select.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
    })()`);
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,...pickerPoint});
    await new Promise(resolve=>setTimeout(resolve,180));
    await win.webContents.executeJavaScript(`(()=>{
      const assert=require('node:assert/strict'),select=document.getElementById(${JSON.stringify(id)});
      assert.equal(select.matches(':open'),true);
      const style=getComputedStyle(select,'::picker(select)');assert.equal(style.borderTopWidth,'0px');assert.notEqual(style.boxShadow,'none');
      assert.notEqual(getComputedStyle(select,'::picker-icon').transform,window.closedPickerIcon,'open rotates the arrow');
      assert.notEqual(getComputedStyle(select).backgroundColor,window.closedPickerBackground,'open visibly changes the field background');
    })()`);
    fs.writeFileSync(path.join(artifacts,filename),(await win.webContents.capturePage()).toPNG());
    for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Escape'});
    await new Promise(resolve=>setTimeout(resolve,180));
    await win.webContents.executeJavaScript(`(()=>{
      const assert=require('node:assert/strict'),select=document.getElementById(${JSON.stringify(id)});
      assert.equal(select.matches(':open'),false,'Escape closes picker');
      assert.equal(getComputedStyle(select,'::picker-icon').transform,window.closedPickerIcon,'close restores arrow');
    })()`);
  }
  await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('node:assert/strict'),note=document.querySelector('.soul-note'),summary=note.querySelector('summary');
    const closed=getComputedStyle(summary,'::before').transform;
    summary.click();await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal(note.open,true);assert.notEqual(getComputedStyle(summary,'::before').transform,closed);
    summary.click();await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal(note.open,false);assert.equal(getComputedStyle(summary,'::before').transform,closed);
  })()`);
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';new Promise(resolve=>setTimeout(resolve,100))`);
  fs.writeFileSync(path.join(artifacts, 'workbench-light.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
  await win.webContents.executeJavaScript(`document.getElementById('soul-sort').value='sub:speedAdditionVal';document.getElementById('soul-sort').dispatchEvent(new Event('change'));new Promise(resolve=>setTimeout(resolve,100))`);
  fs.writeFileSync(path.join(artifacts, 'sort-speed.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('soul-sort').value='default';document.getElementById('soul-sort').dispatchEvent(new Event('change'))`);
  win.setContentSize(1000, 1400);
  await win.webContents.executeJavaScript(`(async()=>{
    const el=id=>document.getElementById('soul-'+id);
    if(el('filter-drawer').hidden) el('filter-toggle').click();
    for(const [id,value] of [['stars','6'],['level','0-2'],['sub-count','4']]) document.querySelector('[data-soul-choice="soul-'+id+'"] button[data-value="'+value+'"]').click();
    el('sub-attributes').querySelector('button[data-name="speedAdditionVal"][data-mode="include"]').click();
    el('sub-attributes').querySelector('button[data-name="debuffEnhance"][data-mode="exclude"]').click();
    el('filter-panel').scrollTop=0; await new Promise(resolve=>setTimeout(resolve,120));
  })()`);
  const filterRect = await win.webContents.executeJavaScript(`(()=>{const r=document.getElementById('soul-filter-drawer').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
  fs.writeFileSync(path.join(artifacts,'filter-layout.png'),(await win.webContents.capturePage(filterRect)).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('soul-filter-reset').click()`);
  win.setContentSize(1000,730);
  await win.webContents.executeJavaScript(`document.getElementById('soul-type-picker').open=true;document.getElementById('soul-filter-panel').scrollTop=0;new Promise(resolve=>setTimeout(resolve,120))`);
  fs.writeFileSync(path.join(artifacts, 'filter-types.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('soul-type-picker').open=false`);
  win.setContentSize(440, 720);
  await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,100))`);
  const narrow = await win.webContents.executeJavaScript(`({ width:document.getElementById('team-builder-soul-calculator').clientWidth, height:document.querySelector('.soul-results').clientHeight, gridWidth:document.querySelector('.soul-results').clientWidth, fetchVisible:document.getElementById('soul-fetch').getBoundingClientRect().right<=innerWidth, drawerFits:document.getElementById('soul-filter-drawer').getBoundingClientRect().right<=innerWidth })`);
  if (!narrow.fetchVisible || narrow.height < 80 || narrow.gridWidth < 380 || !narrow.drawerFits) throw Error('Narrow panel controls or grid are clipped');
  await win.webContents.executeJavaScript(`(()=>{
    const grid=document.querySelector('.soul-results').getBoundingClientRect(),drawer=document.getElementById('soul-filter-drawer').getBoundingClientRect();
    if(grid.bottom>drawer.top || drawer.bottom>innerHeight || drawer.height<80) throw Error('Narrow filters overlap or clip results');
    const panel=document.getElementById('soul-filter-panel');
    if(panel.scrollWidth>panel.clientWidth) throw Error('Narrow filter rows overflow horizontally');
    for(const name of document.querySelectorAll('.soul-sub-name')) if(name.scrollWidth>name.clientWidth) throw Error('Subattribute label is clipped');
    const rows=document.querySelectorAll('.soul-sub-rule'),first=rows[0].getBoundingClientRect(),second=rows[1].getBoundingClientRect();
    if(first.top!==second.top || first.left===second.left) throw Error('Subattributes do not use two columns');
    panel.scrollTop=panel.scrollHeight;
    const count=document.querySelector('[data-soul-choice="soul-sub-count"]').getBoundingClientRect();
    const bounds=panel.getBoundingClientRect();
    if(count.bottom>bounds.bottom || count.top<bounds.top) throw Error('Subattribute count cannot be reached by scrolling');
    panel.scrollTop=0;
    for(const [id,value] of [['stars','6'],['sub-count','4']]) document.querySelector('[data-soul-choice="soul-'+id+'"] button[data-value="'+value+'"]').click();
    document.getElementById('soul-sub-attributes').querySelector('button[data-name="speedAdditionVal"][data-mode="include"]').click();
    const nextGrid=document.querySelector('.soul-results').getBoundingClientRect(),nextDrawer=document.getElementById('soul-filter-drawer').getBoundingClientRect();
    if(nextGrid.top!==grid.top || nextGrid.bottom!==grid.bottom || nextDrawer.top!==drawer.top || nextDrawer.bottom!==drawer.bottom) throw Error('Narrow filter chips push the layout down');
    const chips=document.getElementById('soul-active-filters'),bar=document.querySelector('.soul-filters').getBoundingClientRect(),chipBounds=chips.getBoundingClientRect();
    if(chipBounds.top<bar.top || chipBounds.bottom>bar.bottom || chips.scrollWidth<=chips.clientWidth) throw Error('Narrow conditions do not scroll within the search toolbar');
    if(document.getElementById('soul-filter-toggle').getBoundingClientRect().right>innerWidth || document.getElementById('soul-search').getBoundingClientRect().width<80) throw Error('Conditions hide the narrow search or filter control');
    chips.querySelector('button').click();
    if(document.querySelector('.soul-results').getBoundingClientRect().top!==grid.top) throw Error('Removing narrow conditions moves the grid');
  })()`);
  await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,100))`);
  fs.writeFileSync(path.join(artifacts, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('soul-filter-reset').click()`);
  const resized = await win.webContents.executeJavaScript(`(async()=>{
    const grid=document.getElementById('soul-grid'),viewport=grid.parentElement;
    const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
    viewport.scrollTop=viewport.scrollHeight; await tick();
    const last=grid.querySelector('li[data-index="'+(Number(grid.dataset.total)-1)+'"] .soul-card');
    if(!last) throw Error('Last soul disappears after changing column count');
    last.click();
    if(!document.getElementById('soul-detail').textContent.includes(last.dataset.soulId)) throw Error('Recycled card shows wrong details');
    const popup=document.getElementById('soul-detail-window').getBoundingClientRect();
    if(popup.left<0 || popup.top<0 || popup.right>innerWidth || popup.bottom>innerHeight) throw Error('Narrow detail popup is clipped');
    const cards=grid.querySelectorAll('.soul-card').length;
    if(cards>100) throw Error('Resize renders too many cards');
    viewport.scrollTop=0; await tick();
    return {lastSoulReachable:true,cards};
  })()`);
  // Trusted pointer movement checks real hit testing, including a narrow popup overlapping cards.
  const hoverCards = await win.webContents.executeJavaScript(`(()=>{
    document.getElementById('soul-filter-close').click();
    return Array.from(document.querySelectorAll('.soul-card')).slice(0,2).map(card=>{
      const r=card.getBoundingClientRect(); return {id:card.dataset.soulId,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
    });
  })()`);
  for(const card of hoverCards) {
    win.webContents.sendInputEvent({type:'mouseMove',x:card.x,y:card.y});
    await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(resolve))`);
    const hovered = await win.webContents.executeJavaScript(`(()=>{const p=document.getElementById('soul-detail-window'),r=p.getBoundingClientRect();return {open:p.matches(':popover-open'),text:p.textContent,left:r.left,top:r.top,right:r.right,bottom:r.bottom};})()`);
    if(!hovered.open || !hovered.text.includes(card.id)) throw Error('Hover shows incorrect or missing details');
    if(hovered.left<0 || hovered.top<0 || hovered.right>440 || hovered.bottom>720) throw Error('Hover popup leaves the viewport');
  }
  fs.writeFileSync(path.join(artifacts, 'detail-float.png'), (await win.webContents.capturePage()).toPNG());
  const badgeSample = saved.souls.find(s=>s.locked && s.equipped);
  await win.webContents.executeJavaScript(`(()=>{const input=document.getElementById('soul-search'); input.value=${JSON.stringify(badgeSample.id)}; input.dispatchEvent(new Event('input')); document.querySelector('.soul-card').click();})()`);
  await new Promise(resolve=>setTimeout(resolve,80));
  fs.writeFileSync(path.join(artifacts, 'detail-status-tags.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(()=>{const input=document.getElementById('soul-search'); input.value=''; input.dispatchEvent(new Event('input'));})()`);
  win.webContents.sendInputEvent({type:'mouseMove',x:8,y:8});
  await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,180))`);
  if(await win.webContents.executeJavaScript(`document.getElementById('soul-detail-window').matches(':popover-open')`)) throw Error('Leaving the grid leaves a floating popup');
  win.webContents.sendInputEvent({type:'mouseMove',x:hoverCards[0].x,y:hoverCards[0].y});
  await win.webContents.executeJavaScript(`window.disposeSoul()`);
  await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,180))`);
  if(await win.webContents.executeJavaScript(`document.getElementById('soul-detail-window').matches(':popover-open')`)) throw Error('Disposal leaves a floating popup');
  console.log(JSON.stringify({ ...result, positionSpecificMainAttributes: true, fixedOddMainAttributes: true, staleMainFilterRemoval: true, fullInventorySorting: true, filterLayoutStable: true, subAttributeExclusion: true, multiSelectFilters: true, hoverDetails: true, leaveHidesDetails: true, narrow, resized }));
  if (result.scrolling) fs.writeFileSync(path.join(artifacts, process.argv.includes('--baseline')?'scroll-baseline.json':'scroll-optimized.json'), JSON.stringify(result.scrolling,null,2));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
