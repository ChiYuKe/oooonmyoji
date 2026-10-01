// Isolated test workspace: no device connections or changes to project workflows.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', 'workflow-test-ui');
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
  const win = new BrowserWindow({ show: false, width: 1450, height: 950, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  await win.loadFile(file);
  const modules = path.join(root, 'dist-test-renderer');
  await win.webContents.executeJavaScript(`(async () => {
    const assert = require('node:assert/strict');
    const base = ${JSON.stringify(modules)};
    const { emitRuntimeDocument } = require(base + '/shared/workflow/graph-dsl.js');
    const nodes = [
      {id:'root',name:'御魂组队队长入口',type:'root',children:['sequence']},
      {id:'sequence',name:'选层页建队与邀队',type:'sequence',children:['find','judge',...Array.from({length:12},(_,i)=>'task'+i)]},
      {id:'find',name:'等待御魂选层页组队按钮',type:'task',action:'vision.wait_template',params:{template:'assets/templates/button.png',threshold:.85,timeout_seconds:30}},
      {id:'judge',name:'已进入御魂选层页',type:'condition',expression:true},
      ...Array.from({length:12},(_,i)=>({id:'task'+i,name:['点击组队按钮','等待协战队伍空位','邀请好友入队','等待队友准备'][i%4],type:'task',action:'vision.wait_template',params:{threshold:.85,timeout_seconds:30}}))
    ];
    const text = emitRuntimeDocument({schema_version:4,id:'test',version:'1.0.0',resolution:[1920,1080],root:'root',inputs:{},variables:{},nodes});
    window.__testRequests=[]; window.__commands=[];
    window.onmyoji={
      workflowTestInit:async()=>({uri:'御魂组队_队长.owf',text,instanceId:'mumu',nodeIds:['sequence']}),
      bootstrap:async()=>({catalog:[{name:'vision.wait_template',description:'等待模板出现，超时前识别到目标则成功。',parameters:{template:{type:'asset',required:true,display_name:'模板图片'},roi:{type:'rect',default:[0,0,1920,1080],display_name:'识别区域'},threshold:{type:'number',min:0,max:1,default:.85,display_name:'匹配阈值'},max_results:{type:'integer',default:20,display_name:'最大匹配数'},timeout_seconds:{type:'duration',default:10,display_name:'超时（秒）'},scale_search:{type:'boolean',default:false,display_name:'多尺度搜索'}}},{name:'input.tap',description:'点击屏幕上的坐标。',parameters:{x:{type:'integer',required:true},y:{type:'integer',required:true}}}],instances:[{id:'mumu',displayName:'扫地工'}]}),
      readLayout:()=>undefined,writeLayout(){},onWorkflowTestEvent:fn=>window.__testEvent=fn,
      workflowTestStart:async request=>window.__testRequests.push(request),workflowTestCommand:async command=>window.__commands.push(command),
      workflowTestImages:async()=>['fixture.png'],workflowTestReport:async()=>{},
      minimizeWindow:async()=>{},closeWindow:async()=>{},toggleMaximizeWindow:async()=>false,isWindowMaximized:async()=>false,onWindowMaximized:()=>()=>{}
      ,listAssets:async()=>[{path:'assets/templates/button.png'}],readAssetData:async()=>[{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRDsAAAAASUVORK5CYII='}],
      workflowTestTemplate:async()=> 'assets/templates/imported.png',workflowTestAddNode:async draft=>{window.__addedDraft=draft;return 'task_99';}
    };
    require(${JSON.stringify(path.join(built, 'theme/theme.js'))});
    require(base+'/renderer/workflow-test.js');
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(document.querySelectorAll('.node-row').length,16);
    assert.equal(document.getElementById('panel-cases').hidden,true);
    assert.equal(document.getElementById('run-summary').open,false);
    document.getElementById('test-kind').value='workflow';document.getElementById('test-kind').dispatchEvent(new Event('change'));
    window.__assert=assert;
  })()`);
  const capture = async name => {
    await new Promise(resolve => setTimeout(resolve,120));
    fs.writeFileSync(path.join(artifacts, name+'.png'), (await win.webContents.capturePage()).toPNG());
  };
  await capture('ready-dark');
  await win.webContents.executeJavaScript(`(async()=>{
    const search=document.getElementById('node-search');search.value='协战';search.dispatchEvent(new Event('input'));
    __assert.equal(document.querySelectorAll('.node-row').length,3);
    search.value='';search.dispatchEvent(new Event('input'));
    document.querySelectorAll('.node-name')[2].click();
    await new Promise(resolve=>setTimeout(resolve,30));
    __assert.equal(document.getElementById('panel-parameters').hidden,false);
    const threshold=[...document.querySelectorAll('#parameters input')].find(input=>input.value==='0.85');threshold.value='.92';threshold.dispatchEvent(new Event('change'));
    document.getElementById('test-node').click();await new Promise(resolve=>setTimeout(resolve,30));
    __assert.deepEqual(__testRequests[0].nodeIds,['find']);__assert.equal(__testRequests[0].parameterOverrides.find.threshold,.92);
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#242731';ctx.fillRect(0,0,960,540);ctx.fillStyle='#ddd';ctx.font='24px sans-serif';ctx.fillText('离线界面验证 · 执行前画面',60,80);ctx.fillStyle='#52604b';ctx.fillRect(360,240,240,64);ctx.fillStyle='#fff';ctx.fillText('组队按钮',430,282);
    const image=canvas.toDataURL('image/png').split(',')[1];
    window.__fixtureStep={step_id:'find',name:'等待御魂选层页组队按钮',node_kind:'task',status:'running',params:{threshold:.92},breadcrumb:'御魂组队队长入口 → 选层页建队与邀队 → 等待御魂选层页组队按钮'};
    __testEvent({type:'started',total:1});__testEvent({type:'node_started',round:1,step:__fixtureStep,before_image:image});
    __assert.equal(document.getElementById('before-image').hidden,false);
    __assert.equal(document.getElementById('detail-screen').hidden,false);
    __assert.equal(document.querySelectorAll('#steps .step').length,1);
    window.__fixtureImage=image;
  })()`);
  await capture('running-dark');
  await win.webContents.executeJavaScript(`__testEvent({type:'paused',round:1,step:__fixtureStep,image:__fixtureImage,variables:{},outputs:{}});__assert.equal(document.getElementById('step').disabled,false);document.getElementById('step').click();`);
  await win.webContents.executeJavaScript(`(async()=>{
    await new Promise(resolve=>setTimeout(resolve,30));__assert.equal(__commands[0],'step');
    __testEvent({type:'step',round:1,step:{...__fixtureStep,status:'succeeded',duration_ms:36,output:{found:true,matches:[{confidence:.98}]}},before_image:__fixtureImage,image:__fixtureImage});
    __assert.equal(document.querySelectorAll('#steps .step').length,1);
    const summary={completed:1,requested:1,success_rate:100,mean_ms:36,p95_ms:36,max_ms:36};
    __testEvent({type:'round',round:1,status:'succeeded',passed:true,duration_ms:36,checks:[],summary});
    __testEvent({type:'finished',summary,report:'fixture.json'});__testEvent({type:'idle'});
    document.getElementById('view-output').click();document.querySelector('#output-checks button').click();
    __assert.equal(document.getElementById('panel-checks').hidden,false);
    __assert.equal(document.getElementById('checks').children.length,1);
    document.getElementById('tab-nodes').click();document.getElementById('view-screen').click();
    StudioTheme.set('light');
  })()`);
  await capture('result-light');
  win.setSize(1100,740);
  await capture('compact-light');
  const bounds = await win.webContents.executeJavaScript(`({
    bodyOverflow:document.body.scrollWidth>innerWidth,
    nodeListHeight:document.getElementById('node-list').getBoundingClientRect().height,
    detailWidth:document.querySelector('.detail-section').getBoundingClientRect().width,
    startVisible:document.getElementById('start').getBoundingClientRect().right<innerWidth
  })`);
  if (bounds.bodyOverflow || bounds.nodeListHeight < 100 || bounds.detailWidth < 300 || !bounds.startVisible) throw new Error(JSON.stringify(bounds));
  win.setSize(1450,950);
  await win.webContents.executeJavaScript(`(async()=>{
    StudioTheme.set('dark');document.getElementById('test-kind').value='node';document.getElementById('test-kind').dispatchEvent(new Event('change'));
    const templateCanvas=document.createElement('canvas');templateCanvas.width=240;templateCanvas.height=64;const templateContext=templateCanvas.getContext('2d');templateContext.fillStyle='#52604b';templateContext.fillRect(0,0,240,64);templateContext.fillStyle='#fff';templateContext.font='24px sans-serif';templateContext.fillText('组队按钮',70,42);
    onmyoji.readAssetData=async paths=>paths.map(path=>({path,dataUrl:templateCanvas.toDataURL('image/png')}));
    onmyoji.listAssets=async()=>[{path:'assets/templates/button.png',uri:templateCanvas.toDataURL('image/png')}];
    document.getElementById('lab-action').value='vision.wait_template';document.getElementById('lab-action').dispatchEvent(new Event('change'));await new Promise(resolve=>setTimeout(resolve,30));
    document.querySelector('#lab-parameters .asset-field button').click();await new Promise(resolve=>setTimeout(resolve,30));
    __assert.equal(document.getElementById('template-dialog').open,true);document.querySelector('#template-list button').click();document.getElementById('choose-template').click();
    const threshold=[...document.querySelectorAll('#lab-parameters input')].find(input=>input.value==='0.85');threshold.value='.96';document.getElementById('lab-name').value='识别组队按钮';
    document.getElementById('start').click();await new Promise(resolve=>setTimeout(resolve,30));
    const request=__testRequests.at(-1);__assert.deepEqual(request.nodeIds,['test_node']);
    const {parseDocument}=require(${JSON.stringify(modules+'/shared/workflow/graph-dsl.js')});const {toCanvasDocument}=require(${JSON.stringify(modules+'/shared/workflow/graph-document.js')});
    const raw=toCanvasDocument(parseDocument(request.text));__assert.equal(raw.nodes.length,2);__assert.equal(raw.nodes[1].params.threshold,.96);__assert.equal(raw.nodes[1].params.template,'assets/templates/button.png');
    const labStep={...__fixtureStep,step_id:'test_node',name:'识别组队按钮',breadcrumb:'识别组队按钮'};
    __testEvent({type:'started',total:1});__testEvent({type:'node_started',round:1,step:labStep,before_image:__fixtureImage});
    __testEvent({type:'step',round:1,step:{...labStep,status:'succeeded',params:raw.nodes[1].params,duration_ms:36,output:{found:true,matches:[{confidence:.98}]}},before_image:__fixtureImage,image:__fixtureImage});
    __testEvent({type:'finished',summary:{completed:1,requested:1,success_rate:100}});__testEvent({type:'idle'});
    document.getElementById('add-to-canvas').click();await new Promise(resolve=>setTimeout(resolve,30));
    __assert.equal(__addedDraft.params.threshold,.96);__assert.equal(__addedDraft.params.template,'assets/templates/button.png');__assert.match(document.getElementById('lab-feedback').textContent,/已添加/);
  })()`);
  await capture('node-lab-dark');
  const layout=await win.webContents.executeJavaScript(`(() => {
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    const threshold=rect('[data-parameter="threshold"]'),maximum=rect('[data-parameter="max_results"]');
    const mode=rect('#mode'),instance=rect('#instance'),rounds=rect('#rounds');
    const roi=rect('[data-parameter="roi"] .roi-field-heading'),pick=rect('.roi-pick-button');
    const selectors=['#test-kind','#lab-action','#mode','#instance','[data-parameter="scale_search"] select'];
    __assert.ok(selectors.every(selector=>getComputedStyle(document.querySelector(selector)).display==='flex'));
    __assert.equal(threshold.top,maximum.top);__assert.ok(maximum.left>threshold.right);
    __assert.equal(mode.top,instance.top);__assert.equal(mode.top,rounds.top);
    __assert.ok(pick.top>=roi.top&&pick.bottom<=roi.bottom);
    __assert.ok(rect('#lab-reset').bottom<=rect('#node-lab').bottom);
    __assert.ok(!document.getElementById('lab-action').selectedOptions[0].textContent.includes('vision.'));
    return {pairedParameters:true,environmentOneRow:true,roiButtonAligned:true,selectArrows:true,allParametersVisible:true};
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('.lab-action-help').open=true;document.querySelector('.lab-copy').open=true;`);
  await capture('node-lab-expanded');
  await win.webContents.executeJavaScript(`document.querySelector('.lab-action-help').open=false;document.querySelector('.lab-copy').open=false;document.getElementById('mode').value='offline';document.getElementById('mode').dispatchEvent(new Event('change'));`);
  await capture('node-lab-offline');
  await win.webContents.executeJavaScript(`__assert.equal(document.getElementById('instance-label').hidden,true);__assert.equal(document.getElementById('mode').getBoundingClientRect().top,document.getElementById('rounds').getBoundingClientRect().top);document.getElementById('mode').value='live';document.getElementById('mode').dispatchEvent(new Event('change'));StudioTheme.set('light');`);
  await capture('node-lab-light');
  await win.webContents.executeJavaScript(`StudioTheme.set('dark');`);
  win.setSize(1100,740);
  const labBounds=await win.webContents.executeJavaScript(`({envBottom:document.querySelector('.test-setup').getBoundingClientRect().bottom,height:innerHeight,builderHeight:document.getElementById('node-lab').getBoundingClientRect().height,detailWidth:document.querySelector('.detail-section').getBoundingClientRect().width})`);
  if(labBounds.envBottom>labBounds.height||labBounds.builderHeight<200||labBounds.detailWidth<500)throw new Error(JSON.stringify(labBounds));
  await capture('node-lab-compact');
  await win.webContents.executeJavaScript(`__assert.ok(document.getElementById('lab-reset').getBoundingClientRect().bottom<=document.getElementById('node-lab').getBoundingClientRect().bottom);document.querySelector('.test-workspace').style.setProperty('--test-config-width','340px');`);
  await capture('node-lab-narrow');
  await win.webContents.executeJavaScript(`(() => {
    const panel=document.querySelector('.configuration').getBoundingClientRect();
    __assert.ok(!document.body.scrollWidth||document.body.scrollWidth<=innerWidth);
    for(const element of document.querySelectorAll('#lab-parameters input,#lab-parameters select,.environment-fields .ui-input')){
      const rect=element.getBoundingClientRect();__assert.ok(rect.left>=panel.left&&rect.right<=panel.right);
    }
    const action=document.querySelector('.lab-action-help'),copy=document.querySelector('.lab-copy');
    action.open=true;copy.open=true;
  })()`);
  await capture('node-lab-narrow-expanded');
  console.log(JSON.stringify({singleTest:true,parameters:true,search:true,runningImage:true,step:true,checks:true,compact:bounds,layout}));
  win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
