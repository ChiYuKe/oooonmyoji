const {test}=require('node:test');
const assert=require('node:assert/strict');
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.parent=null;this.className='';this.events={};this.attrs={};this.style={setProperty:(k,v)=>this.style[k]=v};this.clientWidth=960;this.clientHeight=600;this.classList={add:c=>this.className+=' '+c};this.ownerDocument=global.document;}
 append(...nodes){for(const node of nodes)node.parent=this;this.children.push(...nodes);} appendChild(n){this.append(n);return n;} replaceChildren(...n){this.children=n;for(const node of n)node.parent=this;} setAttribute(k,v){this.attrs[k]=v;} remove(){const parent=this.parent;if(parent)parent.children=parent.children.filter(child=>child!==this);this.parent=null;} addEventListener(k,f){this.events[k]=f;} removeEventListener(k){delete this.events[k];}
 getBoundingClientRect(){return this.rect||{left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
 descendants(){return this.children.flatMap(n=>[n,...n.descendants()]);}
 querySelectorAll(s){return this.descendants().filter(n=>s.startsWith('.')?n.className.split(' ').includes(s.slice(1)):n.tagName===s);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;} fire(s){this.events[s]?.({preventDefault(){},stopPropagation(){}});}
}
const host=new Element('section');
const body=new Element('body');
global.document={createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),createTextNode:t=>Object.assign(new Element('text'),{textContent:t}),body,querySelector:s=>s==='#module-reference-viewer'?host:null};
global.window={requestAnimationFrame:f=>{f();return 1;},setTimeout:()=>0,clearTimeout:()=>{}};
const {createReferenceViewer,previewTextLines}=require('../dist-test-renderer/renderer/ui/reference-viewer.js');
const resource=(name,kind='asset')=>({name,path:'assets/'+name,kind,exists:true});
const graph={target:resource('<target>.json','workflow'),referencedBy:[],references:[{target:resource('one.png'),contexts:['a']},{target:resource('two.json','workflow'),contexts:['b']}]};
const previewOf=async(path)=>path.endsWith('.png')?{kind:'image',path,uri:'onmyoji-resource://project/'+path}:{kind:'text',path,text:`# ${path}\n`,truncated:false};
test('reference viewer filters resources, preserves the target and fits the graph',async()=>{
 const viewer=createReferenceViewer({getWorkbenchFrame:()=>undefined,getReferenceGraph:async()=>graph,readContentPreview:previewOf,contentName:p=>p,showToast:()=>{},errorMessage:String});
 viewer.open('target',document);await new Promise(setImmediate);
 assert.equal(host.querySelectorAll('.reference-graph-node').length,3);
 assert.equal(host.querySelectorAll('.reference-column-heading').length,3);
 assert.equal(host.querySelector('.reference-sidebar-summary').querySelector('strong').textContent,'<target>.json');
 const select=host.querySelector('select');select.value='asset';select.fire('change');
 assert.equal(host.querySelectorAll('.reference-graph-node').length,2);
 const input=host.querySelector('input');input.value='missing';input.fire('input');
 assert.equal(host.querySelectorAll('.reference-graph-node').length,1);
 assert.equal(host.querySelectorAll('.reference-column-empty').length,2);
 input.value='';input.fire('input');select.value='';select.fire('change');
 const canvas=host.querySelector('.reference-graph-canvas');canvas.clientWidth=420;canvas.clientHeight=300;
 host.querySelector('.reference-fit').fire('click');
 const zoom=Number(canvas.style['--reference-zoom']);
 assert(zoom>0&&zoom<1);assert(940*zoom<=420);assert(300*zoom<=300);
 assert.equal(host.querySelectorAll('.reference-graph-node').length,3);
 viewer.close();
});
test('画布内滚轮缩放锚定指针位置并被上下限夹住',async()=>{
 const viewer=createReferenceViewer({getWorkbenchFrame:()=>undefined,getReferenceGraph:async()=>graph,readContentPreview:previewOf,contentName:p=>p,showToast:()=>{},errorMessage:String});
 viewer.open('target',document);await new Promise(setImmediate);
 const canvas=host.querySelector('.reference-graph-canvas');
 canvas.clientWidth=420;canvas.clientHeight=300;
 canvas.rect={left:10,top:20,width:420,height:300};
 host.querySelector('.reference-fit').fire('click');
 const fitted=Number(canvas.style['--reference-zoom']);
 const fittedPanX=parseFloat(canvas.style['--reference-pan-x']);
 const fittedPanY=parseFloat(canvas.style['--reference-pan-y']);
 assert(fitted>0&&fitted<1);
 let prevented=false;
 const wheel=(deltaY,deltaMode=0)=>{prevented=false;canvas.events.wheel({deltaY,deltaMode,clientX:110,clientY:120,preventDefault(){prevented=true;}});return prevented;};
 // 向上滚放大，并且指针下的图形坐标保持不动（画布局部坐标 = 110-10, 120-20）。
 assert.equal(wheel(-100),true,'滚轮缩放要吃掉默认滚动');
 const zoomed=Number(canvas.style['--reference-zoom']);
 assert(zoomed>fitted);
 const ratio=zoomed/fitted,ax=100,ay=100;
 assert(Math.abs(parseFloat(canvas.style['--reference-pan-x'])-(ax-ratio*(ax-fittedPanX)))<1e-6);
 assert(Math.abs(parseFloat(canvas.style['--reference-pan-y'])-(ay-ratio*(ay-fittedPanY)))<1e-6);
 // 行模式滚轮同样生效（deltaMode=1 会换算成像素）。
 const beforeLine=Number(canvas.style['--reference-zoom']);
 wheel(-3,1);
 assert(Number(canvas.style['--reference-zoom'])>beforeLine);
 // 连续滚动夹在 20%–160%。
 for(let i=0;i<60;i++)wheel(100);
 assert.equal(Number(canvas.style['--reference-zoom']),0.2);
 for(let i=0;i<80;i++)wheel(-100);
 assert.equal(Number(canvas.style['--reference-zoom']),1.6);
 viewer.close();
});
/** 悬停浮窗的定时器被测试接管：只收集待弹的预览，不让它真的延时。 */
function capturePreviewTimers(){const timers=[];const real=global.window.setTimeout;global.window.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length;};return {timers,restore:()=>{global.window.setTimeout=real;}};}
test('悬停资源卡片弹内容浮窗：图片显示图片、文本按行截断',async()=>{
 const requests=[];
 const viewer=createReferenceViewer({getWorkbenchFrame:()=>undefined,getReferenceGraph:async()=>graph,readContentPreview:async(path)=>{requests.push(path);return path.endsWith('.png')?{kind:'image',path,uri:'onmyoji-resource://project/'+path}:{kind:'text',path,text:Array.from({length:60},(_,i)=>'line '+i).join('\n'),truncated:false};},contentName:p=>p,showToast:()=>{},errorMessage:String});
 viewer.open('target',document);await new Promise(setImmediate);
 const {timers,restore}=capturePreviewTimers();
 try{
  const nodes=host.querySelectorAll('.reference-graph-node');
  const asset=nodes.find(n=>n.className.includes('kind-asset'));
  const workflow=nodes.find(n=>n.className.includes('kind-workflow')&&!n.className.includes('target'));
  assert.equal(asset.title,undefined,'卡片不再挂原生 title，路径与提示都放进浮窗');
  // 悬停要等一小会儿才弹，期间不发起读取。
  asset.fire('mouseenter');
  assert.equal(requests.length,0);
  assert.equal(timers.length,1);
  assert(timers[0].delay>0,'先延时再弹，鼠标扫过时不闪');
  timers[0].fn();await new Promise(setImmediate);
  assert.deepEqual(requests,['assets/one.png']);
  const preview=body.querySelector('.reference-hover-preview');
  assert.ok(preview,'悬停后要挂出浮窗');
  assert.equal(preview.querySelector('img').src,'onmyoji-resource://project/assets/one.png');
  assert.equal(preview.querySelector('.reference-hover-preview-path').textContent,'assets/one.png');
  assert.equal(preview.querySelector('.reference-hover-preview-hint').textContent,'点击卡片可继续追踪该资源的引用');
  // 移开就收起。
  asset.fire('mouseleave');
  assert.equal(body.querySelector('.reference-hover-preview'),null);
  // 文本（工作流 / 目录）：只显示前 26 行，并注明还有没显示出来的内容。
  workflow.fire('mouseenter');
  timers[1].fn();await new Promise(setImmediate);
  const text=body.querySelector('.reference-hover-preview').querySelector('pre');
  assert.equal(text.textContent.split('\n').length,26);
  assert.match(text.textContent,/^line 0/);
  assert.equal(body.querySelector('.reference-hover-preview-note').textContent,'内容较长，仅预览开头部分');
  workflow.fire('mouseleave');
  assert.equal(body.querySelector('.reference-hover-preview'),null);
 }finally{restore();}
 viewer.close();
});
test('悬停浮窗落在途结果作废：移开后到达的响应不再弹出',async()=>{
 const pending=new Map();
 const viewer=createReferenceViewer({getWorkbenchFrame:()=>undefined,getReferenceGraph:async()=>graph,readContentPreview:(path)=>new Promise((resolve)=>pending.set(path,resolve)),contentName:p=>p,showToast:()=>{},errorMessage:String});
 viewer.open('target',document);await new Promise(setImmediate);
 const {timers,restore}=capturePreviewTimers();
 try{
  const asset=host.querySelectorAll('.reference-graph-node').find(n=>n.className.includes('kind-asset'));
  asset.fire('mouseenter');
  timers[0].fn();
  assert.deepEqual([...pending.keys()],['assets/one.png']);
  asset.fire('mouseleave');
  pending.get('assets/one.png')({kind:'image',path:'assets/one.png',uri:'onmyoji-resource://project/assets/one.png'});
  await new Promise(setImmediate);
  assert.equal(body.querySelector('.reference-hover-preview'),null,'鼠标已经移开，迟到的响应不能再弹窗');
 }finally{restore();}
 viewer.close();
});
test('文本预览按行数与单行宽度截断',()=>{
 const {lines,truncated}=previewTextLines(['第一行','b'.repeat(20),'第三行'].join('\n'),2,8);
 assert.deepEqual(lines,['第一行','bbbbbbbb…']);
 assert.equal(truncated,true);
 assert.deepEqual(previewTextLines('甲\n乙\n\n'),{lines:['甲','乙'],truncated:false},'尾部空行不算内容');
});
