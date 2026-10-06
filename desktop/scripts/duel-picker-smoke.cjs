const { readExpandedHtml, readExpandedCss } = require('./renderer-templates.cjs');
// Real renderer with saved rosters and controlled OCR replies; no device or account writes.
const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),project=path.dirname(root),out=path.join(project,'artifacts/soul-ui');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData',path.join(out,'duel-picker-user-data'));
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});
  protocol.handle('onmyoji-resource',request=>{
    const match=new URL(request.url).pathname.match(/^\/assets\/(hero|soul|skill)-icons\/(\d+)\.png$/);
    const file=match&&path.join(project,'assets',match[1]+'-icons',match[2]+'.png');
    return file&&fs.existsSync(file)?net.fetch(pathToFileURL(file).href):new Response('',{status:404});
  });
  const source=readExpandedHtml(path.join(root,'src/renderer/index.html'));
  const markup=source.slice(source.indexOf('<section id="module-duel-prediction"'),source.indexOf('<section id="module-soul-calculator"'));
  const styles=[readExpandedCss(path.join(root,'src/renderer/styles/workbench.css')).replace(/^@import[^;]*;/,''),...['workbench-light.css','theme.css'].map(name=>fs.readFileSync(path.join(root,'public/theme',name),'utf8'))].join('\n');
  const file=path.join(out,'duel-picker.html');
  fs.writeFileSync(file,`<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><style>${styles}\nhtml,body{margin:0;height:100%}#module-duel-prediction{display:grid;height:100vh}</style><body>${markup}</body></html>`);
  const win=new BrowserWindow({show:false,width:1800,height:1450,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true}});
  win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
  await win.loadFile(file);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('node:assert/strict');
    const {installDuelPredictionPanel}=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/duel-prediction'))});
    const battleEngine=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/duel-battle-engine'))});
    const {groupBattleLog,renderBattleLog}=require(${JSON.stringify(path.join(root,'dist-test-renderer/renderer/duel-battle-log'))});
    const structuredFixture=['开局鬼火：蓝方 4，红方 4。','行动条到达顺序：蓝方·追月神（速度 181）。','行动 1｜蓝方·追月神使用技能「清辉月华」（鬼火 5→3）。','蓝方·追月神状态变化：攻击+20%（1回合）。','蓝方行动后自然回火 +1（3→4）。','行动条到达顺序：红方·判官（速度 154）。','行动 2｜红方·判官使用技能「死亡宣告」（鬼火 3→0）。','攻击 蓝方·追月神：13000 点生命伤害，剩余生命 0；状态：攻击+20%。','治疗 红方·判官 100 点生命。','控制生效：蓝方·李小狼受到沉默。','样例对局结束：红方生命比例合计 4.00，蓝方 0.00。'];
    const grouped=groupBattleLog(structuredFixture);assert.equal(grouped.length,4);assert.equal(grouped[1].side,'blue');assert.equal(grouped[2].side,'red');assert.ok(grouped[2].lines[0].includes('红方·判官'),'arrival record belongs to next actor');
    const fixture=renderBattleLog(document,structuredFixture);assert.equal(fixture.querySelectorAll('.duel-action-heading').length,4);assert.ok(fixture.querySelector('.duel-event-defeat'));assert.ok(fixture.querySelector('.duel-event-heal'));assert.ok(fixture.querySelector('.duel-event-control'));assert.ok(fixture.textContent.includes('攻击+20%'),'secondary status is preserved');assert.ok([...fixture.querySelectorAll('.duel-action-details')].every(d=>!d.open),'secondary information starts collapsed');
    const originalBattle=battleEngine.simulateBattle;let actualRuns;
    battleEngine.simulateBattle=(state,runs)=>{actualRuns=runs;return originalBattle(state,runs)};
    const {soulCatalog}=require(${JSON.stringify(path.join(root,'dist-test-renderer/shared/soul-catalog-data'))});
    const host=document.getElementById('module-duel-prediction'),key='onmyoji-studio.duel-prediction.v1';
    const hero=name=>{const h=soulCatalog.heroes.find(h=>h.name===name);assert.ok(h,name);return h};
    const suit=name=>{const s=soulCatalog.suits.find(s=>s.name===name);assert.ok(s,name);return s};
    const blueNames=['追月神','夏目&猫老师','判官','鬼女红叶','李小狼'];
    const redNames=['本真三尾狐','铃彦姬','鬼王酒吞童子','须佐之男','大天狗'];
    const panels=[
      {hp:26935,attack:2791,defense:743,speed:181,crit:.05,critDamage:1.5,hit:0,resist:.64},
      {hp:18573,attack:3434,defense:640,speed:159,crit:.6,critDamage:1.78,hit:0,resist:.78},
      {hp:12535,attack:3878,defense:640,speed:154,crit:.95,critDamage:2.9,hit:0,resist:.64},
      {hp:14870,attack:5246,defense:785,speed:132,crit:.78,critDamage:3.04,hit:0,resist:.56},
      {hp:14870,attack:7079,defense:640,speed:115,crit:1.1,critDamage:2.06,hit:0,resist:.4}
    ];
    const effects=['招财猫','木魅','阴摩罗','阴摩罗','破势'].map(name=>String(suit(name).id));
    const seed={blue:blueNames.map((name,i)=>({heroId:hero(name).id,fourSuit:effects[i],skillLevel:5,panel:panels[i]})),red:redNames.map((name,i)=>({heroId:hero(name).id,fourSuit:String(suit('针女').id),skillLevel:5,panel:{...hero(name).base,hp:20000,attack:5000,speed:150-i*8,crit:1,critDamage:2.5}}))};
    localStorage.setItem(key,JSON.stringify(seed));localStorage.setItem(key+'.instance','preview');
    let reply={width:1000,height:600,backend:'fixture',screenSide:'blue',items:[],soulMatches:[],heroMatches:[]};
    const captureCanvas=document.createElement('canvas');captureCanvas.width=1000;captureCanvas.height=600;const captureUrl=captureCanvas.toDataURL();
    let lastRoi;
    window.onmyoji={listInstances:async()=>[{id:'preview',displayName:'预览模拟器'}],captureDuelScreen:async()=>({dataUrl:captureUrl,width:1000,height:600}),recognizeDuelScreen:async(dataUrl,roi)=>{lastRoi=roi;return reply}};
    let dispose=installDuelPredictionPanel(host);await new Promise(r=>setTimeout(r,80));
    const card=slot=>host.querySelector('[data-slot="'+slot+'"]');
    const field=(slot,name)=>card(slot).querySelector('[data-field="'+name+'"]');
    const choice=(slot,name)=>card(slot).querySelector('[data-duel-choice="'+name+'"]');
    const pick=name=>host.querySelector('[data-community="picker-'+name+'"]');
    const dialog=()=>host.querySelector('dialog');
    const saved=()=>JSON.parse(localStorage.getItem(key));
    const query=term=>{pick('search').focus();pick('search').value=term;pick('search').dispatchEvent(new Event('input'))};
    const enter=()=>pick('search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    const waitFor=async(predicate)=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate(),'expected renderer state')};
    const imageReady=()=>document.querySelector('.duel-roi-image')?.naturalWidth>0&&document.querySelector('.duel-roi-image')?.complete&&!document.querySelector('.duel-roi-stage')?.hidden;
    const recognizePreview=async button=>{
      button.click();
      await waitFor(imageReady);
      assert.ok(document.querySelector('.duel-roi-dialog .duel-capture-instance'),'instance selection is inside recognition dialog');
      const stage=document.querySelector('.duel-roi-stage'),image=document.querySelector('.duel-roi-image');assert.ok(stage&&image);
      const bounds=image.getBoundingClientRect();assert.ok(bounds.width>20&&bounds.height>20);stage.setPointerCapture=()=>{};
      const viewport=document.querySelector('.duel-roi-viewport');assert.ok(viewport.scrollWidth<=viewport.clientWidth&&viewport.scrollHeight<=viewport.clientHeight,'complete image fits without scrolling');
      stage.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:bounds.left+1,clientY:bounds.top+1,bubbles:true}));
      stage.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:bounds.right-1,clientY:bounds.bottom-1,bubbles:true}));
      for(let i=0;i<50&&document.querySelector('.duel-roi-dialog');i++)await new Promise(r=>setTimeout(r,10));
      assert.equal(document.querySelector('.duel-roi-dialog'),null,document.querySelector('.duel-roi-size')?.textContent);
      assert.ok(Math.abs(lastRoi.x-Math.floor(1000/bounds.width))<=1&&Math.abs(lastRoi.y-Math.floor(600/bounds.height))<=1,'scaled selection maps to original screenshot');
    };
    assert.equal(host.querySelectorAll('[data-duel-choice="heroId"]').length,10);
    assert.equal(host.querySelector('.duel-capture-instance'),null,'instance selector is removed from page actions');
    assert.equal(host.querySelectorAll('[data-duel-choice="fourSuit"]').length,10);
    assert.equal(host.querySelectorAll('[data-field="twoSuit"]').length,0);
    for(const select of host.querySelectorAll('[data-field="heroId"],[data-field="fourSuit"]')){assert.equal(select.hidden,true);assert.equal(select.getClientRects().length,0)}
    assert.match(choice('blue-1','heroId').textContent,/夏目&猫老师/);assert.ok(choice('blue-1','heroId').querySelector('img'));
    assert.equal(field('blue-4','crit').value,'110');assert.equal(field('blue-3','resist').value,'56');assert.deepEqual(saved().blue[4].panel,panels[4]);
    host.querySelector('.duel-run-button').click();assert.ok(host.querySelector('.duel-result-rates'),'saved single effects are enough to run');
    const originalRed=JSON.stringify(saved().red),originalBlue=JSON.stringify(saved().blue);
    choice('blue-1','fourSuit').click();assert.equal(dialog().open,true);assert.equal(document.activeElement,pick('search'));
    assert.match(pick('title').textContent,/选择御魂效果.*蓝方 2 号位/);assert.ok(dialog().getBoundingClientRect().height<=540);
    assert.ok(pick('cards').scrollHeight>pick('cards').parentElement.clientHeight);
    assert.ok([...pick('cards').querySelectorAll('button')].every(b=>!soulCatalog.suits.find(s=>s.id===Number(b.dataset.suitId)).boss));
    query('针女');assert.equal(pick('cards').querySelectorAll('button').length,1);
    assert.equal(pick('cards').querySelector('small').textContent,suit('针女').four);
    assert.equal(JSON.stringify(saved().blue),originalBlue,'search does not mutate fighter stats');
    enter();assert.equal(dialog().open,false);assert.equal(document.activeElement,choice('blue-1','fourSuit'));
    assert.match(choice('blue-1','fourSuit').textContent,/针女/);assert.equal(saved().blue[1].fourSuit,String(suit('针女').id));
    assert.deepEqual(saved().blue[1].panel,panels[1]);assert.equal(JSON.stringify(saved().red),originalRed);
    assert.equal(host.querySelector('.duel-result-rates'),null,'choice invalidates old prediction');
    choice('red-2','heroId').click();assert.match(pick('title').textContent,/红方 3 号位/);
    pick('categories').querySelector('[data-category="6"]').click();assert.ok([...pick('cards').querySelectorAll('button')].every(b=>soulCatalog.heroes.find(h=>h.id===Number(b.dataset.heroId)).rarity===6));
    pick('categories').querySelector('[data-category=""]').click();query(hero('追月神').pinyin);
    assert.ok(pick('cards').querySelector('[data-hero-id="'+hero('追月神').id+'"]'),'pinyin finds the desired hero');
    query('追月神');enter();
    assert.equal(saved().red[2].heroId,hero('追月神').id);assert.deepEqual(saved().red[2].panel,hero('追月神').base);
    assert.match(choice('red-2','heroId').textContent,/追月神/);assert.equal(field('red-2','attack').value,String(Number(hero('追月神').base.attack.toFixed(2))));
    choice('red-2','heroId').click();query('不存在的式神');assert.equal(pick('cards').querySelectorAll('button').length,0);assert.match(pick('cards').textContent,/没有匹配项/);
    dialog().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(dialog().open,false);
    choice('blue-1','fourSuit').click();pick('clear').click();assert.equal(saved().blue[1].fourSuit,'');assert.deepEqual(saved().blue[1].panel,panels[1]);assert.match(choice('blue-1','fourSuit').textContent,/选择御魂效果/);
    choice('red-2','heroId').click();pick('clear').click();assert.equal(saved().red[2].heroId,null);assert.equal(saved().red[2].panel,null);assert.equal(field('red-2','attack').value,'');
    dispose();assert.equal(host.querySelector('dialog'),null);dispose=installDuelPredictionPanel(host);await new Promise(r=>setTimeout(r,80));
    assert.match(choice('blue-1','fourSuit').textContent,/选择御魂效果/);assert.match(choice('red-2','heroId').textContent,/选择式神/);
    choice('blue-0','heroId').click();host.querySelector('#duel-prediction-tab-live').click();assert.equal(dialog().open,false);host.querySelector('#duel-prediction-tab-simulation').click();
    host.querySelector('.duel-reset-button').click();for(const b of host.querySelectorAll('.duel-choice-trigger')){assert.equal(b.querySelector('img'),null);assert.match(b.textContent,/选择/)}
    const item=(text,x,y)=>({text,confidence:1,box:[[x-20,y-8],[x+20,y-8],[x+20,y+8],[x-20,y+8]]});
    reply.items=[item('李小狼',250,50),item('攻击 8888',250,100),item('生命 20000',250,150)];
    await recognizePreview(card('blue-2').querySelector('.duel-recognize-button'));
    assert.equal(saved().blue[2].heroId,hero('李小狼').id);assert.equal(saved().blue[2].panel.attack,8888);assert.match(choice('blue-2','heroId').textContent,/李小狼/);
    // Whole game table: five stat columns and one effect icon per column.
    const xs=[250,400,550,700,850],labels=['攻击','生命','防御','速度','暴击','暴击伤害','效果命中','效果抵抗'],fields=['attack','hp','defense','speed','crit','critDamage','hit','resist'];
    reply.items=blueNames.map((name,i)=>item(name,xs[i],50));
    fields.forEach((f,row)=>{const y=110+row*55;reply.items.push(item(labels[row],70,y));panels.forEach((p,i)=>reply.items.push(item(String(row>=4?p[f]*100:p[f]),xs[i],y)))});
    reply.soulMatches=effects.map((id,i)=>({x:xs[i],suitId:Number(id),score:.9,confidenceGap:.2}));
    await recognizePreview(host.querySelector('.duel-team-blue .duel-recognize-roster'));
    seed.blue.forEach((f,i)=>{assert.equal(saved().blue[i].heroId,f.heroId);assert.equal(saved().blue[i].fourSuit,f.fourSuit);assert.deepEqual(saved().blue[i].panel,f.panel);assert.match(choice('blue-'+i,'heroId').textContent,new RegExp(blueNames[i]));assert.ok(choice('blue-'+i,'fourSuit').querySelector('img'))});
    // A partial replacement must also clear the names/icons of the unrecognized slots.
    reply.items=[item('追月神',250,50)];reply.soulMatches=[];await recognizePreview(host.querySelector('.duel-team-blue .duel-recognize-roster'));
    assert.equal(saved().blue[2].heroId,null);assert.match(choice('blue-2','heroId').textContent,/选择式神/);assert.equal(choice('blue-2','fourSuit').querySelector('img'),null);
    window.restorePreview=async()=>{dispose();localStorage.setItem(key,JSON.stringify(seed));dispose=installDuelPredictionPanel(host);host.querySelector('#duel-prediction-tab-simulation').click();await new Promise(r=>setTimeout(r,100));host.querySelector('#duel-prediction-page-simulation').scrollTop=0};
    window.duelChoice=choice;window.duelPick=pick;window.duelDispose=()=>dispose();
    window.openRoiPreview=async()=>{
      card('blue-0').querySelector('.duel-recognize-button').click();
      await waitFor(imageReady);
    };
    window.checkRoiPreview=()=>{
      const modal=document.querySelector('.duel-roi-dialog'),image=modal.querySelector('img'),viewport=modal.querySelector('.duel-roi-viewport'),bounds=modal.getBoundingClientRect();
      assert.ok(bounds.width<=880&&bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight);
      assert.ok(viewport.scrollWidth<=viewport.clientWidth&&viewport.scrollHeight<=viewport.clientHeight,'no screenshot scroll bars');
      assert.ok(Math.abs(image.clientWidth/image.clientHeight-image.naturalWidth/image.naturalHeight)<.01,'screenshot keeps its aspect ratio');
    };
    window.checkDuelOverflow=()=>{
      const page=host.querySelector('#duel-prediction-page-simulation');assert.ok(page.scrollWidth<=page.clientWidth+1,'table scroll is contained in the team');
      const red=host.querySelector('.duel-team-red').getBoundingClientRect(),blue=host.querySelector('.duel-team-blue').getBoundingClientRect();assert.ok(red.bottom<=blue.top,'red above blue');
      for(const team of host.querySelectorAll('.duel-team')){
        const scroll=team.querySelector('.duel-roster-scroll'),bounds=scroll.getBoundingClientRect();assert.ok(bounds.left>=0&&bounds.right<=innerWidth+1);
        const cards=[...team.querySelectorAll('[data-slot]')];assert.equal(cards.length,5);
        for(let i=1;i<5;i++){assert.ok(cards[i-1].getBoundingClientRect().right<=cards[i].getBoundingClientRect().left+1);assert.equal(cards[i].getBoundingClientRect().top,cards[0].getBoundingClientRect().top)}
        for(const name of ['attack','hp','defense','speed','crit','critDamage','hit','resist','fourSuit']){
          const first=cards[0].querySelector('[data-field="'+name+'"]').getBoundingClientRect();
          for(const card of cards.slice(1))assert.equal(card.querySelector('[data-field="'+name+'"]').getBoundingClientRect().top,first.top,'attribute rows align');
        }
      }
      if(dialog().open){const r=dialog().getBoundingClientRect();assert.ok(r.left>=0&&r.right<=innerWidth+1&&r.height<=540,'picker stays inside window')}
    };
    window.checkDuelOutput=()=>{
      const output=host.querySelector('.duel-simulation-output').getBoundingClientRect(),teams=host.querySelector('.duel-teams').getBoundingClientRect(),actions=host.querySelector('.duel-simulation-actions').getBoundingClientRect();
      if(host.querySelector('.duel-prediction-main').clientWidth>=1320){
        assert.ok(output.left>=teams.right,'process on the right');assert.ok(Math.abs(output.top-teams.top)<1,'process starts beside red team');
        const page=host.querySelector('#duel-prediction-page-simulation'),bounds=page.getBoundingClientRect(),padding=parseFloat(getComputedStyle(page).paddingBottom)||0;
        assert.ok(output.bottom<=bounds.bottom-padding+1,'process stays within the actual dock pane');
        assert.ok(Math.abs(output.bottom-(bounds.bottom-padding))<=1,'process fills the available pane height');
        assert.ok(actions.top-teams.bottom<=13,'actions stay immediately below rosters');
      }
      else assert.ok(output.top>=actions.bottom,'process below rosters in narrow panes');
      const log=host.querySelector('.duel-battle-log');assert.equal(log.open,true,'process is expanded after simulation');
      const groups=log.querySelectorAll('.duel-log-group');assert.ok(groups.length>5,'records are grouped into actions');
      assert.ok(log.querySelector('.duel-log-group-blue .duel-action-side'));assert.ok(log.querySelector('.duel-log-group-red .duel-action-side'),'both actor sides are marked');
      const redFilter=log.querySelector('[data-log-filter="red"]');redFilter.click();assert.ok([...log.querySelectorAll('.duel-log-group-blue')].every(g=>g.hidden));assert.ok([...log.querySelectorAll('.duel-log-group-red')].every(g=>!g.hidden));
      log.querySelector('[data-log-filter="all"]').click();assert.ok([...groups].every(g=>!g.hidden));
      const secondary=log.querySelector('.duel-action-details');secondary.open=true;assert.ok(secondary.querySelector('.duel-action-extra').textContent.length>0);secondary.open=false;
      const list=log.querySelector('ol');assert.ok(list.clientHeight>0&&list.textContent.length>0);
      if(host.querySelector('.duel-prediction-main').clientWidth>=1320){assert.ok(list.getBoundingClientRect().bottom<=output.bottom,'process is contained in sidebar');assert.ok(list.scrollHeight>list.clientHeight,'process scrolls independently');const page=host.querySelector('#duel-prediction-page-simulation'),previous=page.scrollTop;list.scrollTop=80;assert.ok(list.scrollTop>0);assert.equal(page.scrollTop,previous);list.scrollTop=0}
      assert.ok(output.right<=innerWidth+1,'output stays inside pane');
    };
    field('blue-0','attack').value='3001';field('blue-0','attack').dispatchEvent(new Event('change',{bubbles:true}));assert.equal(saved().blue[0].panel.attack,3001);
    await restorePreview();checkDuelOverflow();
    const count=host.querySelector('.duel-run-count');count.value='37';count.dispatchEvent(new Event('change',{bubbles:true}));
    host.querySelector('.duel-run-button').click();assert.equal(actualRuns,37,'selected count is passed to simulation engine');
    assert.match(host.querySelector('.duel-result-draws').textContent,/37 场模拟/);assert.ok(host.querySelector('.duel-battle-log summary').textContent.includes('1 / 37 场'));
    count.value='2.5';host.querySelector('.duel-run-button').click();assert.equal(actualRuns,37,'fractional count cannot start simulation');
    await restorePreview();assert.equal(host.querySelector('.duel-run-count').value,'37','simulation count preference restored');
    host.querySelector('.duel-run-count').value='256';host.querySelector('.duel-run-count').dispatchEvent(new Event('change',{bubbles:true}));
    const originalRecognition=window.onmyoji.recognizeDuelScreen;let finishRecognition;
    window.beginLoadingPreview=async whole=>{
      window.onmyoji.recognizeDuelScreen=(dataUrl,roi)=>{lastRoi=roi;return new Promise(resolve=>{finishRecognition=()=>resolve(reply)})};
      await recognizePreview(whole?host.querySelector('.duel-team-red .duel-recognize-roster'):card('blue-0').querySelector('.duel-recognize-button'));
      await waitFor(()=>document.querySelector('.duel-recognition-loading'));
      const target=whole?host.querySelector('.duel-team-red'):card('blue-0'),loading=target.querySelector('.duel-recognition-loading');
      assert.ok(loading,'spinner is inside the requested card');assert.equal(target.getAttribute('aria-busy'),'true');
      assert.equal(host.querySelector('.duel-recognition-status').textContent,'','no tiny progress text during OCR');
      const ring=loading.querySelector('.duel-loading-ring'),bounds=ring.getBoundingClientRect(),cardBounds=target.getBoundingClientRect();
      assert.equal(getComputedStyle(ring).animationName,'spin');assert.ok(bounds.width>=30&&bounds.left>=cardBounds.left&&bounds.right<=cardBounds.right);
      assert.ok(Math.abs((bounds.top+bounds.bottom)-(cardBounds.top+cardBounds.bottom))<2,'ring is vertically centered');
      assert.equal(host.querySelector('.duel-run-button').disabled,true);assert.equal(host.querySelector('.duel-reset-button').disabled,true);
    };
    window.finishLoadingPreview=async()=>{
      finishRecognition();await waitFor(()=>!document.querySelector('.duel-recognition-loading'));
      assert.equal(host.querySelector('[aria-busy="true"]'),null);assert.equal(host.querySelector('.duel-run-button').disabled,false);
      window.onmyoji.recognizeDuelScreen=originalRecognition;await restorePreview();
    };
    await beginLoadingPreview(true);await finishLoadingPreview();await beginLoadingPreview(false);await finishLoadingPreview();
    const originalList=window.onmyoji.listInstances,originalCapture=window.onmyoji.captureDuelScreen;
    const captureCalls=[];
    window.onmyoji.listInstances=async()=>[{id:'preview',displayName:'预览模拟器'},{id:'second',displayName:'第二个模拟器'}];
    window.onmyoji.captureDuelScreen=async id=>{captureCalls.push(id);return originalCapture(id)};
    localStorage.removeItem(key+'.instance');await restorePreview();
    host.querySelector('.duel-team-red .duel-recognize-roster').click();
    await waitFor(()=>document.querySelector('.duel-roi-placeholder')?.textContent==='请先选择模拟器实例');
    assert.equal(captureCalls.length,0,'no capture before instance selection');
    const instance=document.querySelector('.duel-roi-dialog .duel-capture-instance');
    instance.value='second';instance.dispatchEvent(new Event('change'));await waitFor(imageReady);
    assert.equal(captureCalls.at(-1),'second');assert.equal(localStorage.getItem(key+'.instance'),'second');
    instance.value='preview';instance.dispatchEvent(new Event('change'));await waitFor(imageReady);assert.equal(captureCalls.at(-1),'preview');
    const captureCount=captureCalls.length;document.querySelector('.duel-roi-refresh').click();await waitFor(()=>captureCalls.length===captureCount+1&&imageReady());
    document.querySelector('.duel-roi-close').click();await waitFor(()=>!document.querySelector('.duel-roi-dialog'));
    await openRoiPreview();assert.equal(document.querySelector('.duel-capture-instance').value,'preview','remembers instance across dialogs');
    window.onmyoji.listInstances=async()=>[];
    document.querySelector('.duel-roi-refresh').click();
    await waitFor(()=>document.querySelector('.duel-roi-placeholder')?.textContent.includes('未发现在线实例'));
    assert.equal(document.querySelector('.duel-capture-instance').disabled,true);assert.equal(document.querySelector('.duel-roi-stage').hidden,true);
    document.querySelector('.duel-roi-cancel').click();await waitFor(()=>!document.querySelector('.duel-roi-dialog'));
    window.onmyoji.listInstances=originalList;window.onmyoji.captureDuelScreen=originalCapture;
    localStorage.setItem(key+'.instance','preview');await restorePreview();
    return {actionGroupsAndEventKinds:true,secondaryStatusPreserved:true,sideFilters:true,recognitionRingInsideCard:true,individualRecognitionRing:true,noTinyOcrProgress:true,customSimulationCount:true,countValidatedAndRemembered:true,instanceSelectorInDialog:true,selectionLoadsCorrectInstance:true,refreshAndRememberInstance:true,noOnlineInstanceHandled:true,redAboveBlue:true,fiveColumnsAndAlignedStatRows:true,singleEffectPerFighter:true,searchAndIcons:true,keyboardAndRarity:true,targetedSelection:true,preservesTotalStats:true,clearAndRestore:true,resetAndOcrSynchronized:true,partialRosterClearsOldChoices:true,simulation:true,disposal:true};
  })()`);
  const screenshot=async name=>{await new Promise(r=>setTimeout(r,180));fs.writeFileSync(path.join(out,name),(await win.webContents.capturePage()).toPNG())};
  await screenshot('duel-picker-roster-dark.png');
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';checkDuelOverflow()`);
  await screenshot('duel-roster-table-light.png');
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
  await win.webContents.executeJavaScript(`document.querySelector('.duel-run-button').click();checkDuelOverflow();checkDuelOutput()`);
  await screenshot('duel-process-wide-dark.png');
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';checkDuelOutput()`);
  await screenshot('duel-process-wide-light.png');
  const originalContentSize=win.getContentSize();
  for(const height of [850,1100]){
    win.setContentSize(1800,height);await new Promise(r=>setTimeout(r,100));
    await win.webContents.executeJavaScript(`document.getElementById('duel-prediction-page-simulation').scrollTop=0;checkDuelOutput()`);
  }
  await win.webContents.executeJavaScript(`(()=>{const host=document.getElementById('module-duel-prediction');host.style.height='calc(100vh - 180px)';host.style.marginTop='80px'})()`);
  await new Promise(r=>setTimeout(r,100));await win.webContents.executeJavaScript(`checkDuelOutput()`);
  await screenshot('duel-process-dock-height.png');
  await win.webContents.executeJavaScript(`document.getElementById('duel-prediction-page-simulation').scrollTop=140`);
  await new Promise(r=>setTimeout(r,100));
  await win.webContents.executeJavaScript(`(()=>{const assert=require('node:assert/strict'),page=document.getElementById('duel-prediction-page-simulation').getBoundingClientRect(),output=document.querySelector('.duel-simulation-output').getBoundingClientRect();assert.ok(output.top>=page.top&&output.bottom<=page.bottom,'sticky panel stays inside resized dock pane')})()`);
  await win.webContents.executeJavaScript(`(()=>{const host=document.getElementById('module-duel-prediction');host.style.height='';host.style.marginTop='';document.getElementById('duel-prediction-page-simulation').scrollTop=0})()`);
  win.setContentSize(...originalContentSize);await new Promise(r=>setTimeout(r,100));
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
  await win.webContents.executeJavaScript(`(async()=>{await restorePreview()})()`);
  await win.webContents.executeJavaScript(`(async()=>{await beginLoadingPreview(true)})()`);
  await screenshot('duel-recognition-loading-roster.png');
  await win.webContents.executeJavaScript(`(async()=>{await finishLoadingPreview();await beginLoadingPreview(false)})()`);
  await screenshot('duel-recognition-loading-fighter.png');
  await win.webContents.executeJavaScript(`(async()=>{await finishLoadingPreview()})()`);
  const roiFixture=process.env.DUEL_PREVIEW_IMAGE;
  if(roiFixture)await win.webContents.executeJavaScript(`(()=>{window.onmyoji.captureDuelScreen=async()=>({dataUrl:${JSON.stringify('data:image/png;base64,'+fs.readFileSync(roiFixture).toString('base64'))},width:1071,height:515})})()`);
  await win.webContents.executeJavaScript(`(async()=>{await openRoiPreview();checkRoiPreview()})()`);
  await screenshot('duel-roi-compact-dark.png');
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';checkRoiPreview()`);
  await screenshot('duel-roi-compact-light.png');
  await win.webContents.executeJavaScript(`document.querySelector('.duel-roi-close').click();document.documentElement.dataset.theme='dark'`);
  await win.webContents.executeJavaScript(`duelChoice('blue-1','heroId').click();checkDuelOverflow()`);
  await screenshot('duel-picker-heroes.png');
  await win.webContents.executeJavaScript(`duelPick('close').click();duelChoice('blue-1','fourSuit').click();checkDuelOverflow()`);
  await screenshot('duel-picker-effects.png');
  await win.webContents.executeJavaScript(`duelPick('close').click()`);win.setContentSize(520,1000);
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';document.getElementById('duel-prediction-page-simulation').scrollTop=0;checkDuelOverflow()`);
  await screenshot('duel-picker-narrow-light.png');
  await win.webContents.executeJavaScript(`(()=>{const assert=require('node:assert/strict'),scroll=document.querySelector('.duel-team-red .duel-roster-scroll'),label=scroll.querySelector('.duel-roster-labels');assert.ok(scroll.scrollWidth>scroll.clientWidth);scroll.scrollLeft=scroll.scrollWidth;assert.ok(Math.abs(label.getBoundingClientRect().left-scroll.getBoundingClientRect().left)<2);checkDuelOverflow()})()`);
  await screenshot('duel-roster-table-scrolled.png');
  await win.webContents.executeJavaScript(`document.querySelector('.duel-team-red .duel-roster-scroll').scrollLeft=0`);
  await win.webContents.executeJavaScript(`duelChoice('blue-0','fourSuit').click();checkDuelOverflow()`);
  await screenshot('duel-picker-effects-narrow-light.png');
  await win.webContents.executeJavaScript(`(async()=>{duelPick('close').click();await openRoiPreview();checkRoiPreview()})()`);
  await screenshot('duel-roi-compact-narrow.png');
  await win.webContents.executeJavaScript(`document.querySelector('.duel-roi-cancel').click()`);
  await win.webContents.executeJavaScript(`document.querySelector('.duel-run-button').click();checkDuelOutput();document.querySelector('.duel-simulation-output').scrollIntoView({block:'start'})`);
  await screenshot('duel-process-narrow-light.png');
  await win.webContents.executeJavaScript(`duelDispose()`);
  console.log(JSON.stringify({...result,narrowAndLight:true,wideProcessSidebar:true,processExpanded:true,narrowProcessBelow:true}));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
