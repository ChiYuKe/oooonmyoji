const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {renderOverviewCard}=require('../dist-test-renderer/renderer/overview/card.js');

function setup(locked=false){
 class E {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};this.attrs={};}
  append(...children){this.children.push(...children);}
  appendChild(child){this.append(child);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,v){this.events[k]=v;}
 }
 const calls=[];
 const deps={
  document:{createElement:t=>new E(t)},
  selectedIndex:()=>-1,
  isRunning:()=>locked,
  runItem:()=>null,
  workflowName:w=>w.name,
  workflowKind:()=> '工作流',
  workflowValidation:()=>({className:'valid',label:'已校验',title:'校验通过'}),
  workflowUpdated:()=> '更新 09/14 03:30',
  configuredInputs:()=>false,
  statusLabel:()=> '未选择',
  updateSelection:(...a)=>calls.push(['select',...a]),
  openConfiguration:()=>calls.push(['configure']),
  openWorkflow:()=>calls.push(['open']),
 };
 return {card:renderOverviewCard(deps,{rel:'workflows/example.json',name:'很长的脚本名',description:'说明',inputs:[],updatedAt:1}),calls};
}
test('overview separates metadata from actions and retains callbacks',()=>{
 const {card,calls}=setup();
 assert.deepEqual(card.children.map(x=>x.className),['overview-card-header','overview-card-description','overview-card-metadata','overview-card-footer']);
 const meta=card.children[2],footer=card.children[3];
 assert.equal(meta.children.length,4);
 assert.equal(footer.children[1].className,'overview-card-actions');
 const [config,open]=footer.children[1].children;
 config.events.click({stopPropagation(){}});open.events.click({stopPropagation(){}});
 assert.deepEqual(calls,[['configure'],['open']]);
 card.events.keydown({target:config,key:'Enter',preventDefault(){throw Error('nested button intercepted');}});
 card.events.keydown({target:card,key:' ',preventDefault(){}});
 assert.equal(calls[2][0],'select');
});
test('running queue still locks selection and configuration',()=>{
 const {card,calls}=setup(true);
 assert.equal(card.tabIndex,-1);assert.equal(card.children[0].children[0].disabled,true);
 assert.equal(card.children[3].children[1].children[0].disabled,true);
 card.events.keydown({target:card,key:'Enter',preventDefault(){}});
 assert.deepEqual(calls,[]);
});
test('overview prevents narrow vertical labels and removes selection glow',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../src/renderer/styles.css'),'utf8');
 assert.match(css,/\.overview-card-metadata\s*\{[^}]*flex-wrap: wrap/);
 assert.match(css,/\.overview-card-tag\s*\{[^}]*white-space: nowrap/);
 assert.match(css,/\.overview-card-actions\s*\{[^}]*flex: 0 0 auto/);
 assert.match(css,/@container \(max-width: 760px\)/);
 const rules=css.match(/\.overview-card\.(?:selected|running|succeeded|failed)\s*\{[^}]*\}/g)||[];
 for(const rule of rules)assert.doesNotMatch(rule,/box-shadow|border-color/);
});
