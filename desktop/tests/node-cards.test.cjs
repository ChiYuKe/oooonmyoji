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
    getAttribute(k){return Object.prototype.hasOwnProperty.call(this.attrs,k)?this.attrs[k]:null;}
    appendChild(node){this.children.push(node);return node;}
    addEventListener(k,fn){(this.events[k] ||= []).push(fn);}
    querySelectorAll(selector){
      const matches=(node)=>selector.startsWith('.')
        ? String(node.attrs.class || '').split(/\s+/).includes(selector.slice(1))
        : node.tag===selector;
      return this.children.flatMap(c=>[...(matches(c)?[c]:[]),...c.querySelectorAll(selector)]);
    }
    querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
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
  Object.assign(ctx,{state:{run:new Map(),selected:new Set(),raw:{inputs:{count:{type:'integer',default:0}}}},position:()=>({x:0,y:0}),subWorkflowRef:()=>null,templatePreview:()=>null,assetPreviewForPath:()=>null,bindAssetPathPreview:()=>{},workflowBrowsers:[],definitionSchema:value=>value,compatibleRefType:()=>true,
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
    showMenu:(...args)=>ctx.showMenu?.(...args),
    instanceRunPinMenuItems:()=>[],
    variableCardPortMenuItems:()=>[],
    requestInspector:()=>{},
    requestOpenWorkflowReference:()=>{},
    openWorkflowBrowser:(...args)=>ctx.workflowBrowsers.push(args),
    render:()=>{},
    contextMenuSuppressedByPan:()=>false,
    removeInstanceRun:()=>{},
    removeVariableCard:(...args)=>ctx.removeVariableCard?.(...args),
    setVariableCardSelection:(ids)=>ctx.setVariableCardSelection?.(ids),
    variableCardList:()=>model.variableCardList(),
    variableInUse:(scope,name)=>ctx.variableInUse?.(scope,name) ?? false,
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
    showMenu:(...args)=>ctx.showMenu?.(...args),
    nodeGroupVariableMenuItems:(...args)=>ctx.nodeGroupVariableMenuItems?.(...args) || [],
    nodeVariablePinMenuItems:()=>[],
    nodeInputPortMenuItems:()=>[],
    nodeOutputPortMenuItems:()=>[],
    startConnectionFromInput:()=>{},
    startConnection:()=>{},
    startNodeDrag:(...args)=>ctx.startNodeDrag?.(...args),
    registerCardPress:cards.registerCardPress,
    requestInspector:()=>{},
    requestOpenSubWorkflow:()=>{},
    enterNodeGroup:(...args)=>ctx.enterNodeGroup?.(...args),
    ungroupNodeGroup:(...args)=>ctx.ungroupNodeGroup?.(...args),
    render:()=>{},
    contextMenuSuppressedByPan:()=>false,
    copySelection:()=>{},
    cutSelection:()=>{},
    deleteSelection:()=>{},
    typeIcons:ctx.TYPE_ICON,
    typeNames:ctx.TYPE_NAMES,
    runLabels:ctx.RUN_LABEL,
    nodeGroupRunSummary:(groupId)=>ctx.nodeGroupRunSummary?.(groupId) || null,
    // 阶段 6：折叠组问题汇总与节点提醒点在用例里按需注入（延迟读 ctx，便于逐例改写）。
    groupIssueSummary:(groupId)=>ctx.groupIssueSummary?.(groupId) || {errors:0,warnings:0,first:''},
    nodeWarningCount:(nodeId)=>ctx.nodeWarningCount?.(nodeId) || 0,
    // 节点级错误（红点）：默认没有，用例按需注入。
    nodeIssueInfo:(node)=>ctx.nodeIssueInfo?.(node) ?? null,
    issueTitle:(items)=>items.map((item)=>item.message).join('\n'),
    nodeWidth:260,
    baseHeight:96,
    portRadius:7,
    decoratorHeight:22,
    runVariableHeight:24,
    variablePinX:10,
    // 输出口收在卡片右缘以内（nodeWidth - 12），与编辑器里的 TASK_OUTPUT_PORT_X 一致。
    taskOutputPortX:248,
    // 输出口连没连：默认没连（空心环），用例按需注入。
    outputReferenced:(nodeId)=>ctx.outputReferenced?.(nodeId) ?? false,
    preview:{x:174,y:56,width:72,height:30},
  });
  ctx.renderNode=nodeCard.renderNode;
  ctx.patchNodeRuntime=nodeCard.patchNodeRuntime;
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
test('折叠组卡显示成员运行进度，并能在主状态不变时就地刷新',()=>{
  const {ctx,Element}=harness();
  let completed=1;
  ctx.RUN_LABEL.running='运行中';
  ctx.nodeGroupRunSummary=()=>({
    status:'running',total:3,completed,runningNodeId:'b',runningNodeName:'点击按钮',failedNodeIds:[],failedNodeNames:[],
  });
  const layer=new Element('g');
  const node={id:'group',type:'node_group',name:'战斗循环',children:[],_nodeGroup:true,_nodeCount:3,_groupPins:[],_hasReferenceOutput:false};
  ctx.renderNode(layer,node);
  const card=layer.children[0];
  assert.match(card.attrs.class,/run-running/);
  assert.equal(byClass(card,'node-group-run-label')[0].textContent,'运行中');
  assert.equal(byClass(card,'node-group-progress')[0].textContent,'3 个节点 · 已完成 1/3');
  assert.equal(byClass(card,'node-group-runtime-detail')[0].textContent,'正在执行：点击按钮');

  completed=2;
  assert.equal(ctx.patchNodeRuntime(card,node),true);
  assert.equal(byClass(card,'node-group-progress')[0].textContent,'3 个节点 · 已完成 2/3');
});
test('运行态组卡右键提供直接定位真实成员的入口',()=>{
  const {ctx,Element}=harness();
  const opened=[];
  let menu=[];
  ctx.nodeGroupRunSummary=()=>({
    status:'failed',total:2,completed:2,runningNodeId:'',runningNodeName:'',failedNodeIds:['failed-task'],failedNodeNames:['失败任务'],
  });
  ctx.enterNodeGroup=(...args)=>opened.push(args);
  ctx.showMenu=(x,y,items)=>{menu=items;};
  const layer=new Element('g');
  ctx.renderNode(layer,{id:'group',type:'node_group',name:'节点组',children:[],_nodeGroup:true,_nodeCount:2,_groupPins:[],_hasReferenceOutput:false});
  const card=layer.children[0];
  card.events.contextmenu[0]({preventDefault(){},stopPropagation(){},clientX:10,clientY:20});
  assert.deepEqual(menu.map(item=>item.label),['定位异常节点','进入节点组','解散节点组']);
  menu[0].run();
  assert.deepEqual(opened,[['group','failed-task']]);
});
test('折叠组存在跨组输出引用时显示右侧代理输出口',()=>{
  const {ctx,Element}=harness();
  const layer=new Element('g');
  ctx.renderNode(layer,{id:'group',type:'node_group',name:'节点组',children:[],_nodeGroup:true,_nodeCount:2,_groupPins:[],_hasReferenceOutput:true});
  const card=layer.children[0];
  const outputs=byClass(card,'port-out-reference');
  assert.equal(outputs.length,1);
  assert.equal(outputs[0].attrs.cx,'248');
  assert.equal(outputs[0].attrs.cy,'16');
});

// —— 阶段 6：折叠组汇总内部问题（点徽标进组并定位）、节点提醒点 ——

test('折叠组按内部问题数显示汇总徽标，点一下就进组并定位到第一个问题',()=>{
  const {ctx,Element}=harness();
  const entered=[];
  ctx.enterNodeGroup=(groupId,nodeId)=>{entered.push([groupId,nodeId]);return true;};
  ctx.groupIssueSummary=(groupId)=>({errors:3,warnings:1,first:'bad-node'});
  const layer=new Element('g');
  ctx.renderNode(layer,{id:'group',type:'node_group',name:'节点组',children:[],_nodeGroup:true,_nodeCount:2,_groupPins:[],_hasReferenceOutput:false});
  const card=layer.children[0];
  const badge=byClass(card,'node-group-issue')[0];
  assert.ok(badge,'有内部问题时组卡上出现汇总徽标');
  assert.equal(String(badge.attrs.class).includes('error'),true,'有错误时用错误态');
  assert.equal(byClass(badge,'node-group-issue-text')[0].textContent,'⚠3','徽标直接写错误数（不是总数）');
  const stopped=[];
  badge.events.click[0]({preventDefault(){stopped.push('preventDefault');},stopPropagation(){stopped.push('stopPropagation');},stopImmediatePropagation(){stopped.push('stopImmediatePropagation');}});
  assert.deepEqual(entered,[['group','bad-node']],'点徽标进入该组并定位第一个问题节点');
  assert.ok(stopped.includes('stopImmediatePropagation'),'点徽标不能顺带触发卡片拖动/选中');
});

test('折叠组只有提醒时徽标走琥珀态，没有问题时整块不出现',()=>{
  const {ctx,Element}=harness();
  ctx.groupIssueSummary=()=>({errors:0,warnings:2,first:'warn-node'});
  const layer=new Element('g');
  ctx.renderNode(layer,{id:'group',type:'node_group',name:'节点组',children:[],_nodeGroup:true,_nodeCount:1,_groupPins:[],_hasReferenceOutput:false});
  const card=layer.children[0];
  const badge=byClass(card,'node-group-issue')[0];
  assert.equal(String(badge.attrs.class).includes('warning'),true,'只有提醒时用琥珀态');
  assert.equal(byClass(badge,'node-group-issue-text')[0].textContent,'!2');

  const clean=new Element('g');
  ctx.groupIssueSummary=()=>({errors:0,warnings:0,first:''});
  ctx.renderNode(clean,{id:'group2',type:'node_group',name:'干净组',children:[],_nodeGroup:true,_nodeCount:1,_groupPins:[],_hasReferenceOutput:false});
  assert.equal(byClass(clean.children[0],'node-group-issue').length,0,'没有问题时组卡保持干净');
});

test('节点上的提醒画琥珀色小点，与红色错误点区分',()=>{
  const {ctx,Element}=harness();
  ctx.nodeIssueInfo=()=>({node:[],params:new Map()});
  ctx.nodeWarningCount=(id)=>(id==='warn'?2:0);
  const layer=new Element('g');
  ctx.renderNode(layer,{id:'warn',type:'task',action:'core.log',name:'提醒节点',children:[],params:{}});
  const card=layer.children[0];
  assert.equal(byClass(card,'node-warning-dot').length,1,'只有提醒时画琥珀点');
  assert.equal(byClass(card,'node-error-dot').length,0,'没有错误就不画红点');

  const errorLayer=new Element('g');
  ctx.nodeIssueInfo=()=>({node:[{message:'缺 Action'}],params:new Map()});
  ctx.renderNode(errorLayer,{id:'bad',type:'task',name:'错误节点',children:[],params:{}});
  const badCard=errorLayer.children[0];
  assert.equal(byClass(badCard,'node-error-dot').length,1,'有错误时仍是红点');
  assert.equal(byClass(badCard,'node-warning-dot').length,0,'红点优先，不再叠琥珀点');
});
test('组内变量卡把数据端点放在右侧且不显示执行端口',()=>{
  const {ctx,Element}=harness();
  const regularHeight=ctx.nodeHeight;
  ctx.nodeHeight=(node)=>node._nodeGroupHeight || regularHeight(node);
  const regularPins=ctx.nodeVariablePins;
  ctx.nodeVariablePins=(node)=>node._groupPins || regularPins(node);
  const layer=new Element('g');
  ctx.renderNode(layer,{
    id:'group-vars',type:'node_group_variables',name:'节点组 变量',children:[],_nodeGroupVariables:true,_nodeGroupHeight:320,
    _groupPins:[{param:'group-pin:0',targetNodeId:'inside',targetParam:'match',label:'点击节点 · 匹配结果',type:'object',value:{ref:'nodes.source.output.match'},_nodeGroupPin:true}],
  });
  const card=layer.children[0];
  assert.equal(byClass(card,'node-box')[0].attrs.height,'320','变量卡使用组成员纵向跨度');
  assert.equal(byClass(card,'port-variable')[0].attrs.cx,'250','数据端点位于卡片右侧');
  assert.equal(byClass(card,'port-in').length,0,'变量卡不混入执行流入口');
  assert.equal(byClass(card,'port-out').length,0,'变量卡不混入执行流出口');
  const dragged=[];
  const menus=[];
  ctx.startNodeDrag=(event,id)=>dragged.push(id);
  ctx.showMenu=(...args)=>menus.push(args);
  byClass(card,'node-box')[0].events.mousedown[0]({button:0});
  ctx.renderNode(layer,{id:'group-entry',type:'node_group_interface',name:'节点组 接口',children:['inside'],_nodeGroupInterface:true,_groupPins:[]});
  byClass(layer.children[1],'node-box')[0].events.mousedown[0]({button:0});
  assert.deepEqual(dragged,['group-vars','group-entry'],'变量卡和执行入口都交给普通节点拖动器');
  const add=byClass(card,'node-group-add')[0];
  add.events.click[0]({clientX:120,clientY:80,preventDefault(){},stopPropagation(){}});
  assert.equal(menus.length,1,'变量卡标题提供新增入口');
});
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
    settle:{type:'duration',default:1.5},mode:{type:'enum',enum:['安全','快速'],default:'安全'},confirm_key:{type:'key',default:'BACK'},flow:{type:'workflow',default:'a.json'},
  };
  const layer=new Element('g');
  const render=(name)=>{const target=new Element('g');ctx.renderVariableCard(target,{name,scope:'variables',id:name,x:0,y:0});return target.children[0];};
  const tint=render('tint');
  assert.equal(byClass(tint,'variable-card-access')[0].textContent,'颜色 · 状态');
  assert.match(byClass(tint,'variable-card-dot')[0].attrs.class,/^variable-card-dot type-color data-tone-\d+$/);
  assert.equal(byClass(tint,'variable-card-swatch')[0].attrs.fill,'#ff8c3a');
  assert.equal(byClass(tint,'variable-card-swatch')[0].attrs.x,'102');
  assert.equal(byClass(tint,'variable-card-value')[0].textContent,'#ff8c3a');
  // 坐标点与时长用可读写法，不把 JSON 截断在卡片里。
  assert.equal(byClass(render('target'),'variable-card-value')[0].textContent,'960,540');
  assert.equal(byClass(render('settle'),'variable-card-value')[0].textContent,'1.5s');
  assert.equal(byClass(render('mode'),'variable-card-value')[0].textContent,'安全');
  assert.equal(byClass(render('confirm_key'),'variable-card-value')[0].textContent,'BACK');
  assert.equal(byClass(render('flow'),'variable-card-value')[0].textContent,'a.json');
  for(const [name,label,type] of [['target','坐标点','point'],['settle','时长','duration'],['mode','枚举','enum'],['confirm_key','按键','key'],['flow','工作流','workflow']]){
    const card=render(name);
    assert.equal(byClass(card,'variable-card-access')[0].textContent,`${label} · 状态`);
    assert.ok(byClass(card,'port-variable-out')[0].attrs.class.includes(`type-${type}`),type);
    assert.equal(byClass(card,'variable-card-swatch').length,0);
  }
  // 颜色默认值非法时不画色块（例如手工编辑过的旧文档）。
  ctx.state.raw.variables.tint.default='红色';
  assert.equal(byClass(render('tint'),'variable-card-swatch').length,0);
});
test('工作流变量卡片双击快速打开工作流浏览器',()=>{
  const {ctx,Element}=harness();
  ctx.state.raw.variables={flow:{type:'workflow',default:'old.json'}};
  ctx.state.raw.nodes=[{id:'run',type:'task',action:'workflow.run',params:{workflow:{ref:'variables.flow'},inputs:{旧参数:1}}}];
  const layer=new Element('g');
  ctx.renderVariableCard(layer,{name:'flow',scope:'variables',id:'flow-card',x:0,y:0});
  const card=layer.children[0];
  const event={button:0,clientX:30,clientY:20,preventDefault:()=>{},stopPropagation:()=>{},target:{closest:()=>true}};
  card.events.mousedown[0](event);
  card.events.mousedown[0](event);
  assert.equal(ctx.workflowBrowsers.length,1);
  assert.deepEqual(ctx.workflowBrowsers[0].slice(0,3),['','flow','old.json']);
  ctx.workflowBrowsers[0][3]('entrypoints/new.json');
  assert.equal(ctx.state.raw.variables.flow.default,'entrypoints/new.json');
  assert.deepEqual(ctx.state.raw.nodes[0].params.inputs,{});
});
test('卡片渲染返回组元素，拖拽补丁才能就地改 transform',()=>{
  const {ctx,Element}=harness();
  const cardLayer=new Element('g');
  const card=ctx.renderVariableCard(cardLayer,{name:'count',scope:'inputs',id:'card_1',x:0,y:0});
  assert.equal(card,cardLayer.children[0],'变量卡片渲染要返回卡片组元素');
  assert.match(card.attrs.class,/variable-card/);
  ctx.state.raw.nodes=[{id:'n1',type:'task',children:[],pins:[]}];
  const nodeLayer=new Element('g');
  const node=ctx.renderNode(nodeLayer,ctx.state.raw.nodes[0]);
  assert.equal(node,nodeLayer.children[0],'节点卡片渲染要返回卡片组元素');
  assert.match(node.attrs.class,/node/);
});
test('单击已选中的变量卡片保留整组选择，并把整组起点交给拖拽',()=>{
  const {ctx,Element}=harness();
  ctx.state.raw.inputs={count:{type:'integer',default:0},other:{type:'integer',default:0},third:{type:'integer',default:0}};
  ctx.state.raw._variableCards={
    card_1:{name:'count',scope:'inputs',x:0,y:0},
    card_2:{name:'other',scope:'inputs',x:0,y:80},
    card_3:{name:'third',scope:'inputs',x:0,y:160},
  };
  const applied=[];
  ctx.setVariableCardSelection=(ids)=>{
    applied.push([...ids]);
    ctx.state.selectedVariableCardIds=new Set(ids);
    ctx.state.selectedVariableCardId=ids.length===1?ids[0]:'';
  };
  const render=(id,name,y)=>{const layer=new Element('g');ctx.renderVariableCard(layer,{name,scope:'inputs',id,x:0,y});return layer.children[0];};
  const press=(card,extra={})=>card.events.mousedown[0]({button:0,clientX:30,clientY:20,preventDefault:()=>{},stopPropagation:()=>{},target:{closest:()=>true},...extra});
  ctx.state.selectedVariableCardIds=new Set(['card_1','card_2']);
  ctx.state.selectedVariableCardId='';
  // 框选后按住组里的一张：选择不能被收窄成一张，拖拽要带上整组起点。
  press(render('card_1','count',0));
  assert.deepEqual(applied,[],'已选中的卡片被按下时不应收窄选择');
  assert.equal(ctx.state.drag.kind,'variable-card');
  assert.deepEqual(Object.keys(ctx.state.drag.origins).sort(),['card_1','card_2']);
  assert.deepEqual(ctx.state.drag.origins.card_2,{x:0,y:80});
  // 单击没被选中的卡片仍然只选这一张。
  press(render('card_3','third',160));
  assert.deepEqual(applied.at(-1),['card_3']);
  assert.deepEqual(Object.keys(ctx.state.drag.origins),['card_3']);
  // Shift 点击把没选中的卡片加进多选。
  press(render('card_1','count',0),{shiftKey:true});
  assert.deepEqual(applied.at(-1).sort(),['card_1','card_3']);
  assert.deepEqual(Object.keys(ctx.state.drag.origins).sort(),['card_1','card_3']);
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
  assert.doesNotMatch(css,/data-theme="(?:light|dark)"/);assert.match(css,/filter: none/);assert.doesNotMatch(css,/drop-shadow|brightness|box-shadow/);
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
    nodeRowHeight:options.nodeRowHeight,
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
    taskOutputPortX:248,
    // 输出口连没连：默认没连（空心环），用例按需注入 ctx.outputReferenced。
    outputReferenced:(nodeId)=>ctx.outputReferenced?.(nodeId) ?? false,
    preview:{x:174,y:56,width:72,height:30},
    compactValue:ctx.compactValue,
    paramRowInfo:info,
    nodeIssueInfo:options.nodeIssueInfo,
    issueTitle:options.issueTitle,
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
  // 任务节点没有执行流输出（叶子），但右侧带一个「节点输出引用」口。
  const referencePorts=byClass(card,'port-out-reference');
  assert.equal(byClass(card,'port-out').length,1);
  assert.equal(referencePorts.length,1);
  assert.equal(referencePorts[0].attrs.cx,'248','输出口收在卡片右缘以内');
  assert.equal(referencePorts[0].attrs.cy,'16','输出口在表头中线');
  assert.equal(referencePorts[0].events.pointerdown.length,1);
  assert.equal(byClass(card,'port-in')[0].events.pointerdown.length,1);
  assert.equal(referencePorts[0].attrs.class.includes('connected'),false,'没有引用时是空心环');
});
test('输出口按连接状态切换：没连出去是空心环，连出去才填满',()=>{
  const {ctx,Element,renderer}=rowHarness();
  const layer=new Element('g');
  renderer.renderNode(layer,rowNode);
  assert.equal(byClass(layer.children[0],'port-out-reference')[0].attrs.class.includes('connected'),false,'没人引用时中空');
  // 有节点引用了这个节点的输出之后，同一个口要变成实心（与输入口「连接即填满」同一套语言）。
  ctx.outputReferenced=(nodeId)=>nodeId==='tap';
  const wired=new Element('g');
  renderer.renderNode(wired,rowNode);
  const port=byClass(wired.children[0],'port-out-reference')[0];
  assert.equal(port.attrs.class.includes('connected'),true,'被引用后填满');
  assert.equal(port.attrs.cx,'248','连接状态只改样式，不动端点位置');
});
test('变量卡输出口按「这个变量有没有人在用」切换中空与填满',()=>{
  const {ctx,Element}=harness();
  ctx.state.raw.inputs={v_used:{type:'integer',default:0},v_idle:{type:'integer',default:0}};
  ctx.variableInUse=(scope,name)=>scope==='inputs'&&name==='v_used';
  const idle=new Element('g');
  ctx.renderVariableCard(idle,{name:'v_idle',scope:'inputs',id:'v_idle',x:0,y:0});
  assert.equal(byClass(idle.children[0],'port-variable-out')[0].attrs.class.includes('connected'),false,'没人用这个变量时中空');
  const used=new Element('g');
  ctx.renderVariableCard(used,{name:'v_used',scope:'inputs',id:'v_used',x:0,y:0});
  assert.equal(byClass(used.children[0],'port-variable-out')[0].attrs.class.includes('connected'),true,'有人在用就填满');
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
    variablePinX:10,preview:{x:174,y:56,width:72,height:30},compactValue:legacy.ctx.compactValue,
    taskOutputPortX:248});
  const plainLayer=new legacy.Element('g');
  legacyRenderer.renderNode(plainLayer,rowNode);
  assert.equal(byClass(plainLayer.children[0],'param-rows-toggle').length,0);
  assert.equal(byClass(plainLayer.children[0],'param-row-label').length,3);
});
// 固定卡片：清单声明了 card.rows 的动作，端点由清单固定，行样式变成「标签一行 + 值一行」。
const fixedCardNode={id:'wait',type:'task',name:'等待战斗结束',action:'vision.wait_template',params:{template:'assets/templates/battle.png',present:true},pins:[
  {param:'template',label:'模板',type:'asset',configured:true,value:'assets/templates/battle.png',definition:{type:'asset',required:true}},
  {param:'timeout_seconds',label:'超时',type:'duration',configured:false,definition:{type:'duration',required:true,min:0}},
  {param:'present',label:'存在性',type:'boolean',configured:true,value:true,definition:{type:'boolean',default:true},onLabel:'等待出现',offLabel:'等待消失'},
  {param:'roi',label:'识别区域',type:'rect',configured:true,value:[60,120,200,80],definition:{type:'rect'}},
  {param:'threshold',label:'匹配阈值',type:'number',configured:false,definition:{type:'number',default:0.85,min:0,max:1}},
  {param:'scale_search',label:'多尺度搜索',type:'boolean',configured:false,definition:{type:'boolean',default:false},onLabel:'启用',offLabel:'关闭'},
]};
// 固定长度数组（随机间隔）：卡片上拆成两个输入格，各自显示自己的值。
const tupleCardNode={id:'tap',type:'task',name:'点击挑战按钮',action:'input.tap_match',params:{random_interval:[0.2,0.6]},pins:[
  {param:'random_interval',label:'随机间隔（秒）',type:'array',configured:true,value:[0.2,0.6],
    definition:{type:'array',items:{type:'duration',min:0},min_items:2,max_items:2,default:[0,0]}},
  {param:'disappeared_states',label:'消失状态列表',type:'array',configured:false,
    definition:{type:'array',items:{type:'object'},default:[]}},
]};
test('固定长度数组在固定卡片上拆成并排的输入格',()=>{
  const {ctx,Element,calls,renderer}=rowHarness({nodeRowHeight:()=>40,paramRowInfo:()=>({expanded:true,total:2,hidden:0,fixed:true,twoLine:true})});
  ctx.nodeHeight=(node)=>96+(node.pins||[]).length*40;
  const layer=new Element('g');
  renderer.renderNode(layer,tupleCardNode);
  const card=layer.children[0];
  // 两个输入格：宽度 = (226 - 4) / 2，中间留 4px 间隔，几何与热区所在行一致。
  // 两个小格挤在一个值框里：每格 (111 - 4) / 2 = 53.5，整行宽度仍不超过一格。
  const cells=byClass(card,'param-row-cell');
  assert.equal(cells.length,2);
  assert.deepEqual(cells.map(node=>node.attrs.x),['22','79.5']);
  assert.deepEqual(cells.map(node=>node.attrs.width),['53.5','53.5']);
  assert.deepEqual(cells.map(node=>node.attrs.y),['115','115']);
  assert.deepEqual(cells.map(node=>node.attrs.height),['18','18']);
  assert.deepEqual(cells.map(node=>node.attrs.class.includes('goes-inspector')),[false,false]);
  // 每格一个值文字：0.2 / 0.6，各自贴在自己的格子里。
  const values=byClass(card,'param-row-value');
  assert.deepEqual(values.map(node=>node.textContent),['0.2','0.6','[0 项]']);
  assert.deepEqual(values.slice(0,2).map(node=>node.attrs.x),['31','88.5']);
  assert.deepEqual(values.slice(0,2).map(node=>node.attrs['text-anchor']),['start','start']);
  assert.deepEqual(values.slice(0,2).map(node=>node.children[0].textContent),['随机间隔（秒） 第 1 项','随机间隔（秒） 第 2 项']);
  // 两格各有热区，悬停只点亮所在格；点击第二格会聚焦第二个输入框。
  const hits=byClass(card,'param-row-hit');
  assert.deepEqual(hits.map(node=>node.attrs['data-param']),['random_interval','random_interval','disappeared_states']);
  assert.deepEqual(hits.map(node=>node.attrs.x),['22','79.5','22']);
  assert.deepEqual(hits.map(node=>node.attrs.width),['53.5','53.5','111']);
  assert.equal(byClass(card,'param-row-caret').length,1,'只有去详情栏的对象数组画 ›');
  assert.deepEqual(hits.map(node=>node.attrs.class.includes('kind-picker')),[false,false,true],'去详情栏的行是手型光标');
  hits[1].events.click[0]({preventDefault:()=>{},stopPropagation:()=>{},clientX:95,clientY:120});
  assert.deepEqual(calls.editors.map(request=>request.pin.param),['random_interval']);
  assert.equal(calls.editors[0].valueAlign,'left');
  assert.equal(calls.editors[0].inputIndex,1);
  // 长度不定的对象数组仍然是一个虚线框、点击去详情栏。
  const complexField=byClass(card,'param-row-field').find(node=>node.attrs.class.includes('goes-inspector'));
  assert.ok(complexField,'长度不定的数组仍是虚线框');
  assert.equal(complexField.attrs.x,'22');
  assert.equal(complexField.attrs.width,'111');
  // 数组的小格子挤在同一格值框里：整行宽度不超过普通值框。
  assert.ok(Number(cells[0].attrs.x) + cells.reduce((sum, node) => sum + Number(node.attrs.width), 0) + 4 <= 22 + 111);
});
test('校验错误的行标红：参数级标在那一行，节点级标在卡片',()=>{
  const {ctx,Element,renderer}=rowHarness({nodeRowHeight:()=>40,paramRowInfo:()=>({expanded:true,total:6,hidden:0,fixed:true,twoLine:true}),
    nodeIssueInfo:(node)=>node.id==='wait'?{
      node:[{message:'Task 必须定义 Action'}],
      params:new Map([['timeout_seconds',[{message:"'timeout_seconds' is a required property"}]]]),
    }:null,issueTitle:(items)=>items.map((item)=>item.message).join('\n')});
  ctx.nodeHeight=(node)=>96+(node.pins||[]).length*40;
  const layer=new Element('g');
  renderer.renderNode(layer,fixedCardNode);
  const card=layer.children[0];
  // 只有出错的那一行标红：标签 error、值框 error、热区 invalid、引脚 invalid。
  const labels=byClass(card,'param-row-label');
  assert.deepEqual(labels.map(node=>node.attrs.class.includes('error')),[false,true,false,false,false,false]);
  assert.deepEqual(byClass(card,'param-row-field').map(node=>node.attrs.class.includes('error')),
    [false,true,false,false,false,false,false,false,false]);
  assert.deepEqual(byClass(card,'variable-port-hit').length,6);
  assert.deepEqual(byClass(card,'port-variable').map(node=>node.attrs.class.includes('invalid')),[false,true,false,false,false,false]);
  const hits=byClass(card,'param-row-hit');
  assert.deepEqual(hits.map(node=>node.attrs.class.includes('invalid')),[false,true,false,false,false,false]);
  // 出错行的悬停提示给出校验原文。
  assert.match(hits[1].children.map(child=>child.textContent).join(''),/is a required property/);
  // 节点级错误：卡片描边 classes.node-invalid + 标题旁红点 + 标题悬停带上原因。
  assert.equal(card.attrs.class.includes('node-invalid'),true);
  assert.equal(byClass(card,'node-error-dot').length,1);
  assert.equal(byClass(card,'node-error-dot')[0].attrs.r,'4');
  const groupTitle=card.children.find((child)=>child.tag==='title');
  assert.match(groupTitle.textContent,/Task 必须定义 Action/);
});

test('固定卡片按左名称右控件排布，区域编辑保留四坐标宽度',()=>{
  const {ctx,Element,calls,renderer}=rowHarness({nodeRowHeight:()=>30,paramRowInfo:()=>({expanded:true,total:6,hidden:0,fixed:true,twoLine:false})});
  ctx.nodeHeight=(node)=>96+(node.pins||[]).length*30;
  const layer=new Element('g');
  renderer.renderNode(layer,fixedCardNode);
  const card=layer.children[0];
  assert.equal(byClass(card,'card-body')[0].attrs.height,'276');
  assert.deepEqual(byClass(card,'port-variable').map(node=>node.attrs.cy),['111','141','171','201','231','261']);
  const labels=byClass(card,'param-row-label');
  const values=byClass(card,'param-row-value');
  assert.deepEqual(labels.map(node=>node.attrs.x),Array(6).fill('22'));
  assert.deepEqual(labels.map(node=>node.attrs.y),['115','145','175','205','235','265']);
  assert.deepEqual(values.map(node=>node.attrs.y),labels.map(node=>node.attrs.y));
  assert.deepEqual(values.map(node=>node.textContent),['battle.png','未设置','等待出现','60,120 200×80','0.85','关闭']);
  const fields=byClass(card,'param-row-field');
  assert.deepEqual(fields.map(node=>node.attrs.x),Array(6).fill('151'));
  assert.deepEqual(fields.map(node=>node.attrs.width),Array(6).fill('97'));
  assert.deepEqual(fields.map(node=>node.attrs.height),Array(6).fill('20'));
  assert.equal(byClass(card,'param-row-rect-cell').length,0);
  const hits=byClass(card,'param-row-hit');
  assert.deepEqual(hits.map(node=>node.attrs.x),Array(6).fill('151'));
  hits[3].events.click[0]({preventDefault:()=>{},stopPropagation:()=>{},clientX:200,clientY:200});
  assert.deepEqual(calls.editors[0].rect,{x:22,y:191,width:226,height:20});
  assert.equal(calls.editors[0].valueAlign,'left');
  const tupleLayer=new Element('g');
  renderer.renderNode(tupleLayer,tupleCardNode);
  const tupleCells=byClass(tupleLayer.children[0],'param-row-cell');
  assert.deepEqual(tupleCells.map(node=>node.attrs.x),['151','201.5']);
  assert.deepEqual(tupleCells.map(node=>node.attrs.width),['46.5','46.5']);
});

test('固定卡片渲染成双行行样式：值行是可见输入框、无折叠箭头、布尔带状态文案',()=>{
  const {ctx,Element,calls,renderer}=rowHarness({nodeRowHeight:()=>40,paramRowInfo:()=>({expanded:true,total:6,hidden:0,fixed:true,twoLine:true})});
  ctx.nodeHeight=(node)=>96+(node.pins||[]).length*40;
  const layer=new Element('g');
  renderer.renderNode(layer,fixedCardNode);
  const card=layer.children[0];
  assert.equal(byClass(card,'card-body')[0].attrs.height,String(96+6*40));
  assert.equal(ctx.nodeHeight(fixedCardNode),96+6*40);
  // 六个端点按清单顺序，标签用清单里的显示名。
  assert.deepEqual(byClass(card,'param-row-label').map(node=>node.children[0].textContent),
    ['模板','超时','存在性','识别区域','匹配阈值','多尺度搜索']);
  assert.deepEqual(byClass(card,'param-row-rule').map(node=>node.attrs.y1),['96','136','176','216','256','296']);
  assert.deepEqual(byClass(card,'port-variable').map(node=>node.attrs.cy),['116','156','196','236','276','316']);
  // 标签在上、值在下，值在输入框内左对齐。
  const labels=byClass(card,'param-row-label');
  const values=byClass(card,'param-row-value');
  assert.deepEqual(labels.map(node=>node.attrs.y),['109','149','189','229','269','309']);
  assert.deepEqual(values.map(node=>node.attrs.y),['127','167','207','247','247','247','247','287','327']);
  assert.deepEqual(values.map(node=>node.attrs['text-anchor']),Array(9).fill('start'));
  // 模板只显示文件名，识别区域拆成 X / Y / W / H 四格，未配置的走定义默认值。
  assert.deepEqual(values.map(node=>node.textContent),
    ['battle.png','未设置','等待出现','60','120','200','80','0.85','关闭']);
  assert.deepEqual(byClass(card,'param-row-rect-axis').map(node=>node.textContent),['X','Y','W','H']);
  // 非布尔行把悬停提示换成完整取值；布尔行的提示就是它的状态文案。
  assert.deepEqual(values.map(node=>node.children[0].textContent),
    ['template = assets/templates/battle.png（点击选择模板图）','timeout_seconds：未设置（点击编辑）',
      '等待出现','识别区域 X = 60','识别区域 Y = 120','识别区域 W = 200','识别区域 H = 80',
      'threshold：默认值 0.85（点击编辑）','关闭'])
  assert.equal(byClass(card,'param-row-swatch').length,0);
  // 两个布尔行：勾选框在值行框内左侧，勾选的那个画对勾；框按文字光学中心对齐而不是压在基线上。
  assert.deepEqual(byClass(card,'param-row-check').map(node=>node.attrs.x),['31','31']);
  assert.deepEqual(byClass(card,'param-row-check').map(node=>node.attrs.y),['198','318']);
  assert.equal(byClass(card,'param-row-check')[0].attrs.class.includes('checked'),true);
  assert.equal(byClass(card,'param-row-check')[1].attrs.class.includes('checked'),false);
  assert.equal(byClass(card,'param-row-check-mark').length,1);
  // 每行的值都是一个可见的输入框/控件：与热区同矩形，文字在内边距处左对齐。
  const fields=byClass(card,'param-row-field');
  assert.equal(fields.length,9);
  assert.deepEqual(fields.map(node=>node.attrs.y),['115','155','195','235','235','235','235','275','315']);
  assert.deepEqual(fields.map(node=>node.attrs.height),Array(9).fill('18'));
  // 普通值框占一格（111）；识别区域横跨整行，并均分成四个 53.5px 输入框。
  assert.deepEqual(fields.map(node=>node.attrs.width),['111','111','111','53.5','53.5','53.5','53.5','111','111']);
  assert.equal(fields[0].attrs.rx,'4');
  assert.deepEqual(fields.map(node=>node.attrs.class.replace('param-row-field','').trim()),
    ['opens-picker','','','param-row-cell param-row-rect-cell opens-picker','param-row-cell param-row-rect-cell opens-picker',
      'param-row-cell param-row-rect-cell opens-picker','param-row-cell param-row-rect-cell opens-picker','','']);
  assert.deepEqual(byClass(card,'param-row-rect-cell').map(node=>node.attrs.x),['22','79.5','137','194.5']);
  // 区域已经有四个明确输入格，不再额外占空间画 ›；模板选择器仍保留提示。
  assert.equal(byClass(card,'param-row-caret').length,1);
  assert.deepEqual(byClass(card,'param-row-caret').map(node=>node.textContent),['›']);
  assert.deepEqual(byClass(card,'param-row-caret').map(node=>node.attrs.x),['124'],'› 贴在一格值框的右边缘');
  // 值文字贴在框内边距（9px）处，左对齐。
  assert.deepEqual(values.map(node=>node.attrs.x),['31','31','48','33','90.5','148','205.5','31','48']);
  assert.deepEqual(byClass(card,'param-row-rect-value').map(node=>node.attrs['font-size']),['9','9','9','9']);
  assert.deepEqual(byClass(card,'param-row-rect-value').map(node=>node.style.fontSize),['9px','9px','9px','9px']);
  // 热区就是值行框本身（标签行不再是编辑热区），每行一个。
  const hits=byClass(card,'param-row-hit');
  assert.equal(hits.length,6);
  assert.deepEqual(hits.map(node=>node.attrs.y),['115','155','195','235','275','315']);
  assert.deepEqual(hits.map(node=>node.attrs.height),['18','18','18','18','18','18']);
  assert.deepEqual(hits.map(node=>node.attrs.width),['111','111','111','226','111','111'],'区域热区覆盖四个输入格');
  assert.deepEqual(hits.map(node=>node.attrs['data-param']),
    ['template','timeout_seconds','present','roi','threshold','scale_search']);
  // 需要弹选择器的行光标是手型。
  assert.deepEqual(hits.map(node=>node.attrs.class.includes('kind-picker')),[true,false,false,true,false,false]);
  assert.equal(fields[0].events.pointerdown,undefined,'值行框本身不吃事件，命中由热区负责');
  // 资源与区域的行点开也走卡片内编辑（菜单/浮层由编辑器决定），不再直接跳详情栏。
  hits[0].events.click[0]({preventDefault:()=>{},stopPropagation:()=>{},clientX:40,clientY:110});
  hits[3].getBoundingClientRect=()=>({left:100,width:226});
  hits[3].events.click[0]({preventDefault:()=>{},stopPropagation:()=>{},clientX:245,clientY:230});
  assert.deepEqual(calls.editors.map(request=>request.pin.param),['template','roi']);
  assert.deepEqual(calls.editors.map(request=>request.inputIndex),[undefined,2],'点第三格直接聚焦 W 输入框');
  // 双行卡片的值文字在框内左对齐，浮层要按同一种对齐打开。
  assert.deepEqual(calls.editors.map(request=>request.valueAlign),['left','left']);
  assert.deepEqual(calls.editors.map(request=>request.rect),[
    {x:22,y:115,width:111,height:18},{x:22,y:235,width:226,height:18},
  ],'模板框就是一格；区域要开四个坐标输入，浮层横跨整行值区');
  assert.equal(calls.inspectors.length,0);
  // 固定卡片没有折叠箭头，摘要报出端点数量。
  assert.equal(byClass(card,'param-rows-toggle').length,0);
  assert.equal(byClass(card,'node-meta')[0].textContent,'6 项端点 · 卡片直接设置');
  // 视觉对齐：表头说明行、端点标签、值行输入框共用同一条左基准线（22），
  // 值文字在框内缩进内边距（31），标题跟在 20px 图标后单独一列（39）。
  assert.deepEqual(
    ['card-kicker','card-description','node-meta'].map(name=>byClass(card,name)[0].attrs.x),
    ['22','22','22'],'表头说明行与参数列对齐');
  assert.deepEqual(byClass(card,'param-row-label').map(node=>node.attrs.x),['22','22','22','22','22','22']);
  assert.deepEqual(fields.map(node=>node.attrs.x),['22','22','22','22','79.5','137','194.5','22','22']);
  assert.deepEqual(values.map(node=>node.attrs.x),['31','31','48','33','90.5','148','205.5','31','48']);
  assert.equal(byClass(card,'card-title')[0].attrs.x,'39');
  // 引脚仍是连线端点，类型 class 跟着参数类型走。
  assert.deepEqual(byClass(card,'port-variable').map(node=>node.attrs.class.split(' ').filter(name=>name.startsWith('type-'))[0]),
    ['type-asset','type-duration','type-boolean','type-rect','type-number','type-boolean']);
  assert.equal(byClass(card,'variable-port-hit').length,6);
  assert.equal(byClass(card,'port-out').length,1,'任务卡右侧有节点输出引用口');
  assert.equal(byClass(card,'port-out-reference')[0].attrs.cx,'248');
});

test('识别区域四格完整显示常见四位坐标，不产生省略号',()=>{
  const {ctx,Element,renderer}=rowHarness({nodeRowHeight:()=>40,paramRowInfo:()=>({expanded:true,total:6,hidden:0,fixed:true,twoLine:true})});
  ctx.nodeHeight=(node)=>96+(node.pins||[]).length*40;
  const node={
    ...fixedCardNode,
    pins:fixedCardNode.pins.map(pin=>pin.param==='roi'?{...pin,value:[1621,791,299,289]}:{...pin}),
  };
  const layer=new Element('g');
  renderer.renderNode(layer,node);
  const values=byClass(layer.children[0],'param-row-rect-value');
  assert.deepEqual(values.map(value=>value.textContent),['1621','791','299','289']);
  assert.equal(values.some(value=>value.textContent.includes('…')),false);
});


test('task categories have distinct, stable identities and reach the rendered SVG',()=>{
  const {nodeCardCategory}=require('../dist-test-renderer/canvas/render/node-card.js');
  const examples=[['vision.detect_state','vision'],['vision.match_template','vision'],['vision.wait_template','wait'],['input.tap_match','input'],['workflow.run','workflow'],['core.sleep','wait'],['core.log','utility'],['plugin.custom','custom']];
  const {ctx,Element}=harness();
  for(const [action,category] of examples) {
    const node={id:'test',type:'task',action,params:{}};
    assert.equal(nodeCardCategory(node),category);
    const layer=new Element('g');ctx.renderNode(layer,node);
    assert(layer.children[0].attrs.class.includes('category-'+category));
  }
  assert.equal(nodeCardCategory({type:'sequence'}),'control');
  const css=require('postcss').parse(fs.readFileSync(path.join(root,'node-cards.css'),'utf8'));
  const local=new Map();
  css.walkRules(rule=>{if(rule.selector==='.studio-card')rule.walkDecls(d=>local.set(d.prop,d.value));});
  for(const token of ['--card-bg','--card-head','--card-text','--card-muted','--success','--danger','--warning']) assert(local.has(token),token+' must be owned by cards, not inherited from the theme');
  // 端点按数据身份着色：未连接是中空粗环，连接后整颗填满（仍是同一个身份色）；invalid 仍覆盖成危险色。
  let configuredUsesIdentityColor=false, invalidOverrides=false;
  let hollowRing=false, thickRing=false, connectedFills=false;
  css.walkRules(rule=>{
    if(!rule.selector.includes('.port-variable'))return;
    const decls=new Map();rule.walkDecls(d=>decls.set(d.prop,d.value));
    if(/\.configured/.test(rule.selector)){configuredUsesIdentityColor=Boolean(decls.get('fill')?.includes('--data-tone')&&decls.get('stroke')?.includes('--data-tone'));}
    if(/\.invalid/.test(rule.selector))invalidOverrides=decls.get('fill')?.includes('--danger')??false;
    // 中空那一档：数据端点的基础规则（不带状态类）用卡身底色填中间，并且环要够厚。
    if(!/\.configured|\.bound|\.connected|\.invalid/.test(rule.selector)){
      if(decls.get('fill')?.includes('--card-bg'))hollowRing=true;
      if(Number(decls.get('stroke-width'))>=2)thickRing=true;
    }
    if(/\.connected/.test(rule.selector))connectedFills=Boolean(decls.get('fill')?.includes('--data-tone'));
  });
  assert(configuredUsesIdentityColor,'.configured 要用数据身份色做填充与描边');
  assert(invalidOverrides,'.invalid 仍要把端点标红');
  assert(hollowRing,'未连接的数据端点中间要中空（卡身底色）');
  assert(thickRing,'数据端点的环要厚：stroke-width 不小于 2');
  assert(connectedFills,'连出去的输出口（.connected）要整颗填满身份色');
  // 卡面跟随当前界面主题；分类色落在标题带上（否则分类看不出来）。两者都要在 .studio-card 里声明。
  assert.match(local.get('--card-bg'),/var\(--ui-panel/,'卡面底色应跟随界面主题');
  assert.match(local.get('--card-head'),/var\(--ui-surface/,'标题带底色应跟随界面主题');
  assert.match(local.get('--card-head'),/var\(--card-tint/,'标题带应带分类色，分类才看得出来');
  // 分类只能改 --card-tint：卡面与标题带由 .studio-card 统一决定，
  // 否则一屏几十张卡会各自整块跳色（配色太花）。
  let tinted=0;
  css.walkRules(rule=>{
    if(rule.selector==='.studio-card' || !rule.selector.includes('.studio-card')) return;
    if(!/\.(?:type|category)-|\.variable-card/.test(rule.selector)) return;
    if(/:root|\.card-|\.run-|\.node-|\.instance-|\.param-|\.port-/.test(rule.selector)) return;
    const decls=new Map(); rule.walkDecls(d=>decls.set(d.prop,d.value));
    assert(!decls.has('--card-bg'),rule.selector+' 不应改卡面底色');
    assert(!decls.has('--card-head'),rule.selector+' 不应改标题带底色');
    assert(decls.has('--card-tint'),rule.selector+' 应只声明分类色');
    tinted+=1;
  });
  assert(tinted>=10,'分类色规则应覆盖各节点类型与类别');
});
