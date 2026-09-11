const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../public/legacy');

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
  }
  doc.body = new Element('body'); doc.createElement = tag => new Element(tag);
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 400, innerHeight: 800 }; win.parent = win;
  const timers = [];
  const ctx = vm.createContext({ window: win, document: doc, Element, Node: Element, setTimeout: fn => timers.push(fn) });
  vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), ctx);
  return { UI: win.UI, doc, ctx, flush: () => timers.splice(0).forEach(fn => fn()) };
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

test('fixed values survive the real editor mode-switch callback', () => {
  const {UI,ctx} = harness(); const source=fs.readFileSync(path.join(root,'workflow-editor.js'),'utf8');
  const helpers=['parameterLiteralCache','parameterLiteralCacheKey','rememberParameterLiteral','restoreParameterLiteral','isBindingValue','defaultValue'];
  ctx.state={paramLiteralCache:{}}; ctx.clone=v=>JSON.parse(JSON.stringify(v));
  for(const name of helpers) { const start=source.indexOf(`  function ${name}(`); assert(start>=0); vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),ctx); }
  ctx.node={id:'task',params:{timeout_seconds:6}}; ctx.name='timeout_seconds'; ctx.definition={type:'number'};
  ctx.mutate=fn=>fn(); ctx.allRefs=()=>['inputs.timeout']; ctx.variableLinks=()=>({});
  const start=source.indexOf('(next) => mutate(() => {',source.indexOf("const mode = segmentedInput(bound"));
  const end=source.indexOf('\n    }));',start);
  const onChange=vm.runInContext('('+source.slice(start,end)+'\n    })'+')',ctx);
  const control=UI.segmented({value:'literal',options:[{value:'literal',label:'固定值'},{value:'binding',label:'变量'}],onChange});
  for(const value of [6,12,0,false,'assets/template.png',[1,2,30,40]]) {
    ctx.node.params.timeout_seconds=value; control.children[1].fire('click'); control.children[0].fire('click');
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.node.params.timeout_seconds)),value);
  }
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
  const html=fs.readFileSync(path.join(root,'ui-showcase.html'),'utf8');
  for(const asset of ['../theme/editor-light.css','../theme/theme.css','../theme/theme.js']) assert(html.includes(asset));
  assert(html.includes('id="demo-theme"')); assert(html.includes('id="demo-rect-disabled"'));
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
