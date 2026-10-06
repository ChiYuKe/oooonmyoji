const { readExpandedHtml, readExpandedCss } = require('./renderer-templates.cjs');
// Isolated document and mock replies: never sends project content to an AI provider.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'artifacts');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(artifacts, 'ai-node-picker-user-data'));
app.commandLine.appendSwitch('in-process-gpu');
app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  let html = readExpandedHtml(path.join(root, 'src/renderer/canvas.html'));
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  html = html.replace(/href="\/([^"]+)"/g, (_, file) => `href="${pathToFileURL(path.join(root, 'public', file))}"`);
  const file = path.join(artifacts, 'ai-node-picker-smoke.html'); fs.writeFileSync(file, html);
  const win = new BrowserWindow({ show: false, width: 1250, height: 900, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(file);
  const results = await win.webContents.executeJavaScript(`(async () => {
    const assert=require('node:assert/strict');
    const {startCanvasEditor}=require(${JSON.stringify(path.join(root, 'dist-test-renderer/canvas/editor.js'))});
    const {emitRuntimeDocument}=require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/workflow/graph-dsl.js'))});
    const {emptyEditingLibrary}=require(${JSON.stringify(path.join(root, 'dist-test-renderer/shared/editing-library.js'))});
    const catalog=require(${JSON.stringify(path.join(root, 'dist-electron/main/core/catalog.js'))}).loadActionCatalog(${JSON.stringify(path.dirname(root))}).all();
    const listeners=new Set(),requests=[],posts=[];let automatic=true;
    const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
    const emit=message=>{[...listeners].forEach(fn=>fn(message));window.dispatchEvent(new MessageEvent('message',{data:message}));};
    const reply=request=>emit({type:'aiSuggestionsResult',requestId:request.requestId,result:{names:[],advice:[],nodes:[
      {id:'action:input.tap_match',reason:'已有等待模板节点，下一步可用匹配结果点击目标；创建后配置匹配结果参数。'},
      {id:'made-up:action',reason:'不可接受的虚构动作'},
      {id:'type:sequence',reason:'如果下一步包含多个动作，可组合成顺序步骤。'}]}});
    const post=message=>{posts.push(message);if(message.type==='getEditingLibrary')setTimeout(()=>emit({type:'editingLibrary',library:emptyEditingLibrary()}),0);
      if(message.type==='aiSuggestions'){requests.push(message);if(automatic)setTimeout(()=>reply(message),0);}};
    const bridge={mode:'canvas',post,postState(){},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},setTopbarControls(){},editorApi:()=>({postMessage:post,getState:()=>({}),setState(){}})};
    const editor=startCanvasEditor(bridge),state=editor.state;
    const raw={schema_version:4,id:'ai-node-smoke',version:'1.0',root:'root',resolution:[1920,1080],nodes:[
      {id:'root',type:'root',children:['seq']},{id:'seq',type:'sequence',name:'准备流程',children:['wait']},
      {id:'wait',type:'task',name:'等待挑战按钮',action:'vision.wait_template',params:{template:'assets/templates/challenge.png',timeout_seconds:10}},
      {id:'free',type:'task',name:'尚未连接',action:'core.log',params:{message:'测试'}}
    ],_layout:{root:{x:250,y:20},seq:{x:250,y:140},wait:{x:250,y:310},free:{x:50,y:20}}};
    emit({type:'init',document:{uri:'ai-node-isolated.owf',name:'AI 节点验证',text:emitRuntimeDocument(raw)},catalog,refs:{},issues:[],workflows:[],instances:[],selectedInstance:''});await tick();
    const seqId=state.raw.nodes.find(n=>n.type==='sequence').id,waitId=state.raw.nodes.find(n=>n.action==='vision.wait_template').id,freeId=state.raw.nodes.find(n=>n.name==='尚未连接').id;
    const baseline=listeners.size;
    const close=()=>document.querySelector('.editing-dialog-head button').click();
    const open=async connection=>{
      state.selected=new Set([freeId]);state.connect={...connection,startPoint:{x:0,y:0},hover:null};
      const rect=document.getElementById('canvas-wrap').getBoundingClientRect();
      window.dispatchEvent(new PointerEvent('pointerup',{clientX:rect.left+40,clientY:rect.top+60,button:0,bubbles:true}));await tick();
      assert.ok(document.querySelector('.ai-node-generate'),'No picker: '+JSON.stringify({rect:rect.toJSON(),connection:state.connect,panX:state.panX,panY:state.panY,zoom:state.zoom,dialogs:document.querySelectorAll('.editing-dialog').length}));assert.equal(listeners.size,baseline+1);
    };
    await open({direction:'from-output',parent:seqId});
    const original=state.raw.nodes.length,undo=state.undo.length;
    document.querySelector('[aria-label="AI 节点推荐目标"]').value='识别成功后点击目标';
    document.querySelector('.ai-node-generate').click();await tick();
    assert.equal(requests.length,1);assert.equal(requests[0].request.mode,'node');
    const context=JSON.parse(requests[0].request.context);
    assert.equal(context.selected.id,seqId);assert.equal(context.creation.direction,'after');assert.ok(context.downstream.some(n=>n.id===waitId));
    assert.deepEqual(requests[0].request.templatePaths,['assets/templates/challenge.png']);
    assert.ok(requests[0].request.candidates.some(n=>n.id==='action:input.tap_match'));
    assert.equal(state.raw.nodes.length,original);assert.equal(state.undo.length,undo);
    assert.equal(document.querySelectorAll('[data-ai-choice]').length,2);
    assert.ok(document.querySelector('.ai-node-results strong').textContent.startsWith('首选'));
    document.querySelector('[data-ai-choice="action:input.tap_match"]').click();await tick();
    assert.equal(state.raw.nodes.length,original+1);assert.equal(state.undo.length,undo+1);
    const added=state.raw.nodes.find(n=>n.action==='input.tap_match');assert.ok(state.raw.nodes.find(n=>n.id===seqId).children.includes(added.id));
    assert.equal(listeners.size,baseline);
    emit({type:'editorCommand',command:'undo'});await tick();assert.equal(state.raw.nodes.length,original);
    assert.ok(!state.raw.nodes.find(n=>n.id===seqId).children.includes(added.id));
    // Reverse dragging only offers nodes that can be parents of the endpoint.
    await open({direction:'from-input',child:freeId});
    document.querySelector('.ai-node-image-toggle input').checked=false;
    document.querySelector('.ai-node-generate').click();await tick();
    assert.equal(JSON.parse(requests.at(-1).request.context).creation.direction,'before');assert.deepEqual(requests.at(-1).request.templatePaths,[]);
    assert.ok(!requests.at(-1).request.candidates.some(n=>n.id==='action:input.tap_match'));
    document.querySelector('[data-ai-choice="type:sequence"]').click();await tick();
    assert.ok(state.raw.nodes.some(n=>n.type==='sequence'&&n.id!==seqId&&n.children.includes(freeId)));
    emit({type:'editorCommand',command:'undo'});await tick();
    // Mutation after recommendations must block creation, and late replies cannot reopen a closed picker.
    await open({direction:'from-output',parent:seqId});document.querySelector('.ai-node-generate').click();await tick();
    state.raw.nodes.find(n=>n.id===waitId).params.timeout_seconds=12;
    document.querySelector('[data-ai-choice="action:input.tap_match"]').click();assert.match(document.querySelector('.ai-node-status').textContent,/工作流已变化/);assert.equal(state.raw.nodes.length,original);close();await tick();
    automatic=false;await open({direction:'from-output',parent:seqId});document.querySelector('.ai-node-generate').click();const old=requests.at(-1);close();await tick();assert.equal(listeners.size,baseline);
    await open({direction:'from-output',parent:seqId});reply(old);assert.equal(document.querySelectorAll('[data-ai-choice]').length,0);
    document.querySelector('.ai-node-generate').click();emit({type:'aiSuggestionsResult',requestId:requests.at(-1).requestId,error:'请先启用 AI'});assert.match(document.querySelector('.ai-node-status').textContent,/启用 AI/);assert.equal(document.querySelector('.ai-node-generate').disabled,false);
    document.querySelector('.ai-node-reference button').click();await tick();assert.equal(posts.at(-1).type,'openAiSettings');assert.equal(listeners.size,baseline);
    // Standalone picker retains ordinary manual creation and search.
    emit({type:'editorCommand',command:'quickCreate'});await tick();const search=document.querySelector('[aria-label="搜索新节点"]');search.value='core.sleep';search.dispatchEvent(new Event('input'));
    assert.equal(document.querySelectorAll('.editing-choice-main').length,1);close();await tick();
    await open({direction:'from-output',parent:seqId});automatic=true;document.querySelector('.ai-node-generate').click();await tick();
    return {recommendationUsesDraggedSource:true,contextAndTemplates:true,compatibleCandidatesOnly:true,unknownIdsRejected:true,previewBeforeCreation:true,createConnectUndo:true,reverseCreateConnect:true,staleGuard:true,lateReplyGuard:true,subscriptionsCleaned:true,errorRetry:true,settingsEntry:true,manualSearchPreserved:true};
  })()`);
  fs.writeFileSync(path.join(artifacts,'ai-node-picker-wide.png'),(await win.webContents.capturePage()).toPNG());
  win.setContentSize(420,800);
  await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,80))`);
  await win.webContents.executeJavaScript(`const assert=require('node:assert/strict'),dialog=document.querySelector('.editing-dialog'),rect=dialog.getBoundingClientRect();assert.ok(rect.left>=0&&rect.right<=innerWidth);assert.ok(rect.top>=0&&rect.bottom<=innerHeight);assert.ok(dialog.scrollWidth<=dialog.clientWidth);`);
  fs.writeFileSync(path.join(artifacts,'ai-node-picker-narrow.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';new Promise(resolve=>setTimeout(resolve,100));`);
  fs.writeFileSync(path.join(artifacts,'ai-node-picker-narrow-light.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(results));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
