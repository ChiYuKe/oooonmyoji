/**
 * 节点/实例运行/连线的详情渲染：任务参数块、运行实例输入、公共工作流输入与连线上限。
 * 原 `workflow-editor.js` 的 renderTaskInspector 至 renderInstanceRunInspector 区间。
 *
 * 渲染函数只读取文档与状态，编辑通过注入命令回调完成。
 */
import type { Ui } from '../ui/elements';
import type { CanvasState } from '../state/canvas-state';
import { KEY_NAMES, keyOptionLabel } from '../../shared/parameter-types';
import { paramColorSwatch, paramPointParts } from '../render/param-rows';

type UiNode = any;

export interface DetailInspectorsDeps {
  state: CanvasState;
  mutate(fn: () => void): void;
  UI: Ui;
  el(tag: string, className?: string, text?: string): UiNode;
  $(id: string): HTMLElement;
  nodeById(id: string): any;
  catalogByName(name: string): any;
  clone<T>(value: T): T;
  defaultValue(definition: any): any;
  referenceLabel(ref: string): string;
  enumOption(value: string): string;
  runtimeInstanceLabel(instanceId: string, fallback?: string): string;
  workflowInputs(reference: any): any[];
  resolveWorkflowRef?(value: any): string;
  workflowReference(...args: any[]): any;
  requestOpenWorkflowReference(...args: any[]): void;
  definitionSchema(definition: any): any;
  compatibleRefType(expected: any, actual: any): boolean;
  actionDropdown(node: any): UiNode;
  renderParameter(body: UiNode, node: any, name: string, definition: any): void;
  complexValueControl(key: string, definition: any, value: any, set: (value: any) => void, ctx?: any): UiNode;
  displayNameOfDefinition(definition: any, name?: string): string;
  compactValue(value: any, limit?: number): string;
  renderInspector(): void;
  selectInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void, className?: string): UiNode;
  textInput(value: unknown, onChange: (value: string) => void, options?: Record<string, unknown>): UiNode;
  field(body: UiNode, label: string, hint?: string): UiNode;
  section(body: UiNode, title: string, action?: UiNode): UiNode;
  clearInspector(title: string): UiNode;
}

export function createDetailInspectors(deps: DetailInspectorsDeps) {
  const {
    state, mutate, UI, el, $, nodeById, catalogByName, clone, defaultValue, referenceLabel, enumOption,
    runtimeInstanceLabel, workflowInputs, workflowReference, requestOpenWorkflowReference,
    definitionSchema, compatibleRefType, selectInput, textInput, field, section, clearInspector,
    actionDropdown, renderParameter, complexValueControl, displayNameOfDefinition, compactValue, renderInspector,
  } = deps;
  const resolveWorkflowRef = deps.resolveWorkflowRef || ((value: any) => typeof value === 'string' ? value.trim() : '');
  function renderTaskInspector(body: UiNode, node: any): void {
    section(body, '动作');
    const row = field(body, '实现');
    row.appendChild(actionDropdown(node));
    const spec = catalogByName(node.action);
    if (spec && spec.description) body.appendChild(el('div', 'description', spec.description));
    section(body, '参数');
    if (!node.params || typeof node.params !== 'object' || Array.isArray(node.params)) node.params = {};
    if (!spec || !Object.keys(spec.parameters || {}).length) {
      body.appendChild(el('div', 'empty-section', '无参数'));
      return;
    }
    for (const [name, definition] of Object.entries(spec.parameters)) {
      if (node.action === 'workflow.run' && name === 'inputs') continue;
      renderParameter(body, node, name, definition);
    }
    if (node.action === 'workflow.run') renderPublicWorkflowInputs(body, node.params, resolveWorkflowRef(node.params.workflow), true, `${node.id}:inputs:`);
  }

  function removeInstanceRun(node: any, index: number): void {
    mutate(() => {
      if (Array.isArray(node.runs)) node.runs.splice(index, 1);
      state.selectedRun = null;
    });
  }

  function parentVariableRefs(definition: any, allowRuntimeVariables = false): string[] {
    const expected = definitionSchema(definition);
    const inputs = state.raw && state.raw.inputs && typeof state.raw.inputs === 'object' && !Array.isArray(state.raw.inputs)
      ? state.raw.inputs
      : {};
    const refs = Object.entries(inputs)
      .filter(([, parentDefinition]) => compatibleRefType(expected, definitionSchema(parentDefinition)))
      .map(([name]) => `inputs.${name}`);
    if (allowRuntimeVariables) {
      const variables = state.raw && state.raw.variables && typeof state.raw.variables === 'object' && !Array.isArray(state.raw.variables)
        ? state.raw.variables
        : {};
      refs.push(...Object.entries(variables)
        .filter(([, parentDefinition]) => compatibleRefType(expected, definitionSchema(parentDefinition)))
        .map(([name]) => `variables.${name}`));
    }
    return refs;
  }

  function runInputLiteralControl(holder: any, name: string, definition: any, key: string = ''): UiNode {
    const value = holder.inputs[name];
    const set = (next: any) => mutate(() => { holder.inputs[name] = next; });
    if (Array.isArray(definition.enum) && definition.enum.length) {
      return selectInput(JSON.stringify(value), definition.enum.map((item: any) => ({ value: JSON.stringify(item), label: enumOption(item) })), (next: string) => set(JSON.parse(next)), 'full');
    }
    if (definition.type === 'boolean') return UI.checkField({ checked: !!value, label: '开启', onChange: set });
    if (definition.type === 'number' || definition.type === 'integer') {
      return textInput(value, (next: string) => set(definition.type === 'integer' ? parseInt(next || '0', 10) : parseFloat(next || '0')), { type: 'number', min: definition.min, max: definition.max, step: definition.type === 'integer' ? 1 : 'any' });
    }
    if (definition.type === 'duration') return durationLiteralControl(definition, value, set);
    if (definition.type === 'point') return pointLiteralControl(value, set);
    if (definition.type === 'color') return colorLiteralControl(value, set);
    if (definition.type === 'key') return keyLiteralControl(value, set);
    if (['array', 'object', 'any'].includes(definition.type)) {
      return complexValueControl(`run:${key}:${name}`, definition, value, set);
    }
    if (definition.type === 'rect') return rectLiteralControl(value, set);
    return textInput(value ?? '', set);
  }

  /** 时长：数值 + 秒。 */
  function durationLiteralControl(definition: any, value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    shell.appendChild(textInput(value, (next: string) => set(parseFloat(next || '0')), {
      type: 'number', min: definition.min, max: definition.max, step: 'any',
    }));
    shell.appendChild(el('span', 'definition-unit', '秒'));
    return shell;
  }

  /** 坐标点：X/Y 两个整数输入。 */
  function pointLiteralControl(value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'rect-control point-control');
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
      const input = textInput(parts[axis], (next: string) => set(axisChange(axis, next)), { type: 'number', step: 1 });
      inputs[axis] = input;
      shell.appendChild(input);
    });
    return shell;
  }

  /** 颜色：文本 + 取色器。 */
  function colorLiteralControl(value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    const input = textInput(value ?? '', set, { placeholder: '#rrggbb' });
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'definition-color-picker';
    picker.value = paramColorSwatch(value) || '#000000';
    picker.title = '选择颜色';
    picker.addEventListener('input', () => { input.value = picker.value; set(picker.value); });
    shell.appendChild(input);
    shell.appendChild(picker);
    return shell;
  }

  /** 按键：文本 + 常用 keyevent 选择器。 */
  function keyLiteralControl(value: any, set: (value: any) => void): UiNode {
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

  function rectLiteralControl(value: any, set: (value: any) => void): UiNode {
    const shell = el('div', 'rect-control');
    const values = Array.isArray(value) && value.length === 4 ? value : [0, 0, 100, 100];
    values.forEach((item: any, index: number) => shell.appendChild(textInput(item, (next: string) => { const updated = values.slice(); updated[index] = parseInt(next || '0', 10); set(updated); }, { type: 'number' })));
    return shell;
  }

  const publicInputModeCache = new WeakMap();
  function changePublicInputMode(holder: any, name: string, definition: any, next: string, refs: string[]): void {
    const inputs = holder.inputs;
    const current = inputs[name];
    const exists = Object.prototype.hasOwnProperty.call(inputs, name);
    const bound = current && typeof current === 'object' && !Array.isArray(current) && typeof current.ref === 'string';
    const mode = !exists ? 'default' : bound ? 'binding' : 'literal';
    if (next === mode || !['default', 'literal', 'binding'].includes(next)) return;
    if (next === 'binding' && !refs.length) return;
    let cache = publicInputModeCache.get(inputs);
    if (!cache) { cache = new Map(); publicInputModeCache.set(inputs, cache); }
    const saved = cache.get(name) || {};
    if (exists) saved[mode] = clone(current);
    cache.set(name, saved);
    if (next === 'default') delete inputs[name];
    else if (next === 'literal') inputs[name] = Object.prototype.hasOwnProperty.call(saved, 'literal') ? clone(saved.literal) : defaultValue(definition);
    else inputs[name] = { ref: saved.binding && refs.includes(saved.binding.ref) ? saved.binding.ref : refs[0] };
  }

  function renderPublicWorkflowInputs(body: UiNode, holder: any, reference: any, allowRuntimeVariables = true, keyPrefix: string = ''): void {
    if (!holder.inputs || typeof holder.inputs !== 'object' || Array.isArray(holder.inputs)) holder.inputs = {};
    const variables = workflowInputs(reference);
    section(body, '工作流输入');
    if (!variables.length) body.appendChild(el('div', 'empty-section', reference ? '该子工作流没有输入' : '请先选择子工作流'));
    variables.forEach((variable) => {
      const definition = variable.definition || {};
      const block = el('div', 'run-variable-block');
      const heading = el('div', 'run-variable-heading');
      const name = el('span', 'run-input-name', `${displayNameOfDefinition(definition, variable.name)}${definition.required ? ' *' : ''}`);
      name.title = `${variable.name} · ${definition.type || 'any'}`;
      heading.appendChild(name);
      block.appendChild(heading);
      const current = holder.inputs[variable.name];
      const binding = current && typeof current === 'object' && !Array.isArray(current) && typeof current.ref === 'string';
      const exists = Object.prototype.hasOwnProperty.call(holder.inputs, variable.name);
      const mode = !exists ? 'default' : binding ? 'binding' : 'literal';
      const refs = parentVariableRefs(definition, allowRuntimeVariables);
      heading.appendChild(UI.segmented({value:mode,label:`${variable.name}的来源`,options:[
        {value:'default',label:'默认',title:'使用子工作流默认值；没有默认值时不传入'},
        {value:'literal',label:'固定值'},
        {value:'binding',label:'引用',disabled:!refs.length && mode !== 'binding',title:refs.length ? (allowRuntimeVariables ? '引用父级输入或变量' : '引用父输入') : '没有兼容引用'},
      ],onChange:next=>mutate(()=>changePublicInputMode(holder,variable.name,definition,next,refs))}));
      const valueRow = el('div', 'run-input-value');
      valueRow.setAttribute('role', 'group'); valueRow.setAttribute('aria-label', variable.name);
      if (mode === 'binding') {
        valueRow.appendChild(UI.dropdown({value:current.ref || '',label:`${variable.name}的引用`,options:refs.length ? refs.map(ref=>({value:ref,label:referenceLabel(ref)})) : [{value:current.ref || '',label:'没有兼容引用'}],onChange:ref=>mutate(()=>{holder.inputs[variable.name]={ref};})}));
      } else if (mode === 'literal') {
        valueRow.appendChild(runInputLiteralControl(holder, variable.name, definition, `${keyPrefix}${variable.name}`));
      } else {
        const hasDefault = Object.prototype.hasOwnProperty.call(definition, 'default');
        const preview = el('div', `run-input-default${!hasDefault && definition.required ? ' missing' : ''}`);
        preview.textContent = hasDefault ? `默认：${compactValue(definition.default, 70)}` : definition.required ? '未传值 · 此项必填' : '未传值 · 可选';
        if (hasDefault) preview.title = compactValue(definition.default, Infinity);
        valueRow.appendChild(preview);
      }
      block.appendChild(valueRow);
      if (definition.description) {
        const help = el('details', 'run-input-help'); help.appendChild(el('summary', '', '说明'));
        help.appendChild(el('div', 'description', definition.description)); block.appendChild(help);
      }
      body.appendChild(block);
    });
    const privateKeys = Object.keys(holder.inputs).filter((name) => !variables.some((variable) => variable.name === name));
    if (privateKeys.length) body.appendChild(el('div', 'private-input-warning', `未知输入：${privateKeys.join(', ')}`));
  }

  function renderInstanceRunInspector(): void {
    const selection = state.selectedRun;
    const node = selection && nodeById(selection.nodeId);
    const run = node && Array.isArray(node.runs) ? node.runs[selection.index] : null;
    if (!node || !run) { state.selectedRun = null; renderInspector(); return; }
    if (!run.inputs || typeof run.inputs !== 'object' || Array.isArray(run.inputs)) run.inputs = {};
    const body = clearInspector(runtimeInstanceLabel(run.instance, `运行 ${selection.index + 1}`));
    section(body, '子工作流');
    const instanceOptions = (state.instances || []).map((item) => ({ value: item.id, label: runtimeInstanceLabel(item.id) }));
    field(body, '实例').appendChild(selectInput(run.instance || '', instanceOptions.length ? instanceOptions : [{ value: run.instance || '', label: run.instance || '未配置实例' }], (value) => mutate(() => { run.instance = value; })));
    const workflowOptions = (state.workflows || []).filter((item) => item && item.rel).map((item) => {
      const relative = workflowReference(item);
      return { value: relative, label: item.name || relative };
    });
    field(body, '工作流').appendChild(selectInput(run.workflow || '', [{ value: '', label: '选择工作流' }, ...workflowOptions], (value) => mutate(() => { run.workflow = value; run.inputs = {}; })));
    if (run.workflow) {
      const open = el('button', 'full-command', '打开子工作流');
      open.addEventListener('click', () => requestOpenWorkflowReference(run.workflow));
      body.appendChild(open);
    }
    renderPublicWorkflowInputs(body, run, run.workflow, true, `${selection.nodeId}:${selection.index}:inputs:`);
    const remove = el('button', 'danger full-command', '删除实例运行项');
    remove.addEventListener('click', () => removeInstanceRun(node, selection.index));
    body.appendChild(remove);
  }

  return {
    renderTaskInspector, removeInstanceRun, parentVariableRefs, runInputLiteralControl, rectLiteralControl,
    changePublicInputMode, renderPublicWorkflowInputs, renderInstanceRunInspector,
  };
}
