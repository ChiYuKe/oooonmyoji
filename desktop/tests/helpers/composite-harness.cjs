// 迁移期测试基座：用完整假依赖实例化编译后的复合节点详情模块。
const { createCompositeInspector } = require('../../dist-test-renderer/canvas/inspector/composite-inspector.js');

function element(tag, className = '', textContent = '') {
  const node = {
    tag, className, textContent, children: [], events: {}, attrs: {}, dataset: {}, style: {}, disabled: false,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    appendChild(child) { this.children.push(child); return child; },
    prepend(child) { this.children.unshift(child); return child; },
    querySelector(selector) {
      const cls = selector.replace(/^\./, '');
      return this.children.find((child) => (child.className || '').split(' ').includes(cls)) || null;
    },
    addEventListener(name, fn) { this.events[name] = fn; },
    fire(name, extra = {}) { this.events[name]?.({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }); },
  };
  const has = (name) => String(node.className || '').split(' ').includes(name);
  node.classList = {
    add(name) { if (!has(name)) node.className = `${node.className} ${name}`.trim(); },
    remove(name) { node.className = String(node.className || '').split(' ').filter((item) => item !== name).join(' '); },
    toggle(name, force) { const on = force === undefined ? !has(name) : Boolean(force); if (on) this.add(name); else this.remove(name); return on; },
    contains(name) { return has(name); },
  };
  return node;
}

function harness() {
  const state = { raw: { inputs: {}, variables: {} }, instances: [], workflows: [], selected: new Set(), selectedEdge: null, selectedRun: null };
  const toasts = [];
  const deps = {
    el: element,
    section: (body, title) => body.appendChild(element('h3', 'section-header', title)),
    field: (body, label) => { const node = element('div', 'field'); node.label = label; body.appendChild(node); return node; },
    selectInput: () => element('select'),
    checkbox: () => element('input'),
    segmentedInput: () => element('div', 'ui-segmented'),
    textInput: (value, onChange) => { const node = element('input'); node.value = value; node.onChange = onChange; return node; },
    iconButton: (className, tip, icon, onClick) => { const node = element('button', className, icon); node.tip = tip; node.onClick = onClick; node.addEventListener('click', onClick); return node; },
    addRowButton: (label, onClick) => { const node = element('button', '', label); node.onClick = onClick; return node; },
    conditionControl: () => element('div', 'condition-control'),
    conditionOperandControl: () => element('div', 'condition-control'),
    conditionParseLiteral: (value) => value,
    conditionSentence: (expression) => expression && typeof expression === 'object' ? '当 条件成立 时执行' : '',
    nodeChildrenOptions: () => [],
    nodeById: (id) => ({ name: `节点 ${id}` }),
    mutate: (fn) => fn(),
    disconnect: (parent, id) => { deps.disconnected = [parent, id]; },
    runtimeInstanceLabel: (id) => id,
    removeInstanceRun: () => {},
    workflowInputs: () => [],
    render: () => {},
    state,
    decoratorLabel: (decorator) => decorator.type,
    isBindingValue: (value) => !!value && typeof value === 'object' && typeof value.ref === 'string',
    clone: (value) => JSON.parse(JSON.stringify(value)),
    allRefs: () => [],
    referenceLabel: (ref) => ref,
    valueBindingMenu: () => ({ label: '绑定' }),
    toast: (message, error) => toasts.push([message, Boolean(error)]),
    UI: {
      button: (options) => {
        const node = element('button', '', options.label);
        node.label = options.label;
        node.disabled = options.disabled;
        node.tip = options.tip;
        node.onClick = options.onClick;
        return node;
      },
    },
  };
  const inspector = createCompositeInspector(deps);
  return { inspector, state, deps, toasts, body: element('div'), el: element };
}

module.exports = { harness, element };
