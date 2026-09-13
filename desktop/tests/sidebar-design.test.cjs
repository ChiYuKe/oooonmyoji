const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const root=path.join(__dirname,'..');
test('palette groups retain each original add command exactly once',()=>{
  const html=fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8');
  const palette=html.slice(html.indexOf('<section id="module-palette"'),html.indexOf('<section id="module-variables"'));
  for(const command of ['addTask','addSequence','addSelector','addParallel','addGenericParallel','addRepeatUntil','addBranch','addSwitch','addInstanceParallel']) assert.equal(palette.split(`data-editor-command="${command}"`).length-1,1);
  assert.equal((palette.match(/palette-group-heading/g)||[]).length,3);
  assert.equal((palette.match(/<small>/g)||[]).length,9);
});
test('compact tree retains metadata, selection, collapse and missing-child handling',()=>{
  class Element {
    constructor(){this.children=[];this.attrs={};this.dataset={};this.events={};this.className='';this.classList={add:name=>{this.className+=' '+name;}};}
    append(...nodes){this.children.push(...nodes);}
    appendChild(node){this.append(node);}
    setAttribute(k,v){this.attrs[k]=v;}
    addEventListener(k,fn){this.events[k]=fn;}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
  }
  const commands=[],toggles=[];
  const ctx=vm.createContext({document:{createElement:()=>new Element(),createDocumentFragment:()=>new Element()},Node:Element,
    sidebarNodes:[{id:'root',name:'工作流',meta:'root',type:'root',children:['task','missing']},{id:'task',name:'等待挑战按钮',meta:'vision.wait_template',type:'task',children:[]}],
    selectedNode:'task',collapsedTreeNodes:new Set(['root']),treeNodeGlyphs:{},treeNodeFallbackGlyph:{className:'type-default',icon:{}},ChevronRight:{},createTreeIcon:()=>new Element(),
    toggleTreeNode:id=>toggles.push(id),docking:{showPanel(){}},editorCommand:(...args)=>commands.push(args)});
  const source=fs.readFileSync(path.join(root,'src/renderer/main.ts'),'utf8'),start=source.indexOf('function createTreeRows(');
  vm.runInContext(stripTypeScriptTypes(source.slice(start,source.indexOf('\n}\n',start)+2)),ctx);
  const fragment=ctx.createTreeRows(), parent=fragment.children[0], children=fragment.children[1], task=children.children[0];
  assert.equal(parent.children[3].textContent,'1');assert.equal(task.children[3].textContent,'');
  assert.equal(parent.attrs['aria-expanded'],'false');assert(children.className.includes('closed'));
  assert(task.className.includes('selected'));assert(task.title.includes('vision.wait_template'));
  task.events.click({target:task});assert.deepEqual(commands,[['focusNode','task']]);
  parent.events.click({target:parent.children[0]});assert.deepEqual(toggles,['root']);
});
