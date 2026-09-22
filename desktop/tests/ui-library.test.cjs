// Run via npm test (builds the renderer test output first).
// 组件库已迁到 src/canvas/ui/elements.ts：直接使用编译产物，行为测试不再切片源码。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../public/legacy');
const { createUi } = require('../dist-test-renderer/canvas/ui/elements.js');
const { createParameterControls } = require('../dist-test-renderer/canvas/inspector/parameter-controls.js');
const controlsSource = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/inspector/parameter-controls.js'), 'utf8');
const { createCanvasReferences } = require('../dist-test-renderer/canvas/model/references.js');
const references = createCanvasReferences({
  state: {}, clone: value => JSON.parse(JSON.stringify(value)), nodes: () => [],
  definitionSchema: () => undefined, compatibleRefType: () => false, appendNestedRefs: () => {},
  variableSystem: { visible: () => true, referenceLabel: ref => ref }, catalogByName: () => null,
});

// Minimal DOM event harness: verifies behavior, not browser layout.
function harness() {
  const doc = { readyState: 'loading', activeElement: null, events:{},
    addEventListener(name,fn) {(this.events[name] ||= new Set()).add(fn);},
    removeEventListener(name,fn) {this.events[name]?.delete(fn);},
    fire(name,event) {for(const fn of this.events[name] || []) fn(event);},
  };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.events = {};
      this.className = ''; this.disabled = false; this.value = ''; this.scrollTop = 0; this.clientHeight = 100;
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        toggle: (name, force) => { const set = new Set(this.className.split(' ').filter(Boolean)); const value = force ?? !set.has(name); if (value) set.add(name); else set.delete(name); this.className = [...set].join(' '); return value; },
        add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false),
      };
    }
    set innerHTML(value) { this.children = []; }
    get textContent() { return this.text || this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
    fire(k, extra = {}) { for (const fn of this.events[k] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }); }
    focus() { doc.activeElement = this; }
    click() { if (!this.disabled) this.fire('click'); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); }
    contains(target) { return this === target || this.children.some(c => c.contains(target)); }
    querySelectorAll(selector) { const cls = selector.match(/\.([\w-]+)$/)?.[1]; return this.children.flatMap(c => [...(cls && c.classList.contains(cls) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { left: 10, top: 20, bottom: 46, right: 170, width: 160, height: 26 }; }
    get offsetHeight() { return 120; }
    get offsetWidth() { return 160; }
  }
  doc.body = new Element('body'); doc.createElement = tag => new Element(tag);
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 400, innerHeight: 800 }; win.parent = win;
  const timers = [];
  globalThis.window = win; globalThis.document = doc; globalThis.Element = Element; globalThis.Node = Element;
  globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  const UI = createUi();
  const ctx = vm.createContext({ window: win, document: doc, Element, Node: Element, setTimeout: globalThis.setTimeout, JSON, console });
  return { UI, doc, win, ctx, flush: () => timers.splice(0).forEach(fn => fn()) };
}

test('segmented controls ignore repeated clicks and respect rejected changes', () => {
  const {UI} = harness(); const calls = [];
  const control = UI.segmented({value:'literal', options:[{value:'literal',label:'固定值'},{value:'binding',label:'变量'}], onChange:value=>calls.push(value)});
  control.children[0].fire('click'); assert.equal(calls.length,0);
  control.children[1].fire('click'); control.children[1].fire('click');
  assert.deepEqual(calls,['binding']); assert.equal(control.children[1].attrs['aria-pressed'],'true');
  control.set('literal'); assert.equal(calls.length,1); assert.equal(control.children[0].attrs['aria-pressed'],'true');
  const rejected=UI.segmented({value:'a',options:[{value:'a',label:'A'},{value:'b',label:'B'}],onChange:()=>false});
  rejected.children[1].fire('click'); assert.equal(rejected.children[0].attrs['aria-pressed'],'true');
});

test('详情栏不再渲染参数的绑定入口（连线一律回画布）', () => {
  // 这里断言编译产物：参数块曾经同时挂着「固定值 / 变量」模式切换和「绑定 ▾」下拉，
  // 两者都是在详情栏里改 `{ref}`；现在连线与断线都只在画布上做，容易漏删一个，
  // 所以钉住这条契约（要恢复入口就必须同时改这条测试）。
  const source = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/inspector/parameter-controls.js'), 'utf8');
  assert.equal(source.includes('valueBindingMenu'), false, '参数标题行不应再挂「绑定 ▾」下拉');
  assert.equal(source.includes('segmentedInput('), false, '参数标题行不应再有「固定值 / 变量」模式切换');
});

test('fixed values survive binding and unbinding on the canvas', () => {
  const {UI,ctx} = harness();
  ctx.state={paramLiteralCache:{}}; ctx.clone=v=>JSON.parse(JSON.stringify(v));
  ctx.defaultValue=references.defaultValue;
  const controls=createParameterControls({state:ctx.state,clone:ctx.clone,defaultValue:references.defaultValue,UI:{ICON_SVG:{},icon:()=>null}});
  ctx.parameterLiteralCache=controls.parameterLiteralCache;
  ctx.rememberParameterLiteral=controls.rememberParameterLiteral;
  ctx.restoreParameterLiteral=controls.restoreParameterLiteral;
  const node={id:'task',params:{timeout_seconds:6}};
  const definition={type:'number'};
  // 详情栏已经没有「固定值 / 变量」模式切换：连线与断线都发生在画布上。
  // 断线时要能恢复连线前的固定值，所以各种字面量都必须原样留在缓存里。
  for(const value of [6,12,0,false,'assets/template.png',[1,2,30,40]]) {
    ctx.rememberParameterLiteral(node,'timeout_seconds',value);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.restoreParameterLiteral(node,'timeout_seconds',definition))),value);
  }
  // 没有缓存过就回落到定义默认值。
  ctx.state.paramLiteralCache={};
  assert.equal(ctx.restoreParameterLiteral({id:'other',params:{}},'timeout_seconds',{type:'number',default:3}),3);
});

test('inputs preserve zero, checkbox uses boolean, rect edits do not mutate caller data', () => {
  const {UI}=harness(); let result;
  const input=UI.input({value:0,type:'number',label:'超时',onChange:v=>result=v}); assert.equal(input.value,'0');
  input.value='6'; input.fire('change'); assert.equal(result,'6');
  const check=UI.checkbox({checked:false,onChange:v=>result=v}); check.checked=true; check.fire('change'); assert.equal(result,true);
  const original=[1,2,3,4]; const rect=UI.rect({value:original,onChange:v=>result=v});
  const x=rect.children[0].children[1]; x.value='25'; x.fire('change');
  assert.deepEqual(original,[1,2,3,4]); assert.deepEqual(Array.from(result),[25,2,3,4]);
});

test('dropdown keyboard selection, disabled and popup cleanup', () => {
  const {UI,doc,flush}=harness(); let value;
  const options=[{value:'a',label:'甲'},{value:'b',label:'乙'}];
  const dropdown=UI.dropdown({value:'a',options,onChange:v=>value=v}); const trigger=dropdown.children[0];
  trigger.fire('keydown',{key:'ArrowDown'}); assert.equal(trigger.attrs['aria-expanded'],'true');
  let list=doc.body.children[0]; assert.equal(doc.activeElement.textContent,'甲');
  list.fire('keydown',{key:'ArrowDown'}); assert.equal(doc.activeElement.textContent,'乙');
  doc.activeElement.fire('click'); assert.equal(value,'b'); assert.equal(doc.body.children.length,0);
  trigger.fire('click'); UI.closeDropdowns(); flush(); assert.equal(doc.body.children.length,0); assert.equal(trigger.attrs['aria-expanded'],'false');
  UI.dropdown({value:'a',options,disabled:true}).children[0].fire('click'); assert.equal(doc.body.children.length,0);
});

test('all styles parse; legacy rules are layered below the component library', () => {
  const postcss=require('postcss');
  for(const file of ['workflow-editor.css','ui.css','inspector.css','ui-showcase.css']) postcss.parse(fs.readFileSync(path.join(root,file),'utf8'),{from:file});
  const css=postcss.parse(fs.readFileSync(path.join(root,'workflow-editor.css'),'utf8'));
  assert.equal(css.nodes.find(node=>node.type!=='comment').name,'layer');
});

test('tooltips share a borderless neutral surface and reduced shadow across renderers', () => {
  const postcss=require('postcss');
  for(const file of ['ui.css','workflow-editor.css','../../src/renderer/styles.css']) {
    const css=postcss.parse(fs.readFileSync(path.join(root,file),'utf8'));
    let found=0;
    css.walkRules(rule=>{
      if(!rule.selectors.some(selector=>['.app-tooltip','.ui-tooltip'].includes(selector))) return;
      const declarations=Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
      assert.equal(declarations.border,'0',file);
      assert.equal(declarations.background,'var(--ui-tooltip-bg)',file);
      assert.equal(declarations.color,'var(--ui-tooltip-text)',file);
      assert.equal(declarations['box-shadow'],'var(--ui-tooltip-shadow)',file);
      found++;
    });
    assert(found>0,file);
  }
  const ui=fs.readFileSync(path.join(root,'ui.css'),'utf8');
  assert(ui.includes('--ui-tooltip-bg: #303030'));
  assert(ui.includes('--ui-tooltip-shadow: 0 3px 8px rgba(0, 0, 0, .18)'));
  const light=fs.readFileSync(path.join(root,'../theme/theme.css'),'utf8');
  assert(light.includes('--ui-tooltip-bg: #fcfcfc'));
  assert(light.includes('--ui-tooltip-shadow: 0 3px 8px rgba(0, 0, 0, .12)'));
});

test('search dropdown supports arrows, skips disabled options and commits with Enter', () => {
  const {UI,doc}=harness(); const changes=[];
  const control=UI.dropdown({value:'a',label:'动作',searchable:true,options:[{value:'a',label:'甲'},{value:'b',label:'乙',disabled:true},{value:'c',label:'丙'}],onChange:value=>changes.push(value)});
  control.children[0].click();
  let list=doc.body.children[0], search=list.children[0];
  assert.equal(search.attrs['aria-label'],'搜索动作');
  search.fire('keydown',{key:'ArrowUp'}); assert.equal(doc.activeElement.textContent,'丙');
  list.fire('keydown',{key:'ArrowUp'}); assert.equal(doc.activeElement.textContent,'甲');
  list.querySelectorAll('.ui-dropdown-item')[1].fire('click'); assert.equal(changes.length,0);
  search.value='丙'; search.fire('input'); search.fire('keydown',{key:'Enter',isComposing:true}); assert.equal(changes.length,0);
  search.fire('keydown',{key:'Enter'}); assert.deepEqual(changes,['c']); assert.equal(doc.body.children.length,0);
  control.children[0].click(); list=doc.body.children[0]; search=list.children[0];
  search.value='不存在'; search.fire('input'); search.fire('keydown',{key:'ArrowDown'}); search.fire('keydown',{key:'Enter'});
  assert.equal(changes.length,1); assert.equal(list.querySelector('.ui-dropdown-empty').textContent,'没有匹配项');
});

test('dropdown focus exit and external synchronization clean listeners and stale selection', () => {
  const {UI,doc,flush}=harness(); let calls=0;
  const control=UI.dropdown({value:'a',options:[{value:'a',label:'甲'},{value:'b',label:'乙'}],onChange:()=>calls++});
  const trigger=control.children[0];
  trigger.click(); flush(); doc.fire('focusin',{target:doc.createElement('button')});
  assert.equal(doc.body.children.length,0); assert.equal(trigger.attrs['aria-expanded'],'false');
  for(const name of ['focusin','scroll','mousedown']) assert.equal(doc.events[name]?.size || 0,0);
  trigger.click(); control.set('b'); flush();
  assert.equal(doc.body.children.length,0); assert.equal(trigger.textContent,'乙'); assert.equal(calls,0);
  trigger.click(); doc.body.children[0].querySelector('.selected').click(); assert.equal(calls,0);
});

test('rectangle controls disable every coordinate and picker; no-picker layout has four tracks', () => {
  const {UI}=harness();
  const disabled=UI.rect({value:[0,0,100,100],disabled:true,onPick(){}});
  disabled.children.slice(0,4).forEach(field=>assert.equal(field.children[1].disabled,true));
  assert.equal(disabled.children[4].disabled,true);
  assert.equal(UI.rect({value:[0,0,100,100]}).children.length,4);
  const css=require('postcss').parse(fs.readFileSync(path.join(root,'ui.css'),'utf8'));
  let columns;css.walkRules('.ui-rect',rule=>rule.walkDecls('grid-template-columns',decl=>{columns=decl.value;}));
  assert.equal(columns,'repeat(4, minmax(0, 1fr))');
  const html=fs.readFileSync(path.join(__dirname,'../src/renderer/ui-showcase.html'),'utf8');
  for(const asset of ['/theme/editor-light.css','/theme/theme.css','/theme/theme.js']) assert(html.includes(asset));
  assert(html.includes('id="demo-theme"')); assert(html.includes('id="demo-rect-disabled"'));
});

test('详情栏标量控件覆盖坐标点/颜色/按键/时长', () => {
  const {UI,doc}=harness(); const assigned=[];
  const el=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className||'';if(text!==undefined)node.textContent=text;return node;};
  const textInput=(value,onChange,options={})=>{
    const input=doc.createElement('input');
    input.value=value===undefined||value===null?'':String(value);
    input.type=options.type||'text';
    for(const name of ['min','max','step']) if(options[name]!==undefined) input.attrs[name]=String(options[name]);
    input.addEventListener('change',()=>onChange(input.value));
    return input;
  };
  const controls=createParameterControls({
    state:{paramLiteralCache:{}},clone:v=>JSON.parse(JSON.stringify(v)),defaultValue:references.defaultValue,
    UI:{ICON_SVG:{},icon:()=>null},el,textInput,
  });
  const set=value=>assigned.push(value);

  const point=controls.scalarValueControl({type:'point'},{x:1,y:2},set);
  assert.equal(point.className,'rect-control point-control');
  assert.equal(point.children.length,2);
  point.children[0].value='960'; point.children[0].fire('change');
  assert.deepEqual(assigned.at(-1),{x:960,y:2});
  // 改另一个轴时保留当前输入里的 X，而不是回退到初始值。
  point.children[1].value='540.6'; point.children[1].fire('change');
  assert.deepEqual(assigned.at(-1),{x:960,y:541});

  const color=controls.scalarValueControl({type:'color'},'#ff8c3a',set);
  const colorText=color.children[0], picker=color.children[1];
  assert.equal(colorText.value,'#ff8c3a');
  assert.equal(picker.type,'color');
  assert.equal(picker.className,'definition-color-picker');
  assert.equal(picker.value,'#ff8c3a');
  picker.value='#123456'; picker.fire('input');
  assert.equal(colorText.value,'#123456');
  assert.equal(assigned.at(-1),'#123456');

  const key=controls.scalarValueControl({type:'key'},'BACK',set);
  const keyText=key.children[0], keyPicker=key.children[1];
  assert.equal(keyText.value,'BACK');
  assert.equal(keyPicker.value,'BACK');
  assert.ok(keyPicker.children.length>=13);
  assert.equal(keyPicker.children[1].textContent,'BACK · 返回');
  keyPicker.value='DPAD_UP'; keyPicker.fire('change');
  assert.equal(keyText.value,'DPAD_UP');
  assert.equal(assigned.at(-1),'DPAD_UP');
  // 清单外的令牌不回填选择器，也不会因为选择器空值而写回。
  const custom=controls.scalarValueControl({type:'key'},'KEYCODE_99',set);
  assert.equal(custom.children[1].value,'');
  custom.children[1].value=''; custom.children[1].fire('change');
  assert.equal(assigned.at(-1),'DPAD_UP');

  const duration=controls.scalarValueControl({type:'duration',min:0,max:5},1.5,set);
  assert.equal(String(duration.children[0].value),'1.5');
  assert.equal(duration.children[0].attrs.min,'0');
  assert.equal(duration.children[0].attrs.step,'any');
  assert.equal(duration.children[1].textContent,'秒');
  duration.children[0].value='2.5'; duration.children[0].fire('change');
  assert.equal(assigned.at(-1),2.5);

  // 新类型都按标量走详情栏就地编辑，而不是退化成 JSON 文本框。
  for(const definition of [{type:'point'},{type:'color'},{type:'key'},{type:'duration'}]) {
    assert.equal(controls.scalarDefinitionUsable(definition),true,definition.type);
  }
  assert.equal(controls.scalarDefinitionUsable({type:'object'}),false);
  assert.equal(controls.scalarDefinitionUsable(null),false);
  assert.deepEqual(controls.itemDefaultValue({type:'point'}),{x:0,y:0});
  assert.equal(controls.itemDefaultValue({type:'duration'}),0);
  assert.equal(controls.itemDefaultValue({type:'color'}),'#000000');
  assert.equal(controls.itemDefaultValue({type:'enum',enum:['甲','乙']}),'甲');
});

test('坐标点击详情把 X/Y 合并为一行，并从当前画面选点回填', () => {
  const {UI,doc}=harness(); const requests=[];
  const el=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className||'';if(text!==undefined)node.textContent=text;return node;};
  const textInput=(value,onChange,options={})=>{
    const input=doc.createElement('input'); input.value=String(value ?? ''); input.type=options.type||'text';
    input.addEventListener('change',()=>onChange(input.value)); return input;
  };
  const controls=createParameterControls({
    state:{},mutate:fn=>fn(),UI:{ICON_SVG:{},icon:()=>null},el,textInput,
    clone:v=>JSON.parse(JSON.stringify(v)),defaultValue:()=>0,
    requestRoi:(...args)=>requests.push(args),
  });
  const body=doc.createElement('div');
  const node={id:'tap_1',action:'input.tap',params:{x:120,y:360}};
  controls.renderCoordinatePair(body,node,{type:'number',required:true},{type:'number',required:true});

  const shell=body.children[0].children[2];
  assert.equal(shell.className,'coordinate-control');
  assert.equal(shell.children.length,3,'X、Y 与选点按钮处于同一行');
  assert.equal(shell.children[0].children[0].textContent,'X');
  assert.equal(shell.children[1].children[0].textContent,'Y');
  shell.children[0].children[1].value='240'; shell.children[0].children[1].fire('change');
  assert.deepEqual(node.params,{x:240,y:360});

  shell.children[2].click();
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].slice(0,3),['tap_1','x','point']);
  assert.equal(requests[0][3].pairedKey,'y');
  requests[0][3].applyValue([960,540]);
  assert.deepEqual(node.params,{x:960,y:540});
});

test('任务参数结构化控件：固定长度数组给固定输入，未声明字段的对象按值推断', () => {
  const {UI,doc}=harness();
  const el=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className||'';if(text!==undefined)node.textContent=text;return node;};
  const textInput=(value,onChange,options={})=>{
    const input=doc.createElement('input');
    input.value=value===undefined||value===null?'':String(value);
    input.type=options.type||'text';
    for(const name of ['min','max','step']) if(options[name]!==undefined) input.attrs[name]=String(options[name]);
    input.addEventListener('change',()=>onChange(input.value));
    return input;
  };
  const controls=createParameterControls({
    state:{paramLiteralCache:{}},mutate:fn=>fn(),clone:v=>JSON.parse(JSON.stringify(v)),
    defaultValue:references.defaultValue,UI,el,textInput,toast:()=>{},fieldLabel:name=>name,enumOption:value=>value,
  });
  // 随机间隔这类固定长度数组：正好两个输入，不出现增删按钮。
  let random=[0.2,0.6];
  const tuple=controls.nestedValueControl({type:'array',items:{type:'duration',min:0},min_items:2,max_items:2},random,next=>{random=next;},{},'random_interval');
  assert.equal(tuple.className,'scalar-array');
  assert.equal(tuple.children.length,2,'固定长度数组不渲染增删按钮');
  assert.ok(tuple.children.every(row=>row.className==='scalar-array-row'));
  assert.equal(tuple.children[1].children[0].children[0].type,'number','元素沿用 duration 控件（秒单位）');
  const firstItem=tuple.children[0].children[0].children[0];
  firstItem.value='1.5'; firstItem.fire('change');
  assert.deepEqual(random,[1.5,0.6]);
  // 不定长数组仍保留删除 + 添加。
  const list=controls.nestedValueControl({type:'array',items:{type:'integer'}},[1,2],()=>{}, {},'x');
  assert.equal(list.children.length,3,'两项 + 添加按钮');
  assert.equal(list.children.at(-1).className,'structured-add');
  // 没有声明 properties 的对象按当前值的键推断字段，而不是 JSON 文本框。
  const object=controls.nestedValueControl({type:'object'},{x:1,y:2},()=>{}, {},'match');
  assert.equal(object.className,'structured-object');
  assert.equal(object.children.length,2);
  assert.deepEqual(object.children.map(row=>row.children[0].textContent),['x','y']);
  assert.equal(object.children[0].children[1].tagName,'INPUT','推断出来的字段直接给输入控件');
  // 元素是「没有字段声明的对象」时，按现有元素的键推断字段（如消失状态列表）。
  const objectList=controls.nestedValueControl({type:'array',items:{type:'object'}},[{name:'a',ttl:2}],()=>{}, {},'disappeared_states');
  assert.equal(objectList.className,'object-array');
  assert.equal(objectList.querySelectorAll('.object-array-card').length,1);
  assert.deepEqual(objectList.querySelectorAll('.structured-field').map(field=>field.children[0].textContent),['name','ttl']);
  // 空对象无法推断字段，保留原有的 JSON 兜底（有明确结构时不会出现）。
  const empty=controls.nestedValueControl({type:'object'},{},()=>{}, {},'blank');
  assert.equal(empty.tagName,'TEXTAREA');
});

test('font entries and their local subsets exist for all desktop surfaces', () => {
  const desktop=path.join(root,'../..');
  for(const weight of ['Regular','Semibold','Bold']) {
    const relative=`fonts/harmonyos-sans-sc/${weight}.css`;
    for(const page of ['index','popout','vision-test']) {
      const html=fs.readFileSync(path.join(desktop,`src/renderer/${page}.html`),'utf8');
      assert(html.includes(`href="/${relative}"`));
    }
    const file=path.join(desktop,'public',relative), fontCss=fs.readFileSync(file,'utf8');
    const urls=[...fontCss.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)];
    assert(urls.length>0);
    for(const [,url] of urls) assert(fs.existsSync(path.resolve(path.dirname(file),url)),url);
  }
});

test('structured inspector rows share fixed caption tracks and compact first-line alignment', () => {
  const css=require('postcss').parse(fs.readFileSync(path.join(root,'inspector.css'),'utf8'));
  const declarations=selector=>{
    const result={}; css.walkRules(selector,rule=>{ if(rule.parent.type==='root') rule.walkDecls(d=>{result[d.prop]=d.value;}); }); return result;
  };
  assert.equal(declarations('#inspector-body')['--inspector-structured-label'],'82px');
  const row=declarations('#inspector-body .structured-field');
  assert.equal(row['grid-template-columns'],'var(--inspector-structured-label) minmax(0, 1fr)');
  assert.equal(row.gap,'6px');
  const caption=declarations('#inspector-body .structured-field-caption');
  assert.equal(caption['grid-template-columns'],'minmax(0, 1fr) 30px');
  assert.equal(caption['padding-top'],'0');
  assert.equal(caption['min-height'],'var(--ui-height)');
  css.walkDecls('--inspector-structured-label',decl=>assert.equal(decl.value,'82px','narrow panels must not shift the value column'));
  assert.equal(declarations('#inspector-body .structured-field > .inline-control > .ui-input')['flex-basis'],'100%');
  let rectRule=false;
  css.walkRules('#inspector-body .structured-field > .rect-control',rule=>{
    assert.equal(rule.parent.params,'inspector (max-width: 400px)');
    assert(rule.nodes.some(d=>d.prop==='grid-template-columns'&&d.value==='repeat(2, minmax(0, 1fr)) 22px')); rectRule=true;
  });
  assert(rectRule);
  const showcase=fs.readFileSync(path.join(root,'ui-showcase.js'),'utf8');
  for(const label of ['名称 *','模板','识别区域','匹配阈值']) assert(showcase.includes(`structured('${label}'`));
});
