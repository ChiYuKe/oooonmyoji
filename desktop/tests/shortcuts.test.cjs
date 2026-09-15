const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/shortcuts/shortcuts.js'), 'utf8');

/** 在无 DOM 的 VM 中加载共享模块，模拟主窗口 / iframe 的原生与浏览器存储。 */
function load(options = {}) {
  const store = new Map(Object.entries(options.storage || {}));
  const events = {};
  const writes = [];
  const native = options.native === null ? undefined : {
    readLayout: options.native?.readLayout || (() => store.get('onmyoji-studio.shortcuts') ?? null),
    writeLayout: (key, value) => { writes.push([key, value]); if (options.native?.writeLayout) options.native.writeLayout(key, value); },
  };
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  const window = {
    onmyoji: native,
    addEventListener: (name, listener) => { (events[name] ||= []).push(listener); },
  };
  window.parent = window;
  window.opener = window;
  window.top = window;
  const ctx = vm.createContext({window, localStorage});
  vm.runInContext(source, ctx);
  return {api: window.StudioShortcuts, store, events, writes};
}

const key = (value, extra = {}) => ({
  key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra,
});

test('默认绑定覆盖全部可配置命令并带多组合', () => {
  const {api} = load();
  assert.equal(api.get('editor.undo'), 'ctrl+z');
  assert.equal(api.get('editor.redo'), 'ctrl+shift+z|ctrl+y');
  assert.equal(api.get('global.delete'), 'delete|backspace');
  assert.equal(api.get('editor.save'), 'ctrl+s');
  assert.equal(api.format('ctrl+shift+z|ctrl+y'), 'Ctrl+Shift+Z / Ctrl+Y');
  assert.equal(api.format('delete|backspace'), 'Delete / Backspace');
  assert.equal(api.isCustom('editor.undo'), false);
});

test('匹配区分修饰键、多组合与删除别名', () => {
  const {api} = load();
  assert.equal(api.matches(key('z', {ctrlKey: true}), 'ctrl+z'), true);
  assert.equal(api.matches(key('Z', {ctrlKey: true, shiftKey: true}), 'ctrl+shift+z|ctrl+y'), true);
  assert.equal(api.matches(key('y', {ctrlKey: true}), 'ctrl+shift+z|ctrl+y'), true);
  assert.equal(api.matches(key('z', {ctrlKey: true, shiftKey: true}), 'ctrl+z'), false);
  assert.equal(api.matches(key('Delete'), 'delete|backspace'), true);
  assert.equal(api.matches(key('Backspace'), 'delete|backspace'), true);
  assert.equal(api.matches(key('Delete', {ctrlKey: true}), 'delete|backspace'), false);
  assert.equal(api.matches(key('F6', {shiftKey: true}), 'shift+f6'), true);
  assert.equal(api.matches(key('Home'), 'home'), true);
});

test('按键捕获忽略纯修饰键并规范化空白键', () => {
  const {api} = load();
  assert.equal(api.bindingFromEvent(key('z', {ctrlKey: true, shiftKey: true})), 'ctrl+shift+z');
  assert.equal(api.bindingFromEvent(key('Control', {ctrlKey: true})), null);
  assert.equal(api.bindingFromEvent(key(' ')), 'space');
});

test('设置写入浏览器与原生存储，重置恢复默认', () => {
  const {api, store, writes} = load();
  assert.equal(api.set('editor.undo', 'ctrl+u').ok, true);
  assert.equal(api.get('editor.undo'), 'ctrl+u');
  assert.equal(api.isCustom('editor.undo'), true);
  assert.equal(store.get(api.storageKey), '{"editor.undo":"ctrl+u"}');
  assert.equal(writes.at(-1)[0], api.storageKey);

  assert.equal(api.reset('editor.undo'), true);
  assert.equal(api.get('editor.undo'), 'ctrl+z');
  assert.equal(api.isCustom('editor.undo'), false);
});

test('拒绝无效绑定并与其它命令的绑定冲突', () => {
  const {api} = load();
  const invalid = api.set('editor.undo', 'ctrl');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid');
  assert.equal(api.set('editor.undo', '').reason, 'invalid');
  const conflict = api.set('editor.undo', 'ctrl+c');
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'conflict');
  assert.equal(conflict.conflictId, 'editor.copy');
  assert.equal(api.get('editor.undo'), 'ctrl+z');
  // 全局与画布同名默认（Delete）属于不同上下文，不算冲突。
  assert.equal(api.set('editor.delete', 'delete|backspace').ok, true);
  assert.equal(api.get('editor.delete'), 'delete|backspace');
});

test('原生配置在启动时加载并镜像给同源 iframe', () => {
  const native = {
    readLayout: () => JSON.stringify({'editor.save': 'ctrl+shift+s'}),
    writeLayout: () => {},
  };
  const {api, store} = load({native});
  assert.equal(api.get('editor.save'), 'ctrl+shift+s');
  assert.equal(api.isCustom('editor.save'), true);
  assert.equal(store.get(api.storageKey), JSON.stringify({'editor.save': 'ctrl+shift+s'}));
});

test('storage 事件把其它窗口的改动同步进来', () => {
  const {api, events} = load();
  let notified = 0;
  api.subscribe(() => { notified += 1; });
  const handler = events.storage[0];
  assert(handler);
  handler({key: api.storageKey, newValue: JSON.stringify({'editor.undo': 'ctrl+u'})});
  assert.equal(api.get('editor.undo'), 'ctrl+u');
  assert(notified >= 2);
  assert.equal(api.resetAll(), undefined);
  assert.equal(api.get('editor.undo'), 'ctrl+z');
});
