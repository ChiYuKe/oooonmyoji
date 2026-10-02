// Production renderer with a small in-memory DOM. No windows, screenshots or devices.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const root = path.join(__dirname, '..');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.value = ''; this.textContent = '';
    this.className = ''; this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.style = {setProperty() {}};
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: name => { this.className = this.className.split(' ').filter(v => v !== name).join(' '); },
      toggle: (name, active) => active ? this.classList.add(name) : this.classList.remove(name),
    };
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'src') this.src = ''; }
  addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({target:this}); }
  click() { if (!this.disabled) this.fire('click'); }
  querySelectorAll(selector) {
    const match = item => selector.startsWith('.') ? item.classList.contains(selector.slice(1)) : item.tagName === selector;
    return this.children.flatMap(child => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return {width:1450}; }
}
class Input extends Element { constructor() { super('input'); } }
class Textarea extends Element { constructor() { super('textarea'); } }
class Select extends Element { constructor() { super('select'); } }

test('Tools entry opens the current canvas testing snapshot', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const tools = html.split('>工具</button>')[1].split('<div class="menu-root">')[0];
  assert.match(tools, /data-editor-command="openWorkflowTest"/);
  const {createEditorCommandDispatch} = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js');
  let requested = 0;
  createEditorCommandDispatch({requestWorkflowTest:()=>requested++}).executeEditorCommand('openWorkflowTest');
  assert.equal(requested, 1);
});

test('restyled renderer initializes, edits a case, steps through results and uses window controls', async () => {
  const elements = new Map();
  const document = {
    getElementById: id => elements.get(id),
    createElement(tag) {
      const value = tag === 'input' ? new Input() : tag === 'textarea' ? new Textarea() : tag === 'select' ? new Select() : new Element(tag);
      value.ownerDocument = document; return value;
    },
    querySelector: () => elements.get('test-inspection'),
  };
  for (const [,tag,attributes,id] of fs.readFileSync(path.join(root,'src/renderer/workflow-test.html'),'utf8').matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const value = document.createElement(tag); value.className = attributes.match(/class="([^"]+)"/)?.[1] || '';
    value.disabled = /\bdisabled\b/.test(attributes); value.hidden = /\bhidden\b/.test(attributes);
    value.value = attributes.match(/value="([^"]+)"/)?.[1] || ''; elements.set(id,value);
  }
  const {emitRuntimeDocument} = require('../dist-test-renderer/shared/workflow/graph-dsl.js');
  const text = emitRuntimeDocument({schema_version:4,id:'test',version:'1.0.0',description:'识别按钮',resolution:[1920,1080],root:'root',inputs:{},variables:{},nodes:[{id:'root',type:'root',children:['find']},{id:'find',type:'task',name:'识别按钮',action:'vision.match_template',params:{template:'button.png',threshold:0.85}}]});
  let listener, request, maximizeListener, stored = {}, added;
  const commands = [], windows = [];
  const workflowUri = `file:///E:/Project/${encodeURIComponent('其他游戏')}/oooonmyoji/workflows/${encodeURIComponent('御魂组队_队长.owf')}`;
  const api = {
    // 真实工作流 uri 来自主进程的 `pathToFileURL()`：非 ASCII 文件名在里面是百分号编码，
    // 标题栏必须显示解码后的名字（回归：曾经直接 split uri，显示成一串 `%E5%BE%A1…`）。
    workflowTestInit: async()=>({uri:workflowUri,text,instanceId:'mumu-0',nodeIds:['find']}),
    bootstrap: async()=>({catalog:[{name:'vision.match_template',parameters:{threshold:{type:'number'}}}],instances:[{id:'mumu-0'}]}),
    readLayout:key=>stored[key], writeLayout:(key,value)=>stored[key]=value,
    onWorkflowTestEvent:fn=>listener=fn, workflowTestStart:async value=>request=value,
    workflowTestCommand:async value=>commands.push(value), workflowTestImages:async()=>['fixture.png'], workflowTestReport:async()=>{},
    minimizeWindow:async()=>windows.push('minimize'), closeWindow:async()=>windows.push('close'),
    toggleMaximizeWindow:async()=>{windows.push('maximize');return true;}, isWindowMaximized:async()=>false,
    onWindowMaximized:fn=>{maximizeListener=fn;return()=>{};},
    listAssets:async()=>[{path:'assets/templates/chosen.png'}],readAssetData:async paths=>paths.map(path=>({path,dataUrl:'data:image/png;base64,template'})),
    workflowTestTemplate:async()=> 'assets/templates/imported.png',workflowTestAddNode:async node=>{added=node;return 'node_2';},
  };
  const window = {onmyoji:api, addEventListener() {}, removeEventListener() {}}; document.defaultView = window;
  const filename = path.join(root,'dist-test-renderer/renderer/workflow-test.js');
  const localRequire = createRequire(filename);
  const context = vm.createContext({window,document,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,HTMLSelectElement:Select,structuredClone,console,require:name=>name==='lucide'?{createIcons(){}}:localRequire(name),exports:{}});
  vm.runInContext(fs.readFileSync(filename,'utf8'),context,{filename});
  const tick = () => new Promise(resolve=>setImmediate(resolve));
  await tick();
  const get = id=>elements.get(id);
  assert.equal(get('start').disabled,false);
  assert.equal(get('workflow-name').textContent,'御魂组队_队长.owf','标题栏显示解码后的工作流文件名');
  assert.equal(get('workflow-config').hidden,true);
  assert.equal(get('node-lab').hidden,false);
  const labThreshold=get('lab-parameters').querySelectorAll('input').find(item=>item.type==='number');
  labThreshold.value='.94'; get('lab-name').value='调好的识别';
  get('variables').value='not JSON';
  get('start').click();await tick();
  assert.deepEqual([...request.nodeIds],['test_node']);
  const {parseDocument}=require('../dist-test-renderer/shared/workflow/graph-dsl.js');
  const {toCanvasDocument}=require('../dist-test-renderer/shared/workflow/graph-document.js');
  const tested=toCanvasDocument(parseDocument(request.text));
  assert.equal(tested.nodes.length,2,'node testing ignores unrelated workflow nodes');
  assert.equal(tested.nodes.find(item=>item.id==='test_node').params.threshold,.94);
  listener({type:'idle'});
  get('add-to-canvas').click();await tick();
  assert.equal(added.action,'vision.match_template');assert.equal(added.params.threshold,.94);assert.equal(added.name,'调好的识别');
  assert.match(get('lab-feedback').textContent,/已添加/);
  get('variables').value='{}';
  get('test-kind').value='workflow';get('test-kind').fire('change');
  assert.equal(get('panel-nodes').hidden,false);
  assert.equal(get('panel-cases').hidden,true);
  assert.equal(get('node-list').children.length,2);
  const selected = get('node-list').children[1];
  assert.ok(selected.children[0].classList.contains('ui-checkbox'));
  assert.ok(selected.children[1].classList.contains('ui-button'));
  selected.children[1].click();await tick();
  assert.equal(get('panel-parameters').hidden,false);
  assert.equal(get('panel-nodes').hidden,true);
  const threshold = get('parameters').querySelectorAll('input').find(item=>item.type==='number');
  threshold.value='0.92';threshold.fire('change');await tick();
  get('case-name').value='按钮识别';get('save-case').click();await tick();
  assert.equal(Object.keys(stored).length,1);
  get('single-step').checked=true;get('start').click();await tick();
  assert.equal(request.parameterOverrides.find.threshold,0.92);
  assert.equal(request.nodeIds[0],'find');assert.equal(request.singleStep,true);
  const step = {step_id:'find',name:'识别按钮',status:'succeeded',duration_ms:36,params:{threshold:0.92},output:[{confidence:0.98}]};
  listener({type:'started',total:1});listener({type:'paused',round:1,step:{...step,status:'running'},variables:{},outputs:{}});
  assert.equal(get('step').disabled,false);get('step').click();await tick();assert.deepEqual(commands,['step']);
  listener({type:'node_started',round:1,step:{...step,status:'running'},before_image:'before'});
  assert.equal(get('steps').children.length,1,'pause and start share one row');
  assert.equal(get('before-image').src,'data:image/png;base64,before');
  assert.equal(get('run-title').textContent,'识别按钮');
  listener({type:'step',round:1,step,before_image:'before',image:'after'});
  assert.equal(get('after-image').src,'data:image/png;base64,after');
  assert.equal(get('steps').children.length,1,'completion replaces the running row');
  listener({type:'node_started',round:1,step:{...step,status:'running'},before_image:'repeat'});
  assert.equal(get('steps').children.length,2,'another invocation remains separate');
  get('steps').children[0].click();
  listener({type:'step',round:1,step:{...step,output:[{confidence:.99}]},image:'repeat-result'});
  assert.equal(get('steps').children.length,2);
  assert.equal(get('after-image').src,'data:image/png;base64,after','inspecting an earlier step stops automatic following');
  get('follow-latest').click();
  assert.equal(get('after-image').src,'data:image/png;base64,repeat-result');
  listener({type:'step',round:1,step:{step_id:'root',name:'流程入口',node_kind:'root',status:'succeeded'}});
  assert.equal(get('after-image').src,'data:image/png;base64,repeat-result','container completion keeps the task result visible');
  get('output-checks').querySelectorAll('button')[0].click();
  assert.equal(get('checks').children.length,1);
  const summary = {completed:1,requested:1,success_rate:100,mean_ms:36,p95_ms:36,max_ms:36};
  listener({type:'round',round:1,status:'succeeded',passed:true,duration_ms:36,checks:[],summary});
  get('round-results').children[0].click();assert.ok(get('round-results').children[0].classList.contains('active'));
  listener({type:'finished',summary,report:'report.json'});listener({type:'idle'});
  assert.equal(get('start').disabled,false);assert.equal(get('report').disabled,false);
  get('all-nodes').click();
  get('node-search').value='识别';get('node-search').fire('input');
  assert.equal(get('node-list').children.length,1);
  get('node-list').children[0].children[3].click();await tick();
  assert.deepEqual([...request.nodeIds],['find'],'single test replaces whole-workflow scope');
  assert.equal(request.parameterOverrides.find.threshold,.92,'single test keeps edited parameters');
  listener({type:'idle'});
  get('node-search').value='不存在';get('node-search').fire('input');
  assert.match(get('node-list').children[0].textContent,/没有找到节点/);
  assert.match(get('scope-help').textContent,/识别按钮/,'filtering retains test selection');
  get('mode').value='offline';get('mode').fire('change');get('pick-images').click();await tick();
  get('start').click();await tick();assert.equal(request.mode,'offline');assert.equal(request.images[0],'fixture.png');
  get('test-minimize').click();get('test-maximize').click();get('test-close').click();await tick();
  assert.deepEqual(windows,['minimize','maximize','close']);
  assert.equal(get('test-maximize').title,'还原');maximizeListener(false);assert.equal(get('test-maximize').title,'最大化');
});
