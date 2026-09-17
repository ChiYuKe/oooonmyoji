/**
 * 复合节点与装饰器详情面板：渲染组合节点设置、子节点列表与装饰器编辑。
 * 原 `editor-composite-inspector.js`；迁移期由 main.ts 以 window.StudioEditorCompositeInspector 挂载。
 *
 * 返回对象同时暴露迁移期的内部函数（decoratorField/decoratorVectorField/
 * decoratorParameterControl/exposeDecoratorParameter/retryPublicActions），
 * 供编译产物测试使用；阶段 4d 拆出 inspector 模块后收回。
 */
import { createVariableSystem } from '../model/variable-system';

export type UiNode = HTMLElement & Record<string, any>;

export interface CompositeNode {
  id?: string;
  type: string;
  name?: string;
  [key: string]: any;
}

export interface DecoratorLike {
  type: string;
  [key: string]: any;
}

export interface CompositeInspectorState {
  raw: { inputs?: Record<string, any>; variables?: Record<string, any>; [key: string]: any } | null;
  instances?: Array<{ id: string }>;
  workflows?: Array<{ name?: string; rel?: string }>;
  selected: Set<string>;
  selectedEdge: unknown;
  selectedRun: { nodeId: string; index: number } | null;
  [key: string]: any;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface CompositeInspectorDeps {
  el(tag: string, className?: string, text?: string): UiNode;
  section(body: UiNode, title: string, action?: UiNode): void;
  field(body: UiNode, label: string): UiNode;
  selectInput(value: unknown, options: SelectOption[], onChange: (value: string) => void, className?: string): UiNode;
  checkbox(checked: boolean, onChange: (value: boolean) => void): UiNode;
  segmentedInput(value: string, options: SelectOption[], onChange: (value: string) => void): UiNode;
  textInput(value: unknown, onChange: (value: string) => void, options?: { type?: string; min?: number; step?: number; className?: string }): UiNode;
  iconButton(className: string, tip: string, icon: string, onClick: () => void): UiNode;
  addRowButton(label: string, onClick: () => void): UiNode;
  conditionControl(value: unknown, onChange: (value: unknown) => void, options: { node: CompositeNode }): UiNode;
  conditionOperandControl(value: unknown, onChange: (value: unknown) => void, options: { node: CompositeNode }): UiNode;
  conditionParseLiteral(value: string): unknown;
  nodeChildrenOptions(node: CompositeNode, current?: unknown): SelectOption[];
  nodeById(id: string): { name?: string } | undefined;
  mutate(fn: () => void): void;
  disconnect(nodeId: string, childId: string): void;
  runtimeInstanceLabel(id: string): string;
  removeInstanceRun(node: CompositeNode, index: number): void;
  workflowInputs(reference: unknown): unknown[];
  render(): void;
  state: CompositeInspectorState;
  decoratorLabel(decorator: DecoratorLike): string;
  isBindingValue(value: unknown): value is { ref: string };
  clone<T>(value: T): T;
  allRefs(node: CompositeNode, schema?: { type: string; min?: number }, existsOnly?: boolean): string[];
  referenceLabel(ref: string): string;
  valueBindingMenu(node: CompositeNode, preset: unknown, getValue: () => unknown, applyValue: (value: unknown) => void, label: string): UiNode;
  toast(message: string, error?: boolean): void;
  UI: { button(options: { label: string; disabled?: boolean; tip?: string; onClick?: () => void }): UiNode };
}

export interface CompositeInspector {
  renderCompositeInspector(body: UiNode, node: CompositeNode): void;
  renderDecorators(body: UiNode, node: CompositeNode): void;
  // 迁移期测试可见的内部实现
  renderDecorator(body: UiNode, node: CompositeNode, decorator: DecoratorLike, index: number): void;
  decoratorField(label: string, control: UiNode): UiNode;
  decoratorVectorField(label: string, control: UiNode): UiNode;
  decoratorParameterControl(node: CompositeNode, decorator: DecoratorLike, key: string, literalControl: UiNode, actionTarget?: UiNode | null): UiNode;
  exposeDecoratorParameter(node: CompositeNode, decorator: DecoratorLike, key: string | string[]): void;
  retryPublicActions(node: CompositeNode, decorator: DecoratorLike): UiNode;
}

export function createCompositeInspector(deps: CompositeInspectorDeps): CompositeInspector {
  const {
    el, section, field, selectInput, checkbox, segmentedInput, textInput, iconButton, addRowButton,
    conditionControl, conditionOperandControl, conditionParseLiteral, nodeChildrenOptions, nodeById,
    mutate, disconnect, runtimeInstanceLabel, removeInstanceRun, workflowInputs, render, state,
    decoratorLabel, isBindingValue, clone, allRefs, referenceLabel, valueBindingMenu, toast, UI,
  } = deps;

  function renderCompositeInspector(body: UiNode, node: CompositeNode): void {
    if (!['sequence', 'selector'].includes(node.type)) section(body, '执行设置');
    if (node.type === 'selector') body.appendChild(el('div', 'description', '按顺序执行，首个成功后返回成功。'));
    if (node.type === 'sequence') body.appendChild(el('div', 'description', '按顺序执行，首个失败后返回失败。'));
    if (node.type === 'parallel') {
      body.appendChild(el('div', 'description', '并发执行所有子节点。'));
      const wait = field(body, '完成条件');
      wait.appendChild(selectInput(node.wait_for || 'all', [{ value: 'all', label: '全部完成' }, { value: 'any', label: '任一成功' }], (value) => mutate(() => { node.wait_for = value; })));
      const cancel = field(body, '失败时取消其他分支');
      cancel.appendChild(checkbox(node.cancel_on_failure !== false, (value) => mutate(() => { node.cancel_on_failure = value; })));
    }
    if (node.type === 'repeat_until') {
      body.appendChild(el('div', 'description', '重复执行唯一子节点，直到条件成立。'));
      const condition = field(body, '结束条件');
      condition.classList.add('tall-control');
      condition.appendChild(conditionControl(node.condition === undefined ? { eq: [1, 1] } : node.condition, (value) => mutate(() => { node.condition = value; }), { node }));
      const max = field(body, '最大次数');
      max.appendChild(textInput(node.max_iterations || 100, (value) => mutate(() => { node.max_iterations = Math.max(1, parseInt(value || '100', 10)); }), { type: 'number', min: 1, step: 1 }));
    }
    if (node.type === 'branch') {
      body.appendChild(el('div', 'description', '按 conditions 顺序选择第一个成立的分支。'));
      const conditions = Array.isArray(node.conditions) ? node.conditions : [];
      const wrap = el('div', 'object-array');
      conditions.forEach((item: unknown, index: number) => {
        const card = el('div', 'object-array-card');
        const head = el('div', 'object-array-head');
        head.appendChild(el('span', 'object-array-title', `分支 ${index + 1}`));
        const actions = el('div', 'object-array-actions');
        actions.appendChild(iconButton('object-array-move', '上移', 'arrow-up', () => mutate(() => { const updated = node.conditions.slice(); [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]; node.conditions = updated; })));
        actions.appendChild(iconButton('object-array-move', '下移', 'arrow-down', () => mutate(() => { const updated = node.conditions.slice(); [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]]; node.conditions = updated; })));
        actions.appendChild(iconButton('object-array-remove', '删除该分支', 'trash', () => mutate(() => { node.conditions.splice(index, 1); })));
        head.appendChild(actions);
        card.appendChild(head);
        card.appendChild(conditionControl(item, (value) => mutate(() => { node.conditions[index] = value; }), { node }));
        wrap.appendChild(card);
      });
      wrap.appendChild(addRowButton('添加分支', () => mutate(() => { node.conditions.push({ eq: [1, 1] }); })));
      body.appendChild(wrap);
    }
    if (node.type === 'switch') {
      body.appendChild(el('div', 'description', '按 expression 的值匹配 cases。'));
      const expression = field(body, '表达式');
      expression.classList.add('tall-control');
      expression.appendChild(conditionOperandControl(node.expression ?? 0, (value) => mutate(() => { node.expression = value; }), { node }));
      const cases = Array.isArray(node.cases) ? node.cases : [];
      const wrap = el('div', 'object-array');
      cases.forEach((item: any, index: number) => {
        const card = el('div', 'object-array-card');
        const head = el('div', 'object-array-head');
        head.appendChild(el('span', 'object-array-title', `分支 ${index + 1}`));
        const actions = el('div', 'object-array-actions');
        actions.appendChild(iconButton('object-array-move', '上移', 'arrow-up', () => mutate(() => { const updated = node.cases.slice(); [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]; node.cases = updated; })));
        actions.appendChild(iconButton('object-array-move', '下移', 'arrow-down', () => mutate(() => { const updated = node.cases.slice(); [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]]; node.cases = updated; })));
        actions.appendChild(iconButton('object-array-remove', '删除该分支', 'trash', () => mutate(() => { node.cases.splice(index, 1); })));
        head.appendChild(actions);
        card.appendChild(head);
        const whenRow = field(card, '匹配值');
        whenRow.classList.add('tall-control');
        whenRow.appendChild(textInput(item && item.value, (value) => mutate(() => { node.cases[index] = { ...node.cases[index], value: conditionParseLiteral(value) }; }), { className: 'full' }));
        const childRow = field(card, '目标子节点');
        childRow.classList.add('tall-control');
        childRow.appendChild(selectInput(item && item.child || '', nodeChildrenOptions(node, item && item.child), (value) => mutate(() => { node.cases[index] = { ...node.cases[index], child: value }; }), 'full'));
        wrap.appendChild(card);
      });
      wrap.appendChild(addRowButton('添加分支', () => mutate(() => {
        if (!Array.isArray(node.cases)) node.cases = [];
        node.cases.push({ value: 0, child: nodeChildrenOptions(node, '')[0] ? nodeChildrenOptions(node, '')[0].value : '' });
      })));
      body.appendChild(wrap);
      if (nodeChildrenOptions(node, node.default_child).length) {
        const defaultRow = field(body, '默认子节点');
        defaultRow.appendChild(selectInput(node.default_child || '', [{ value: '', label: '未设置' }, ...nodeChildrenOptions(node, node.default_child)], (value) => mutate(() => { node.default_child = value || undefined; }), 'full'));
      }
    }
    if (node.type === 'simple_parallel') {
      body.appendChild(el('div', 'description', '第 1 个子节点是主 Task，第 2 个是后台分支。'));
      const finish = field(body, '结束模式');
      finish.appendChild(selectInput(node.finish_mode || 'abort_background', [
        { value: 'abort_background', label: '主任务结束时中止后台' },
        { value: 'wait_for_background', label: '主任务结束后等待后台' },
      ], (value) => mutate(() => { node.finish_mode = value; })));
    }
    if (node.type === 'instance_parallel') {
      body.appendChild(el('div', 'description', 'Supervisor 会同时把每个运行项投递到对应实例。该节点不能连接普通子节点。'));
      const wait = field(body, '完成条件');
      wait.appendChild(selectInput(node.wait_for || 'all', [
        { value: 'all', label: '全部实例完成' },
        { value: 'any', label: '任一实例完成' },
      ], (value) => mutate(() => { node.wait_for = value; })));
      const cancel = field(body, '失败时取消其他实例');
      cancel.appendChild(checkbox(node.cancel_on_failure !== false, (value) => mutate(() => { node.cancel_on_failure = value; })));
      section(body, '实例运行项');
      if (!Array.isArray(node.runs)) node.runs = [];
      const instanceOptions = (state.instances || []).map((item) => ({ value: item.id, label: runtimeInstanceLabel(item.id) }));
      const workflowOptions = (state.workflows || []).filter((item) => item && item.rel).map((item) => {
        const relative = String(item.rel).replace(/^.*workflows[\\/]/i, '');
        return { value: relative, label: item.name || relative };
      });
      node.runs.forEach((run: any, index: number) => {
        const block = el('div', 'instance-run-block');
        const heading = el('div', 'parameter-heading');
        heading.appendChild(el('span', '', `运行 ${index + 1} · ${runtimeInstanceLabel(run.instance)}`));
        const remove = el('button', 'icon-button danger', '×');
        remove.title = '删除运行项';
        remove.addEventListener('click', () => removeInstanceRun(node, index));
        heading.appendChild(remove);
        block.appendChild(heading);
        const instanceRow = field(block, '实例');
        instanceRow.appendChild(selectInput(run.instance || '', instanceOptions.length ? instanceOptions : [{ value: run.instance || '', label: run.instance || '未配置实例' }], (value) => mutate(() => { run.instance = value; })));
        const workflowRow = field(block, '工作流');
        workflowRow.appendChild(selectInput(run.workflow || '', workflowOptions.length ? [{ value: '', label: '选择工作流' }, ...workflowOptions] : [{ value: run.workflow || '', label: run.workflow || '输入路径' }], (value) => mutate(() => { run.workflow = value; run.inputs = {}; })));
        const edit = el('button', 'full-command', `编辑工作流输入（${workflowInputs(run.workflow).length}）`);
        edit.addEventListener('click', () => {
          state.selected.clear();
          state.selectedEdge = null;
          state.selectedRun = { nodeId: node.id ?? '', index };
          render();
        });
        block.appendChild(edit);
        body.appendChild(block);
      });
      const addRun = el('button', 'full-command', '＋ 添加实例运行项');
      addRun.addEventListener('click', () => {
        const index = node.runs.length;
        mutate(() => {
          node.runs.push({ instance: state.instances?.[0]?.id || '', workflow: '', inputs: {} });
          state.selected.clear();
          state.selectedEdge = null;
          state.selectedRun = { nodeId: node.id ?? '', index };
        });
      });
      body.appendChild(addRun);
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    section(body, `子节点 · ${children.length}`);
    if (!children.length) body.appendChild(el('div', 'empty-section', '尚未连接'));
    children.forEach((childId: string, index: number) => {
      const row = el('div', 'child-row');
      row.appendChild(el('span', 'child-order', String(index + 1)));
      const childName = el('span', 'child-name', nodeById(childId)?.name || childId);
      childName.title = `${childName.textContent}\n${childId}`;
      row.appendChild(childName);
      const up = el('button', 'icon-button', '↑');
      up.title = '提高优先级';
      up.disabled = index === 0;
      up.addEventListener('click', () => mutate(() => { const value = node.children.splice(index, 1)[0]; node.children.splice(index - 1, 0, value); }));
      const down = el('button', 'icon-button', '↓');
      down.title = '降低优先级';
      down.disabled = index === children.length - 1;
      down.addEventListener('click', () => mutate(() => { const value = node.children.splice(index, 1)[0]; node.children.splice(index + 1, 0, value); }));
      const remove = el('button', 'icon-button danger', '×');
      remove.title = '断开连接';
      remove.addEventListener('click', () => mutate(() => disconnect(node.id ?? '', childId)));
      row.appendChild(up);
      row.appendChild(down);
      row.appendChild(remove);
      body.appendChild(row);
    });
  }

  function renderDecorators(body: UiNode, node: CompositeNode): void {
    const add = selectInput('', [
      { value: '', label: '＋ 添加' }, { value: 'condition', label: 'Condition' }, { value: 'cooldown', label: 'Cooldown' },
      { value: 'timeout', label: 'Time Limit' }, { value: 'retry', label: 'Retry' }, { value: 'repeat', label: 'Repeat' },
      { value: 'do_once', label: 'Do Once' },
    ], (type) => {
      if (!type) return;
      mutate(() => {
        if (!Array.isArray(node.decorators)) node.decorators = [];
        const defaults: Record<string, DecoratorLike> = { condition: { type, expression: true }, cooldown: { type, seconds: 1 }, timeout: { type, seconds: 10 }, retry: { type, attempts: 2, delay_seconds: 0 }, repeat: { type, count: 2 }, do_once: { type, reset_on_failure: false } };
        node.decorators.push(defaults[type]);
      });
    }, 'decorator-add');
    section(body, '装饰器', add);
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];
    if (!decorators.length) body.appendChild(el('div', 'empty-section', '无装饰器'));
    decorators.forEach((decorator: DecoratorLike, index: number) => renderDecorator(body, node, decorator, index));
  }

  function decoratorField(label: string, control: UiNode): UiNode {
    const fieldNode = el('div', 'decorator-field');
    const caption = el('span', 'decorator-field-label', label);
    const actions = control.querySelector?.('.decorator-param-actions') as UiNode | null;
    if (actions) actions.prepend(caption);
    else fieldNode.appendChild(caption);
    fieldNode.appendChild(control);
    return fieldNode;
  }

  function decoratorVectorField(label: string, control: UiNode): UiNode {
    const fieldNode = el('div', 'decorator-vector-component');
    const input = control.children[1] as UiNode;
    const value = el('div', 'decorator-vector-value');
    const caption = el('span', 'decorator-vector-label', label);
    input.setAttribute('aria-label', label === '次数' ? '重试尝试次数' : '重试间隔（秒）');
    value.appendChild(caption);
    value.appendChild(input);
    fieldNode.appendChild(value);
    return fieldNode;
  }

  const decoratorLiteralCache = new WeakMap<DecoratorLike, Record<string, unknown>>();

  function decoratorParameterDefinition(decorator: DecoratorLike, key: string): { type: string; min?: number } {
    if (key === 'expression') return { type: typeof decorator.expression === 'boolean' ? 'boolean' : 'object' };
    if (key === 'reset_on_failure') return { type: 'boolean' };
    if (key === 'attempts') return { type: 'integer', min: 1 };
    return { type: 'number', min: key === 'delay_seconds' ? 0 : 0.001 };
  }

  function exposeDecoratorParameter(node: CompositeNode, decorator: DecoratorLike, key: string | string[]): void {
    const raw = state.raw;
    if (!raw) return;
    const keys = (Array.isArray(key) ? key : [key]).filter((item) => !isBindingValue(decorator[item]));
    if (!keys.length) return;
    const names: string[] = [];
    mutate(() => {
      if (!raw.inputs || typeof raw.inputs !== 'object' || Array.isArray(raw.inputs)) raw.inputs = {};
      for (const item of keys) {
        const current = decorator[item] ?? (item === 'reset_on_failure' ? false : item === 'attempts' ? 1 : 0);
        const base = `${String(node.id || 'node').replace(/[^\w\u4e00-\u9fff-]/g, '_')}_${decorator.type}_${item}`;
        let name = base, suffix = 1;
        while (Object.prototype.hasOwnProperty.call(raw.inputs, name) || Object.prototype.hasOwnProperty.call(raw.variables || {}, name)) name = `${base}_${++suffix}`;
        const cache = decoratorLiteralCache.get(decorator) || {};
        cache[item] = clone(current);
        decoratorLiteralCache.set(decorator, cache);
        raw.inputs![name] = { ...decoratorParameterDefinition(decorator, item), default: clone(current), _autoPublished: true };
        decorator[item] = { ref: `inputs.${name}` };
        names.push(name);
      }
    });
    toast(`已公开为输入：${names.join('、')}`);
  }

  function restoreDecoratorParameter(decorator: DecoratorLike, key: string): void {
    if (!state.raw) return;
    const current = decorator[key];
    if (!isBindingValue(current)) return;
    const cache = decoratorLiteralCache.get(decorator) || {};
    const initial = VariableSystemDefaultAt(state.raw, current.ref);
    decorator[key] = initial !== undefined ? initial : Object.prototype.hasOwnProperty.call(cache, key) ? clone(cache[key]) : key === 'expression' ? true : key === 'reset_on_failure' ? false : key === 'delay_seconds' ? 0 : 1;
  }

  function retryPublicActions(node: CompositeNode, decorator: DecoratorLike): UiNode {
    const actions = el('div', 'decorator-param-actions');
    const keys = ['attempts', 'delay_seconds'];
    const bound = keys.every((key) => isBindingValue(decorator[key]));
    const exposed = bound && keys.every((key) => (decorator[key] as { ref: string }).ref.startsWith('inputs.'));
    actions.appendChild(UI.button({
      label: exposed ? '已公开' : bound ? '已绑定' : '公开',
      disabled: bound,
      tip: '将重试配置公开为一个结构体输入',
      onClick: () => {
        const raw = state.raw;
        if (!raw) return;
        if (keys.some((key) => isBindingValue(decorator[key]))) { exposeDecoratorParameter(node, decorator, keys); return; }
        mutate(() => {
          const id = VariableSystemCreate(raw, 'inputs', `${node.name || node.id} · 重试配置`, { ...VariableSystemPresets.retry, _autoPublished: true }, { attempts: decorator.attempts ?? 1, delay_seconds: decorator.delay_seconds ?? 0 });
          for (const key of keys) decorator[key] = { ref: `inputs.${id}.${key}` };
        });
      },
    }));
    actions.appendChild(valueBindingMenu(node, VariableSystemPresets.retry, () => ({ attempts: decorator.attempts, delay_seconds: decorator.delay_seconds }), (value) => { for (const key of keys) decorator[key] = isBindingValue(value) ? { ref: `${value.ref}.${key}` } : (value as Record<string, unknown>)[key]; }, '重试配置'));
    if (keys.some((key) => isBindingValue(decorator[key]))) actions.appendChild(UI.button({ label: '固定值', tip: '恢复整组固定值，清理不再使用的自动输入', onClick: () => mutate(() => keys.forEach((key) => restoreDecoratorParameter(decorator, key))) }));
    return actions;
  }

  function decoratorParameterControl(node: CompositeNode, decorator: DecoratorLike, key: string, literalControl: UiNode, actionTarget: UiNode | null = null): UiNode {
    const shell = el('div', 'decorator-parameter');
    const actions = el('div', 'decorator-param-actions');
    const current = decorator[key], bound = isBindingValue(current);
    const exposed = bound && current.ref.startsWith('inputs.') && Object.prototype.hasOwnProperty.call(state.raw?.inputs || {}, current.ref.slice(7));
    actions.appendChild(UI.button({ label: exposed ? '已公开' : '公开', disabled: bound, tip: exposed ? '已绑定工作流输入，可在变量详情中编辑默认值' : '将当前值公开为工作流输入', onClick: () => exposeDecoratorParameter(node, decorator, key) }));
    if (bound) actions.appendChild(UI.button({
      label: '固定值',
      tip: '恢复固定值，清理不再使用的自动输入',
      onClick: () => mutate(() => {
        restoreDecoratorParameter(decorator, key);
      }),
    }));
    (actionTarget || shell).appendChild(actions);
    if (bound) {
      const refs = allRefs(node, key === 'expression' ? undefined : decoratorParameterDefinition(decorator, key));
      const options = refs.includes(current.ref) ? refs : [current.ref, ...refs];
      shell.appendChild(selectInput(current.ref, options.map((ref) => ({ value: ref, label: referenceLabel(ref) })), (ref) => mutate(() => { decorator[key] = { ref }; }), 'full'));
    } else shell.appendChild(literalControl);
    return shell;
  }

  function renderDecorator(body: UiNode, node: CompositeNode, decorator: DecoratorLike, index: number): void {
    const block = el('div', 'decorator-block');
    const titles: Record<string, string> = { retry: '失败重试', repeat: '重复执行', cooldown: '冷却', timeout: '限时', condition: '条件', do_once: '仅执行一次' };
    const subtitles: Record<string, string> = { retry: 'Retry', repeat: 'Repeat', cooldown: 'Cooldown', timeout: 'Time Limit', condition: 'Condition', do_once: 'Do Once' };
    const head = el('div', 'decorator-heading');
    const title = el('span', 'decorator-title', titles[decorator.type] || decoratorLabel(decorator));
    title.title = decoratorLabel(decorator);
    head.appendChild(title);
    head.appendChild(el('span', 'decorator-subtitle', subtitles[decorator.type] || ''));
    const headActions = el('div', 'decorator-head-actions');
    head.appendChild(headActions);
    const remove = el('button', 'decorator-remove danger', '删除');
    remove.title = '移除装饰器';
    remove.setAttribute('aria-label', `移除${titles[decorator.type] || '装饰器'}`);
    remove.addEventListener('click', () => mutate(() => node.decorators.splice(index, 1)));
    block.appendChild(head);
    if (decorator.type === 'condition') block.appendChild(decoratorParameterControl(node, decorator, 'expression', conditionDecoratorControl(node, decorator), headActions));
    else if (decorator.type === 'cooldown' || decorator.type === 'timeout') {
      const fieldNode = decoratorField('时长（秒）', decoratorParameterControl(node, decorator, 'seconds', textInput(decorator.seconds, (value) => mutate(() => { decorator.seconds = Math.max(0.001, parseFloat(value || '0')); }), { type: 'number', min: 0.001, step: 0.1 }), headActions));
      fieldNode.classList.add('decorator-field-inline');
      block.appendChild(fieldNode);
    } else if (decorator.type === 'retry') {
      headActions.appendChild(retryPublicActions(node, decorator));
      const row = el('div', 'decorator-vector');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', '重试次数与间隔');
      row.appendChild(decoratorVectorField('次数', decoratorParameterControl(node, decorator, 'attempts', textInput(decorator.attempts, (value) => mutate(() => { decorator.attempts = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1, step: 1 }))));
      row.appendChild(decoratorVectorField('间隔·秒', decoratorParameterControl(node, decorator, 'delay_seconds', textInput(decorator.delay_seconds || 0, (value) => mutate(() => { decorator.delay_seconds = Math.max(0, parseFloat(value || '0')); }), { type: 'number', min: 0, step: 0.1 }))));
      block.appendChild(row);
    } else if (decorator.type === 'repeat') {
      const control = repeatDecoratorControl(node, decorator);
      const expose = control.querySelector('.decorator-expose') as UiNode | null;
      if (expose) headActions.appendChild(expose);
      control.title = '循环次数';
      block.appendChild(control);
    } else if (decorator.type === 'do_once') {
      const row = el('label', 'inline-control');
      row.appendChild(checkbox(decorator.reset_on_failure === true, (value) => mutate(() => { decorator.reset_on_failure = value; if (!value) delete decorator.reset_on_failure; })));
      row.appendChild(el('span', 'do-once-note', '失败后重置，成功后锁定'));
      block.appendChild(decoratorParameterControl(node, decorator, 'reset_on_failure', row, headActions));
    }
    headActions.appendChild(remove);
    body.appendChild(block);
  }

  function repeatDecoratorControl(node: CompositeNode, decorator: DecoratorLike): UiNode {
    const shell = el('div', 'inline-control repeat-decorator-control');
    const isBinding = decorator.count && typeof decorator.count === 'object' && !Array.isArray(decorator.count) && typeof decorator.count.ref === 'string';
    const refs = allRefs(node, { type: 'integer' });
    const currentRef = isBinding ? decorator.count.ref : '';
    const mode = segmentedInput(isBinding ? 'reference' : 'literal', [
      { value: 'literal', label: '固定值' },
      ...((isBinding || refs.length) ? [{ value: 'reference', label: '变量' }] : []),
    ], (next) => {
      if (next === 'reference') {
        const available = allRefs(node, { type: 'integer' });
        if (!available.length && !currentRef) {
          toast('没有可用的整数引用', true);
          return;
        }
        mutate(() => { decorator.count = { ref: currentRef && (available.includes(currentRef) || !available.length) ? currentRef : available[0] }; });
      } else {
        const value = isBinding ? 1 : decorator.count;
        mutate(() => { decorator.count = Math.max(1, Number.isInteger(value) ? value : parseInt(value || '1', 10)); });
      }
    });
    shell.appendChild(mode);
    if (isBinding) {
      const options = currentRef && !refs.includes(currentRef) ? [currentRef, ...refs] : refs;
      shell.appendChild(selectInput(currentRef, (options.length ? options : ['']).map((ref) => ({ value: ref, label: referenceLabel(ref) })), (ref) => mutate(() => { decorator.count = { ref }; }), 'full'));
    } else {
      shell.appendChild(textInput(decorator.count, (value) => mutate(() => { decorator.count = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1, step: 1 }));
    }
    const exposed = isBinding && currentRef.startsWith('inputs.');
    const expose = el('button', 'decorator-expose', exposed ? '已公开' : '公开');
    expose.type = 'button';
    expose.disabled = exposed;
    expose.title = exposed ? '循环次数已公开为工作流输入' : '创建一个整数工作流输入，并将循环次数绑定到它';
    expose.addEventListener('click', () => exposeRepeatCount(node, decorator));
    shell.appendChild(expose);
    return shell;
  }

  function exposeRepeatCount(node: CompositeNode, decorator: DecoratorLike): void {
    const raw = state.raw;
    if (!raw) return;
    let name = `${String(node.id || 'node').replace(/[^\w\u4e00-\u9fff-]/g, '_')}_repeat_count`;
    const inputs = raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs) ? raw.inputs : {};
    let suffix = 1;
    const base = name;
    while (Object.prototype.hasOwnProperty.call(inputs, name) || Object.prototype.hasOwnProperty.call(raw.variables || {}, name)) {
      suffix += 1;
      name = `${base}_${suffix}`;
    }
    const literal = Number.isInteger(decorator.count) ? Math.max(1, decorator.count) : 1;
    mutate(() => {
      if (raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs)) raw.inputs[name] = { type: 'integer', default: literal, _autoPublished: true };
      else raw.inputs = { [name]: { type: 'integer', default: literal } };
      decorator.count = { ref: `inputs.${name}` };
    });
    toast(`循环次数已公开为输入：${name}`);
  }

  function conditionDecoratorControl(node: CompositeNode, decorator: DecoratorLike): UiNode {
    const shell = el('div', 'condition-control');
    const expression = decorator.expression;
    const op = expression && typeof expression === 'object' && !Array.isArray(expression) ? Object.keys(expression)[0] : 'literal';
    const choices = ['literal', 'exists', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'and', 'or', 'not'];
    const labels: Record<string, string> = { literal: '固定条件', exists: '存在', eq: '等于', ne: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', contains: '包含', and: '全部满足', or: '任一满足', not: '取反' };
    shell.appendChild(selectInput(op, choices.map((value) => ({ value, label: labels[value] })), (next) => mutate(() => {
      if (next === 'literal') decorator.expression = true;
      else if (next === 'exists') decorator.expression = { exists: { ref: allRefs(node, undefined, true)[0] || '' } };
      else if (next === 'and' || next === 'or') decorator.expression = { [next]: [true, true] };
      else if (next === 'not') decorator.expression = { not: true };
      else decorator.expression = { [next]: [{ ref: allRefs(node)[0] || '' }, null] };
    }), 'when-op'));
    if (op === 'literal') {
      shell.classList.add('condition-literal');
      const toggle = el('label', 'check-label');
      toggle.appendChild(checkbox(!!expression, (value) => mutate(() => { decorator.expression = value; })));
      toggle.appendChild(el('span', '', '满足条件'));
      shell.appendChild(toggle);
    } else if (op === 'exists') {
      const ref = expression.exists && expression.exists.ref;
      const refs = allRefs(node, undefined, true);
      const options = ref && !refs.includes(ref) ? [ref, ...refs] : refs;
      shell.appendChild(selectInput(ref || '', (options.length ? options : ['']).map((value) => ({ value, label: referenceLabel(value) })), (value) => mutate(() => { decorator.expression = { exists: { ref: value } }; }), 'full'));
    } else if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(op)) {
      const refs = allRefs(node);
      const operands = Array.isArray(expression[op]) ? expression[op] : [{ ref: refs[0] || '' }, null];
      const left = operands[0] && operands[0].ref ? operands[0].ref : refs[0] || '';
      const options = left && !refs.includes(left) ? [left, ...refs] : refs;
      shell.appendChild(selectInput(left, (options.length ? options : ['']).map((value) => ({ value, label: referenceLabel(value) })), (value) => mutate(() => { decorator.expression[op][0] = { ref: value }; }), 'full'));
      const right = textInput(JSON.stringify(operands[1]), (value) => { try { mutate(() => { decorator.expression[op][1] = JSON.parse(value); }); } catch { toast('比较值不是有效 JSON', true); } });
      shell.appendChild(right);
    } else {
      const area = el('textarea', 'json-value');
      area.value = JSON.stringify(expression, null, 2);
      area.addEventListener('change', () => { try { const value = JSON.parse(area.value); mutate(() => { decorator.expression = value; }); } catch { toast('条件不是有效 JSON', true); } });
      shell.appendChild(area);
    }
    return shell;
  }

  return {
    renderCompositeInspector,
    renderDecorators,
    renderDecorator,
    decoratorField,
    decoratorVectorField,
    decoratorParameterControl,
    exposeDecoratorParameter,
    retryPublicActions,
  };
}

/* 迁移期：变量系统的稳定标识与预设原为旧编辑器的全局，改为显式模块依赖。 */
const variableSystem = createVariableSystem();
const VariableSystemDefaultAt = variableSystem.defaultAt;
const VariableSystemCreate = variableSystem.create;
const VariableSystemPresets = variableSystem.presets;
