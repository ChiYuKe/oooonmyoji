const { readExpandedHtml, readExpandedCss } = require('./renderer-templates.cjs');
// Real renderer, saved inventory and controlled search replies; no device or account writes.
const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),project=path.dirname(root),out=path.join(project,'artifacts/soul-ui');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData',path.join(out,'speed-style-user-data'));
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});
  protocol.handle('onmyoji-resource',request=>{
    const match=new URL(request.url).pathname.match(/^\/assets\/(hero|soul)-icons\/(\d+)\.png$/);
    const file=match&&path.join(project,'assets',match[1]+'-icons',match[2]+'.png');
    return file&&fs.existsSync(file)?net.fetch(pathToFileURL(file).href):new Response('',{status:404});
  });
  const snapshot=await new(require('../dist-electron/main/soulService').SoulService)(project).load('mumu-1');
  if(!snapshot?.souls.length)throw Error('Missing preview inventory');
  const styles=[readExpandedCss(path.join(root,'src/renderer/styles/workbench.css')).replace(/^@import[^;]*;/,''),...['workbench-light.css','theme.css'].map(name=>fs.readFileSync(path.join(root,'public/theme',name),'utf8'))].join('\n');
  const file=path.join(out,'speed-style.html');
  fs.writeFileSync(file,`<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><style>${styles}\nhtml,body{margin:0;height:100%}#speed{height:100vh}</style><body><section id="speed"></section></body></html>`);
  const win=new BrowserWindow({show:false,width:1040,height:1150,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true}});
  await win.loadFile(file);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('node:assert/strict');
    const {installSoulSpeedCalculator}=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/soul-speed-calculator'))});
    const {evaluatePlan}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/soul-optimizer'))});
    const {soulCatalog}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/soul-catalog-data'))});
    const snapshot=${JSON.stringify(snapshot)},host=document.getElementById('speed'),stored=new Map(),messages=[],used=new Set();
    const speed=s=>[s.mainAttribute,...s.subAttributes,...(s.intrinsicAttributes??[])].reduce((sum,a)=>sum+(a?.name==='speedAdditionVal'?a.value:0),0);
    const fixtures=Array.from({length:100},()=>{const suits=new Set();const gear=Array.from({length:6},(_,i)=>{
      const soul=snapshot.souls.filter(s=>s.position===i+1&&!used.has(s.id)&&!suits.has(s.suitId)&&s.attributesComplete).sort((a,b)=>speed(b)-speed(a))[0];
      assert.ok(soul);used.add(soul.id);suits.add(soul.suitId);return soul;
    });const panel=evaluatePlan(gear,{attack:0,hp:0,defense:0,speed:0,crit:0,critDamage:0,hit:0,resist:0},soulCatalog.suits);return {ids:gear.map(s=>s.id),panel,score:panel.speed,suits:[]}}).sort((a,b)=>b.panel.speed-a.panel.speed);
    let worker,index=0;
    const storage={readLayout:k=>stored.get(k)??null,writeLayout:(k,v)=>stored.set(k,v)};
    const createWorker=()=>worker={terminate(){},postMessage(message){
      messages.push(message);queueMicrotask(()=>worker.onmessage({data:{type:'result',result:{plans:[fixtures[index++]],status:'complete',elapsed:0,visited:1,found:1,skipped:0,candidates:[1,1,1,1,1,1]}}}));
    }};
    let calculator=installSoulSpeedCalculator(host,storage,createWorker);
    let mode=host.querySelector('[data-speed="mode"]'),suit=host.querySelector('[data-speed="suit"]'),run=host.querySelector('.soul-speed-run');
    const el=name=>host.querySelector('[data-speed="'+name+'"]'),pick=name=>host.querySelector('[data-community="picker-'+name+'"]');
    const change=(name,value)=>{el(name).value=String(value);el(name).dispatchEvent(new Event('input'))};
    assert.equal(run.disabled,true);assert.equal(getComputedStyle(suit.closest('label')).display,'none');
    mode.value='set';mode.dispatchEvent(new Event('change'));assert.notEqual(getComputedStyle(suit.closest('label')).display,'none');
    assert.equal(suit.hidden,true);el('choose-suit').click();const dialog=host.querySelector('dialog');assert.equal(dialog.open,true);assert.equal(pick('clear').hidden,true);assert.ok(dialog.getBoundingClientRect().height<=540);
    assert.equal(document.activeElement,pick('search'));assert.ok(pick('cards').scrollHeight>pick('cards').parentElement.clientHeight,'long catalog scrolls inside bounded picker');
    pick('search').value='招财猫';pick('search').dispatchEvent(new Event('input'));assert.equal(pick('cards').querySelectorAll('button').length,1);assert.ok(pick('cards').querySelector('img'));
    pick('search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(dialog.open,false);assert.equal(document.activeElement,el('choose-suit'));
    assert.equal(suit.value,String(soulCatalog.suits.find(s=>s.name==='招财猫').id));assert.match(el('choose-suit').textContent,/招财猫/);
    el('count').value='2';el('count').dispatchEvent(new Event('change'));el('choose-suit').click();assert.ok([...pick('cards').querySelectorAll('button')].every(b=>soulCatalog.suits.find(s=>s.id===Number(b.dataset.suitId)).bonus));
    pick('categories').querySelector('[data-category="critRateAdditionVal"]').click();assert.ok(pick('cards').querySelectorAll('button').length>0);assert.ok([...pick('cards').querySelectorAll('button')].every(b=>soulCatalog.suits.find(s=>s.id===Number(b.dataset.suitId)).bonus.name==='critRateAdditionVal'));
    dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(dialog.open,false);el('count').value='4';el('count').dispatchEvent(new Event('change'));
    mode.value='scatter';mode.dispatchEvent(new Event('change'));assert.equal(getComputedStyle(suit.closest('label')).display,'none');
    calculator.update(snapshot);assert.equal(run.disabled,false);
    change('result-count',7);assert.equal(el('result-count-slider').value,'7');assert.equal(JSON.parse([...stored.values()][0]).resultCount,7);
    for(const invalid of ['',0,101,2.5]){change('result-count',invalid);assert.equal(run.disabled,true);assert.equal(el('result-count').getAttribute('aria-invalid'),'true');assert.equal(JSON.parse([...stored.values()][0]).resultCount,7);run.click();assert.equal(messages.length,0)}
    change('result-count-slider',7);assert.equal(run.disabled,false);assert.equal(el('result-count').value,'7');assert.equal(el('result-count-hint').hidden,true);
    for(const invalid of ['',0,31,1.5]){change('seconds',invalid);assert.equal(run.disabled,true);assert.equal(el('seconds').getAttribute('aria-invalid'),'true')}
    change('seconds-slider',7);assert.equal(run.disabled,false);assert.equal(el('seconds').value,'7');
    run.click();await new Promise(r=>setTimeout(r,30));assert.equal(messages.length,7);assert.equal(host.querySelectorAll('.soul-speed-plan').length,7);assert.ok(messages.every(message=>message.options.seconds===7));
    change('result-count',100);assert.equal(el('result-count').max,'100');assert.equal(el('result-count-slider').max,'100');assert.equal(el('result-count-slider').value,'100');assert.equal(JSON.parse([...stored.values()][0]).resultCount,100);
    calculator.dispose();assert.equal(host.querySelector('dialog'),null);
    index=0;messages.length=0;
    calculator=installSoulSpeedCalculator(host,storage,createWorker);calculator.update(snapshot);
    mode=el('mode');suit=el('suit');run=host.querySelector('.soul-speed-run');assert.equal(el('result-count').value,'100');assert.equal(el('result-count-slider').value,'100');assert.equal(el('seconds').value,'7');assert.equal(el('seconds-slider').value,'7');assert.equal(suit.value,String(soulCatalog.suits.find(s=>s.name==='招财猫').id));
    run.click();await new Promise(r=>setTimeout(r,30));assert.equal(messages.length,100);assert.equal(host.querySelectorAll('.soul-speed-plan').length,100);assert.match(host.querySelector('.soul-speed-total').textContent,/100/);assert.equal(new Set([...host.querySelectorAll('.soul-speed-plan')].flatMap(card=>card.dataset.soulIds.split('|'))).size,600);assert.equal(messages[99].options.excludedIds.length,594);
    index=0;messages.length=0;
    change('result-count-slider',10);change('seconds',10);run.click();await new Promise(r=>setTimeout(r,300));
    assert.equal(host.querySelectorAll('.soul-speed-plan').length,10);assert.equal(host.querySelectorAll('.soul-speed-plan-soul').length,60);
    assert.equal(messages.length,10);for(let i=0;i<10;i++){assert.equal(messages[i].options.distinctSuits,true);assert.equal(messages[i].options.excludedIds.length,i*6)}
    assert.match(host.querySelector('.soul-speed-total').textContent,/10/);
    assert.match(host.querySelector('.soul-speed-plan-rating').textContent,/御魂速度/);
    const cards=[...host.querySelectorAll('.soul-speed-plan')];
    for(let i=0;i<cards.length;i++){
      const soul=snapshot.souls.find(s=>s.id===fixtures[i].ids[1]),parts=cards[i].querySelectorAll('.soul-speed-soul-breakdown > span');
      assert.equal(parts.length,2);
      const main=soul.mainAttribute?.name==='speedAdditionVal'?soul.mainAttribute.value:0;
      const sub=soul.subAttributes.reduce((sum,a)=>sum+(a.name==='speedAdditionVal'?a.value:0),0);
      assert.equal(parts[0].querySelector('strong').textContent,'+'+main.toFixed(2));assert.equal(parts[1].querySelector('strong').textContent,'+'+sub.toFixed(2));
      assert.match(parts[0].getAttribute('aria-label'),/主属性速度/);assert.match(parts[1].getAttribute('aria-label'),/副属性速度/);
    }
    const original=snapshot.souls.find(s=>s.id===fixtures[0].ids[1]);
    const alternate={...snapshot,souls:snapshot.souls.map(s=>s===original?{...s,mainAttribute:{...s.mainAttribute,name:'attackAdditionRate',value:.55},subAttributes:s.subAttributes.filter(a=>a.name!=='speedAdditionVal')}:s)};
    calculator.update(alternate);index=0;run.click();await new Promise(r=>setTimeout(r,100));
    assert.equal(host.querySelector('[data-speed-part="main"] strong').textContent,'+0.00');assert.equal(host.querySelector('[data-speed-part="sub"] strong').textContent,'+0.00');
    calculator.update(snapshot);index=0;run.click();await new Promise(r=>setTimeout(r,100));
    window.calculator=calculator;window.speedEl=el;return {modeVisibility:true,searchableSuitPicker:true,keyboardSelection:true,eligibleSuitCategories:true,numericSliders:true,arbitraryIntegerCount:true,maximum100Plans:true,invalidValuesBlocked:true,restoredSettings:true,rankingAndDisjointRequests:true,portraitsAndReadableValues:true};
  })()`);
  await win.webContents.executeJavaScript(`speedEl('result-count-slider').focus()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
  await win.webContents.executeJavaScript(`require('node:assert/strict').equal(speedEl('result-count').value,'11');speedEl('result-count').value='10';speedEl('result-count').dispatchEvent(new Event('input'));`);
  const drag=await win.webContents.executeJavaScript(`(()=>{const slider=speedEl('result-count-slider'),rect=slider.getBoundingClientRect();require('node:assert/strict').ok(slider.previousElementSibling.getBoundingClientRect().height>=6,'slider track is visible');return {x:Math.round(rect.left+9+(rect.width-18)*9/99),end:Math.round(rect.left+9+(rect.width-18)*6/99),y:Math.round(rect.top+rect.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseDown',x:drag.x,y:drag.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:drag.end,y:drag.y,button:'left'});win.webContents.sendInputEvent({type:'mouseUp',x:drag.end,y:drag.y,button:'left',clickCount:1});
  await win.webContents.executeJavaScript(`require('node:assert/strict').equal(speedEl('result-count').value,'7','native pointer adjusts quantity');speedEl('result-count').value='10';speedEl('result-count').dispatchEvent(new Event('input'));`);
  const capture=async(name)=>{await new Promise(r=>setTimeout(r,160));await win.webContents.executeJavaScript(`(()=>{const assert=require('node:assert/strict'),host=document.getElementById('speed');assert.ok(host.scrollWidth<=host.clientWidth);for(const row of host.querySelectorAll('.soul-speed-plan-soul')){assert.ok(row.scrollWidth<=row.clientWidth);assert.ok(row.lastElementChild.getBoundingClientRect().right<=row.getBoundingClientRect().right)}for(const control of host.querySelectorAll('.soul-speed-settings input,.soul-speed-settings select,.soul-speed-settings button')){if(!control.getClientRects().length)continue;const rect=control.getBoundingClientRect();assert.ok(rect.left>=0&&rect.right<=innerWidth,'control remains inside window');}const fields=host.querySelector('.soul-speed-fields').getBoundingClientRect(),tuning=host.querySelector('.soul-speed-tuning').getBoundingClientRect();assert.ok(tuning.top>=fields.bottom+12,'sliders have a separate aligned row');if(innerWidth>900){const cards=[...host.querySelectorAll('.soul-speed-numeric')].map(card=>card.getBoundingClientRect());assert.equal(cards[0].top,cards[1].top);assert.equal(cards[0].height,cards[1].height)}})()`);fs.writeFileSync(path.join(out,name),(await win.webContents.capturePage()).toPNG());};
  await capture('speed-style-dark.png');
  await win.webContents.executeJavaScript(`speedEl('mode').value='set';speedEl('mode').dispatchEvent(new Event('change'));speedEl('result-count').value='20';speedEl('result-count').dispatchEvent(new Event('input'));document.getElementById('speed').scrollTop=0`);await capture('speed-filters-dark.png');
  await win.webContents.executeJavaScript(`speedEl('choose-suit').click()`);await capture('speed-suit-picker.png');
  await win.webContents.executeJavaScript(`document.querySelector('[data-community="picker-close"]').click()`);
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);await capture('speed-style-light.png');
  win.setSize(430,1000);await capture('speed-style-narrow.png');
  win.setSize(280,1000);await capture('speed-style-compact.png');
  await win.webContents.executeJavaScript(`document.querySelector('.soul-speed-header-actions button:last-child').click();if(document.querySelectorAll('.soul-speed-plan').length)throw Error('Clear failed');calculator.dispose()`);
  console.log(JSON.stringify({...result,nativeSliderKeyboard:true,nativeSliderDrag:true,darkLightAndNarrowNoOverflow:true}));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
