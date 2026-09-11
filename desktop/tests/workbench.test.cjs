const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');

function modeHarness() {
  const source = read('public/legacy/workflow-editor.js');
  const ctx = vm.createContext({clone: value => JSON.parse(JSON.stringify(value))});
  vm.runInContext('const publicInputModeCache = new WeakMap();', ctx);
  for (const name of ['defaultValue', 'changePublicInputMode']) {
    const start = source.indexOf(`  function ${name}(`);
    assert(start >= 0);
    vm.runInContext(source.slice(start, source.indexOf('\n  }', start) + 4), ctx);
  }
  return ctx.changePublicInputMode;
}

test('public input modes preserve literals and selected references through default mode', () => {
  const change = modeHarness();
  const refs = ['inputs.first', 'inputs.second'];
  for (const value of [6, 0, false, '', null, [1, 2, 30, 40], {nested: [0, false]}]) {
    const holder = {inputs: {value}};
    change(holder, 'value', {type: 'number'}, 'binding', refs);
    holder.inputs.value.ref = refs[1];
    change(holder, 'value', {}, 'default', refs);
    assert.equal(Object.hasOwn(holder.inputs, 'value'), false);
    change(holder, 'value', {}, 'literal', refs);
    assert.deepEqual(holder.inputs.value, value);
    change(holder, 'value', {}, 'binding', refs);
    assert.equal(holder.inputs.value.ref, refs[1]);
    assert.equal(JSON.stringify(holder), '{"inputs":{"value":{"ref":"inputs.second"}}}');
  }
});

test('input caches are isolated by input object and variable; defaults are cloned', () => {
  const change = modeHarness();
  const first = {inputs: {a: 6, b: 9}}, second = {inputs: {a: 42}};
  for (const holder of [first, second]) change(holder, 'a', {}, 'default', []);
  change(first, 'b', {}, 'default', []);
  change(first, 'a', {}, 'literal', []); change(first, 'b', {}, 'literal', []);
  change(second, 'a', {}, 'literal', []);
  assert.deepEqual(first.inputs, {a: 6, b: 9}); assert.equal(second.inputs.a, 42);
  first.inputs = {};
  const definition = {default: [0, false]};
  change(first, 'a', definition, 'literal', []);
  assert.deepEqual(first.inputs.a, definition.default);
  first.inputs.a.push(3); assert.deepEqual(definition.default, [0, false]);
});

test('unavailable references and repeated choices do not reset a value', () => {
  const change = modeHarness(), holder = {inputs: {a: 6}};
  for (const next of ['literal', 'binding', 'invalid']) change(holder, 'a', {}, next, []);
  assert.equal(holder.inputs.a, 6);
  change(holder, 'a', {}, 'binding', ['inputs.old']);
  change(holder, 'a', {}, 'literal', []);
  change(holder, 'a', {}, 'binding', ['inputs.new']);
  assert.equal(holder.inputs.a.ref, 'inputs.new');
});

test('toolbar menus support initial up/down, wrapping, escape and outside dismissal', () => {
  let focused;
  const item = () => ({focus() { focused = this; }});
  const trigger = item(), entries = [item(), item(), item()], events = {}, docEvents = {};
  const menu = {open: false, querySelector: () => trigger, querySelectorAll: () => entries,
    addEventListener: (name, fn) => {events[name] = fn;}, contains: target => target === trigger || entries.includes(target)};
  const document = {querySelectorAll: () => [menu], addEventListener: (name, fn) => {docEvents[name] = fn;}};
  vm.runInNewContext(read('public/workbench/workbench.js'), {document});
  const key = (key, target = trigger) => events.keydown({key, target, preventDefault() {}});
  key('ArrowUp'); assert.equal(focused, entries[2]); assert.equal(menu.open, true);
  key('ArrowDown', focused); assert.equal(focused, entries[0]);
  key('End'); assert.equal(focused, entries[2]); key('Home'); assert.equal(focused, entries[0]);
  key('Escape', focused); assert.equal(menu.open, false); assert.equal(focused, trigger);
  key('ArrowDown'); assert.equal(focused, entries[0]);
  events.focusout({relatedTarget: {}}); assert.equal(menu.open, false);
  menu.open = true; docEvents.pointerdown({target: {}}); assert.equal(menu.open, false);
});

test('toolbar keeps existing commands and shared compositions parse', () => {
  const html = read('src/renderer/index.html');
  const strip = html.slice(html.indexOf('<div class="tool-strip"'), html.indexOf('<div class="dock-workspace-shell"'));
  for (const command of ['addTask','addSequence','addSelector','addParallel','addGenericParallel','addRepeatUntil','addBranch','addSwitch','addInstanceParallel','autoLayout','fitView','exportImage','workflowSettings']) {
    assert.equal(strip.split(`data-editor-command="${command}"`).length - 1, 1, command);
  }
  for (const id of ['run-button','stop-button','save-button','more-button','instance-select']) assert(strip.includes(`id="${id}"`));
  for (const file of ['public/workbench/workbench.css', 'public/legacy/inspector.css']) require('postcss').parse(read(file));
  const palette = read('public/legacy/ui.css') + read('public/theme/theme.css');
  for (const [, token] of read('public/workbench/workbench.css').matchAll(/var\((--ui-[\w-]+)\)/g)) assert(palette.includes(`${token}:`), token);
  assert(read('src/renderer/popout.html').includes('/workbench/workbench.css'));
});

test('content browser grouping preserves item instances, draft editing and flat list mode', () => {
  const source = read('src/renderer/main.ts');
  const start = source.indexOf('function renderContentBrowser(): void {');
  const js = require('node:module').stripTypeScriptTypes(source.slice(start, source.indexOf('\n}\n', start) + 2));
  const element = () => ({children: [], classList: {toggle() {}}, setAttribute() {},
    append(...children) {this.children.push(...children);}, appendChild(child) {this.children.push(child);},
    replaceChildren(...children) {this.children = children;}});
  const container = element(), created = [];
  const entries = [{kind:'asset',name:'template',path:'template.png'}, {kind:'workflow',name:'main',path:'main.json'}, {kind:'folder',name:'assets',path:'assets'}];
  const ctx = vm.createContext({contentFolders: () => [''], contentBrowserFolder: '', contentBrowserQuery: '',
    renderContentBrowserTree() {}, renderContentBrowserBreadcrumbs() {}, contentBrowserEntries: () => [...entries],
    contentFolderDraft: {parentPath:'',name:'新建文件夹'}, contentBrowserItems:container, contentBrowserView:'grid', selectedContentPath:'',
    createContentItem(item, draft) { const result = {...element(), item, draft}; created.push(result); return result; },
    document: {createElement: element, querySelector: element, querySelectorAll: () => []}, createIcons() {}, desktopIcons: {}});
  vm.runInContext(js, ctx); ctx.renderContentBrowser();
  assert.deepEqual(container.children.map(group => group.children[0].textContent), ['文件夹 · 2','工作流 · 1','模板图片 · 1']);
  assert.equal(container.children[0].children[1].children[0], created[0]);
  assert.equal(created[0].draft, true);
  assert.equal(container.children[2].children[1].children[0], created[1]);
  ctx.contentBrowserView = 'list'; ctx.contentFolderDraft = null; created.length = 0;
  ctx.renderContentBrowser(); assert.deepEqual(container.children, created); assert.equal(container.children.length, 3);
});
