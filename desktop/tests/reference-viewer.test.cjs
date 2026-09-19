const {test}=require('node:test');
const assert=require('node:assert/strict');
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.className='';this.events={};this.attrs={};this.style={setProperty:(k,v)=>this.style[k]=v};this.clientWidth=960;this.clientHeight=600;this.classList={add:c=>this.className+=' '+c};this.ownerDocument=global.document;}
 append(...nodes){this.children.push(...nodes);} appendChild(n){this.append(n);return n;} replaceChildren(...n){this.children=n;} setAttribute(k,v){this.attrs[k]=v;} remove(){} addEventListener(k,f){this.events[k]=f;} removeEventListener(k){delete this.events[k];}
 getBoundingClientRect(){return this.rect||{left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
 descendants(){return this.children.flatMap(n=>[n,...n.descendants()]);}
 querySelectorAll(s){return this.descendants().filter(n=>s.startsWith('.')?n.className.split(' ').includes(s.slice(1)):n.tagName===s);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;} fire(s){this.events[s]?.({preventDefault(){},stopPropagation(){}});}
}
const host=new Element('section');
global.document={createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),createTextNode:t=>Object.assign(new Element('text'),{textContent:t}),querySelector:s=>s==='#module-reference-viewer'?host:null};
global.window={requestAnimationFrame:f=>{f();return 1;},setTimeout:()=>0};
const {createReferenceViewer}=require('../dist-test-renderer/renderer/reference-viewer.js');
const resource=(name,kind='asset')=>({name,path:'assets/'+name,kind,exists:true});
const graph={target:resource('<target>.json','workflow'),referencedBy:[],references:[{target:resource('one.png'),contexts:['a']},{target:resource('two.json','workflow'),contexts:['b']}]};
test('reference viewer filters resources, preserves the target and fits the graph',async()=>{
 const viewer=createReferenceViewer({getWorkbenchFrame:()=>undefined,getReferenceGraph:async()=>graph,contentName:p=>p,showToast:()=>{},errorMessage:String});
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
 const viewer=createReferenceViewer({getWorkbenchFrame:()=>undefined,getReferenceGraph:async()=>graph,contentName:p=>p,showToast:()=>{},errorMessage:String});
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
