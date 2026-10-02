// Run after npm test. Uses an isolated card and an in-memory AI host, with no API requests.
const { app, BrowserWindow, safeStorage, net, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(artifacts, 'ai-smoke-user-data'));
app.commandLine.appendSwitch('in-process-gpu');
app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  // Exercise Electron's real fetch and OS credential encryption against a local mock service.
  const assert = require('node:assert/strict');
  const imageRoot = path.join(artifacts, 'ai-image-fixture');
  fs.mkdirSync(path.join(imageRoot, 'assets/templates'), { recursive: true });
  const fixtureImage = nativeImage.createFromPath(path.join(root, 'src/renderer/assets/onmyoji-icon.png')).resize({ width: 1400 });
  fs.writeFileSync(path.join(imageRoot, 'assets/templates/button.png'), fixtureImage.toPNG());
  const httpBodies = [];
  const server = require('node:http').createServer((request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer isolated-smoke-key');
    let body = ''; request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      httpBodies.push(JSON.parse(body));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: '{"names":["本机连接验证"],"advice":[]}' } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { AiAssistant } = require(path.join(root, 'dist-electron/main/aiAssistant.js'));
    const store = path.join(artifacts, 'ai-smoke-user-data', 'ai-settings.json');
    const secretStorage = { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value) };
    const { loadAiImage } = require(path.join(root, 'dist-electron/main/ai-images.js'));
    const ai = new AiAssistant(store, secretStorage, net.fetch.bind(net), relative => loadAiImage(imageRoot, relative, nativeImage.createFromBuffer));
    ai.saveSettings({ enabled: true, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'mock-model', apiKey: 'isolated-smoke-key' });
    assert.ok(!fs.readFileSync(store, 'utf8').includes('isolated-smoke-key'));
    await ai.testConnection();
    assert.deepEqual(await ai.suggest({ mode: 'name', context: '{}', instruction: '' }), { names: ['本机连接验证'], advice: [] });
    await ai.suggest({ mode: 'name', context: '{}', instruction: '', templatePaths: ['assets/templates/button.png'] });
    const imagePart = httpBodies.at(-1).messages[1].content.find(part => part.type === 'image_url');
    const sentImage = nativeImage.createFromDataURL(imagePart.image_url.url);
    assert.ok(!sentImage.isEmpty()); assert.equal(sentImage.getSize().width, 1024);
    assert.ok(imagePart.image_url.url.length < 2 * 1024 * 1024);
    fs.writeFileSync(path.join(imageRoot, 'assets/templates/invalid.png'), 'not-an-image');
    await assert.rejects(ai.suggest({ mode: 'name', context: '{}', instruction: '', templatePaths: ['assets/templates/invalid.png'] }), /无法解析/);
    assert.equal(httpBodies.length, 3);
    ai.saveSettings({ ...ai.getSettings(), enabled: false, apiKey: '' });
    console.log(JSON.stringify({ electronFetchAndEncryptedStorage: true, actualMultimodalImageUpload: true, imageCompression: true }));
  } finally { await new Promise(resolve => server.close(resolve)); }
  let html = fs.readFileSync(path.join(root, 'src/renderer/canvas.html'), 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  html = html.replace(/href="\/([^"]+)"/g, (_, file) => `href="${pathToFileURL(path.join(root, 'public', file))}"`);
  const file = path.join(artifacts, 'ai-smoke.html'); fs.writeFileSync(file, html);
  const win = new BrowserWindow({ show: false, width: 1250, height: 880, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  await win.loadFile(file);
  const modules = path.join(root, 'dist-test-renderer');
  const results = await win.webContents.executeJavaScript(`(async () => {
    const assert = require('node:assert/strict'); const base = ${JSON.stringify(modules)};
    const { startCanvasEditor } = require(base + '/canvas/editor.js');
    const { emitRuntimeDocument } = require(base + '/shared/workflow/graph-dsl.js');
    const { emptyEditingLibrary } = require(base + '/shared/editing-library.js');
    const catalog = require(${JSON.stringify(path.join(root, 'dist-electron/main/core/catalog.js'))}).loadActionCatalog(${JSON.stringify(path.dirname(root))}).all();
    const tick = () => new Promise(resolve => setTimeout(resolve, 40));
    const listeners = [], requests = [], posts = []; let automatic = true;
    const emit = message => { listeners.forEach(fn => fn(message)); window.dispatchEvent(new MessageEvent('message', { data: message })); };
    const reply = request => emit({type:'aiSuggestionsResult',requestId:request.requestId,result:{names:['等待挑战按钮','识别挑战入口'],advice:['确认识别区域和超时参数。']}});
    const post = message => {
      posts.push(message);
      if (message.type === 'getEditingLibrary') setTimeout(() => emit({type:'editingLibrary',library:emptyEditingLibrary()}),0);
      if (message.type === 'aiSuggestions') { requests.push(message); if (automatic) setTimeout(() => reply(message),0); }
    };
    const bridge = {mode:'canvas',post,postState(){},subscribe(fn){listeners.push(fn);return()=>{};},setTopbarControls(){},editorApi:()=>({postMessage:post,getState:()=>({}),setState(){}})};
    const command = (command,value) => emit({type:'editorCommand',command,value});
    const editor = startCanvasEditor(bridge);
    const raw={schema_version:4,id:'ai-smoke',version:'1.0',resolution:[1920,1080],root:'root',nodes:[{id:'root',type:'root',children:['task']},{id:'task',type:'task',name:'等待按钮',action:'vision.wait_template',params:{template:'assets/templates/button.png',timeout_seconds:10}}],_layout:{root:{x:300,y:20},task:{x:300,y:170}}};
    emit({type:'init',document:{uri:'ai-isolated.owf',name:'AI 验证',text:emitRuntimeDocument(raw)},assetsBaseUri:${JSON.stringify(pathToFileURL(path.join(imageRoot, 'assets')).toString() + '/')},catalog,refs:{},issues:[],workflows:[],instances:[],selectedInstance:''}); await tick();
    const state=editor.state;const taskId=state.raw.nodes.find(n=>n.action==='vision.wait_template').id; state.selected=new Set([taskId]);state.inspector='node';editor.render();editor.renderInspector();await tick();
    const button = text => { const found=[...document.querySelectorAll('button')].find(item=>item.textContent===text);assert.ok(found,'Missing '+text+'; buttons='+[...document.querySelectorAll('button')].map(item=>item.textContent).join('|')+'; selected='+[...state.selected]+'; nodes='+state.raw.nodes.map(n=>n.id));return found; };
    button('AI 命名与参数建议').click();
    assert.equal(document.querySelector('.ai-card-results').hidden,true);
    assert.equal(document.querySelector('.ai-card-apply').hidden,true);
    assert.ok(document.querySelector('.ai-card-instruction').getBoundingClientRect().height>=80);
    button('简短明确').click();assert.match(document.querySelector('.ai-card-instruction').value,/12 字以内/);
    document.querySelector('.ai-card-instruction').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true})); await tick();
    assert.equal(requests.length,1);assert.equal(requests[0].request.mode,'name');
    assert.deepEqual(requests[0].request.templatePaths,['assets/templates/button.png']);
    assert.equal(JSON.parse(requests[0].request.context).selected.id,taskId);
    assert.equal(JSON.parse(requests[0].request.context).upstream.length,1);
    assert.equal(document.querySelectorAll('.ai-card-results button').length,2);
    const undo=state.undo.length; button('等待挑战按钮').click();
    assert.equal(state.raw.nodes.find(n=>n.id===taskId).name,'等待按钮');assert.equal(state.undo.length,undo);
    assert.equal(button('应用名称').disabled,false);button('应用名称').click();
    assert.equal(state.raw.nodes.find(n=>n.id===taskId).name,'等待挑战按钮');assert.equal(state.undo.length,undo+1);
    command('undo');assert.equal(state.raw.nodes.find(n=>n.id===taskId).name,'等待按钮');
    state.selected=new Set([taskId]);state.inspector='node';editor.renderInspector();
    button('AI 命名与参数建议').click(); automatic=false;button('获取建议').click();
    state.raw.nodes.find(n=>n.id===taskId).params.timeout_seconds=15; reply(requests.at(-1));
    assert.match(document.querySelector('.ai-card-dialog [role="status"]').textContent,/工作流已变化/);
    assert.equal(document.querySelectorAll('.ai-card-results button').length,0);button('关闭').click();
    button('AI 命名与参数建议').click();button('获取建议').click();const old=requests.at(-1);button('关闭').click();
    button('AI 命名与参数建议').click();reply(old);
    assert.equal(document.querySelectorAll('.ai-card-results button').length,0);
    button('动作与参数').click();assert.equal(document.querySelector('.ai-card-results').hidden,true);button('获取建议').click();
    assert.equal(requests.at(-1).request.mode,'advice');
    emit({type:'aiSuggestionsResult',requestId:requests.at(-1).requestId,error:'请先启用 AI'});
    assert.match(document.querySelector('.ai-card-dialog [role="status"]').textContent,/启用 AI/);assert.equal(button('获取建议').disabled,false);
    button('关闭').click();
    // F2 name editing offers the same assistant and commits the draft before opening it.
    window.StudioShortcuts={matchesById:(event,id)=>event.key==='F2'&&id==='editor.rename'};
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));await tick();
    const nameEditor=document.querySelector('.inline-node-name-editor');assert.ok(nameEditor);assert.ok(nameEditor.querySelector('.inline-name-ai'));
    nameEditor.querySelector('input').value='新的手动名';nameEditor.querySelector('.inline-name-ai').click();
    assert.equal(state.raw.nodes.find(n=>n.id===taskId).name,'新的手动名');assert.ok(document.querySelector('.ai-card-dialog'));
    automatic=true;button('获取建议').click();await tick();
    assert.equal(button('应用名称').disabled,true);
    button('AI 设置').click();assert.equal(posts.at(-1).type,'openAiSettings');assert.equal(document.querySelector('.ai-card-dialog'),null);
    button('AI 命名与参数建议').click();
    const range=document.querySelector('.ai-card-scope select');range.value='0';range.dispatchEvent(new Event('change'));
    const toggle=document.querySelector('.ai-card-image-toggle input');toggle.checked=false;toggle.dispatchEvent(new Event('change'));
    button('获取建议').click();await tick();assert.deepEqual(requests.at(-1).request.templatePaths,[]);assert.equal(JSON.parse(requests.at(-1).request.context).upstream.length,0);
    return {candidatePreviewApplyUndo:true,compactEmptyState:true,presetRequirements:true,keyboardGenerate:true,staleWorkflowGuard:true,closedDialogGuard:true,adviceMode:true,errorRecovery:true,nameEditorEntry:true,settingsNavigation:true};
  })()`);
  fs.writeFileSync(path.join(artifacts, 'ai-card-suggestions.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`const scope=document.querySelector('.ai-card-scope');scope.open=true;scope.querySelector('select').value='3';scope.querySelector('select').dispatchEvent(new Event('change'));scope.querySelector('input').checked=true;scope.querySelector('input').dispatchEvent(new Event('change'));`);
  fs.writeFileSync(path.join(artifacts, 'ai-card-context.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.ai-card-scope').open=false;`);
  win.setContentSize(420, 800);
  await win.webContents.executeJavaScript(`(async () => {
    document.body.classList.add('desktop-details-mode');
    document.querySelector('.ai-card-candidate').click();
    await new Promise(resolve=>setTimeout(resolve,80));
    const assert=require('node:assert/strict');const dialog=document.querySelector('.ai-card-dialog');const rect=dialog.getBoundingClientRect();
    assert.ok(rect.left>=0&&rect.right<=innerWidth);assert.ok(rect.top>=0&&rect.bottom<=innerHeight);
    assert.ok(dialog.scrollWidth<=dialog.clientWidth);assert.ok(rect.height<750);
    assert.equal(document.querySelector('.ai-card-candidate').getAttribute('aria-pressed'),'true');
  })()`);
  fs.writeFileSync(path.join(artifacts, 'ai-card-suggestions-narrow.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('.ai-card-dialog .editing-dialog-head button').click();
    [...document.querySelectorAll('button')].find(item=>item.textContent==='AI 命名与参数建议').click();
    await new Promise(resolve=>setTimeout(resolve,80));
    const assert=require('node:assert/strict');assert.equal(document.querySelector('.ai-card-results').hidden,true);
    assert.ok(document.querySelector('.ai-card-dialog').getBoundingClientRect().height<540);
  })()`);
  fs.writeFileSync(path.join(artifacts, 'ai-card-empty-narrow.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';`);
  fs.writeFileSync(path.join(artifacts, 'ai-card-empty-narrow-light.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(1250, 880);
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';document.body.classList.remove('desktop-details-mode');`);
  const settingsHtml = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8').match(/<section id="settings-page-ai"[\s\S]*?<\/section>/)[0].replace('settings-page hidden', 'settings-page');
  const settingsResults = await win.webContents.executeJavaScript(`(async () => {
    const assert=require('node:assert/strict');
    document.body.innerHTML='<div class="settings-body">'+${JSON.stringify(settingsHtml)}+'</div>';
    const css=document.createElement('link');css.rel='stylesheet';css.href=${JSON.stringify(pathToFileURL(path.join(root,'public/settings/settings.css')).toString())};document.head.append(css);
    const {createAiSettings}=require(${JSON.stringify(path.join(modules, 'renderer/ai-settings.js'))});
    const tick=()=>new Promise(resolve=>setTimeout(resolve,40));const get=id=>document.getElementById('settings-ai-'+id);
    let saved={enabled:false,baseUrl:'https://example.com/v1',model:'example-model',hasApiKey:true},updates=[],calls=0,fail=false,saveFail=false,slowSave,hold=false,testedModel;
    const controller=createAiSettings({getAiSettings:async()=>saved,saveAiSettings:async value=>{updates.push(value);if(hold){hold=false;await new Promise(resolve=>{slowSave=resolve;});}if(saveFail)throw new Error('接口地址无效');saved={enabled:value.enabled,baseUrl:value.baseUrl,model:value.model,hasApiKey:value.apiKey===undefined?saved.hasApiKey:Boolean(value.apiKey)};return saved;},testAiConnection:async()=>{calls++;testedModel=saved.model;if(fail)throw new Error('接口连接失败');}});
    await controller.refresh();assert.equal(get('key').value,'');assert.match(get('key').placeholder,/已保存密钥/);
    assert.equal(get('save'),null);
    get('key').value='smoke-only-key';get('key').dispatchEvent(new Event('input'));get('enabled').checked=true;get('enabled').dispatchEvent(new Event('change'));await tick();
    assert.equal(updates[0].apiKey,'smoke-only-key');assert.equal(saved.enabled,true);assert.equal(get('key').value,'');
    get('model').value='changed-model';get('model').dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,660));assert.equal(saved.model,'changed-model');assert.equal(updates[1].apiKey,undefined);
    // Rapid input is coalesced, but blur commits immediately.
    const count=updates.length;get('model').value='first-model';get('model').dispatchEvent(new Event('input'));get('model').value='latest-model';get('model').dispatchEvent(new Event('input'));
    assert.equal(updates.length,count);get('model').dispatchEvent(new Event('blur'));await tick();assert.equal(saved.model,'latest-model');assert.equal(updates.length,count+1);
    // An older asynchronous write cannot overwrite a newer edit or erase the newer key.
    hold=true;get('model').value='slow-model';get('key').value='isolated-smoke-key';get('key').dispatchEvent(new Event('input'));get('model').dispatchEvent(new Event('change'));await tick();
    assert.equal(get('model').disabled,false);get('model').value='newer-model';get('model').dispatchEvent(new Event('input'));get('key').value='smoke-only-key';get('key').dispatchEvent(new Event('input'));
    slowSave();await tick();assert.equal(saved.model,'newer-model');assert.equal(updates.at(-1).apiKey,'smoke-only-key');assert.equal(get('key').value,'');
    // Testing flushes a pending edit, so it never tests an older configuration.
    get('model').value='test-current-model';get('model').dispatchEvent(new Event('input'));
    get('test').click();await tick();assert.equal(calls,1);assert.match(get('status').textContent,/连接成功/);
    assert.equal(testedModel,'test-current-model');
    fail=true;get('test').click();await tick();assert.match(get('status').textContent,/连接失败/);assert.equal(get('model').disabled,false);
    saveFail=true;get('url').value='invalid';get('url').dispatchEvent(new Event('input'));get('test').click();await tick();assert.equal(calls,2);assert.match(get('status').textContent,/自动保存失败/);assert.equal(get('url').value,'invalid');
    await controller.refresh();assert.equal(get('url').value,'invalid');
    saveFail=false;get('url').value='https://example.com/v1';get('url').dispatchEvent(new Event('change'));await tick();assert.match(get('status').textContent,/已自动保存/);
    // IME composition is kept intact; password input is retained while still being typed.
    const beforeIme=updates.length;get('model').dispatchEvent(new CompositionEvent('compositionstart'));get('model').value='输入中的模型';get('model').dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,650));assert.equal(updates.length,beforeIme);
    get('model').dispatchEvent(new CompositionEvent('compositionend'));await controller.flush();assert.equal(saved.model,'输入中的模型');
    get('key').focus();get('key').value='isolated-smoke-key';get('key').dispatchEvent(new Event('input'));await controller.flush();assert.equal(get('key').value,'isolated-smoke-key');get('key').blur();get('key').dispatchEvent(new Event('blur'));await tick();assert.equal(get('key').value,'');
    get('clear').click();await tick();assert.equal(saved.enabled,false);assert.equal(saved.hasApiKey,false);assert.equal(get('enabled').checked,false);
    // Clearing during an older key save finishes that write first, then removes the key.
    hold=true;get('key').value='smoke-only-key';get('key').dispatchEvent(new Event('input'));get('key').dispatchEvent(new Event('change'));await tick();get('clear').click();slowSave();await tick();assert.equal(saved.hasApiKey,false);assert.equal(saved.enabled,false);
    await new Promise(resolve=>setTimeout(resolve,100));
    return {automaticSave:true,coalescedInput:true,blurSave:true,latestEditWins:true,keyNotRevealed:true,keyPreserved:true,testFlushesCurrentEdit:true,saveFailureBlocksTest:true,invalidDraftRetained:true,imePreserved:true,passwordTypingPreserved:true,keyRemovalDisablesAi:true,inFlightRemoval:true};
  })()`);
  fs.writeFileSync(path.join(artifacts, 'ai-settings.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(settingsResults));
  console.log(JSON.stringify(results)); win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
