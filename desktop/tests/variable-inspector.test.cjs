const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const { createCanvasReferences }=require('../dist-test-renderer/canvas/model/references.js');
const references=createCanvasReferences({state:{},clone:value=>JSON.parse(JSON.stringify(value)),nodes:()=>[],
  definitionSchema:()=>undefined,compatibleRefType:()=>false,appendNestedRefs:()=>{},
  variableSystem:{visible:()=>true,referenceLabel:ref=>ref},catalogByName:()=>null});
function harness(definition,scope='inputs') {
  const el=(tag,className='',textContent='')=>({tag,className,textContent,children:[],events:{},
    appendChild(child){this.children.push(child);return child;},addEventListener(name,fn){this.events[name]=fn;}});
  // 颜色控件用原生 input[type=color]，模块读的是全局 document。
  globalThis.document=globalThis.document||{createElement:(tag)=>el(tag)};
  const body=el('div'), removed=[], renames=[], toasts=[], exposed=[];
  const raw={[scope]:{value:definition}};
  const state={selectedVariable:'value',selectedVariableScope:scope,raw};
  const ctx=vm.createContext({el,state,
    clearInspector:()=>body,section:(parent,title)=>parent.appendChild(el('h3','section-header',title)),
    field:(parent,label)=>{const row=el('div','field',label);parent.appendChild(row);return row;},
    textInput:(value,onChange,options={})=>Object.assign(el('input'),{value,onChange,...options}),
    checkbox:(checked,onChange)=>Object.assign(el('input','ui-checkbox'),{checked,onChange}),
    selectInput:(value,options,onChange)=>Object.assign(el('select'),{value,options,onChange}),
    mutate:fn=>fn(),clone:value=>JSON.parse(JSON.stringify(value)),defaultValue:references.defaultValue,
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
  const detail=require('../dist-test-renderer/canvas/inspector/variable-inspectors.js').createVariableInspectors({
    state, mutate:fn=>ctx.mutate(fn), UI:ctx.UI, el:ctx.el, clone:ctx.clone, toast:(...a)=>ctx.toast(...a),
    defaultValue:references.defaultValue, allRefs:(...a)=>ctx.allRefs?ctx.allRefs(...a):[], referenceLabel:ref=>ref,
    fieldLabel:name=>name, disconnect:()=>{},
    bindAssetPreview:(...a)=>ctx.bindAssetPreview(...a), openAssetBrowser:(...a)=>ctx.openAssetBrowser(...a),
    variableCards:()=>ctx.variableCards(), variableLinks:()=>({}), clearVariableCardSelection:()=>{},
    renameVariable:(...a)=>ctx.renameVariable(...a), removeVariable:(...a)=>ctx.removeVariable(...a), variableReferenceCount:()=>0,
    VariableSystem:ctx.VariableSystem,
    selectInput:(...a)=>ctx.selectInput(...a), textInput:(...a)=>ctx.textInput(...a), checkbox:(...a)=>ctx.checkbox(...a),
    field:(...a)=>ctx.field(...a), section:(...a)=>ctx.section(...a), clearInspector:(...a)=>ctx.clearInspector(...a),
  });
  for(const name of ['initialDefinitionValue','definitionValueControl','sameDefinitionValue','convertInputToVariable','syncExposedInput','renderVariablesInspector']) ctx[name]=detail[name];
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

test('固定长度数组变量按元素给输入框，不出现 JSON 文本框',()=>{
  const definition={type:'array',items:{type:'duration',min:0},min_items:2,max_items:2,default:[0.2,0.6]};
  const h=harness(definition,'variables');h.ctx.renderVariablesInspector();
  assert.equal(h.all().some(node=>node.tag==='textarea'),false,'默认值不应退化成 JSON 文本框');
  const control=h.rows().at(-1).children[0];
  assert.equal(control.className,'variable-array-value');
  assert.equal(control.children.length,2,'固定长度数组正好两个元素输入框');
  assert.ok(control.children.every(row=>row.children.length===1),'固定长度不提供增删按钮');
  assert.deepEqual(control.children.map(row=>String(row.children[0].children[0].value)),['0.2','0.6']);
  assert.equal(control.children[0].children[0].children[1].textContent,'秒','元素控件用 duration（带秒单位）');
  // 连续改两个元素时互不覆盖。
  control.children[0].children[0].children[0].onChange('1.5');
  control.children[1].children[0].children[0].onChange('2.5');
  assert.deepEqual(definition.default,[1.5,2.5]);
});

test('不定长数组与未声明元素类型的数组也走元素输入框',()=>{
  const definition={type:'array',items:{type:'integer'},default:[1,2]};
  const h=harness(definition,'variables');h.ctx.renderVariablesInspector();
  const control=h.rows().at(-1).children[0];
  assert.equal(control.children.length,3,'两行元素 + 添加按钮');
  assert.equal(control.children.at(-1).textContent,'添加元素');
  // 整数元素控件就是裸输入框（duration 等带壳控件在另一个用例里覆盖）。
  control.children[0].children[0].onChange('9');
  assert.deepEqual(definition.default,[9,2],'改元素不覆盖其它元素');
  control.children[1].children[0].onChange('5');
  assert.deepEqual(definition.default,[9,5]);
  control.children.at(-1).onClick();
  assert.deepEqual(definition.default,[9,5,0]);
  control.children[0].children[1].onClick();
  assert.deepEqual(definition.default,[5,0]);
  // 没写 items：按默认值推断成数值输入，而不是 JSON。
  const inferred={type:'array',default:[1,2]};
  const h2=harness(inferred,'variables');h2.ctx.renderVariablesInspector();
  assert.equal(h2.all().some(node=>node.tag==='textarea'),false);
  const inferredControl=h2.rows().at(-1).children[0];
  assert.equal(inferredControl.children.length,3);
  inferredControl.children[0].children[0].onChange('7');
  assert.deepEqual(inferred.default,[7,2]);
});

test('无字段声明的对象变量按字段行编辑，可增删改名且不出现 JSON',()=>{
  const definition={type:'object',default:{x:1,y:2}};
  const h=harness(definition,'variables');h.ctx.renderVariablesInspector();
  assert.equal(h.all().some(node=>node.tag==='textarea'),false,'对象默认值不应退化成 JSON 文本框');
  const control=h.rows().at(-1).children[0];
  assert.equal(control.className,'variable-map-value');
  assert.equal(control.children.length,3,'两个字段行 + 添加字段');
  const first=control.children[0];
  assert.equal(first.children[0].value,'x');
  assert.equal(first.children[0].className,'');
  first.children[1].onChange('7');
  assert.deepEqual(definition.default,{x:7,y:2});
  control.children[1].children[1].onChange('8');
  assert.deepEqual(definition.default,{x:7,y:8},'连续编辑不同字段互不覆盖');
  first.children[0].onChange('left');
  assert.deepEqual(definition.default,{left:7,y:8});
  // 重名会被拒绝并提示。
  first.children[0].onChange('left');
  first.children[0].onChange('y');
  assert.deepEqual(definition.default,{left:7,y:8});
  assert.deepEqual(h.toasts.at(-1),['字段「y」已存在',true]);
  control.children.at(-1).onClick();
  assert.deepEqual(Object.keys(definition.default),['left','y','字段 3']);
  control.children[1].children[2].onClick();
  assert.deepEqual(definition.default,{left:7,'字段 3':''});
  // 声明了 properties 的对象按固定字段渲染，字段名不可改。
  const declared={type:'object',properties:{a:{type:'integer'},b:{type:'string'}},default:{a:1,b:'x'}};
  const h2=harness(declared,'variables');h2.ctx.renderVariablesInspector();
  assert.equal(h2.all().some(node=>node.tag==='textarea'),false);
  // 结构体的子字段也是 field 行，这里按标签定位「默认值」那一行。
  const struct=h2.rows().find(row=>row.textContent==='默认值').children[0];
  assert.equal(struct.className,'variable-struct-value');
  assert.equal(struct.children.length,2);
  assert.deepEqual(struct.children.map(row=>row.textContent),['a','b']);
  struct.children[0].children[0].onChange('5');
  struct.children[1].children[0].onChange('y');
  assert.deepEqual(declared.default,{a:5,b:'y'});
});
test('公开变量的自动输入镜像同步名称/类型/说明/默认值',()=>{
  const definition={type:'integer',default:1,initial_from:'auto_input',display_name:'次数'};
  const h=harness(definition,'variables');
  h.raw.inputs={auto_input:{_autoPublished:true,type:'integer',default:1,display_name:'次数 · 初始值'}};
  h.ctx.syncExposedInput(definition,'value');
  assert.equal(h.raw.inputs.auto_input.display_name,'次数');
  definition.type='number';definition.description='次数说明';definition.group='战斗';
  h.ctx.syncExposedInput(definition,'value');
  assert.equal(h.raw.inputs.auto_input.type,'number');
  assert.equal(h.raw.inputs.auto_input.description,'次数说明');
  assert.equal(h.raw.inputs.auto_input.group,'战斗');
  delete definition.initial_from;
  h.ctx.syncExposedInput(definition,'value');
  assert.equal(h.raw.inputs.auto_input.type,'number');
});

test('变量类型下拉覆盖全部 15 种类型并显示中文标签',()=>{
  const definition={type:'integer',default:0};
  const h=harness(definition,'variables');
  h.ctx.renderVariablesInspector();
  const select=h.rows()[1].children[0];
  assert.equal(select.options.length,15);
  assert.deepEqual(select.options.map((option)=>option.value),
    ['string','number','integer','boolean','rect','asset','path','array','object','any','point','enum','key','color','duration']);
  assert.equal(select.options.find((option)=>option.value==='point').label,'坐标点');
  assert.equal(select.options.find((option)=>option.value==='enum').label,'枚举');
  assert.equal(select.options.find((option)=>option.value==='key').label,'按键');
  assert.equal(select.options.find((option)=>option.value==='color').label,'颜色');
  assert.equal(select.options.find((option)=>option.value==='duration').label,'时长');
  // 切到 enum 自动补一个选项，避免出现「枚举但没有选项」的非法定义。
  select.onChange('enum');
  assert.equal(definition.type,'enum');
  assert.deepEqual(definition.enum,['选项 1']);
  // 时长属于数值家族：min/max 保留；布尔等类型则清掉。
  definition.min=0;definition.max=5;
  select.onChange('duration');
  assert.equal(definition.type,'duration');
  assert.equal(definition.min,0);
  assert.equal(definition.max,5);
  select.onChange('boolean');
  assert.equal(definition.min,undefined);
  assert.equal(definition.max,undefined);
  // 按键属于字符串家族：长度约束保留；颜色不属于，会被清掉。
  definition.min_length=1;
  select.onChange('key');
  assert.equal(definition.min_length,1);
  select.onChange('color');
  assert.equal(definition.min_length,undefined);
  // 切类型时非法默认值会被丢弃（整数默认值不能当颜色）。
  assert.equal('default' in definition,false);
});

test('新类型的默认值控件：坐标点/颜色/按键/时长/枚举',()=>{
  const assigned=[];
  const set=(value)=>assigned.push(value);
  const h=harness({type:'integer',default:0},'variables');

  const point=h.ctx.definitionValueControl({type:'point'},{x:1,y:2},set);
  assert.equal(point.className,'definition-point-control');
  assert.equal(point.children.length,2);
  point.children[0].onChange('960');
  assert.deepEqual(assigned.at(-1),{x:960,y:2});
  // 改 Y 时以当前输入里的 X 为准（不回退到初始值）。
  point.children[0].value='960';
  point.children[1].onChange('540.6');
  assert.deepEqual(assigned.at(-1),{x:960,y:541});

  const color=h.ctx.definitionValueControl({type:'color'},'#ff8c3a',set);
  const colorText=color.children[0];
  const picker=color.children[1];
  assert.equal(colorText.value,'#ff8c3a');
  assert.equal(picker.type,'color');
  assert.equal(picker.value,'#ff8c3a');
  picker.value='#123456';
  picker.events.input();
  assert.equal(colorText.value,'#123456');
  assert.equal(assigned.at(-1),'#123456');

  const key=h.ctx.definitionValueControl({type:'key'},'BACK',set);
  const keyText=key.children[0];
  const keyPicker=key.children[1];
  assert.equal(keyText.value,'BACK');
  assert.equal(keyPicker.value,'BACK');
  assert.ok(keyPicker.children.length>=13, '常用按键候选 + 占位项');
  keyPicker.value='DPAD_UP';
  keyPicker.events.change();
  assert.equal(keyText.value,'DPAD_UP');
  assert.equal(assigned.at(-1),'DPAD_UP');
  // 清单外的令牌不会把选择器带偏。
  const custom=h.ctx.definitionValueControl({type:'key'},'KEYCODE_99',set);
  assert.equal(custom.children[1].value,'');

  const duration=h.ctx.definitionValueControl({type:'duration',min:0,max:5},1.5,set);
  assert.equal(duration.children[0].type,'number');
  assert.equal(duration.children[0].value,1.5);
  assert.equal(duration.children[0].min,0);
  assert.equal(duration.children[0].max,5);
  assert.equal(duration.children[1].textContent,'秒');
  duration.children[0].onChange('2.5');
  assert.equal(assigned.at(-1),2.5);

  const mode=h.ctx.definitionValueControl({type:'enum',enum:['安全','快速']},'安全',set);
  assert.deepEqual(mode.options.map((option)=>option.label),['安全','快速']);
});

test('枚举变量在详情栏编辑选项并保持默认值合法',()=>{
  const definition={type:'enum',enum:['安全','快速'],default:'安全'};
  const h=harness(definition,'variables');
  h.ctx.renderVariablesInspector();
  assert.deepEqual(h.sections().map((item)=>item.textContent),['变量','默认值','枚举选项']);
  const list=h.rows().at(-1).children[0];
  assert.equal(h.rows().at(-1).textContent,'选项');
  assert.equal(list.className,'definition-enum-options');
  assert.equal(list.children.length,3, '两个选项行 + 添加按钮');
  // 改名会同步默认值，避免默认值指向不存在的选项。
  list.children[0].children[0].onChange('稳妥');
  assert.deepEqual(definition.enum,['稳妥','快速']);
  assert.equal(definition.default,'稳妥');
  // 删除非默认选项不影响默认值。
  list.children[1].children[1].onClick();
  assert.deepEqual(definition.enum,['稳妥']);
  assert.equal(definition.default,'稳妥');
  // 添加选项排在末尾。
  list.children.at(-1).onClick();
  assert.deepEqual(definition.enum,['稳妥','选项 2']);
  // 删除行内剩下的选项后，默认值跟着落到第一个有效选项。
  list.children[0].children[1].onClick();
  assert.deepEqual(definition.enum,['选项 2']);
  assert.equal(definition.default,'选项 2');
  // 删掉最后一个选项时补回一个，避免空枚举定义。
  const single=harness({type:'enum',enum:['唯一'],default:'唯一'},'variables');
  single.ctx.renderVariablesInspector();
  single.rows().at(-1).children[0].children[0].children[1].onClick();
  assert.deepEqual(single.raw.variables.value.enum,['选项 1']);
  assert.equal(single.raw.variables.value.default,'选项 1');
});
