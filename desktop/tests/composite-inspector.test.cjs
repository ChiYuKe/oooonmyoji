// Run via npm test (builds the renderer test output first).
// 复合节点详情已迁到 src/canvas/inspector/composite-inspector.ts：用假依赖实例化编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness} = require('./helpers/composite-harness.cjs');

test('retry fields have visible labels and preserve numeric edit and removal callbacks',()=>{
  const h=harness();const decorator={type:'retry',attempts:2,delay_seconds:0},node={decorators:[decorator]};
  h.inspector.renderDecorator(h.body,node,decorator,0);
  const block=h.body.children[0],fields=block.children[1].children;
  assert.equal(fields[0].children[0].children[0].textContent,'次数');assert.equal(fields[1].children[0].children[0].textContent,'间隔·秒');
  assert.equal(fields[1].children[0].children[1].value,0);
  fields[0].children[0].children[1].onChange('4');fields[1].children[0].children[1].onChange('0.5');
  assert.equal(decorator.attempts,4);assert.equal(decorator.delay_seconds,.5);
  block.children[0].children[2].children.at(-1).events.click();assert.equal(node.decorators.length,0);
});
test('sequence child list preserves row order, boundary buttons and disconnect semantics',()=>{
  const h=harness();const node={id:'root',type:'sequence',children:['a','b']};
  h.inspector.renderCompositeInspector(h.body,node);
  const headers=h.body.children.filter(x=>x.className==='section-header');assert.equal(headers.length,1);assert.equal(headers[0].textContent,'子节点 · 2');
  const rows=h.body.children.filter(x=>x.className==='child-row');assert.equal(rows.length,2);
  assert.equal(rows[0].children[2].disabled,true);assert.equal(rows[1].children[3].disabled,true);
  rows[0].children[3].events.click();assert.deepEqual(node.children,['b','a']);
  rows[1].children[4].events.click();assert.deepEqual(Array.from(h.deps.disconnected),['root','b']);
  assert(rows[0].children[1].title.includes('a'));
});
