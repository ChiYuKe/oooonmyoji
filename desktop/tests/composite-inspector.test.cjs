// Run via npm test (builds the renderer test output first).
// 复合节点详情已迁到 src/canvas/inspector/composite-inspector.ts：用假依赖实例化编译产物。
// 值卡片（布尔判断 / 拆分）的内容编辑器在 value-card-fields.ts（画布浮动编辑器共用）。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness} = require('./helpers/composite-harness.cjs');
const {renderBoolJudgeFields, renderBreakFields} = require('../dist-test-renderer/canvas/inspector/value-card-fields.js');

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
const tree=(node,out=[])=>{out.push(node);for(const c of node.children||[])if(c&&typeof c==='object')tree(c,out);return out;};
const byClass=(node,name)=>tree(node).filter(x=>String(x.className||'').split(' ').includes(name));

test('判断节点上方给出中文回读，条件本身交给共用的结构化控件',()=>{
  const h=harness();
  const node={id:'judge',type:'condition',expression:{or:[{eq:[{ref:'nodes.a.output.state'},'x']}]}};
  h.inspector.renderCompositeInspector(h.body,node);

  // 回读整句是给新手的保险：读得通才敢点保存。
  const readback=byClass(h.body,'condition-readback');
  assert.equal(readback.length,1);
  assert.equal(readback[0].textContent,'当 条件成立 时执行');

  // 条件不带 JSON 兜底，也不在面板里再维护一份比较表达式：编辑统一走左侧布尔端口。
  assert.equal(tree(h.body).some(x=>x.tag==='textarea'),false);
  assert.equal(byClass(h.body,'condition-input-readonly').length,1);
});

test('条件解释不了时不画回读行，而不是显示一句可能错的说明',()=>{
  const h=harness();
  const node={id:'judge',type:'condition',expression:undefined};
  h.inspector.renderCompositeInspector(h.body,node);
  assert.equal(byClass(h.body,'condition-readback').length,0);
});

test('布尔判断卡片：只编辑条件表达式，给出回读与输出引用，不画子节点槽位',()=>{
  const h=harness();
  const node={id:'bool_1',type:'bool_judge',expression:{eq:[{ref:'nodes.a.output.state'},'x']}};
  renderBoolJudgeFields(h.body,node,h.deps);

  // 卡片就是「算一个 bool」：条件表达式是唯一编辑对象。
  assert.equal(byClass(h.body,'condition-control').length,1);
  assert.equal(tree(h.body).some(x=>x.tag==='textarea'),false);
  assert.equal(byClass(h.body,'condition-readback')[0].textContent,'当 条件成立 时为真');
  assert.equal(byClass(h.body,'field-hint')[0].textContent,'输出引用：nodes.bool_1.output.value');
  // 叶子卡片没有分支槽位，也没有子节点列表。
  assert.equal(byClass(h.body,'condition-slot').length,0);
  assert.equal(byClass(h.body,'child-row').length,0);
});

test('布尔判断卡片没配条件时补一个可编辑的默认表达式，回读行不瞎说',()=>{
  const h=harness();
  const node={id:'bool_2',type:'bool_judge'};
  renderBoolJudgeFields(h.body,node,h.deps);
  assert.equal(byClass(h.body,'condition-control').length,1);
  assert.equal(byClass(h.body,'condition-readback').length,0);
});

test('拆分卡片进阶编辑器：字段列表落在顶层 fields 上，来源只做回读',()=>{
  const h=harness();
  const node={id:'split_1',type:'break',ref:{ref:'nodes.a.output.matched'},fields:{目标点:'0.point'}};
  renderBreakFields(h.body,node,h.deps);

  // 来源不可在这里改（UE 里结构体走节点菜单）：只有回读提示。
  assert.equal(byClass(h.body,'field-hint')[0].textContent,'拆分来源：nodes.a.output.matched（右键卡片可更改）');

  // 字段名与来源路径分别编辑 fields 的键和值。
  const inputs=tree(h.body).filter(x=>x.tag==='input');
  assert.equal(inputs.length,2);
  assert.equal(inputs[0].value,'目标点');
  inputs[0].onChange('位置');
  assert.deepEqual(node.fields,{位置:'0.point'});
  inputs[1].onChange('0.point.x');
  assert.deepEqual(node.fields,{位置:'0.point.x'});

  // 添加字段补一个不冲突的默认名（测试基座不会自动重渲染，DOM 里仍只有一行）。
  tree(h.body).find(x=>x.tag==='button'&&x.textContent==='添加字段').onClick();
  assert.deepEqual(node.fields,{位置:'0.point.x',field_1:''});

  // 重渲染后两行各有一个删除按钮；两行都删掉时整体移除 fields。
  const rerendered=h.el('div');
  renderBreakFields(rerendered,node,h.deps);
  const removes=tree(rerendered).filter(x=>String(x.className||'').includes('object-array-remove'));
  assert.equal(removes.length,2);
  removes[1].fire('click');
  assert.deepEqual(node.fields,{位置:'0.point.x'});
  removes[0].fire('click');
  assert.equal(node.fields,undefined);
  assert.equal(byClass(rerendered,'field-hint').some(x=>x.textContent.startsWith('来源路径')),true);
});

test('拆分卡片未绑来源且未写字段时，提示镜像来源而不是瞎编字段',()=>{
  const h=harness();
  const node={id:'split_2',type:'break'};
  renderBreakFields(h.body,node,h.deps);
  assert.equal(byClass(h.body,'section-header')[0].textContent,'拆分字段（未设置 · 输出镜像来源）');
  assert.equal(byClass(h.body,'field-hint')[0].textContent,'未绑定来源：把来源卡片的输出口拖到「拆分来源」行，或右键卡片选择来源');
});

test('组合详情不再为值卡片渲染内容：它们的内容编辑器已搬到卡片上',()=>{
  const h=harness();
  for (const node of [{id:'bool_3',type:'bool_judge'},{id:'split_3',type:'break'}]) {
    h.inspector.renderCompositeInspector(h.body,node);
    assert.equal(byClass(h.body,'condition-control').length,0,`${node.type} 不该在详情面板里渲染条件控件`);
    assert.equal(tree(h.body).some(x=>String(x.className||'').includes('object-array-card')),false,`${node.type} 不该在详情面板里渲染字段列表`);
  }
});
