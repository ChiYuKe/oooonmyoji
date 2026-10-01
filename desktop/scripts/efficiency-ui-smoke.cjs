// Run after npm test: node_modules/.bin/electron.cmd scripts/efficiency-ui-smoke.cjs
// Isolated editor document and in-memory host; never reads or changes a user's workflow.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(artifacts, 'efficiency-smoke-user-data'));
app.commandLine.appendSwitch('in-process-gpu');

app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  let html = fs.readFileSync(path.join(root, 'src/renderer/canvas.html'), 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  html = html.replace(/href="\/([^"]+)"/g, (_, file) => `href="${pathToFileURL(path.join(root, 'public', file))}"`);
  const file = path.join(artifacts, 'efficiency-smoke.html'); fs.writeFileSync(file, html);
  const win = new BrowserWindow({ show: false, width: 1250, height: 880, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  await win.loadFile(file);
  const modules = path.join(root, 'dist-test-renderer');
  const results = await win.webContents.executeJavaScript(`(async () => {
    const assert = require('node:assert/strict');
    const base = ${JSON.stringify(modules)};
    const { startCanvasEditor } = require(base + '/canvas/editor.js');
    const { emitRuntimeDocument } = require(base + '/shared/workflow/graph-dsl.js');
    const { emptyEditingLibrary, changeEditingLibrary } = require(base + '/shared/editing-library.js');
    const catalog = require(${JSON.stringify(path.join(root, 'dist-electron/main/core/catalog.js'))}).loadActionCatalog(${JSON.stringify(path.dirname(root))}).all();
    const tick = () => new Promise(resolve => setTimeout(resolve, 60));
    const listeners = [], posts = []; let library = emptyEditingLibrary();
    const emit = message => { listeners.forEach(fn => fn(message)); window.dispatchEvent(new MessageEvent('message', { data: message })); };
    const post = message => {
      posts.push(message);
      if (message.type === 'getEditingLibrary') setTimeout(() => emit({ type: 'editingLibrary', library }), 0);
      if (message.type === 'updateEditingLibrary') { library = changeEditingLibrary(library, message.change); setTimeout(() => emit({ type: 'editingLibrary', library }), 0); }
    };
    const bridge = { mode:'canvas', post, postState(){}, subscribe(fn){ listeners.push(fn); return () => {}; }, setTopbarControls(){}, editorApi:() => ({ postMessage:post, getState:()=>({}), setState(){} }) };
    const command = (command, value) => emit({type:'editorCommand',command,value}); const editor = startCanvasEditor(bridge); window.__efficiencyEditor = editor;
    const raw = { schema_version:4, id:'editing-smoke', version:'1.0', resolution:[1920,1080], root:'root', nodes:[{ id:'root', type:'root', children:['seq'] },{ id:'seq', type:'sequence', children:[] }], _layout:{ root:{x:400,y:20}, seq:{x:400,y:180} } };
    emit({type:'init',document:{uri:'isolated.owf',name:'编辑效率验证',text:emitRuntimeDocument(raw)},catalog,refs:{},issues:[],workflows:[],instances:[],selectedInstance:''}); await tick();
    const state = editor.state;
    const searchPicker = query => { const input = document.querySelector('[aria-label="搜索新节点"]'); input.value = query; input.dispatchEvent(new Event('input')); };
    const choose = action => { const button = [...document.querySelectorAll('.editing-choice-main')].find(item => item.textContent.includes(action)); assert.ok(button, action); button.click(); };
    command('quickCreate'); await tick(); searchPicker('vision.wait_template');
    assert.equal(document.querySelectorAll('.editing-choice-main').length,1); choose('vision.wait_template');
    let task = state.raw.nodes.find(node => node.action === 'vision.wait_template'); assert.ok(task);
    assert.equal(state.undo.length,1); command('undo'); assert.equal(state.raw.nodes.length,2); command('redo');
    task = state.raw.nodes.find(node => node.action === 'vision.wait_template'); task.params = {template:'assets/templates/test.png',threshold:.8,timeout_seconds:10}; state.selected = new Set([task.id]);
    command('savePreset'); document.querySelector('[aria-label="预设名称"]').value='常用等待'; [...document.querySelectorAll('.editing-dialog button')].find(item=>item.textContent==='保存预设').click(); await tick();
    assert.equal(library.presets.length,1);
    command('openPresets'); await tick(); assert.equal(document.querySelectorAll('.editing-choice-main').length,1);
    document.querySelector('[aria-label="收藏 常用等待"]').click(); await tick(); assert.equal(library.presets[0].favorite,true); choose('常用等待');
    assert.equal(state.raw.nodes.filter(node=>node.action==='vision.wait_template').length,2);
    assert.equal(state.raw.nodes.at(-1).params.threshold,.8);
    // Release an execution line on empty canvas; creating and connecting is one history entry.
    state.panX=0; state.panY=0; state.zoom=1; const wrap=document.getElementById('canvas-wrap'); const box=wrap.getBoundingClientRect();
    state.connect={direction:'from-output',parent:'seq',pointerId:null,x:800,y:400,startPoint:{x:530,y:276}};
    const undoCount=state.undo.length;
    window.dispatchEvent(new PointerEvent('pointerup',{clientX:box.left+800,clientY:box.top+400,bubbles:true}));
    await tick(); assert.ok(document.querySelector('.editing-dialog'));
    searchPicker('vision.match_template'); choose('vision.match_template');
    const child = state.raw.nodes.find(node=>node.action==='vision.match_template'); assert.ok(child); assert.ok(state.raw.nodes.find(node=>node.id==='seq').children.includes(child.id)); assert.equal(state.undo.length,undoCount+1);
    command('undo'); assert.ok(!state.raw.nodes.find(node=>node.id===child.id)); command('redo');
    // Image drag offers recipes; click recipe wires a valid wait output to tap_match.
    const transfer=new DataTransfer(); transfer.setData('application/x-onmyoji-asset','assets/templates/button.png');
    wrap.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,clientX:box.left+650,clientY:box.top+350,bubbles:true,cancelable:true}));
    [...document.querySelectorAll('.editing-dialog button')].find(item=>item.textContent==='等待出现并点击').click();
    const sequence=state.raw.nodes.find(node=>node.name==='识别并点击 button.png'); assert.equal(sequence.children.length,2);
    const wait=state.raw.nodes.find(node=>node.id===sequence.children[0]); const tap=state.raw.nodes.find(node=>node.id===sequence.children[1]);
    assert.equal(tap.params.match.ref,'nodes.'+wait.id+'.output.matches.0');
    const {validateWorkflow}=require(base+'/shared/workflow/validate.js');
    const issues=validateWorkflow(state.raw,{byName:name=>catalog.find(item=>item.name===name),names:()=>catalog.map(item=>item.name)});
    assert.ok(!issues.some(issue=>issue.path.includes(tap.id)),JSON.stringify(issues.filter(issue=>issue.path.includes(tap.id))));
    // Preview and commit only checked parameters; one undo restores the values.
    command('replaceParameters','0.8'); document.querySelector('[aria-label="替换为"]').value='0.9';
    [...document.querySelectorAll('.editing-dialog button')].find(item=>item.textContent==='预览替换').click();
    assert.equal(document.querySelectorAll('.editing-replacement-row').length,2);
    const replaceCount=state.undo.length; [...document.querySelectorAll('.editing-dialog button')].find(item=>item.textContent.startsWith('确认替换')).click();
    assert.equal(state.undo.length,replaceCount+1); assert.ok(state.raw.nodes.filter(node=>node.params?.threshold!==undefined).every(node=>node.params.threshold===.9));
    command('undo'); assert.ok(state.raw.nodes.filter(node=>node.params?.threshold!==undefined).every(node=>node.params.threshold===.8));
    // Real inspector navigation survives synchronous DOM reconstruction on commit.
    const {installParameterNavigation}=require(base+'/canvas/interactions/parameter-navigation.js');
    const panel=document.createElement('div'); document.body.append(panel);
    const draw=()=>{panel.innerHTML='<div data-parameter-name="x"><input value="1"></div><div data-parameter-name="y"><input value="2"></div>';panel.querySelector('input').addEventListener('change',draw);}; draw(); installParameterNavigation(panel);
    const first=panel.querySelector('input'); first.focus(); first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); await tick();
    assert.equal(document.activeElement.closest('[data-parameter-name]').dataset.parameterName,'y'); panel.remove();
    // Card editing continues through numbers and boolean fields, blocking invalid values.
    const cardTask=state.raw.nodes.find(node=>node.params?.threshold===.8);
    state.raw._layout[cardTask.id]={x:100,y:180}; state.panX=0;state.panY=0;state.zoom=1;editor.render(); await tick();
    const hit=document.querySelector('.param-row-hit[data-node="'+cardTask.id+'"][data-param="timeout_seconds"]'); assert.ok(hit);
    hit.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:150,clientY:350}));
    let scalar=document.querySelector('.inline-param-editor input');assert.ok(scalar);scalar.value='-1';scalar.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    assert.equal(state.raw.nodes.find(node=>node.id===cardTask.id).params.timeout_seconds,10);
    scalar.value='11';scalar.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
    const boolean=document.querySelector('.inline-param-editor select');assert.ok(boolean);boolean.value='false';boolean.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));await tick();
    assert.equal(state.raw.nodes.find(node=>node.id===cardTask.id).params.present,false);
    document.querySelector('.inline-param-editor select').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    // Output-line drop filters to compatible consumers and binds the chosen field.
    state.referenceConnect={nodeId:cardTask.id,field:'found',pointerId:null,x:1100,y:650,startPoint:{x:350,y:200}};
    window.dispatchEvent(new PointerEvent('pointerup',{clientX:box.left+1100,clientY:box.top+650,bubbles:true}));await tick();
    assert.ok(document.querySelector('.editing-dialog'));searchPicker('condition');choose('condition');
    const condition=state.raw.nodes.find(node=>node.type==='condition');assert.equal(condition.expression.ref,'nodes.'+cardTask.id+'.output.found');
    command('openPresets'); await tick();
    assert.equal(document.querySelector('.editing-dialog-controls select').value,'presets');
    return {quickCreate:true,executionDrop:true,outputDrop:true,preset:true,favorite:true,imageRecipe:true,replacementUndo:true,keyboardNavigation:true,inlineNavigation:true};
  })()`);
  await new Promise(resolve=>setTimeout(resolve,150));
  fs.writeFileSync(path.join(artifacts,'efficiency-presets.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(results)); win.destroy(); app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
