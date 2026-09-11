const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/main.ts'), 'utf8');

// Exercise the production renderer without opening a desktop/browser window.
function harness(variables) {
  class Element {
    constructor(tag) { this.tagName=tag; this.children=[]; this.attrs={}; this.dataset={}; this.events={}; this.className=''; this.scrollTop=0;
      this.classList={add:name=>{this.className+=' '+name;},remove:name=>{this.className=this.className.split(' ').filter(x=>x!==name).join(' ');}}; }
    setAttribute(name,value) {this.attrs[name]=value;}
    append(...nodes) {this.children.push(...nodes);}
    appendChild(node) {this.append(node); return node;}
    replaceChildren() {this.children=[];}
    set innerHTML(html) {this.children=[...html.matchAll(/<span class="([^"]+)"><\/span>/g)].map(([,cls])=>{const node=new Element('span'); node.className=cls; return node;});}
    querySelector(selector) {return this.children.find(node=>selector.startsWith('.variable-row[')
      ? selector.includes(`data-variable-name="${node.dataset.variableName}"`) && selector.includes(`data-variable-scope="${node.dataset.variableScope}"`)
      : node.className.split(' ').includes(selector.slice(1)));}
    addEventListener(name,fn) {this.events[name]=fn;}
  }
  const list=new Element('div'), commands=[], panels=[];
  const ctx=vm.createContext({document:{createElement:tag=>new Element(tag)},variablesView:list,sidebarVariables:variables,
    selectedVariable:'shared',selectedVariableScope:'inputs',overviewInputDisplayName:name=>name,
    variableTypeGlyphs:{},variableTypeFallbackGlyph:{icon:{},className:'type-any'},createTreeIcon:()=>new Element('svg'),
    docking:{showPanel:name=>panels.push(name)},editorCommand:(...args)=>commands.push(args),CSS:{escape:value=>value}});
  const start=source.indexOf('const variableTypeLabels:');
  vm.runInContext(stripTypeScriptTypes(source.slice(start,source.indexOf('\n};',start)+3)),ctx);
  for(const name of ['renderVariables','syncVariableSelection']) {
    const begin=source.indexOf(`function ${name}(`);
    vm.runInContext(stripTypeScriptTypes(source.slice(begin,source.indexOf('\n}\n',begin)+2)),ctx);
  }
  return {ctx,list,commands,panels,rows:()=>list.children.filter(x=>x.tagName==='button')};
}

test('variable groups show counts once and rows keep complete names, types and scroll',()=>{
  const h=harness([{name:'shared',scope:'inputs',type:'integer'},{name:'长名称'.repeat(12),scope:'inputs',type:'array'}, {name:'shared',scope:'variables',type:'custom<type>'}]);
  h.list.scrollTop=96; h.ctx.renderVariables();
  const headings=h.list.children.filter(x=>x.tagName==='h3');
  assert.deepEqual(headings.map(x=>x.children.map(c=>c.textContent)),[['工作流输入','2','只读'],['运行变量','1','可更新']]);
  assert.equal(h.rows()[0].querySelector('.variable-flags').textContent,'整数');
  assert.equal(h.rows()[2].querySelector('.variable-flags').textContent,'custom<type>');
  assert.equal(h.rows()[1].querySelector('.variable-name').textContent,'长名称'.repeat(12));
  assert(h.rows()[1].title.includes('长名称'.repeat(12)));
  assert.equal(h.list.scrollTop,96);
  assert.equal(h.rows()[0].attrs['aria-pressed'],'true'); assert.equal(h.rows()[2].attrs['aria-pressed'],'false');
});

test('variable selection and drag preserve existing scope-aware commands',()=>{
  const h=harness([{name:'shared',scope:'inputs',type:'integer'},{name:'shared',scope:'variables',type:'integer'}]);
  h.ctx.renderVariables();
  h.rows()[1].events.click(); assert.deepEqual(h.panels,['details']);
  assert.equal(h.commands[0][0],'selectVariable'); assert.equal(h.commands[0][1].scope,'variables');
  let payload;
  const transfer={setData(type,value){payload=[type,JSON.parse(value)];}};
  h.rows()[1].events.dragstart({dataTransfer:transfer});
  assert.deepEqual(payload,['application/x-onmyoji-variable',{name:'shared',scope:'variables'}]); assert.equal(transfer.effectAllowed,'copy');
  h.ctx.selectedVariableScope='variables'; h.ctx.syncVariableSelection('shared','inputs');
  assert.equal(h.rows()[0].attrs['aria-pressed'],'false'); assert.equal(h.rows()[1].attrs['aria-pressed'],'true');
  assert.equal(h.rows()[1].className.includes('selected'),true);
});

test('empty variable groups keep their headings and explain the two add controls',()=>{
  const h=harness([]); h.ctx.renderVariables();
  assert.equal(h.list.children.filter(x=>x.tagName==='h3').length,2);
  const empty=h.list.children.filter(x=>x.className==='variable-group-empty');
  assert(empty[0].textContent.includes('＋ 输入')); assert(empty[1].textContent.includes('＋ 变量'));
  const html=fs.readFileSync(path.join(__dirname,'../src/renderer/index.html'),'utf8');
  for(const [id,label] of [['add-input-button','输入'],['add-variable-button','变量']]) {
    assert(new RegExp(`id="${id}"[^>]*>[\\s\\S]*?<span>${label}</span></button>`).test(html));
  }
});
