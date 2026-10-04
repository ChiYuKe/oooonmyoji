// Real Electron DOM and production search worker; isolated inventory and favorites.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), out = path.join(path.dirname(root), 'artifacts/soul-ui');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(out, 'favorites-user-data'));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const html = path.join(out, 'soul-favorites.html');
  fs.writeFileSync(html, '<!doctype html><html><meta charset="UTF-8"><body><section id="host"></section></body></html>');
  const workerFile = fs.readdirSync(path.join(root, 'dist/renderer/assets')).find(name => /^soul-optimizer-worker-.*\.js$/.test(name));
  if (!workerFile) throw Error('Build the production worker first');
  const workerURL = pathToFileURL(path.join(root, 'dist/renderer/assets', workerFile)).href;
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  await win.loadFile(html);
  const result = await win.webContents.executeJavaScript(`(async () => {
    try {
      const assert = require('node:assert/strict');
      const { installSoulOptimizer } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/soul-optimizer-view.js'))});
      const attr = (name, value) => ({ name, value, label: name, percent: !['attackAdditionVal','defenseAdditionVal','maxHpAdditionVal','speedAdditionVal'].includes(name), rolls: 1 });
      const mains = [['attackAdditionVal',486],['attackAdditionRate',.55],['defenseAdditionVal',104],['attackAdditionRate',.55],['maxHpAdditionVal',2052],['critRateAdditionVal',.55]];
      const souls = mains.flatMap(([name,value], i) => [0,1].map(j => ({ id: i+'-'+j, position: i+1, suitId: 300030, stars: 6, level: 15,
        attributesComplete: true, mainAttribute: attr(name,value), subAttributes: [attr('critPowerAdditionVal',.08+j*.04),attr('speedAdditionVal',2+j)], intrinsicAttributes: [] })));
      const store = new Map(); let searches = 0, lastOptions;
      const controller = installSoulOptimizer(document.getElementById('host'), { readLayout: key => store.get(key) ?? null, writeLayout: (key,value) => store.set(key,value) }, () => {
        searches++; const worker = new Worker(${JSON.stringify(workerURL)}, { type: 'module' });
        const post = worker.postMessage.bind(worker); worker.postMessage = message => { if(message.type === 'start') lastOptions = message.options; post(message); }; return worker;
      });
      controller.update({ instanceId:'favorites-fixture', fetchedAt:'2026-10-05T00:00:00Z', source:'memory', total:souls.length, failed:0, warnings:[], souls });
      const panel = document.getElementById('soul-optimizer'), el = name => panel.querySelector('[data-ui="'+name+'"]');
      const tick = () => new Promise(resolve => setTimeout(resolve,20));
      const run = async () => { panel.querySelector('[data-action="start"]').click(); const until=Date.now()+5000;
        while(el('settings').disabled) { if(Date.now()>until) throw Error('Search timed out'); await tick(); } assert.ok(el('results').children.length); };
      const change = (name,value) => { el(name).value=value; el(name).dispatchEvent(new Event('change',{bubbles:true})); };
      const savedData = () => JSON.parse(store.get('onmyoji-studio.souls.plans.favorites-fixture') ?? '[]');
      const capture = () => ({ cards: [...el('results').children], source: el('target-source').value, analysis: el('target-analysis').innerHTML,
        scores: [...el('results').children].map(card=>card.dataset.score), sort: el('result-sort').value, count: el('result-total').textContent,
        note: el('result-note').textContent, searches });
      const unchanged = before => {
        assert.deepEqual([...el('results').children],before.cards,'all existing result nodes and expanded details survive deletion');
        assert.deepEqual([...el('results').children].map(card=>card.dataset.score),before.scores);
        assert.equal(el('target-source').value,before.source); assert.equal(el('target-analysis').innerHTML,before.analysis);
        assert.equal(el('result-sort').value,before.sort); assert.equal(el('result-total').textContent,before.count); assert.equal(el('result-note').textContent,before.note);
        assert.equal(searches,before.searches,'deleting a favorite never starts another search'); assert.equal(el('result-sort').disabled,false);
      };
      await run(); assert.equal(el('results').children.length,20);
      change('target','27000'); change('target-source','1'); change('result-sort','speed');
      const card=el('results').firstElementChild, save=card.querySelector('[data-action="save-plan"]'); card.querySelector('details').open=true;
      save.click(); assert.equal(save.disabled,true); assert.equal(savedData().length,1);
      const before=capture(), status=el('status').textContent;
      el('saved').querySelector('[data-action="delete-plan"]').click(); unchanged(before);
      assert.equal(card.querySelector('details').open,true); assert.equal(el('status').textContent,status);
      assert.equal(save.disabled,false); assert.equal(save.textContent,'收藏方案'); assert.equal(savedData().length,0);
      assert.equal(el('saved-total').textContent,'0'); assert.equal(el('exclusions').querySelectorAll('input').length,0);
      // Re-save the same live card, then also save another plan.
      save.click(); el('results').children[1].querySelector('[data-action="save-plan"]').click(); assert.equal(savedData().length,2);
      const otherKey=savedData()[1].key, excluded=el('exclusions').querySelector('input');
      const excludedIds=savedData()[0].plan.ids; excluded.checked=true; excluded.dispatchEvent(new Event('change',{bubbles:true}));
      assert.equal(el('results').children.length,0,'explicit checkbox changes still invalidate search conditions');
      await run(); assert.deepEqual([...lastOptions.excludedIds].sort(),[...excludedIds].sort());
      assert.ok([...el('results').children].every(card=>card.dataset.planIds.split('|').every(id=>!excludedIds.includes(id))));
      change('target-source','0'); const excludedBefore=capture();
      el('saved').querySelector('[data-action="delete-plan"]').click(); unchanged(excludedBefore);
      assert.match(el('status').textContent,/当前结果已保留.*下次计算生效/);
      assert.equal(savedData().length,1); assert.equal(savedData()[0].key,otherKey,'unrelated favorites stay saved');
      assert.equal(el('exclusions').querySelectorAll('input:checked').length,0);
      await run(); assert.deepEqual(lastOptions.excludedIds,[],'deleted exclusion only changes the next explicit search');
      const restored=el('results').querySelector('[data-plan-ids="'+excludedIds.join('|')+'"]'); assert.ok(restored,'previously excluded gear can participate again');
      assert.equal(restored.querySelector('[data-action="save-plan"]').disabled,false);
      controller.update({ instanceId:'favorites-fixture', fetchedAt:'2026-10-05T00:00:00Z', source:'memory', total:souls.length, failed:0, warnings:[], souls });
      assert.equal(el('saved').children.length,1,'only the remaining favorite is restored');
      assert.ok(el('saved').firstElementChild.dataset.planIds === savedData()[0].plan.ids.join('|'));
      controller.dispose(); return { retainedResults:true, retainedSortAndDetails:true, retainedAnalysis:true, favoriteButtonReset:true, canSaveAgain:true, removedExclusionNextSearch:true, persistedDeletion:true, searches };
    } catch(error) { return { error: String(error), stack: error.stack }; }
  })()`);
  if(result.error) throw Error(result.stack || result.error);
  console.log(JSON.stringify(result)); win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
