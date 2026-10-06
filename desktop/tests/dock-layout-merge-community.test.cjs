const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeCommunityComparisonLayout } = require('../dist-test-renderer/renderer/shell/docking/layout.js');
const source = 'soulCommunityComparison', target = 'soulOptimizer';
const leaf = (id, views, activeView = views[0]) => ({ type: 'leaf', data: { id, views, activeView }, size: 500 });
const layout = (...groups) => ({ grid: { root: {type: 'branch', data: groups}, width: 1000, height: 700, orientation: 'HORIZONTAL' }, panels: { [target]: {id: target}, [source]: {id: source} } });
test('old separate community column disappears and active view moves to the optimizer', () => {
  const value = layout(leaf('1', ['workflow', target], target), leaf('2', [source])); value.activeGroup = '2';
  assert.equal(mergeCommunityComparisonLayout(value), true);
  assert.deepEqual(value.grid.root.data, [leaf('1', ['workflow', target], target)]);
  assert.equal(value.grid.root.type, 'branch'); assert.equal(value.activeGroup, '1');
  assert.equal(value.panels[source], undefined); assert.deepEqual(value.panels[target], {id: target});
  const once = JSON.stringify(value); assert.equal(mergeCommunityComparisonLayout(value), false); assert.equal(JSON.stringify(value), once);
});
test('community-only layouts recover as the optimizer with canonical module parameters', () => {
  const value = layout(leaf('1', ['workflow'], 'workflow'), leaf('2', [source])); delete value.panels[target];
  mergeCommunityComparisonLayout(value);
  assert.deepEqual(value.grid.root.data[1].data.views, [target]); assert.equal(value.grid.root.data[1].data.activeView, target);
  assert.equal(value.panels[target].id, target); assert.equal(value.panels[target].params.moduleElementId, 'module-soul-optimizer');
  assert.equal(value.panels[target].title, '御魂配装');
});
test('shared tab groups retain unrelated tabs and their active selection', () => {
  const value = layout(leaf('1', ['workflow', target, source, 'settings'], 'settings'));
  mergeCommunityComparisonLayout(value);
  assert.deepEqual(value.grid.root.data[0].data.views, ['workflow', target, 'settings']);
  assert.equal(value.grid.root.data[0].data.activeView, 'settings');
});
test('floating and popped out community groups are removed without closing other windows', () => {
  const value = layout(leaf('1', ['workflow', target]));
  value.floatingGroups = [{data: {id:'2', views:[source], activeView:source}, position: {left:1}}, {data: {id:'3', views:['settings'], activeView:'settings'}, position:{left:2}}];
  value.popoutGroups = [{grid:{root:{type:'branch',data:[leaf('4',[source])]}},url:'popout.html'}, {data:{id:'5',views:['runtime',source],activeView:'runtime'},position:{left:30}}];
  mergeCommunityComparisonLayout(value);
  assert.equal(value.floatingGroups.length, 1); assert.deepEqual(value.floatingGroups[0].data.views, ['settings']);
  assert.equal(value.popoutGroups.length, 1); assert.deepEqual(value.popoutGroups[0].data.views, ['runtime']); assert.equal(value.popoutGroups[0].data.activeView, 'runtime');
});
test('closed community pages do not add a new optimizer or alter other layouts', () => {
  const value = layout(leaf('1',['workflow','settings'])); delete value.panels[source]; delete value.panels[target];
  const before=JSON.stringify(value); assert.equal(mergeCommunityComparisonLayout(value),false); assert.equal(JSON.stringify(value),before);
  for(const invalid of [null,undefined,42,'bad',{}]) assert.doesNotThrow(()=>mergeCommunityComparisonLayout(invalid));
});
