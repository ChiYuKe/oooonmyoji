// Runs the real result view with the modular engine and isolated local data.
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readExpandedHtml, readExpandedCss } = require('./renderer-templates.cjs');
const root = path.resolve(__dirname, '..');
const project = path.dirname(root);
const out = path.join(project, 'artifacts/soul-ui');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(out, 'duel-result-layout-user-data'));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  protocol.handle('onmyoji-resource', request => {
    const match = new URL(request.url).pathname.match(/^\/assets\/(hero|soul|skill)-icons\/(\d+)\.png$/);
    const file = match && path.join(project, 'assets', `${match[1]}-icons`, `${match[2]}.png`);
    return file && fs.existsSync(file) ? net.fetch(pathToFileURL(file).href) : new Response('', { status: 404 });
  });
  const source = readExpandedHtml(path.join(root, 'src/renderer/index.html'));
  const markup = source.slice(source.indexOf('<section id="module-duel-prediction"'), source.indexOf('<section id="module-soul-calculator"'));
  const css = readExpandedCss(path.join(root, 'src/renderer/styles/workbench.css')).replace(/^@import[^;]*;/, '')
    + fs.readFileSync(path.join(root, 'public/theme/theme.css'), 'utf8');
  const file = path.join(out, 'duel-result-layout.html');
  fs.writeFileSync(file, `<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><style>${css}
    html,body{margin:0;height:100%}#module-duel-prediction{display:grid;height:100vh}
    </style><body>${markup}</body></html>`);
  const win = new BrowserWindow({ show: false, width: 1843, height: 1100,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true } });
  await win.loadFile(file);
  const compiled = path.join(root, 'dist-test-renderer');
  const report = await win.webContents.executeJavaScript(`(async () => {
    const assert = require('node:assert/strict');
    const base = ${JSON.stringify(compiled)};
    const { soulCatalog } = require(base + '/shared/soul-catalog-data.js');
    const engine = require(base + '/renderer/features/duel/engine/battle-engine.js');
    const { groupBattleLog, renderBattleLog } = require(base + '/renderer/features/duel/engine/battle-log.js');
    const legacy = ['开局鬼火：蓝方 4，红方 4。', '行动条到达顺序：蓝方·追月神（速度 181）。',
      '行动 1｜蓝方·追月神使用技能「清辉月华」（鬼火 5→3）。', '蓝方·追月神状态变化：攻击+20%。',
      '行动 2｜红方·判官使用普攻（鬼火 4）。', '攻击 蓝方·追月神：13000 点生命伤害，剩余生命 0。', '样例对局结束：红方获胜。'];
    assert.deepEqual(groupBattleLog(legacy).map(g => g.phase), ['opening','action','action','ending']);
    assert.equal(groupBattleLog(legacy)[1].lines[0], legacy[1]);
    const modern = ['战斗开始。', '蓝方·追月神的回合开始。', '蓝方鬼火：4→2。',
      '蓝方·追月神使用技能「清辉月华」。', '蓝方·追月神获得庇护。', '蓝方·追月神的回合结束。',
      '红方·判官的回合开始。', '红方·判官使用通用普攻（判官的技能规则尚未迁移）。',
      '蓝方·追月神受到100点伤害。', '蓝方·追月神损失100点生命。', '蓝方·追月神被击败。',
      '红方·判官恢复50点生命。', '红方·判官受到控制：眩晕。', '红方·判官的回合结束。',
      '蓝方·大天狗的回合开始。', '蓝方·大天狗本次无法行动。', '对局结束：红方获胜（全灭结束）。'];
    const grouped = groupBattleLog(modern);
    assert.deepEqual(grouped.map(g => g.phase), ['opening','action','action','action','ending']);
    assert.deepEqual(grouped.filter(g => g.phase === 'action').map(g => g.side), ['blue','red','blue']);
    assert.deepEqual(grouped.filter(g => g.phase === 'action').map(g => g.action), [1,2,3]);
    assert.deepEqual(grouped[1].lines.slice(0,2), modern.slice(1,3));
    assert.equal(grouped.reduce((n,g) => n + g.lines.length + (g.phase === 'action' ? 1 : 0), 0), modern.length, 'no records lost');
    const rendered = renderBattleLog(document, modern);
    for (const kind of ['damage','defeat','heal','control']) assert.ok(rendered.querySelector('.duel-event-' + kind), kind);
    assert.ok(rendered.querySelector('.duel-action-actor img'), 'hero avatars');
    assert.ok(rendered.querySelector('.duel-log-skill-icon img'), 'skill icons');
    const Module = require('node:module'), load = Module._load;
    let lastOutcome;
    class ControlledWorker {
      postMessage(message) {
        setTimeout(() => {
          if (message.type === 'start') {
            this.state = message.state;
            const result = engine.simulateBattle(message.state, message.runs);
            if (window.hidePreviewDiagnostics) result.diagnostics = [];
            lastOutcome = result;
            this.onmessage?.({data: {type:'result', taskId:message.taskId, result}});
          } else if (message.type === 'sample') {
            const sample = engine.simulateBattleSampleDetails(this.state, message.index);
            this.onmessage?.({data: {type:'sample', taskId:message.taskId, index:message.index, ...sample}});
          }
        }, 0);
      }
      terminate() {}
    }
    Module._load = function(id, ...args) { return id.endsWith('worker?worker') ? ControlledWorker : load.call(this, id, ...args); };
    const { installDuelPredictionPanel } = require(base + '/renderer/features/duel/prediction/view.js');
    Module._load = load;
    const fighter = (name, soulId, values) => {
      const hero = soulCatalog.heroes.find(h => h.name === name); assert.ok(hero, name);
      assert.ok(soulCatalog.suits.some(s => s.id === soulId), 'soul ' + soulId);
      return {heroId:hero.id, fourSuit:String(soulId), skillLevel:5, panel:{
        attack:values[0], hp:values[1], defense:values[2], speed:values[3], crit:values[4] / 100,
        critDamage:values[5] / 100, hit:values[6] / 100, resist:values[7] / 100}};
    };
    const state = {
      red:[
        fighter('慧明灯',300090,[3413,23984,899,212,30,150,0,125]),
        fighter('荒骷髅',300021,[3001,28171,545,208,3,150,0,56]),
        fighter('追月神',300021,[2791,26935,743,181,5,150,0,64]),
        fighter('御馔津',300030,[4928,15964,648,137,105,220,60,56]),
        fighter('不知火',300034,[4773,12666,529,135,25,185,15,48]),
      ],
      blue:[
        fighter('天井下',300007,[2737,23586,799,181,20,150,0,64]),
        fighter('初翎山风',300022,[5661,13446,519,152,67,178,0,0]),
        fighter('犬夜叉',300036,[5067,16864,744,132,95,185,0,144]),
        fighter('化鲸',300033,[4520,18145,686,129,25,227,0,63]),
        fighter('萤草',300080,[5256,14585,668,115,80,255,0,55]),
      ],
    };
    localStorage.clear(); localStorage.setItem('onmyoji-studio.duel-prediction.v1', JSON.stringify(state));
    localStorage.setItem('onmyoji-studio.duel-prediction.v1.runs', '3');
    window.onmyoji = {listInstances: async () => []};
    const host = document.getElementById('module-duel-prediction');
    window.disposePreview = installDuelPredictionPanel(host);
    window.waitPreview = async predicate => {
      for (let i=0;i<100;i++) { if(predicate())return; await new Promise(r=>setTimeout(r,30)); }
      throw new Error('Preview timed out: ' + host.textContent.slice(-800));
    };
    window.runPreview = async () => {
      document.querySelector('.duel-run-button').click();
      await waitPreview(() => document.querySelector('.duel-battle-log'));
      await new Promise(r=>setTimeout(r,100));
    };
    await runPreview();
    const actualGroups = groupBattleLog(lastOutcome.sampleLog);
    assert.ok(actualGroups.filter(g => g.phase === 'action').length > 2, 'real modular battle is grouped');
    assert.equal(actualGroups[0].phase,'opening'); assert.ok(actualGroups[0].lines.length < 20, 'opening does not swallow battle');
    assert.equal(actualGroups.at(-1).phase,'ending');
    assert.ok(document.querySelector('.duel-result-warning'));
    assert.ok(document.querySelector('.duel-coverage-diagnostics'));
    window.checkPreview = () => {
      const output = document.querySelector('.duel-simulation-output');
      const log = output.querySelector('.duel-battle-log'), entries = log.querySelector('ol');
      const bounds = output.getBoundingClientRect(), list = entries.getBoundingClientRect();
      const page = document.getElementById('duel-prediction-page-simulation').getBoundingClientRect();
      if (getComputedStyle(output).position === 'sticky') {
        assert.ok(bounds.bottom <= page.bottom + 1, 'output fits dock height');
        assert.ok(list.bottom <= bounds.bottom + 1, 'log fits panel');
        assert.ok(list.height > 140, 'remaining space is available to log');
        const metadata = [...output.querySelector('.duel-simulation-result').children].filter(el=>el!==log);
        assert.ok(metadata.every(el=>el.getBoundingClientRect().height < 185), 'metadata has natural height');
        const last = metadata.at(-1).getBoundingClientRect();
        assert.ok(log.getBoundingClientRect().top-last.bottom < 20, 'no large blank gap before log');
      }
      assert.ok(entries.scrollHeight > entries.clientHeight, 'independent log scrolling');
      entries.scrollTop = 100; assert.ok(entries.scrollTop > 0); entries.scrollTop = 0;
      const coverage = output.querySelector('.duel-coverage-diagnostics');
      if (coverage?.open) {
        assert.equal(coverage.querySelectorAll('li').length, 13, 'all remaining screenshot lineup coverage items are listed');
        assert.ok(!coverage.textContent.includes('另有'), 'no coverage items are hidden behind a summary');
      }
    };
    checkPreview();
    document.querySelector('[data-log-filter="blue"]').click();
    assert.ok([...document.querySelectorAll('[data-log-side="red"]')].every(el=>el.hidden), 'blue filter works');
    document.querySelector('[data-log-filter="all"]').click();
    const input = document.querySelector('.duel-match-number'); input.value='2'; input.dispatchEvent(new Event('change'));
    await waitPreview(()=>document.querySelector('.duel-match-number').value==='2' && document.querySelector('.duel-battle-log summary').textContent.includes('第 2 /'));
    checkPreview();
    return {legacyAndModularGroups:true,recordsPreserved:true,eventKindsAndIcons:true,realBattle:true,sideFilters:true,sampleSwitching:true};
  })()`);
  const pause = () => new Promise(r => setTimeout(r, 150));
  const capture = async name => { await pause(); fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG()); };
  await capture('duel-result-layout-fixed.png');
  for (const height of [850, 1200]) {
    win.setContentSize(1843, height); await pause(); await win.webContents.executeJavaScript('checkPreview()');
  }
  await win.webContents.executeJavaScript("document.querySelector('.duel-coverage-diagnostics').open=true");
  await pause(); await win.webContents.executeJavaScript('checkPreview()');
  await win.webContents.executeJavaScript('window.hidePreviewDiagnostics=true;runPreview()');
  await win.webContents.executeJavaScript('checkPreview()');
  win.setContentSize(520, 1000); await pause();
  await win.webContents.executeJavaScript('checkPreview()');
  await capture('duel-result-layout-narrow.png');
  await win.webContents.executeJavaScript('disposePreview()');
  console.log(JSON.stringify({ ...report, withAndWithoutDiagnostics:true,expandedDiagnostics:true,responsiveHeight:true,narrowLayout:true }));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
