const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/legacy/workflow-editor.js'),'utf8');
function harness(definition,scope='inputs') {
  const el=(tag,className='',textContent='')=>({tag,className,textContent,children:[],events:{},
    appendChild(child){this.children.push(child);return child;},addEventListener(name,fn){this.events[name]=fn;}});
  const body=el('div'), removed=[];
  const ctx=vm.createContext({el,state:{selectedVariable:'value',selectedVariableScope:scope,raw:{[scope]:{value:definition}}},
    clearInspector:()=>body,section:(parent,title)=>parent.appendChild(el('h3','section-header',title)),
    field:(parent,label)=>{const row=el('div','field',label);parent.appendChild(row);return row;},
    textInput:(value,onChange,options={})=>Object.assign(el('input'),{value,onChange,...options}),
    checkbox:(checked,onChange)=>Object.assign(el('input','ui-checkbox'),{checked,onChange}),
    selectInput:(value,options,onChange)=>Object.assign(el('select'),{value,options,onChange}),
    mutate:fn=>fn(),clone:value=>JSON.parse(JSON.stringify(value)),variableReferenceCount:()=>2,
    removeVariable:(...args)=>removed.push(args),renameVariable(){},toast(){},
    UI:{button:options=>Object.assign(el('button',options.className,options.label),{onClick:options.onClick})},
    DEFINITION_TYPES:['string','number','integer','boolean','rect','asset','path','array','object','any']});
  for(const name of ['defaultValue','initialDefinitionValue','definitionValueControl','sameDefinitionValue','optionalDefinitionNumber','nextEnumValue','renderDefinitionEnum','renderDefinitionShape','renderDefinitionOptions','renderVariablesInspector']) {
    const start=source.indexOf(`  function ${name}(`);
    vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),ctx);
  }
  const all=node=>[node,...node.children.flatMap(all)];
  return {ctx,body,removed,all:()=>all(body),find:cls=>all(body).find(x=>x.className===cls)};
}
test('input inspector groups required and references, uses full-width default and bottom delete',()=>{
  const definition={type:'integer',default:0,required:true,min:0,max:100};
  const h=harness(definition);h.ctx.renderVariablesInspector();
  const meta=h.find('variable-detail-meta'); assert.equal(meta.children.length,2);
  assert.equal(meta.children[1].textContent,'2 处节点引用');
  assert.equal(h.find('definition-default').children.length,1);
  assert.equal(h.find('definition-default').children[0].value,0);
  const heading=h.find('variable-option-heading');assert.equal(heading.children[1].children[0].checked,true);
  meta.children[0].children[0].onChange(false);assert.equal(Object.hasOwn(definition,'required'),false);
  const shape=h.find('definition-shape');assert.deepEqual(shape.children.map(x=>x.textContent),['最小值','最大值']);
  shape.children[0].children[0].onChange('');assert.equal(Object.hasOwn(definition,'min'),false);
  shape.children[0].children[0].onChange('0');assert.equal(definition.min,0);
  const remove=h.body.children.at(-1);assert.equal(remove.className,'variable-delete');remove.onClick();
  assert.deepEqual(h.removed,[['inputs','value']]);
});
test('runtime initial values have no enable toggle and preserve false, arrays and objects',()=>{
  for(const [type,value] of [['boolean',false],['array',[0,false]],['object',{a:0}],['rect',[0,0,100,100]]]) {
    const definition={type,default:value};const h=harness(definition,'variables');h.ctx.renderVariablesInspector();
    const heading=h.find('variable-option-heading');assert.equal(heading.children[0].textContent,'初始值');assert.equal(heading.children.length,1);
    assert.equal(h.find('variable-detail-meta').children.length,1);
    assert.deepEqual(definition.default,value);
    assert.equal(h.find('definition-default').children.length,1);
  }
});
test('unset defaults show required guidance and enable editing without altering enum actions',()=>{
  const definition={type:'integer',required:true,enum:[0,2]};const h=harness(definition);h.ctx.renderVariablesInspector();
  assert(h.find('definition-default').children[0].textContent.includes('必须传入'));
  h.find('variable-option-heading').children[1].children[0].onChange(true);assert.equal(definition.default,0);
  const enumRow=h.find('definition-enum-row');enumRow.children[1].events.click();
  assert.deepEqual(definition.enum,[2]);assert.equal(definition.default,2);
  h.find('small-command').events.click();assert.deepEqual(definition.enum,[2,0]);
});
