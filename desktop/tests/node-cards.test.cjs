const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../public/legacy');
function harness() {
  class Element {
    constructor(tag){this.tag=tag;this.attrs={};this.children=[];this.dataset={};this.events={};this.style={};}
    setAttribute(k,v){this.attrs[k]=String(v);}
    appendChild(node){this.children.push(node);return node;}
    addEventListener(k,fn){(this.events[k] ||= []).push(fn);}
    querySelectorAll(tag){return this.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...c.querySelectorAll(tag)]);}
  }
  const svgEl=(tag,attrs,parent)=>{const node=new Element(tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);parent?.appendChild(node);return node;};
  const ctx=vm.createContext({window:{},document:{createElementNS:(_,tag)=>new Element(tag)},svgEl,console});
  vm.runInContext(fs.readFileSync(path.join(root,'node-cards.js'),'utf8'),ctx);ctx.NodeCards=ctx.window.NodeCards;
  const source=fs.readFileSync(path.join(root,'workflow-editor.js'),'utf8');
  // Use the real geometry constants and height formula, not a copy of the layout.
  for(const name of ['NODE_W','BASE_H','DECO_H','PORT_R','RUN_CARD_W','RUN_CARD_BASE_H','RUN_VARIABLE_H','VARIABLE_CARD_W','VARIABLE_CARD_H','VARIABLE_CARD_PORT_Y','VARIABLE_PIN_X']) {
    vm.runInContext(source.match(new RegExp(`  const ${name} = [^;]+;`))[0],ctx);
  }
  ctx.nodeVariablePins=node=>node.pins || [];
  vm.runInContext(source.slice(source.indexOf('  const nodeHeight ='),source.indexOf(';',source.indexOf('  const nodeHeight ='))+1),ctx);
  for(const name of ['nodeCardSummary','compactValue','workflowInputVariableValue','variableValueSummary','renderNode','renderInstanceRunCard','renderVariableCard']) {
    const start=source.indexOf(`  function ${name}(`); vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),ctx);
  }
  Object.assign(ctx,{state:{run:new Map(),selected:new Set(),raw:{inputs:{count:{type:'integer',default:0}}}},position:()=>({x:0,y:0}),subWorkflowRef:()=>null,templatePreview:()=>null,
    TYPE_NAMES:{task:'任务',sequence:'顺序',root:'根节点'},TYPE_ICON:{task:'□',sequence:'→'},RUN_LABEL:{succeeded:'已完成'},compositeSubtitle:()=> '执行子节点',decoratorLabel:()=> 'Retry · 3 次'});
  return {ctx,Element,svgEl};
}
const byClass=(element,name)=>element.children.filter(c=>(c.attrs.class || '').split(' ').includes(name));
test('card text width budgets preserve CJK, emoji, zero and complete hover text',()=>{
  const {ctx,Element}=harness();const UI=ctx.NodeCards;
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
  const variable={name:'运行轮数',definition:{type:'integer',default:0}};
  ctx.renderInstanceRunCard(layer,{node:{id:'multi'},key:'multi:0',index:0,x:0,y:0,height:102,run:{instance:'mumu-1',workflow:'sample.json',inputs:{运行轮数:full}},variables:[variable]});
  const card=layer.children[0];assert.equal(byClass(card,'card-body')[0].attrs.width,'250');
  assert.equal(byClass(card,'instance-variable-pin')[0].attrs.cy,'90');
  assert.equal(byClass(card,'instance-variable-value')[0].children[0].textContent,full);
  ctx.renderVariableCard(layer,{name:'count',scope:'inputs',id:'count',x:0,y:0});const source=layer.children[1];
  assert.equal(byClass(source,'card-body')[0].attrs.width,'168');assert.equal(byClass(source,'card-body')[0].attrs.height,'58');
  assert.equal(byClass(source,'port-variable-out')[0].attrs.cy,'29');
  assert.equal(byClass(source,'variable-card-value')[0].textContent,'0');
});
test('summary preserves zero settings; shared styling covers both themes without glow',()=>{
  const {ctx}=harness();assert.equal(ctx.nodeCardSummary({type:'task',params:{timeout_seconds:0,threshold:0,present:false}}),'等待消失 · 超时 0s · 阈值 0%');
  assert.match(ctx.nodeCardSummary({type:'parallel'}),/并行/);
  const css=fs.readFileSync(path.join(root,'node-cards.css'),'utf8');require('postcss').parse(css);
  assert.match(css,/:root\[data-theme="light"\]/);assert.match(css,/filter: none/);assert.doesNotMatch(css,/drop-shadow|brightness|box-shadow/);
  const html=fs.readFileSync(path.join(root,'editor-frame.html'),'utf8');assert(html.indexOf('./node-cards.js')<html.indexOf('./workflow-editor.js'));
  assert(html.indexOf('./node-cards.css')>html.indexOf('/theme/theme.css'));
});
