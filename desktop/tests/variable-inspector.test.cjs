const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/legacy/workflow-editor.js'),'utf8');
function harness(definition,scope='inputs') {
  const el=(tag,className='',textContent='')=>({tag,className,textContent,children:[],events:{},
    appendChild(child){this.children.push(child);return child;},addEventListener(name,fn){this.events[name]=fn;}});
  const body=el('div'), removed=[], renames=[], toasts=[], exposed=[];
  const raw={[scope]:{value:definition}};
  const state={selectedVariable:'value',selectedVariableScope:scope,raw};
  const ctx=vm.createContext({el,state,
    clearInspector:()=>body,section:(parent,title)=>parent.appendChild(el('h3','section-header',title)),
    field:(parent,label)=>{const row=el('div','field',label);parent.appendChild(row);return row;},
    textInput:(value,onChange,options={})=>Object.assign(el('input'),{value,onChange,...options}),
    checkbox:(checked,onChange)=>Object.assign(el('input','ui-checkbox'),{checked,onChange}),
    selectInput:(value,options,onChange)=>Object.assign(el('select'),{value,options,onChange}),
    mutate:fn=>fn(),clone:value=>JSON.parse(JSON.stringify(value)),
    variableReferenceCount:()=>0,removeVariable:(...args)=>removed.push(args),
    renameVariable:(...args)=>renames.push(args),toast:(msg,isError)=>toasts.push([msg,!!isError]),
    variableDisplayName:(_scope,id)=>id,
    variableCards:()=>(state.raw._variableCards||(state.raw._variableCards={})),
    changeDefinitionType:(target,type)=>{target.type=type;},
    bindAssetPreview:()=>{},openAssetBrowser:()=>{},
    VariableSystem:{expose:(rawDoc,id)=>{rawDoc.variables[id].initial_from='auto_input';exposed.push(id);return 'auto_input';},
      label:(rawDoc,scope,id)=>rawDoc?.[scope]?.[id]?.display_name||id,
      create:(rawDoc,scope,name,definition,value)=>{const id='v_new';const entry=JSON.parse(JSON.stringify(definition));entry.display_name=name;delete entry.required;delete entry.owner;delete entry.initial_from;if(value!==undefined)entry.default=JSON.parse(JSON.stringify(value));rawDoc[scope]||={};rawDoc[scope][id]=entry;return id;}},
    UI:{button:options=>Object.assign(el('button',options.className,options.label),{onClick:options.onClick})},
    DEFINITION_TYPES:['string','number','integer','boolean','rect','asset','path','array','object','any']});
  for(const name of ['defaultValue','initialDefinitionValue','definitionValueControl','sameDefinitionValue','convertInputToVariable','syncExposedInput','renderVariablesInspector']) {
    const start=source.indexOf(`  function ${name}(`);
    assert.notEqual(start,-1,`缺少函数 ${name}`);
    vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),ctx);
  }
  const all=node=>[node,...node.children.flatMap(all)];
  return {ctx,body,removed,renames,toasts,exposed,raw,
    all:()=>all(body),find:cls=>all(body).find(x=>x.className===cls),
    rows:()=>all(body).filter(x=>x.className==='field'),
    sections:()=>all(body).filter(x=>x.className==='section-header'),
    labels:()=>all(body).filter(x=>x.className==='field').map(x=>x.textContent)};
}
test('asset variable defaults bind image hover preview',()=>{
  const definition={type:'asset',default:'assets/templates/start/icon.png'};
  const h=harness(definition);const previews=[];
  h.ctx.bindAssetPreview=input=>input.addEventListener('mouseenter',()=>previews.push(input.value));
  const shell=h.ctx.definitionValueControl(definition,definition.default,()=>{});
  const input=shell.children[0];
  assert.equal(typeof input.events.mouseenter,'function');input.events.mouseenter();
  assert.deepEqual(previews,['assets/templates/start/icon.png']);
});
test('输入详情分为变量与默认值两栏并可重命名删除',()=>{
  const definition={type:'integer',default:0};
  const h=harness(definition,'inputs');h.ctx.renderVariablesInspector();
  assert.deepEqual(h.sections().map(item=>item.textContent),['变量','默认值']);
  assert.deepEqual(h.labels(),['变量命名','变量类型','描述','分组','公开','默认值']);
  const rows=h.rows();
  assert.equal(rows[0].children[0].value,'value');
  rows[0].children[0].onChange('次数');assert.deepEqual(h.renames,[['inputs','value','次数']]);
  rows[1].children[0].onChange('number');assert.equal(definition.type,'number');
  rows[2].children[0].onChange('说明');assert.equal(definition.description,'说明');
  rows[3].children[0].onChange('战斗设置');assert.equal(definition.group,'战斗设置');
  const publicBox=rows[4].children[0];
  assert.equal(publicBox.checked,true);
  assert.ok(!publicBox.disabled,'输入公开开关可点击');
  const remove=h.body.children.at(-1);assert.equal(remove.className,'variable-delete');remove.onClick();
  assert.deepEqual(h.removed,[['inputs','value']]);
});
test('取消输入的公开会转为运行变量并改写引用',()=>{
  const definition={type:'integer',default:3};
  const h=harness(definition,'inputs');
  h.raw.nodes=[{id:'n1',params:{mode:{ref:'inputs.value'},deep:{ref:'inputs.value.sub'},keep:{ref:'variables.other'}}}];
  h.raw.variables={v:{type:'integer',default:0,initial_from:'value'}};
  h.ctx.renderVariablesInspector();
  const box=h.rows()[4].children[0];
  assert.ok(!box.disabled);
  box.onChange(false);
  assert.equal(h.raw.inputs.value,undefined);
  assert.equal(h.raw.variables.v.initial_from,undefined);
  assert.equal(h.raw.nodes[0].params.mode.ref,'variables.v_new');
  assert.equal(h.raw.nodes[0].params.deep.ref,'variables.v_new.sub');
  assert.equal(h.raw.nodes[0].params.keep.ref,'variables.other');
  assert.equal(h.raw.variables.v_new.display_name,'value');
  assert.equal(h.ctx.state.selectedVariableScope,'variables');
});
test('自动公开输入可以取消公开并解除变量绑定',()=>{
  const definition={type:'integer',default:0,_autoPublished:true};
  const h=harness(definition,'inputs');
  h.raw.variables={v:{type:'integer',default:0,initial_from:'value'}};
  h.ctx.renderVariablesInspector();
  const publicBox=h.rows()[4].children[0];
  assert.equal(publicBox.checked,true);
  assert.ok(!publicBox.disabled,'自动公开输入允许取消');
  publicBox.onChange(false);
  assert.equal(h.raw.inputs.value,undefined);
  assert.equal(h.raw.variables.v.initial_from,undefined);
});
test('运行变量详情包含公开开关并读写 initial_from',()=>{
  const definition={type:'integer',default:1};
  const h=harness(definition,'variables');h.ctx.renderVariablesInspector();
  assert.deepEqual(h.sections().map(item=>item.textContent),['变量','默认值']);
  assert.deepEqual(h.labels(),['变量命名','变量类型','描述','分组','公开','默认值']);
  const box=h.rows()[4].children[0];
  assert.equal(box.checked,false);
  box.onChange(true);assert.deepEqual(h.exposed,['value']);assert.equal(definition.initial_from,'auto_input');
  box.onChange(false);assert.equal(Object.hasOwn(definition,'initial_from'),false);
});
test('运行变量默认值编辑保留 false、数组与对象',()=>{
  for(const [type,value] of [['boolean',false],['array',[0,false]],['object',{a:0}],['rect',[0,0,100,100]]]) {
    const definition={type,default:value};
    const h=harness(definition,'variables');h.ctx.renderVariablesInspector();
    assert.deepEqual(definition.default,value);
    assert.ok(h.find('variable-details'));
  }
});
test('公开变量的自动输入镜像同步名称/类型/说明/默认值',()=>{
  const definition={type:'integer',default:1,initial_from:'auto_input',display_name:'次数'};
  const h=harness(definition,'variables');
  h.raw.inputs={auto_input:{_autoPublished:true,type:'integer',default:1,display_name:'次数 · 初始值'}};
  h.ctx.syncExposedInput(definition,'value');
  assert.equal(h.raw.inputs.auto_input.display_name,'次数 · 初始值');
  definition.type='number';definition.description='次数说明';definition.group='战斗';
  h.ctx.syncExposedInput(definition,'value');
  assert.equal(h.raw.inputs.auto_input.type,'number');
  assert.equal(h.raw.inputs.auto_input.description,'次数说明');
  assert.equal(h.raw.inputs.auto_input.group,'战斗');
  delete definition.initial_from;
  h.ctx.syncExposedInput(definition,'value');
  assert.equal(h.raw.inputs.auto_input.type,'number');
});
