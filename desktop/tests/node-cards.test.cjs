const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../public/legacy');
const NodeCards=require('../dist-test-renderer/canvas/render/node-cards.js');
const {createWorkflowModel}=require('../dist-test-renderer/canvas/model/workflow-model.js');
const CardValues=require('../dist-test-renderer/canvas/render/card-values.js');
const {createCanvasHitTest}=require('../dist-test-renderer/canvas/interactions/hit-test.js');
const {createCanvasCards}=require('../dist-test-renderer/canvas/render/cards.js');
const {createNodeCardRenderer}=require('../dist-test-renderer/canvas/render/node-card.js');
const {createCanvasConnections}=require('../dist-test-renderer/canvas/interactions/connections.js');
function harness() {
  class Element {
    constructor(tag){this.tag=tag;this.attrs={};this.children=[];this.dataset={};this.events={};this.style={};}
    setAttribute(k,v){this.attrs[k]=String(v);}
    appendChild(node){this.children.push(node);return node;}
    addEventListener(k,fn){(this.events[k] ||= []).push(fn);}
    querySelectorAll(tag){return this.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...c.querySelectorAll(tag)]);}
  }
  const svgEl=(tag,attrs,parent)=>{const node=new Element(tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);parent?.appendChild(node);return node;};
  globalThis.document={createElementNS:(_,tag)=>new Element(tag)};
  const ctx=vm.createContext({window:{},document:globalThis.document,svgEl,console});
  ctx.NodeCards=NodeCards;
  const source=fs.readFileSync(path.join(__dirname,'../dist-test-renderer/canvas/editor.js'),'utf8');
  // Use the real geometry constants and height formula, not a copy of the layout.
  for(const name of ['NODE_W','BASE_H','DECO_H','PORT_R','RUN_CARD_W','RUN_CARD_BASE_H','RUN_VARIABLE_H','VARIABLE_CARD_W','VARIABLE_CARD_H','VARIABLE_CARD_PORT_Y','VARIABLE_PIN_X']) {
    vm.runInContext(source.match(new RegExp(`const ${name} = [^;]+;`))[0],ctx);
  }
  ctx.nodeVariablePins=node=>node.pins || [];
  ctx.nodes=()=>Array.isArray(ctx.state?.raw?.nodes) ? ctx.state.raw.nodes : [];
  ctx.instanceRunCards=()=>[];
  const CanvasWorkflowModel=require('../dist-test-renderer/canvas/model/canvas-workflow-model.js').createCanvasWorkflowModel({
    state:{},Model:{},VariableSystem:{},nodes:()=>ctx.nodes(),position:()=>({x:0,y:0}),variableCards:()=>({}),
    compatibleRefType:()=>true,definitionSchema:value=>value,nodeHeight:()=>0,baseHeight:96,nodeWidth:260,decoHeight:22,
    variableCardWidth:168,variableCardHeight:58,variableCardPortY:29,variablePinX:10,runCardWidth:250,runCardBaseHeight:78,
    runVariableHeight:24,runCardGapX:48,runCardGapY:92,catalogByName:()=>null,fieldLabel:name=>name,workflowNodeInputs:()=>[],
    nextVariableCardId:()=>'',workflowReference:()=>'',nodeVariablePins:(node)=>ctx.nodeVariablePins(node),
  });
  ctx.collectNodeCardVariableRefs=CanvasWorkflowModel.collectNodeCardVariableRefs;
  ctx.instanceRunInputPosition=CanvasWorkflowModel.instanceRunInputPosition;
  // vm 顶层的 const 不会挂到上下文对象上；用表达式赋值保留同一公式（常量取自源码切片）。
  ctx.nodeHeight=vm.runInContext('(node) => BASE_H + nodeVariablePins(node).length * RUN_VARIABLE_H + (Array.isArray(node.decorators) ? node.decorators.length * DECO_H : 0)',ctx);
  Object.assign(ctx,{state:{run:new Map(),selected:new Set(),raw:{inputs:{count:{type:'integer',default:0}}}},position:()=>({x:0,y:0}),subWorkflowRef:()=>null,templatePreview:()=>null,assetPreviewForPath:()=>null,bindAssetPathPreview:()=>{},definitionSchema:value=>value,compatibleRefType:()=>true,
    TYPE_NAMES:{task:'任务',sequence:'顺序',root:'根节点'},TYPE_ICON:{task:'□',sequence:'→'},RUN_LABEL:{succeeded:'已完成'},compositeSubtitle:()=> '执行子节点',decoratorLabel:()=> 'Retry · 3 次'});
  const model=createWorkflowModel(ctx.state);
  ctx.displayNameOfDefinition=model.displayNameOfDefinition;
  ctx.variableDisplayNameOf=model.variableDisplayNameOf;
  ctx.parentVariableRefs=require('../dist-test-renderer/canvas/inspector/detail-inspectors.js')
    .createDetailInspectors({state:ctx.state,definitionSchema:ctx.definitionSchema,compatibleRefType:ctx.compatibleRefType}).parentVariableRefs;
  const hitTest=createCanvasHitTest({
    state:ctx.state,
    worldPoint:(event)=>({x:event.clientX,y:event.clientY}),
    nodes:()=>ctx.nodes(),
    nodeById:(id)=>ctx.nodes().find((node)=>node.id===id)||null,
    position:(node)=>ctx.position(node),
    nodeHeight:(node)=>ctx.nodeHeight(node),
    nodeVariablePins:(node)=>ctx.nodeVariablePins(node),
    variableCompatibleWithPin:(scope,name,node,param)=>ctx.variableCompatibleWithPin?ctx.variableCompatibleWithPin(scope,name,node,param):false,
    variableCompatibleWithInstanceInput:(scope,name,card,input)=>ctx.variableCompatibleWithInstanceInput?ctx.variableCompatibleWithInstanceInput(scope,name,card,input):false,
    instanceRunCards:()=>ctx.instanceRunCards(),
    instanceRunInputPosition:(card,index)=>ctx.instanceRunInputPosition(card,index),
    variableCardList:()=>[],
    portRadius:7,nodeWidth:260,baseHeight:96,runVariableHeight:24,variablePinX:10,
    runCardWidth:250,runCardBaseHeight:78,variableCardWidth:168,variableCardHeight:58,variableCardPortY:29,
  });
  ctx.instanceRunInputTargetAt=hitTest.instanceRunInputTargetAt;
  const cards=createCanvasCards({
    state:ctx.state,
    svgEl:(tag,attrs,parent)=>ctx.svgEl(tag,attrs,parent),
    nodeCards:ctx.NodeCards,
    displayNameOfDefinition:(definition,fallback)=>ctx.displayNameOfDefinition(definition,fallback),
    assetPreviewForPath:(value)=>ctx.assetPreviewForPath(value),
    bindAssetPathPreview:(target,getValue)=>ctx.bindAssetPathPreview(target,getValue),
    disconnectVariableFromInstanceInput:(...args)=>ctx.disconnectVariableFromInstanceInput(...args),
    startVariableConnectionFromInstanceInput:(...args)=>ctx.startVariableConnectionFromInstanceInput(...args),
    startVariableConnectionFromCard:(...args)=>ctx.startVariableConnectionFromCard?.(...args),
    openPortContextMenu:()=>null,
    showMenu:()=>{},
    instanceRunPinMenuItems:()=>[],
    variableCardPortMenuItems:()=>[],
    requestInspector:()=>{},
    requestOpenWorkflowReference:()=>{},
    render:()=>{},
    contextMenuSuppressedByPan:()=>false,
    removeInstanceRun:()=>{},
    removeVariableCard:(...args)=>ctx.removeVariableCard?.(...args),
    setVariableCardSelection:(ids)=>ctx.setVariableCardSelection?.(ids),
    worldPoint:(event)=>({x:event.clientX,y:event.clientY}),
    snapshot:()=>JSON.stringify(ctx.state.raw),
    runCardWidth:250,runCardBaseHeight:78,runVariableHeight:24,portRadius:7,
    variableCardWidth:168,variableCardHeight:58,variableCardPortY:29,
  });
  ctx.renderInstanceRunCard=cards.renderInstanceRunCard;
  ctx.renderVariableCard=cards.renderVariableCard;
  ctx.registerCardPress=cards.registerCardPress;
  const nodeCard=createNodeCardRenderer({
    state:ctx.state,
    svgEl:(tag,attrs,parent)=>ctx.svgEl(tag,attrs,parent),
    nodeCards:ctx.NodeCards,
    position:(node)=>ctx.position(node),
    nodeHeight:(node)=>ctx.nodeHeight(node),
    subWorkflowRef:(node)=>ctx.subWorkflowRef(node),
    templatePreview:(node)=>ctx.templatePreview(node),
    compositeSubtitle:(node)=>ctx.compositeSubtitle(node),
    variableDisplayNameOf:(scope,name,fallback)=>ctx.variableDisplayNameOf(scope,name,fallback),
    decoratorLabel:(decorator)=>ctx.decoratorLabel(decorator),
    nodeVariablePins:(node)=>ctx.nodeVariablePins(node),
    openLightbox:()=>{},
    disconnectVariableFromPin:(...args)=>ctx.disconnectVariableFromPin(...args),
    startVariableConnectionFromPin:(...args)=>ctx.startVariableConnectionFromPin?.(...args),
    openPortContextMenu:()=>null,
    showMenu:()=>{},
    nodeVariablePinMenuItems:()=>[],
    nodeInputPortMenuItems:()=>[],
    nodeOutputPortMenuItems:()=>[],
    startConnectionFromInput:()=>{},
    startConnection:()=>{},
    startNodeDrag:()=>{},
    registerCardPress:cards.registerCardPress,
    requestInspector:()=>{},
    requestOpenSubWorkflow:()=>{},
    render:()=>{},
    contextMenuSuppressedByPan:()=>false,
    copySelection:()=>{},
    cutSelection:()=>{},
    deleteSelection:()=>{},
    typeIcons:ctx.TYPE_ICON,
    typeNames:ctx.TYPE_NAMES,
    runLabels:ctx.RUN_LABEL,
    nodeWidth:260,
    baseHeight:96,
    portRadius:7,
    decoratorHeight:22,
    runVariableHeight:24,
    variablePinX:10,
    preview:{x:174,y:56,width:72,height:30},
  });
  ctx.renderNode=nodeCard.renderNode;
  const connections=createCanvasConnections({
    state:ctx.state,
    graph:{setPointerCapture(){},releasePointerCapture(){}},
    worldPoint:(event)=>({x:event.clientX,y:event.clientY}),
    render:()=>{},
    snapshot:()=>JSON.stringify(ctx.state.raw),
    mutate:(fn)=>ctx.mutate?ctx.mutate(fn):fn(),
    connect:()=>true,
    disconnect:()=>{},
    variableConnectionTargetAt:()=>null,
    nodeById:(id)=>ctx.nodeById(id),
    instanceRunCards:()=>ctx.instanceRunCards(),
    variableCompatibleWithPin:(scope,name,node,param)=>ctx.variableCompatibleWithPin?ctx.variableCompatibleWithPin(scope,name,node,param):true,
    variableCompatibleWithInstanceInput:(scope,name,card,input)=>ctx.variableCompatibleWithInstanceInput?ctx.variableCompatibleWithInstanceInput(scope,name,card,input):true,
    variableLinks:()=>ctx.variableLinks(),
    displayNameOfDefinition:(definition,fallback)=>ctx.displayNameOfDefinition(definition,fallback),
    variableDisplayNameOf:(scope,name,fallback)=>ctx.variableDisplayNameOf(scope,name,fallback),
    toast:(...args)=>ctx.toast?.(...args),
  });
  ctx.connectVariableToInstanceInput=connections.connectVariableToInstanceInput;
  ctx.disconnectVariableFromPin=connections.disconnectVariableFromPin;
  ctx.disconnectVariableFromInstanceInput=connections.disconnectVariableFromInstanceInput;
  ctx.nodeCardSummary=CardValues.nodeCardSummary;
  ctx.compactValue=CardValues.compactValue;
  ctx.workflowInputVariableValue=CardValues.workflowInputVariableValue;
  ctx.variableValueSummary=CardValues.variableValueSummary;
  return {ctx,Element,svgEl,NodeCards};
}
const byClass=(element,name)=>element.children.filter(c=>(c.attrs.class || '').split(' ').includes(name));
test('card text width budgets preserve CJK, emoji, zero and complete hover text',()=>{
  const {Element}=harness();const UI=NodeCards;
  for(const text of ['等待挑战按钮与战斗结束页面', 'long_workflow_reference.json', '变量😀输入',0,false]) {
    const fitted=UI.fit(text,90,11);assert(UI.widthOf(fitted,11)<=90);
    const parent=new Element('g');const node=UI.text(parent,{className:'value',x:0,y:16,value:text,width:90});
    assert.equal(node.children[0].textContent,String(text));
  }
  assert.equal(UI.fit(0,100),'0');assert.equal(UI.fit(false,100),'false');
});
test('running cards do not steal title space and retain node/variable port geometry',()=>{
  const {ctx,Element}=harness();const node={id:'n',name:'点击战斗结束后的继续按钮',type:'sequence',pins:[{type:'integer',variable:'很长的运行轮数变量名称',label:'超时秒数',param:'timeout'}],decorators:[{type:'retry'}]};
  const render=()=>{const layer=new Element('g');ctx.renderNode(layer,node);return layer.children[0];};
  const normal=render();ctx.state.run.set('n',{status:'succeeded',duration:430});const running=render();
  assert.equal(byClass(normal,'card-title')[0].textContent,byClass(running,'card-title')[0].textContent);
  const body=byClass(running,'card-body')[0];assert.equal(body.attrs.width,'260');assert.equal(body.attrs.height,'142');
  assert.equal(byClass(running,'port-in')[0].attrs.cy,'0');assert.equal(byClass(running,'port-out')[0].attrs.cy,'142');
  assert.equal(byClass(running,'port-out')[0].attrs.cx,'130');
  assert.equal(byClass(running,'port-variable')[0].attrs.cy,'108');
  assert.equal(byClass(running,'port-in')[0].events.pointerdown.length,1);
  assert.equal(byClass(running,'card-title')[0].events.mousedown.length,1);
  assert.equal(byClass(running,'run-label')[0].attrs.y,'47');
  assert.equal(byClass(running,'node-field-label').length,0);
});
test('instance and variable cards retain dimensions, pins and unclipped value sources',()=>{
  const {ctx,Element}=harness();const layer=new Element('g');
  const full='a_very_long_input_variable_name_that_should_be_available_on_hover';
  const variable={name:'v_internal_run_count',definition:{type:'integer',default:0,display_name:'运行轮数 · 初始值',_autoPublished:true}};
  ctx.renderInstanceRunCard(layer,{node:{id:'multi'},key:'multi:0',index:0,x:0,y:0,height:102,run:{instance:'mumu-1',workflow:'sample.json',inputs:{v_internal_run_count:full}},variables:[variable]});
  const card=layer.children[0];assert.equal(byClass(card,'card-body')[0].attrs.width,'250');
  assert.equal(byClass(card,'instance-variable-pin')[0].attrs.cy,'90');
  assert.equal(byClass(card,'instance-variable-name')[0].children[0].textContent,'运行轮数');
  assert.equal(byClass(card,'instance-variable-value')[0].children[0].textContent,full);
  ctx.renderVariableCard(layer,{name:'count',scope:'inputs',id:'count',x:0,y:0});const source=layer.children[1];
  assert.equal(byClass(source,'card-body')[0].attrs.width,'168');assert.equal(byClass(source,'card-body')[0].attrs.height,'58');
  assert.equal(byClass(source,'port-variable-out')[0].attrs.cy,'29');
  assert.equal(byClass(source,'variable-card-value')[0].textContent,'0');
});
test('新类型变量卡片：类型名用中文标签，颜色卡片带色块',()=>{
  const {ctx,Element}=harness();
  ctx.state.raw.variables={
    tint:{type:'color',default:'#ff8c3a'},target:{type:'point',default:{x:960,y:540}},
    settle:{type:'duration',default:1.5},mode:{type:'enum',enum:['安全','快速'],default:'安全'},confirm_key:{type:'key',default:'BACK'},
  };
  const layer=new Element('g');
  const render=(name)=>{const target=new Element('g');ctx.renderVariableCard(target,{name,scope:'variables',id:name,x:0,y:0});return target.children[0];};
  const tint=render('tint');
  assert.equal(byClass(tint,'variable-card-access')[0].textContent,'颜色 · 状态');
  assert.equal(byClass(tint,'variable-card-dot')[0].attrs.class,'variable-card-dot type-color');
  assert.equal(byClass(tint,'variable-card-swatch')[0].attrs.fill,'#ff8c3a');
  assert.equal(byClass(tint,'variable-card-swatch')[0].attrs.x,'102');
  assert.equal(byClass(tint,'variable-card-value')[0].textContent,'#ff8c3a');
  // 坐标点与时长用可读写法，不把 JSON 截断在卡片里。
  assert.equal(byClass(render('target'),'variable-card-value')[0].textContent,'960,540');
  assert.equal(byClass(render('settle'),'variable-card-value')[0].textContent,'1.5s');
  assert.equal(byClass(render('mode'),'variable-card-value')[0].textContent,'安全');
  assert.equal(byClass(render('confirm_key'),'variable-card-value')[0].textContent,'BACK');
  for(const [name,label,type] of [['target','坐标点','point'],['settle','时长','duration'],['mode','枚举','enum'],['confirm_key','按键','key']]){
    const card=render(name);
    assert.equal(byClass(card,'variable-card-access')[0].textContent,`${label} · 状态`);
    assert.ok(byClass(card,'port-variable-out')[0].attrs.class.includes(`type-${type}`),type);
    assert.equal(byClass(card,'variable-card-swatch').length,0);
  }
  // 颜色默认值非法时不画色块（例如手工编辑过的旧文档）。
  ctx.state.raw.variables.tint.default='红色';
  assert.equal(byClass(render('tint'),'variable-card-swatch').length,0);
});
test('删除变量卡片后不会因为保留变量详情而选中同名卡片',()=>{
  const {ctx,Element}=harness();
  ctx.state.inspector='variables';ctx.state.selectedVariable='count';ctx.state.selectedVariableScope='inputs';
  const layer=new Element('g');
  ctx.state.selectedVariableCardId='count-1';ctx.renderVariableCard(layer,{name:'count',scope:'inputs',id:'count-2',x:0,y:0});
  assert.equal((layer.children[0].attrs.class||'').includes('selected'),false);
  const selectedLayer=new Element('g');
  ctx.renderVariableCard(selectedLayer,{name:'count',scope:'inputs',id:'count-1',x:0,y:0});
  assert.equal((selectedLayer.children[0].attrs.class||'').includes('selected'),true);
  const clearedLayer=new Element('g');ctx.state.selectedVariableCardId='';
  ctx.renderVariableCard(clearedLayer,{name:'count',scope:'inputs',id:'count-1',x:0,y:0});
  assert.equal((clearedLayer.children[0].attrs.class||'').includes('selected'),false);
});
test('资源变量卡片的路径值支持图片悬浮预览',()=>{
  const {ctx,Element}=harness();
  const previews=[];
  ctx.state.assetsBaseUri='assets-base/';
  ctx.state.raw.inputs.icon_template={type:'asset',default:'assets/templates/start/icon.png'};
  ctx.assetPreviewForPath=value=>value?{uri:'assets-base/templates/start/icon.png',path:value}:null;
  ctx.bindAssetPathPreview=(target,getValue)=>target.addEventListener('mouseenter',()=>previews.push(getValue()));
  const layer=new Element('g');
  ctx.renderVariableCard(layer,{name:'icon_template',scope:'inputs',id:'icon',x:0,y:0});
  const valueNode=byClass(layer.children[0],'variable-card-value')[0];
  assert.equal(valueNode.events.mouseenter.length,1);
  valueNode.events.mouseenter[0]();
  assert.deepEqual(previews,['assets/templates/start/icon.png']);
});
test('节点卡片上的变量引用被收集起来用于变量列表标记',()=>{
  const {ctx}=harness();
  ctx.state.raw.nodes=[
    {type:'task',pins:[{scope:'inputs',variable:'target'},{scope:'variables',variable:'retry.attempts'},{scope:'inputs',variable:''}]},
    {type:'task',pins:[{scope:'inputs',variable:'target'}]},
    {type:'sequence',pins:[]},
  ];
  assert.deepEqual([...ctx.collectNodeCardVariableRefs()].sort(),['inputs.target','variables.retry']);
});
test('变量卡片可以连接实例子工作流输入',()=>{
  const {ctx}=harness();
  const run={inputs:{}};
  const node={id:'parallel',runs:[run]};
  const card={node,index:0,x:100,y:200,run,variables:[{name:'input_id',definition:{type:'number',display_name:'计数'}}]};
  ctx.state.zoom=1;ctx.state.raw.variables={count:{type:'number',default:0,display_name:'计数'}};
  ctx.instanceRunCards=()=>[card];ctx.variableCompatibleWithInstanceInput=()=>true;
  const inputY=200+vm.runInContext('RUN_CARD_BASE_H + RUN_VARIABLE_H / 2',ctx);
  const target=ctx.instanceRunInputTargetAt({x:110,y:inputY},'variables','count');
  assert.equal(target.kind,'instance-input');assert.equal(target.nodeId,'parallel');assert.equal(target.runIndex,0);
  assert.equal(target.param,'input_id');assert.equal(target.x,110);assert.equal(target.y,inputY);
  const links={};ctx.nodeById=()=>card.node;ctx.mutate=fn=>fn();ctx.variableLinks=()=>links;ctx.toast=()=>{};
  ctx.connectVariableToInstanceInput('variables','count','parallel',0,'input_id','card_1');
  assert.equal(run.inputs.input_id.ref,'variables.count');
  assert.equal(links['parallel:runs.0.inputs.input_id'],'card_1');
});
test('实例子工作流输入的引用候选包含父级运行变量',()=>{
  const {ctx}=harness();
  ctx.state.raw.inputs={parent_input:{type:'number'}};
  ctx.state.raw.variables={runtime_count:{type:'number'}};
  assert.deepEqual([...ctx.parentVariableRefs({type:'number'},false)],['inputs.parent_input']);
  assert.deepEqual([...ctx.parentVariableRefs({type:'number'},true)],['inputs.parent_input','variables.runtime_count']);
});
test('Alt 点击可以快速断开节点和实例输入的变量绑定',()=>{
  const {ctx}=harness();
  const run={inputs:{input_id:{ref:'variables.count'}}};
  const node={id:'parallel',params:{value:{ref:'variables.count'}},runs:[run]};
  const links={'parallel:value':'card_1','parallel:runs.0.inputs.input_id':'card_2'};
  ctx.state.raw.variables={count:{type:'number',default:0,display_name:'计数'}};
  ctx.nodeById=()=>node;ctx.mutate=fn=>fn();ctx.variableLinks=()=>links;ctx.toast=()=>{};
  ctx.disconnectVariableFromPin('parallel','value');
  assert.equal(node.params.value,undefined);assert.equal(links['parallel:value'],undefined);
  ctx.disconnectVariableFromInstanceInput('parallel',0,'input_id');
  assert.equal(run.inputs.input_id,undefined);assert.equal(links['parallel:runs.0.inputs.input_id'],undefined);
});
test('summary preserves zero settings; shared styling covers both themes without glow',()=>{
  const {ctx}=harness();assert.equal(ctx.nodeCardSummary({type:'task',params:{timeout_seconds:0,threshold:0,present:false}}),'等待消失 · 超时 0s · 阈值 0%');
  assert.match(ctx.nodeCardSummary({type:'parallel'}),/并行/);
  const css=fs.readFileSync(path.join(root,'node-cards.css'),'utf8');require('postcss').parse(css);
  assert.match(css,/:root\[data-theme="light"\]/);assert.match(css,/filter: none/);assert.doesNotMatch(css,/drop-shadow|brightness|box-shadow/);
  const entry=fs.readFileSync(path.join(__dirname,'../src/canvas/editor.ts'),'utf8');
  assert.equal(entry.includes("'/legacy/workflow-editor.js'"),false,'画布已迁入 TS，不应再以经典脚本加载');
  assert(entry.includes('createNodeCards()'));
  const canvas=fs.readFileSync(path.join(__dirname,'../src/renderer/canvas.html'),'utf8');
  assert(canvas.indexOf('/legacy/node-cards.css')>canvas.indexOf('/theme/theme.css'));
});
// UE 风格参数行：行集 == 引脚集，行高与 nodeHeight 共用 RUN_VARIABLE_H，折叠只影响显示。
function rowHarness(options={}) {
  const built=harness();
  const {ctx,Element}=built;
  const calls={editors:[],toggles:[],menus:[],inspectors:[]};
  const info=options.paramRowInfo || ((node)=>({expanded:false,total:2,hidden:0}));
  const renderer=createNodeCardRenderer({
    state:ctx.state,svgEl:built.svgEl,nodeCards:ctx.NodeCards,
    position:()=>({x:0,y:0}),nodeHeight:(node)=>ctx.nodeHeight(node),
    subWorkflowRef:()=>null,templatePreview:()=>null,compositeSubtitle:()=>'执行子节点',
    variableDisplayNameOf:(scope,name,fallback)=>ctx.variableDisplayNameOf(scope,name,fallback),
    decoratorLabel:()=>'Retry · 3 次',nodeVariablePins:(node)=>ctx.nodeVariablePins(node),
    openLightbox:()=>{},disconnectVariableFromPin:()=>{},startVariableConnectionFromPin:()=>{},
    openPortContextMenu:()=>({param:'',x:0,y:0}),showMenu:(...args)=>calls.menus.push(args),
    nodeVariablePinMenuItems:()=>['pin-menu'],nodeInputPortMenuItems:()=>[],nodeOutputPortMenuItems:()=>[],
    startConnectionFromInput:()=>{},startConnection:()=>{},startNodeDrag:()=>{},
    registerCardPress:()=>{},requestInspector:(request)=>calls.inspectors.push(request),
    requestOpenSubWorkflow:()=>{},render:()=>{},contextMenuSuppressedByPan:()=>false,
    copySelection:()=>{},cutSelection:()=>{},deleteSelection:()=>{},
    typeIcons:ctx.TYPE_ICON,typeNames:ctx.TYPE_NAMES,runLabels:ctx.RUN_LABEL,
    nodeWidth:260,baseHeight:96,portRadius:7,decoratorHeight:22,runVariableHeight:24,variablePinX:10,
    preview:{x:174,y:56,width:72,height:30},
    compactValue:ctx.compactValue,
    paramRowInfo:info,
    toggleParamRows:(nodeId)=>calls.toggles.push(nodeId),
    openParamEditor:(request)=>calls.editors.push(request),
    paramRowMenuItems:(nodeId,pin)=>['row-menu',pin.param],
  });
  return {...built,calls,renderer};
}
const rowNode={id:'tap',type:'task',name:'点击挑战按钮',action:'input.tap_match',params:{random_offset:11,verify_gone:true},pins:[
  {param:'match',label:'匹配配置',type:'object',scope:'inputs',variable:'模板',configured:true,value:{ref:'inputs.模板'},definition:{type:'object',required:true}},
  {param:'random_offset',label:'随机偏移',type:'integer',configured:true,value:11,definition:{type:'integer',default:0,min:0}},
  {param:'verify_gone',label:'确认模板消失',type:'boolean',configured:true,value:true,definition:{type:'boolean',default:false}},
]};
test('参数行按引脚逐行渲染引脚、名称、值与勾选框',()=>{
  const {ctx,Element,calls,renderer}=rowHarness();
  const layer=new Element('g');
  renderer.renderNode(layer,rowNode);
  const card=layer.children[0];
  assert.equal(byClass(card,'param-row-label').length,3);
  assert.deepEqual(byClass(card,'param-row-label').map(node=>node.children[0].textContent),['匹配配置','随机偏移','确认模板消失']);
  assert.deepEqual(byClass(card,'param-row-rule').map(node=>node.attrs.y1),['96','120','144']);
  assert.deepEqual(byClass(card,'port-variable').map(node=>node.attrs.cy),['108','132','156']);
  assert.deepEqual(byClass(card,'port-variable').map(node=>node.attrs.class.split(' ').filter(name=>name.startsWith('type-')||name==='bound'||name==='configured').sort()),[
    ['bound','configured','type-object'].sort(),['configured','type-integer'].sort(),['configured','type-boolean'].sort(),
  ]);
  // 绑定与字面量各用各的色调；布尔渲染成勾选框而不是文本。
  const values=byClass(card,'param-row-value');
  assert.deepEqual(values.map(node=>node.attrs.class.replace('param-row-value ','')),['tone-bound','tone-literal']);
  assert.deepEqual(values.map(node=>node.textContent),['← 模板','11']);
  assert.deepEqual(values.map(node=>node.children[0].textContent),['match：绑定 inputs.模板','random_offset = 11']);
  assert.equal(byClass(card,'param-row-check').length,1);
  assert.equal(byClass(card,'param-row-check')[0].attrs.class.includes('checked'),true);
  assert.equal(byClass(card,'param-row-check-mark').length,1);
  // 卡片高度 = 基础高 + 行数 * 行高，与 nodeHeight 一致。
  assert.equal(byClass(card,'card-body')[0].attrs.height,String(96+3*24));
  assert.equal(ctx.nodeHeight(rowNode),96+3*24);
  assert.equal(byClass(card,'node-meta')[0].textContent,'3 项参数 · 点值编辑');
});
test('参数行点击分派：值区打开编辑器、勾选框切换、引脚仍是连线端点',()=>{
  const {Element,calls,renderer}=rowHarness();
  const layer=new Element('g');
  renderer.renderNode(layer,rowNode);
  const card=layer.children[0];
  const hits=byClass(card,'param-row-hit');
  assert.equal(hits.length,3);
  assert.equal(hits[1].attrs['data-param'],'random_offset');
  // 热区几何来自 paramRowGeometry：x = valueLeft - 6，高度 = 行高 - 6。
  assert.equal(hits[1].attrs.x,String(Math.round(260*0.46)-6));
  assert.equal(hits[1].attrs.y,String(120+3));
  assert.equal(hits[1].attrs.height,String(24-6));
  hits[1].events.pointerdown[0]({stopPropagation:()=>{},clientX:0,clientY:0});
  hits[1].events.click[0]({preventDefault:()=>{},stopPropagation:()=>{},clientX:120,clientY:130});
  assert.equal(calls.editors.length,1);
  assert.equal(calls.editors[0].pin.param,'random_offset');
  assert.equal(calls.editors[0].node.id,'tap');
  assert.deepEqual(calls.editors[0].rect,{x:Math.round(260*0.46)-6,y:123,width:260-Math.round(260*0.46)-4,height:18});
  assert.equal(calls.editors[0].clientX,120);
  // 右键走参数行菜单（比端口菜单多出恢复默认与详情栏）。
  hits[2].events.contextmenu[0]({clientX:10,clientY:20,preventDefault:()=>{}});
  assert.deepEqual(calls.menus[0][2],['row-menu','verify_gone']);
  // 引脚命中圆保留变量端点行为，且与行热区互不吞并。
  const pins=byClass(card,'variable-port-hit');
  assert.equal(pins.length,3);
  pins[1].events.pointerdown[0]({stopPropagation:()=>{},altKey:false});
  assert.equal(pins[1].events.contextmenu.length,1);
  // 任务节点只有输入端口（输出由后续连线表示），端口命中区不受参数行影响。
  assert.equal(byClass(card,'port-out').length,0);
  assert.equal(byClass(card,'port-in')[0].events.pointerdown.length,1);
});
const typeRowNode={id:'types',type:'task',name:'新类型参数',action:'studio.preview_types',params:{realm_popup_close_point:{x:960,y:540},tint:'#ff8c3a',wait_for:'any',stable_seconds:1.5,keycode:'BACK'},pins:[
  {param:'realm_popup_close_point',label:'结界弹窗关闭位置',type:'point',configured:true,value:{x:960,y:540},definition:{type:'point'}},
  {param:'tint',label:'标记颜色',type:'color',configured:true,value:'#ff8c3a',definition:{type:'color',default:'#000000'}},
  {param:'wait_for',label:'完成条件',type:'enum',configured:true,value:'any',definition:{type:'enum',enum:['all','any'],default:'all'}},
  {param:'stable_seconds',label:'稳定时长（秒）',type:'duration',configured:false,definition:{type:'duration',default:1.5,min:0}},
  {param:'keycode',label:'按键代码',type:'key',configured:true,value:'BACK',definition:{type:'key',default:'BACK'}},
]};
test('新类型参数行渲染：坐标点、颜色色块、枚举、时长与按键',()=>{
  const {ctx,Element,renderer}=rowHarness({paramRowInfo:()=>({expanded:true,total:5,hidden:0})});
  const layer=new Element('g');
  renderer.renderNode(layer,typeRowNode);
  const card=layer.children[0];
  const values=byClass(card,'param-row-value');
  assert.deepEqual(values.map(node=>node.attrs.class.replace('param-row-value ','')),
    ['tone-literal','tone-literal','tone-literal','tone-default','tone-literal']);
  assert.deepEqual(values.map(node=>node.textContent),['(960, 540)','#ff8c3a','any','1.5s','BACK']);
  // 颜色行在值前挂色块，并给文本让出宽度。
  const swatches=byClass(card,'param-row-swatch');
  assert.equal(swatches.length,1);
  assert.equal(swatches[0].attrs.fill,'#ff8c3a');
  assert.equal(swatches[0].attrs.width,'10');
  assert.equal(swatches[0].attrs.y,String(96+24+12-5));
  // 每行都是可点值区，新类型也走就地编辑。
  assert.equal(byClass(card,'param-row-hit').length,5);
  assert.equal(byClass(card,'param-row-check').length,0);
  // 引脚类型 class 跟着新类型走，连线兼容性由它决定。
  assert.deepEqual(byClass(card,'port-variable').map(node=>node.attrs.class.split(' ').filter(name=>name.startsWith('type-'))[0]),
    ['type-point','type-color','type-enum','type-duration','type-key']);
  assert.equal(ctx.nodeHeight(typeRowNode),96+5*24);
});
test('折叠箭头显示隐藏数量并回调切换，未接入信息时不渲染箭头',()=>{
  const collapsed=rowHarness({paramRowInfo:()=>({expanded:false,total:5,hidden:3})});
  const layer=new collapsed.Element('g');
  collapsed.renderer.renderNode(layer,rowNode);
  const caret=byClass(layer.children[0],'param-rows-toggle')[0];
  assert.equal(caret.textContent,'▸ 3');
  assert.match(caret.children[0].textContent,/还有 3 项未显示/);
  let stopped=false;
  caret.events.mousedown[0]({preventDefault:()=>{},stopImmediatePropagation:()=>{stopped=true;}});
  assert.equal(stopped,true);
  caret.events.click[0]({preventDefault:()=>{},stopPropagation:()=>{}});
  assert.deepEqual(collapsed.calls.toggles,['tap']);
  // 折叠时摘要给出「已显示 / 全部」，展开时只报总数。
  assert.equal(byClass(layer.children[0],'node-meta')[0].textContent,'3 / 5 项参数 · 点值编辑');
  const expanded=rowHarness({paramRowInfo:()=>({expanded:true,total:3,hidden:0})});
  const expandedLayer=new expanded.Element('g');
  expanded.renderer.renderNode(expandedLayer,rowNode);
  assert.equal(byClass(expandedLayer.children[0],'param-rows-toggle')[0].textContent,'▾');
  assert.equal(byClass(expandedLayer.children[0],'node-meta')[0].textContent,'3 项参数 · 点值编辑');
  // 旧的渲染器（没有参数行信息）不显示箭头，也不改变既有布局。
  const legacy=rowHarness({paramRowInfo:undefined,rows:undefined});
  const legacyRenderer=createNodeCardRenderer({...{},svgEl:legacy.svgEl,state:legacy.ctx.state,nodeCards:legacy.ctx.NodeCards,
    position:()=>({x:0,y:0}),nodeHeight:(node)=>legacy.ctx.nodeHeight(node),subWorkflowRef:()=>null,templatePreview:()=>null,
    compositeSubtitle:()=>'执行子节点',variableDisplayNameOf:(scope,name,fallback)=>legacy.ctx.variableDisplayNameOf(scope,name,fallback),
    decoratorLabel:()=>'',nodeVariablePins:(node)=>legacy.ctx.nodeVariablePins(node),openLightbox:()=>{},
    disconnectVariableFromPin:()=>{},startVariableConnectionFromPin:()=>{},openPortContextMenu:()=>null,showMenu:()=>{},
    nodeVariablePinMenuItems:()=>[],nodeInputPortMenuItems:()=>[],nodeOutputPortMenuItems:()=>[],
    startConnectionFromInput:()=>{},startConnection:()=>{},startNodeDrag:()=>{},registerCardPress:()=>{},
    requestInspector:()=>{},requestOpenSubWorkflow:()=>{},render:()=>{},contextMenuSuppressedByPan:()=>false,
    copySelection:()=>{},cutSelection:()=>{},deleteSelection:()=>{},typeIcons:legacy.ctx.TYPE_ICON,typeNames:legacy.ctx.TYPE_NAMES,
    runLabels:legacy.ctx.RUN_LABEL,nodeWidth:260,baseHeight:96,portRadius:7,decoratorHeight:22,runVariableHeight:24,
    variablePinX:10,preview:{x:174,y:56,width:72,height:30},compactValue:legacy.ctx.compactValue});
  const plainLayer=new legacy.Element('g');
  legacyRenderer.renderNode(plainLayer,rowNode);
  assert.equal(byClass(plainLayer.children[0],'param-rows-toggle').length,0);
  assert.equal(byClass(plainLayer.children[0],'param-row-label').length,3);
});
