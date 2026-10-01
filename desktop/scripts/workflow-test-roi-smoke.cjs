// Exercise the production ROI picker with native mouse input and a fixture frame.
// This hidden window never connects to an emulator or writes a workflow.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', 'workflow-test-roi');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(artifacts, 'user-data'));
app.commandLine.appendSwitch('in-process-gpu');

app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const built = path.join(root, 'dist/renderer');
  let html = fs.readFileSync(path.join(built, 'workflow-test.html'), 'utf8')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, '');
  html = html.replace(/(href|src)="([^":]+)"/g, (_, attribute, file) => `${attribute}="${pathToFileURL(path.join(built, file.replace(/^\//, '')))}"`);
  const file = path.join(artifacts, 'preview.html'); fs.writeFileSync(file, html);
  const win = new BrowserWindow({ show: false, width: 1450, height: 950, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(file);
  const modules = path.join(root, 'dist-test-renderer');
  await win.webContents.executeJavaScript(`(async () => {
    const {emitRuntimeDocument} = require(${JSON.stringify(path.join(modules, 'shared/workflow/graph-dsl.js'))});
    const text = emitRuntimeDocument({schema_version:4,id:'roi-fixture',version:'1.0.0',resolution:[1920,1080],root:'root',inputs:{},variables:{},nodes:[{id:'root',type:'root',children:['find']},{id:'find',type:'task',name:'框选测试',action:'vision.match_template',params:{template:'assets/templates/fixture.png'}}]});
    const frame = document.createElement('canvas'); frame.width=1600; frame.height=900;
    const context=frame.getContext('2d');context.fillStyle='#263238';context.fillRect(0,0,1600,900);
    context.fillStyle='#52604b';context.fillRect(320,225,800,360);
    context.fillStyle='#fff';context.font='34px sans-serif';context.fillText('拖拽框选测试 · 1600 × 900',350,280);
    const dataUrl=frame.toDataURL('image/png');
    window.onmyoji={
      workflowTestInit:async()=>({uri:'fixture.owf',text,instanceId:'fixture',nodeIds:['find']}),
      bootstrap:async()=>({catalog:[{name:'vision.match_template',parameters:{template:{type:'asset',required:true},roi:{type:'rect'}}}],instances:[{id:'fixture',displayName:'截图测试'}]}),
      captureRoi:async()=>({dataUrl,width:1600,height:900}),
      readAssetData:async()=>[],readLayout:()=>undefined,onWorkflowTestEvent:()=>{},
      isWindowMaximized:async()=>false,onWindowMaximized:()=>()=>{},
      workflowTestStart:async request=>window.__request=request,
    };
    require(${JSON.stringify(path.join(built, 'theme/theme.js'))});
    require(${JSON.stringify(path.join(modules, 'renderer/workflow-test.js'))});
    await new Promise(resolve=>setTimeout(resolve,40));
    document.querySelector('.roi-pick-button').click();
    await new Promise(resolve=>setTimeout(resolve,80));
    await document.getElementById('roi-image').decode();
    document.getElementById('roi-stage').addEventListener('pointerdown',event=>window.__pointerId=event.pointerId);
    window.__pointerTrace=[];
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) document.addEventListener(type,event=>__pointerTrace.push({type,id:event.pointerId,x:event.clientX,y:event.clientY,target:event.target.id,buttons:event.buttons}),true);
  })()`);
  const evaluate = source => win.webContents.executeJavaScript(source);
  const pause = () => new Promise(resolve => setTimeout(resolve, 30));
  const frameBounds = () => evaluate(`(()=>{const r=document.getElementById('roi-image').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};})()`);
  const point = (r,x,y) => ({x:Math.round(r.left+r.width*x),y:Math.round(r.top+r.height*y)});
  const state = () => evaluate(`({disabled:document.getElementById('confirm-roi').disabled,hint:document.getElementById('roi-hint').textContent,box:document.getElementById('roi-selection').style.cssText,open:document.getElementById('roi-dialog').open})`);
  let mousePressed=false;
  const mouse = async (type,p) => {
    if(type==='mouseDown') mousePressed=true;
    const options=type==='mouseMove' ? (mousePressed ? {button:'left',modifiers:['leftButtonDown']} : {}) : {button:'left',clickCount:1};
    win.webContents.sendInputEvent({type,...p,...options});
    if(type==='mouseUp') mousePressed=false;
    await pause();
  };
  const drag = async (start,end) => {await mouse('mouseMove',start);await mouse('mouseDown',start);await mouse('mouseMove',end);await mouse('mouseUp',end);};
  const reopen = async () => {await evaluate(`document.getElementById('cancel-roi').click();document.querySelector('.roi-pick-button').click();`);await pause();await pause();};

  const bounds=await frameBounds();
  const start=point(bounds,.2,.25),end=point(bounds,.7,.65);
  await drag(start,end);
  const selected=await state();assert.equal(selected.disabled,false,'drag release enables confirmation');
  await mouse('mouseMove',point(bounds,.05,.05));
  assert.deepEqual(await state(),selected,'moving after release keeps the chosen rectangle and button state');
  fs.writeFileSync(path.join(artifacts,'selected.png'),(await win.webContents.capturePage()).toPNG());
  await evaluate(`document.getElementById('confirm-roi').click();`);
  const expected=[Math.round((start.x-bounds.left)/bounds.width*1920),Math.round((start.y-bounds.top)/bounds.height*1080),Math.round((end.x-bounds.left)/bounds.width*1920)-Math.round((start.x-bounds.left)/bounds.width*1920),Math.round((end.y-bounds.top)/bounds.height*1080)-Math.round((start.y-bounds.top)/bounds.height*1080)];
  const values=await evaluate(`[...document.querySelectorAll('#lab-parameters .coordinate-fields input')].map(input=>Number(input.value))`);
  assert.deepEqual(values,expected,'confirmation maps the scaled frame to workflow reference coordinates');
  await evaluate(`document.getElementById('start').click();`);await pause();
  const tested=await evaluate(`require(${JSON.stringify(path.join(modules,'shared/workflow/graph-document.js'))}).toCanvasDocument(require(${JSON.stringify(path.join(modules,'shared/workflow/graph-dsl.js'))}).parseDocument(__request.text)).nodes.find(node=>node.id==='test_node').params.roi`);
  assert.deepEqual(tested,expected,'the next test uses the filled ROI');

  await evaluate(`document.querySelector('.roi-pick-button').click();`);await pause();await pause();
  await drag(end,start);assert.equal((await state()).disabled,false,'reverse drag is valid');
  await reopen();
  await mouse('mouseMove',start);await mouse('mouseDown',start);await mouse('mouseUp',start);
  const clicked=await state();assert.equal(clicked.disabled,true,'a click alone is not a region');
  await mouse('mouseMove',end);assert.deepEqual(await state(),clicked,'hover after a click never creates a phantom selection');

  await mouse('mouseDown',start);await mouse('mouseMove',end);
  await evaluate(`document.getElementById('roi-stage').dispatchEvent(new PointerEvent('pointercancel',{pointerId:__pointerId}));`);
  await mouse('mouseUp',end);await mouse('mouseMove',start);
  assert.equal((await state()).disabled,true,'cancelled dragging cannot be confirmed');
  assert.match((await state()).box,/display: none/,'cancelled dragging clears the box');
  await drag(end,{x:Math.round(bounds.left-8),y:Math.round(bounds.top-8)});
  if ((await state()).disabled) console.log(await evaluate(`({trace:__pointerTrace.slice(-14),state:document.getElementById('roi-hint').textContent,bounds:document.getElementById('roi-image').getBoundingClientRect().toJSON()})`));
  assert.equal((await state()).disabled,false,'dragging outside the image clamps to its edge');
  await evaluate(`document.getElementById('confirm-roi').click();`);
  const edge=await evaluate(`[...document.querySelectorAll('#lab-parameters .coordinate-fields input')].map(input=>Number(input.value))`);
  assert.equal(edge[0],0);assert.equal(edge[1],0);assert.ok(edge[2]<=1920&&edge[3]<=1080);
  console.log(JSON.stringify({drag:true,hoverStable:true,reverseDrag:true,zeroArea:true,cancel:true,boundaryClamp:true,referenceCoordinates:expected,testRequest:true}));
  win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
