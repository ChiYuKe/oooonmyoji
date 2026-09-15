const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/legacy/editor-composite-inspector.js'),'utf8');
function harness() {
  const el=(tag,className='',textContent='')=>({tag,className,textContent,children:[],events:{},setAttribute(){},appendChild(child){this.children.push(child);},addEventListener(name,fn){this.events[name]=fn;}});
  const ctx=vm.createContext({el,mutate:fn=>fn(),section:(body,title)=>body.appendChild(el('h3','section-header',title)),
    textInput:(value,onChange)=>({...el('input'),value,onChange}),decoratorLabel:d=>d.type,
    decoratorParameterControl:(_node,_decorator,_key,control)=>({children:[el('div','decorator-param-actions'),control]}),
    retryPublicActions:()=>el('div','decorator-param-actions'),
    nodeById:id=>({name:`节点 ${id}`}),disconnect:(parent,id)=>ctx.disconnected=[parent,id],repeatDecoratorControl:()=>el('div','repeat-decorator-control')});
  for(const name of ['decoratorField','decoratorVectorField','renderDecorator','renderCompositeInspector']) {
    const start=source.indexOf(`  function ${name}(`);vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),ctx);
  }
  return {ctx,body:el('div')};
}
test('retry fields have visible labels and preserve numeric edit and removal callbacks',()=>{
  const {ctx,body}=harness();const decorator={type:'retry',attempts:2,delay_seconds:0},node={decorators:[decorator]};
  ctx.renderDecorator(body,node,decorator,0);
  const block=body.children[0],fields=block.children[1].children;
  assert.equal(fields[0].children[0].children[0].textContent,'次数');assert.equal(fields[1].children[0].children[0].textContent,'间隔·秒');
  assert.equal(fields[1].children[0].children[1].value,0);
  fields[0].children[0].children[1].onChange('4');fields[1].children[0].children[1].onChange('0.5');
  assert.equal(decorator.attempts,4);assert.equal(decorator.delay_seconds,.5);
  block.children[0].children[2].children.at(-1).events.click();assert.equal(node.decorators.length,0);
});
test('sequence child list preserves row order, boundary buttons and disconnect semantics',()=>{
  const {ctx,body}=harness();const node={id:'root',type:'sequence',children:['a','b']};
  ctx.renderCompositeInspector(body,node);
  const headers=body.children.filter(x=>x.className==='section-header');assert.equal(headers.length,1);assert.equal(headers[0].textContent,'子节点 · 2');
  const rows=body.children.filter(x=>x.className==='child-row');assert.equal(rows.length,2);
  assert.equal(rows[0].children[2].disabled,true);assert.equal(rows[1].children[3].disabled,true);
  rows[0].children[3].events.click();assert.deepEqual(node.children,['b','a']);
  rows[1].children[4].events.click();assert.deepEqual(Array.from(ctx.disconnected),['root','b']);
  assert(rows[0].children[1].title.includes('a'));
});
