/**
 * 工作流/变量详情渲染：连线上限、工作流设置、变量列表与定义/引用控件。
 * 原 `workflow-editor.js` 的 renderEdgeInspector 至 valueBindingMenu 区间。
 *
 * 渲染函数只读取文档与状态，编辑通过注入命令回调完成。
 */
import type { Ui } from '../ui/elements';
import type { CanvasState } from '../state/canvas-state';
import {
  COLOR_PATTERN, KEY_NAMES, KEY_PATTERN, NUMERIC_TYPES, PARAMETER_TYPES, STRING_TYPES,
  keyOptionLabel, parameterTypeLabel,
} from '../../shared/parameter-types';
import { paramColorSwatch, paramPointParts } from '../render/param-rows';

type UiNode = any;

export interface VariableInspectorsDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  mutate(fn: () => void): void;
  UI: Ui;
  el(tag: string, className?: string, text?: string): UiNode;
  $(id: string): HTMLElement;
  nodeById(id: string): any;
  clone<T>(value: T): T;
  toast(message: string, isError?: boolean): void;
  defaultValue(definition: any): any;
  allRefs(node: any, definition?: any, includePossible?: boolean): string[];
  referenceLabel(ref: string): string;
  fieldLabel(name: string): string;
  disconnect(nodeId: string, childId: string): void;
  bindAssetPreview(input: UiNode): void;
  openAssetBrowser(...args: any[]): void;
  variableCards(): Record<string, any>;
  variableLinks(): Record<string, any>;
  clearVariableCardSelection(): void;
  renameVariable?(scope: string, oldName: string, name: string): void;
  removeVariable?(scope: string, name: string): void;
  variableReferenceCount?(scope: string, name: string): number;
  VariableSystem: Record<string, any>;
  selectInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void, className?: string): UiNode;
  textInput(value: unknown, onChange: (value: string) => void, options?: Record<string, unknown>): UiNode;
  checkbox(value: boolean, onChange: (value: boolean) => void): UiNode;
  field(body: UiNode, label: string, hint?: string): UiNode;
  section(body: UiNode, title: string, action?: UiNode): UiNode;
  clearInspector(title: string): UiNode;
}

export function createVariableInspectors(deps: VariableInspectorsDeps) {
  const {
    state, mutate, UI, el, $, nodeById, clone, toast, defaultValue, allRefs, referenceLabel, fieldLabel,
    disconnect, bindAssetPreview, openAssetBrowser, variableCards, variableLinks, clearVariableCardSelection, VariableSystem,
    selectInput, textInput, checkbox, field, section, clearInspector,
  } = deps;
  function renderEdgeInspector(): void {
    const edge = state.selectedEdge;
    const body = clearInspector('连接');
    section(body, '父子关系');
    const from = field(body, '父节点'); from.appendChild(el('div', 'readonly-value', edge.parent));
    const to = field(body, '子节点'); to.appendChild(el('div', 'readonly-value', edge.child));
    const parent = nodeById(edge.parent); const index = parent && parent.children ? parent.children.indexOf(edge.child) : -1;
    const order = field(body, '执行顺序'); order.appendChild(el('div', 'readonly-value', index >= 0 ? String(index + 1) : '—'));
    const remove = el('button', 'danger full-command', '断开连接'); remove.addEventListener('click', () => { mutate(() => disconnect(edge.parent, edge.child)); state.selectedEdge = null; }); body.appendChild(remove);
  }

  function renderLimitControl(body: UiNode, label: string, key: string, fallback: any, parse: (value: string) => any, options?: any): void {
    const limits = state.raw.limits && typeof state.raw.limits === 'object' && !Array.isArray(state.raw.limits) ? state.raw.limits : null;
    const enabled = Boolean(limits) && typeof limits[key] === 'number';
    const row = field(body, label);
    const shell = el('div', 'inline-control');
    const toggle = el('label', 'check-label');
    toggle.appendChild(checkbox(enabled, (value) => mutate(() => {
      const target = state.raw.limits && typeof state.raw.limits === 'object' && !Array.isArray(state.raw.limits) ? state.raw.limits : (state.raw.limits = {});
      if (value) target[key] = fallback;
      else {
        delete target[key];
        if (!Object.keys(target).length) delete state.raw.limits;
      }
    })));
    toggle.appendChild(el('span', '', '启用'));
    shell.appendChild(toggle);
    const input = textInput(enabled ? limits[key] : fallback, (value) => mutate(() => {
      const target = state.raw.limits && typeof state.raw.limits === 'object' && !Array.isArray(state.raw.limits) ? state.raw.limits : (state.raw.limits = {});
      if (typeof target[key] === 'number') target[key] = parse(value);
    }), options);
    input.disabled = !enabled;
    shell.appendChild(input);
    row.appendChild(shell);
  }

  function renderWorkflowInspector(): void {
    const body = clearInspector('工作流设置');
    section(body, '标识');
    field(body, 'ID').appendChild(textInput(state.raw.id || '', (value) => mutate(() => { state.raw.id = value.trim(); })));
    field(body, '版本').appendChild(textInput(state.raw.version || '4.0.0', (value) => mutate(() => { state.raw.version = value.trim(); })));
    const descriptionRow = field(body, '描述', '用于说明脚本用途，并显示在子工作流选择器中');
    const description = el('textarea', 'workflow-description-input');
    description.value = typeof state.raw.description === 'string' ? state.raw.description : '';
    description.placeholder = '说明这个工作流的用途';
    description.addEventListener('change', () => mutate(() => { state.raw.description = description.value.trim(); }));
    descriptionRow.appendChild(description);
    section(body, '运行限制');
    body.appendChild(el('div', 'field-hint', '默认不开启；开启后按设定值终止运行。'));
    renderLimitControl(body, '总超时（秒）', 'timeout_seconds', 300, (value) => Math.max(0.001, parseFloat(value || '300')), { type: 'number', min: 0.001 });
    renderLimitControl(body, '最大节点执行数', 'max_steps', 1000, (value) => Math.max(1, parseInt(value || '1000', 10)), { type: 'number', min: 1, step: 1 });
    const resolution = Array.isArray(state.raw.resolution) ? state.raw.resolution : [1920, 1080];
    const resolutionRow = field(body, '参考分辨率'); const inline = el('div', 'inline-control');
    inline.appendChild(textInput(resolution[0], (value) => mutate(() => { state.raw.resolution[0] = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1 }));
    inline.appendChild(textInput(resolution[1], (value) => mutate(() => { state.raw.resolution[1] = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1 })); resolutionRow.appendChild(inline);
  }

  const DEFINITION_TYPES: readonly string[] = PARAMETER_TYPES;

  function sameDefinitionValue(left: any, right: any): boolean {
    try { return JSON.stringify(left) === JSON.stringify(right); } catch { return left === right; }
  }

  function definitionAcceptsValue(type: string, value: any): boolean {
    if (type === 'any') return true;
    if (type === 'string' || type === 'asset' || type === 'path') return typeof value === 'string';
    if (type === 'enum') return typeof value === 'string';
    if (type === 'key') return typeof value === 'string' && new RegExp(KEY_PATTERN).test(value);
    if (type === 'color') return typeof value === 'string' && new RegExp(COLOR_PATTERN).test(value);
    if (type === 'number' || type === 'duration') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'point') {
      if (Array.isArray(value)) return value.length === 2 && value.every((item) => Number.isFinite(Number(item)));
      return value !== null && typeof value === 'object'
        && Number.isFinite(Number((value as any).x)) && Number.isFinite(Number((value as any).y));
    }
    if (type === 'rect') return Array.isArray(value) && value.length === 4 && value.every(Number.isInteger);
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    return false;
  }

  function changeDefinitionType(definition: any, type: string): void {
    definition.type = type;
    if (!(NUMERIC_TYPES as readonly string[]).includes(type)) { delete definition.min; delete definition.max; }
    if (!(STRING_TYPES as readonly string[]).includes(type)) { delete definition.min_length; delete definition.max_length; }
    if (type !== 'array') { delete definition.min_items; delete definition.max_items; delete definition.items; }
    if (type !== 'object') delete definition.properties;
    if (type === 'enum' && (!Array.isArray(definition.enum) || !definition.enum.length)) definition.enum = ['选项 1'];
    if (Object.prototype.hasOwnProperty.call(definition, 'default') && !definitionAcceptsValue(type, definition.default)) delete definition.default;
    if (Array.isArray(definition.enum)) {
      definition.enum = definition.enum.filter((value: any) => definitionAcceptsValue(type, value));
      if (!definition.enum.length) {
        if (type === 'enum') definition.enum = ['选项 1'];
        else delete definition.enum;
      }
    }
  }

  function initialDefinitionValue(definition: any): any {
    if (Array.isArray(definition.enum) && definition.enum.length) return clone(definition.enum[0]);
    return defaultValue({ type: definition.type, enum: definition.enum });
  }

  /** 坐标点：两个整数输入（X/Y），改动一个轴时保留另一个轴当前输入的值。 */
  function pointValueControl(value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'definition-point-control');
    const parts = paramPointParts(value);
    const inputs: Record<string, UiNode> = {};
    const axisChange = (axis: 'x' | 'y', next: unknown): any => {
      const other: 'x' | 'y' = axis === 'x' ? 'y' : 'x';
      const sibling = inputs[other];
      const siblingRaw = sibling && sibling.value !== undefined && sibling.value !== '' ? sibling.value : parts[other];
      const number = Number(next);
      const siblingNumber = Number(siblingRaw);
      return {
        ...parts,
        [axis]: Number.isFinite(number) ? Math.round(number) : 0,
        [other]: Number.isFinite(siblingNumber) ? Math.round(siblingNumber) : parts[other],
      };
    };
    (['x', 'y'] as const).forEach((axis) => {
      const input = textInput(parts[axis], (next) => set(axisChange(axis, next)), { type: 'number', step: 1, 'aria-label': axis.toUpperCase() });
      inputs[axis] = input;
      shell.appendChild(input);
    });
    return shell;
  }

  /** 颜色：文本 + 原生取色器，两边同步。 */
  function colorValueControl(value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    const input = textInput(value ?? '', set, { placeholder: '#rrggbb' });
    shell.appendChild(input);
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'definition-color-picker';
    picker.value = paramColorSwatch(value) || '#000000';
    picker.title = '选择颜色';
    picker.addEventListener('input', () => { input.value = picker.value; set(picker.value); });
    shell.appendChild(picker);
    return shell;
  }

  /** 按键：文本 + 常用按键选择器（选中后回填文本）。 */
  function keyValueControl(value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    const input = textInput(value ?? '', set, { placeholder: 'BACK' });
    const picker = el('select', 'ui-select definition-key-picker') as HTMLSelectElement;
    const blank = el('option', '', '常用按键') as HTMLOptionElement;
    blank.value = '';
    picker.appendChild(blank);
    for (const name of KEY_NAMES) {
      const option = el('option', '', keyOptionLabel(name)) as HTMLOptionElement;
      option.value = name;
      picker.appendChild(option);
    }
    picker.value = (KEY_NAMES as readonly string[]).includes(String(value)) ? String(value) : '';
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      input.value = picker.value;
      set(picker.value);
    });
    shell.appendChild(input);
    shell.appendChild(picker);
    return shell;
  }

  /** 时长：数值 + 秒单位。 */
  function durationValueControl(definition: any, value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    shell.appendChild(textInput(value, (next) => set(parseFloat(next || '0')), {
      type: 'number', min: definition.min, max: definition.max, step: 'any',
    }));
    shell.appendChild(el('span', 'definition-unit', '秒'));
    return shell;
  }

  /** 枚举选项编辑：新增/删除/改名，并保持默认值合法。 */
  function enumOptionsControl(definition: any, after: () => void): UiNode {
    const shell = el('div', 'definition-enum-options');
    const options: any[] = Array.isArray(definition.enum) ? definition.enum : [];
    options.forEach((option, index) => {
      const row = el('div', 'definition-enum-row');
      row.appendChild(textInput(String(option), (next) => mutate(() => {
        definition.enum[index] = next;
        if (sameDefinitionValue(definition.default, option)) definition.default = next;
        after();
      }), { placeholder: '选项值' }));
      row.appendChild(UI.button({
        label: '删除',
        onClick: () => mutate(() => {
          definition.enum.splice(index, 1);
          if (!definition.enum.length) definition.enum = ['选项 1'];
          if (!definition.enum.some((item: any) => sameDefinitionValue(item, definition.default))) definition.default = clone(definition.enum[0]);
          after();
        }),
      }));
      shell.appendChild(row);
    });
    shell.appendChild(UI.button({
      label: '添加选项',
      onClick: () => mutate(() => {
        definition.enum = [...options, `选项 ${options.length + 1}`];
        after();
      }),
    }));
    return shell;
  }

  /** 从当前值推断结构：清单/旧文档没写 items、properties 时也给出结构化控件，而不是原始 JSON。 */
  function inferredDefinition(value: any): any {
    if (Array.isArray(value)) return { type: 'array', items: inferredDefinition(value[0]) };
    if (value !== null && typeof value === 'object') {
      const properties: Record<string, any> = {};
      for (const [key, item] of Object.entries(value)) properties[key] = inferredDefinition(item);
      return { type: 'object', properties };
    }
    if (typeof value === 'number') return { type: 'number' };
    if (typeof value === 'boolean') return { type: 'boolean' };
    return { type: 'string' };
  }

  /** 固定长度数组（如随机间隔的 [min, max]）：正好给 N 个元素输入框，不提供增删。 */
  function fixedArrayLength(definition: any): number | null {
    const min = definition.min_items;
    const max = definition.max_items;
    if (!Number.isInteger(min) || min !== max) return null;
    return min >= 1 && min <= 8 ? min : null;
  }

  /** 数组元素定义：优先用清单声明，其次按默认值推断，最差也按字符串给一行输入。 */
  function arrayItemDefinition(definition: any, value: any): any {
    const declared = definition.items;
    if (declared && typeof declared === 'object' && !Array.isArray(declared)) return declared;
    const sample = Array.isArray(value) && value.length ? value[0] : definition.default;
    if (Array.isArray(sample) && sample.length) return inferredDefinition(sample[0]);
    if (sample !== undefined && sample !== null && typeof sample !== 'object') return inferredDefinition(sample);
    return { type: 'string' };
  }

  /** 对象字段定义：只认清单声明；没有声明就走动态字段行（键名可由用户增删）。 */
  function objectProperties(definition: any): Record<string, any> | null {
    const declared = definition.properties;
    return declared && typeof declared === 'object' && Object.keys(declared).length ? declared : null;
  }

  /** 无字段定义的 object/any：按「字段名 + 值」行编辑，可增删，避免用户直接写 JSON。 */
  function dynamicObjectControl(definition: any, value: any, assign: (value: any) => void, options: any): UiNode {
    const shell = el('div', 'variable-map-value');
    // 每次编辑都基于最新值重建（同一屏内连续编辑不会互相覆盖）。
    let current: Record<string, any> = value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
    // 字段控件自身的 mutate 已经记过撤销；按钮要自己记一次。
    const commit = (next: Record<string, any>): void => { current = next; assign(next); };
    const apply = (next: Record<string, any>): void => { current = next; mutate(() => assign(next)); };
    const rename = (from: string, to: string): boolean => {
      const next = String(to || '').trim();
      if (!next || next === from) return false;
      if (Object.prototype.hasOwnProperty.call(current, next)) { toast(`字段「${next}」已存在`, true); return false; }
      const updated: Record<string, any> = {};
      for (const [key, item] of Object.entries(current)) updated[key === from ? next : key] = item;
      apply(updated);
      return true;
    };
    Object.entries(current).forEach(([key, item]) => {
      const row = el('div', 'variable-map-row');
      row.appendChild(textInput(key, (next) => rename(key, next), { placeholder: '字段名' }));
      row.appendChild(definitionValueControl(inferredDefinition(item), item, (next) => commit({ ...current, [key]: next }), options));
      row.appendChild(UI.button({ label: '删除', onClick: () => {
        const updated: Record<string, any> = { ...current };
        delete updated[key];
        apply(updated);
      } }));
      shell.appendChild(row);
    });
    shell.appendChild(UI.button({ label: '添加字段', onClick: () => {
      let index = Object.keys(current).length + 1;
      let key = `字段 ${index}`;
      while (Object.prototype.hasOwnProperty.call(current, key)) { index += 1; key = `字段 ${index}`; }
      apply({ ...current, [key]: '' });
    } }));
    return shell;
  }

  function definitionValueControl(definition: any, value: any, assign: (value: any) => void, options: any = {}): UiNode {
    const set = (next: any) => mutate(() => assign(next));
    const type = definition.type || 'any';
    if (type === 'object') {
      const properties = objectProperties(definition);
      if (!properties) return dynamicObjectControl(definition, value, assign, options);
      const shell = el('div', 'variable-struct-value');
      let current: Record<string, any> = value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
      const commit = (next: Record<string, any>): void => { current = next; assign(next); };
      for (const [key, child] of Object.entries<any>(properties)) {
        const row = field(shell, child.display_name || fieldLabel(key));
        const item = current[key] === undefined ? initialDefinitionValue(child) : current[key];
        row.appendChild(definitionValueControl(child, item, next => commit({ ...current, [key]: next }), options));
      }
      return shell;
    }
    if (type === 'array') {
      const itemDefinition = arrayItemDefinition(definition, value);
      let items: any[] = Array.isArray(value) ? value.slice() : [];
      // 元素控件自己记撤销；增删按钮要自己记一次。
      const commit = (next: any[]): void => { items = next; assign(next); };
      const apply = (next: any[]): void => { items = next; set(next); };
      const shell = el('div', 'variable-array-value');
      const fixed = fixedArrayLength(definition);
      if (fixed !== null) {
        while (items.length < fixed) items.push(initialDefinitionValue(itemDefinition));
        for (let index = 0; index < fixed; index += 1) {
          const row = el('div', 'variable-array-item');
          row.appendChild(definitionValueControl(itemDefinition, items[index], next => {
            const updated = items.slice();
            updated[index] = next;
            commit(updated);
          }, options));
          shell.appendChild(row);
        }
        return shell;
      }
      items.forEach((item: any, index: number) => {
        const row = el('div', 'variable-array-item');
        row.appendChild(definitionValueControl(itemDefinition, item, next => {
          const updated = items.slice();
          updated[index] = next;
          commit(updated);
        }, options));
        row.appendChild(UI.button({ label: '删除', onClick: () => apply(items.filter((_: any, i: number) => i !== index)) }));
        shell.appendChild(row);
      });
      shell.appendChild(UI.button({ label: '添加元素', onClick: () => apply([...items, initialDefinitionValue(itemDefinition)]) }));
      return shell;
    }
    if (options.useEnum !== false && Array.isArray(definition.enum) && definition.enum.length) {
      const values = definition.enum.slice();
      if (!values.some((item: any) => sameDefinitionValue(item, value))) values.unshift(value);
      return selectInput(JSON.stringify(value), values.map((item: any) => ({ value: JSON.stringify(item), label: String(item) })), (next: string) => set(JSON.parse(next)), 'full');
    }
    if (type === 'boolean') return checkbox(!!value, set);
    if (type === 'number' || type === 'integer') {
      return textInput(value, (next) => set(type === 'integer' ? parseInt(next || '0', 10) : parseFloat(next || '0')), {
        type: 'number', min: definition.min, max: definition.max, step: type === 'integer' ? 1 : 'any',
      });
    }
    if (type === 'duration') return durationValueControl(definition, value, set);
    if (type === 'point') return pointValueControl(value, set);
    if (type === 'color') return colorValueControl(value, set);
    if (type === 'key') return keyValueControl(value, set);
    if (type === 'rect') {
      const shell = el('div', 'definition-rect-control');
      const values = Array.isArray(value) && value.length === 4 ? value : [0, 0, 100, 100];
      values.forEach((item, index) => shell.appendChild(textInput(item, (next) => {
        const updated = values.slice(); updated[index] = parseInt(next || '0', 10); set(updated);
      }, { type: 'number' })));
      return shell;
    }
    if (type === 'asset') {
      const shell = el('div', 'inline-control');
      const input = textInput(value ?? '', set, { placeholder: 'assets/templates/...' });
      bindAssetPreview(input);
      shell.appendChild(input);
      const browse = el('button', '', '浏览'); browse.title = '从 assets 中选择模板';
      browse.addEventListener('click', () => openAssetBrowser(options.nodeId || '', options.key || '', value, assign));
      shell.appendChild(browse);
      return shell;
    }
    // 任意类型也按值本身给控件：对象走字段行、数组走元素行、标量走文本输入，绝不退化成 JSON。
    if (type === 'any' && value !== null && typeof value === 'object') {
      return Array.isArray(value)
        ? definitionValueControl({ type: 'array', items: inferredDefinition(value[0]) }, value, assign, options)
        : dynamicObjectControl(definition, value, assign, options);
    }
    return textInput(value === undefined || value === null ? '' : String(value), set);
  }

  function variableReferenceCountDefault(scope: string, name: string): number {
    return VariableSystem.references(state.raw,scope,name).length;
  }

  /** 取消输入的公开：转为运行变量，并同步改写节点绑定与变量卡片。 */
  function convertInputToVariable(name: string): void {
    if (!state.raw.inputs || !state.raw.inputs[name]) return;
    mutate(() => {
      const definition = state.raw.inputs[name];
      const newId = VariableSystem.create(state.raw, 'variables', VariableSystem.label(state.raw, 'inputs', name), definition, definition.default);
      const prefix = `inputs.${name}`, target = `variables.${newId}`;
      const rewrite = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.ref === 'string' && (value.ref === prefix || value.ref.startsWith(`${prefix}.`))) value.ref = target + value.ref.slice(prefix.length);
        for (const child of Object.values(value)) rewrite(child);
      };
      for (const node of state.raw.nodes || []) rewrite(node);
      for (const card of Object.values(variableCards())) {
        if (card && typeof card === 'object' && card.scope !== 'variables' && card.name === name) { card.scope = 'variables'; card.name = newId; }
      }
      for (const variable of Object.values<any>(state.raw.variables || {})) {
        if (variable && variable.initial_from === name) delete variable.initial_from;
      }
      delete state.raw.inputs[name];
      state.selectedVariable = newId;
      state.selectedVariableScope = 'variables';
    });
  }

  function removeVariableDefault(scope: string, name: string): void {
    const references = variableReferenceCount(scope, name);
    if (references) {
      toast(`变量 ${name} 正在被 ${references} 处引用，不能删除`, true);
      return;
    }
    mutate(() => {
      clearVariableCardSelection();
      const definitions = state.raw[scope];
      const names = Object.keys(definitions);
      const index = names.indexOf(name);
      delete definitions[name];
      for (const [id, card] of Object.entries(variableCards())) {
        const cardName = card && typeof card.name === 'string' ? card.name : id;
        const cardScope = card && card.scope === 'variables' ? 'variables' : 'inputs';
        if (cardScope === scope && cardName === name) delete variableCards()[id];
      }
      for (const [key, cardId] of Object.entries(variableLinks())) {
        if (!Object.prototype.hasOwnProperty.call(variableCards(), cardId)) delete variableLinks()[key];
      }
      const remaining = Object.keys(definitions);
      state.selectedVariable = remaining[Math.min(Math.max(0, index), remaining.length - 1)] || '';
    });
  }

  function addVariable(scope: string = 'variables'): void {
    mutate(() => {
      if (scope !== 'inputs') scope = 'variables';
      if (!state.raw[scope] || typeof state.raw[scope] !== 'object' || Array.isArray(state.raw[scope])) state.raw[scope] = {};
      const name = VariableSystem.create(state.raw,scope,'新变量',{type:'string'},'');
      state.selectedVariable = name;
      state.selectedVariableScope = scope;
      clearVariableCardSelection();
      state.inspector = 'variables';
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = null;
    });
  }

  function renderVariablesInspector(): void {
    const name = state.selectedVariable;
    const scope = state.selectedVariableScope === 'variables' ? 'variables' : 'inputs';
    const scopeLabel = '变量';
    const body = clearInspector(name ? `${scopeLabel} · ${name}` : scopeLabel);
    if (!state.raw[scope] || typeof state.raw[scope] !== 'object' || Array.isArray(state.raw[scope])) state.raw[scope] = {};
    const rawDefinition = name ? state.raw[scope][name] : null;
    if (!rawDefinition) {
      body.appendChild(el('div', 'variable-inspector-empty', '从左侧变量列表选择一个变量'));
      return;
    }
    const definition = rawDefinition && typeof rawDefinition === 'object' && !Array.isArray(rawDefinition)
      ? rawDefinition
      : { type: 'any' };
    if (scope === 'variables' && !Object.prototype.hasOwnProperty.call(definition, 'default')) definition.default = initialDefinitionValue(definition);
    if (definition !== rawDefinition) state.raw[scope][name] = definition;
    const details = el('div', 'variable-details');
    section(details, '变量');
    field(details, '变量命名').appendChild(textInput(variableDisplayName(scope, name), (value) => renameVariable(scope, name, value.trim())));
    field(details, '变量类型').appendChild(selectInput(definition.type || 'string', DEFINITION_TYPES.map((value) => ({ value, label: parameterTypeLabel(value) })), (value) => {
      if (variableReferenceCount(scope, name)) { toast('变量已有引用，请先解除引用再修改类型', true); return; }
      mutate(() => { changeDefinitionType(definition, value); syncExposedInput(definition, name); });
    }));
    field(details, '描述').appendChild(textInput(definition.description || '', (value) => mutate(() => {
      if (value.trim()) definition.description = value.trim(); else delete definition.description;
      syncExposedInput(definition, name);
    }), { placeholder: '说明这个变量的用途' }));
    field(details, '分组').appendChild(textInput(definition.group || '', (value) => mutate(() => {
      if (value.trim()) definition.group = value.trim(); else delete definition.group;
      syncExposedInput(definition, name);
    }), { placeholder: '例如：战斗设置；留空为未分组' }));
    if (scope === 'variables') {
      field(details, '公开').appendChild(checkbox(!!definition.initial_from, (value) => mutate(() => {
        if (value) VariableSystem.expose(state.raw, name);
        else delete definition.initial_from;
      })));
    } else {
      const auto = definition._autoPublished === true;
      const initializers = Object.entries<any>(state.raw.variables || {})
        .filter(([, item]) => item && item.initial_from === name)
        .map(([key]) => key);
      const publicBox = checkbox(true, (value) => {
        if (value) return;
        if (auto) {
          mutate(() => {
            for (const key of initializers) delete state.raw.variables[key].initial_from;
            delete state.raw.inputs[name];
          });
          return;
        }
        convertInputToVariable(name);
      });
      publicBox.title = auto ? '取消公开会移除自动输入，并解除变量的初始化绑定' : '取消公开后转为运行变量，引用它的地方会同步改写';
      field(details, '公开').appendChild(publicBox);
    }
    section(details, '默认值');
    field(details, '默认值').appendChild(definitionValueControl(definition, definition.default, (value) => {
      definition.default = value;
      syncExposedInput(definition, name);
    }, { key: name }));
    if (definition.type === 'enum') {
      section(details, '枚举选项');
      field(details, '选项').appendChild(enumOptionsControl(definition, () => syncExposedInput(definition, name)));
    }
    body.appendChild(details);
    const remove = UI.button({ label: `删除${scopeLabel}`, variant: 'danger', className: 'variable-delete', onClick: () => removeVariable(scope, name) });
    body.appendChild(remove);
  }

  function renameVariableDefault(scope: string, oldName: string, name: string): void {
    if (!name || name === variableDisplayName(scope,oldName)) return;
    try { mutate(()=>{VariableSystem.rename(state.raw,scope,oldName,name);syncExposedInput(state.raw[scope][oldName],oldName);}); } catch(error: any) { toast(error.message,true); }
  }

  function variableDisplayName(scope: string, name: string): string { return state.raw?.[scope]?.[name]?.display_name || name; }

  /** 公开变量的自动输入是它的镜像：改名、改类型、改说明、改默认值时同步过去。 */
  function syncExposedInput(definition: any, name: string): void {
    const twin = definition && definition.initial_from && state.raw.inputs ? state.raw.inputs[definition.initial_from] : null;
    if (!twin || !twin._autoPublished) return;
    for (const key of ['type', 'description', 'group']) {
      if (definition[key] === undefined) delete twin[key]; else twin[key] = clone(definition[key]);
    }
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) twin.default = clone(definition.default); else delete twin.default;
    twin.display_name = VariableSystem.label(state.raw, 'variables', name);
  }

  function valueBindingMenu(node: any, definition: any, getValue: () => any, assign: (value: any) => void, label: string): UiNode {
    const refs = allRefs(node,definition);
    return UI.dropdown({value:'',label:'绑定',options:[
      {value:'',label:'绑定',disabled:true},
      ...refs.map(ref=>({value:ref,label:referenceLabel(ref)})),
      {value:'$variable',label:'提升为变量'},
    ],searchable:true,placeholder:'搜索兼容变量或节点输出',onChange:choice=>{
      if(!choice)return;
      if(choice.startsWith('$')) {
        const current=getValue();
        if(VariableSystem.containsBinding(current)){toast('请先恢复固定值，或选择已有引用',true);return;}
        mutate(()=>{const id=VariableSystem.create(state.raw,'variables',label,{...definition},current===undefined?initialDefinitionValue(definition):current);assign({ref:`variables.${id}`});});
      } else mutate(()=>assign({ref:choice}));
    }});
  }

  /** 测试或外部集成可覆盖删除/改名实现；默认使用下方本地实现。 */
  const removeVariable = deps.removeVariable ?? removeVariableDefault;
  const renameVariable = deps.renameVariable ?? renameVariableDefault;
  const variableReferenceCount = deps.variableReferenceCount ?? variableReferenceCountDefault;

  return {
    renderEdgeInspector, renderLimitControl, renderWorkflowInspector, sameDefinitionValue, definitionAcceptsValue,
    changeDefinitionType, initialDefinitionValue, definitionValueControl, variableReferenceCount, convertInputToVariable,
    removeVariable, addVariable, renderVariablesInspector, renameVariable, variableDisplayName, syncExposedInput,
    valueBindingMenu,
  };
}