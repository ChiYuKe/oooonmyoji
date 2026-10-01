/**
 * 复合节点与装饰器详情面板：渲染组合节点设置、子节点列表与装饰器编辑。
 * 原 `editor-composite-inspector.js`；依赖由入口工厂注入。
 *
 * 返回对象同时暴露内部函数（decoratorField/decoratorVectorField/
 * decoratorParameterControl/exposeDecoratorParameter/retryPublicActions），
 * 供编译产物测试使用。
 */
import { createVariableSystem } from '../model/variable-system';
import { isBindingValue } from '../../shared/workflow/bindings';
import { CONDITION_PORT_LABELS, CONDITION_PORT_ORDER, conditionPortsOf } from '../model/exec-ports';
import { nodeDisplayTitle } from '../model/node-title';

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
  conditionControl(value: unknown, onChange: (value: unknown) => void, options: { node: CompositeNode; allowLiteral?: boolean }): UiNode;
  conditionOperandControl(value: unknown, onChange: (value: unknown) => void, options: { node: CompositeNode }): UiNode;
  conditionParseLiteral(value: string): unknown;
  /** 条件表达式 → 中文回读整句；认不出来时返回空串。 */
  conditionSentence(expression: unknown): string;
  /** 条件表达式 → 中文回读（不带「时执行」后缀），布尔判断卡片用它。 */
  conditionToText(expression: unknown): string;
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
    conditionControl, conditionOperandControl, conditionParseLiteral, conditionSentence, conditionToText, nodeChildrenOptions, nodeById,
    mutate, disconnect, runtimeInstanceLabel, removeInstanceRun, workflowInputs, render, state,
    decoratorLabel, clone, allRefs, referenceLabel, valueBindingMenu, toast, UI,
  } = deps;

  function renderCompositeInspector(body: UiNode, node: CompositeNode): void {
    // 值卡片（布尔判断 / 拆分）的内容在画布上的浮动编辑器里编辑（见 value-card-fields.ts），
    // 这里不再分支处理：选中它们不会打开详情面板。
    if (node.type === 'condition') {
      // 判断节点：一个条件 + 真/假两条分支槽位（各最多一个子节点）。
      body.appendChild(el('div', 'description', '判断一个条件：成立走真口、不成立走假口。真/假口各最多接一个子节点，在画布上从口拖线即可连接；两个口都没接时就是纯判断——成立成功、不成立失败。'));
      // UE 分支节点的条件来自左侧 Bool 数据 Pin；不在详情栏再维护一份独立比较表达式。
      // 保留 expression 作为文档兼容/运行时存储，但只能由数据 Pin 连线写入。
      const input = field(body, '布尔输入');
      input.appendChild(el('div', 'condition-input-readonly', '请从节点左侧“布尔条件”端口接入值。'));
      const sentence = conditionSentence(node.expression);
      if (sentence) body.appendChild(el('div', 'condition-readback', sentence));
      section(body, '分支');
      const children = Array.isArray(node.children) ? node.children : [];
      const ports = conditionPortsOf(node);
      for (const port of CONDITION_PORT_ORDER) {
        const index = ports.indexOf(port);
        const childId = index >= 0 && index < children.length ? String(children[index]) : '';
        const slot = el('div', 'condition-slot');
        slot.appendChild(el('span', `condition-slot-title condition-slot-${port}`, CONDITION_PORT_LABELS[port]));
        if (childId) {
          const name = el('span', 'condition-slot-child', nodeDisplayTitle(nodeById(childId)) || '节点已移除');
          name.title = name.textContent || '';
          slot.appendChild(name);
          const removeTip = `断开${CONDITION_PORT_LABELS[port]}口上的分支`;
          const remove = iconButton('icon-button danger condition-slot-remove', removeTip, 'trash', () => {
            mutate(() => disconnect(node.id ?? '', childId));
          });
          slot.appendChild(remove);
        } else {
          slot.appendChild(el('span', 'condition-slot-empty', '未接：这条路径没有内容，按失败返回'));
        }
        body.appendChild(slot);
      }
      return;
    }
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
    if (node.type === 'state_machine') {
      body.appendChild(el('div', 'description', '每轮识别当前画面状态，运行该状态的处理子图，然后重新识别并切换；命中终止状态即成功结束，处理子图失败即整机失败。'));
      section(body, '判断当前画面');
      const classifyRow = field(body, '识别用的动作');
      const catalogNames = ((state.catalog || []) as Array<{ name: string }>).map((item) => item.name);
      if (!catalogNames.includes('vision.detect_state')) catalogNames.unshift('vision.detect_state');
      classifyRow.appendChild(selectInput(node.state_action || 'vision.detect_state', catalogNames.map((name: string) => ({ value: name, label: name })), (value) => mutate(() => { node.state_action = value; }), 'full'));
      body.appendChild(el('div', 'description', '该动作必须接受 states 参数并返回 state 字段；默认的内置识别按模板匹配、全部未命中才降级 OCR。'));
      const ocrRow = field(body, '允许 OCR 兜底');
      ocrRow.appendChild(checkbox(node.allow_ocr !== false, (value) => mutate(() => { node.allow_ocr = value; })));
      const waitRow = field(body, '等待画面出现（秒）');
      waitRow.appendChild(textInput(node.state_timeout_seconds ?? 0, (value) => mutate(() => {
        const seconds = Number(value);
        node.state_timeout_seconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      }), { type: 'number', min: 0, step: 0.5 }));
      const maxRow = field(body, '最大轮数');
      // 轮数可以绑到输入（`运行轮数`）：绑定时这里不再显示数字，避免把引用写成 [object Object]。
      const boundRounds = Boolean(node.max_iterations) && typeof node.max_iterations === 'object';
      if (boundRounds) {
        maxRow.appendChild(el('div', 'description', `已绑定到 ${node.max_iterations.ref}（在连线里换来源）`));
      } else {
        const rounds = typeof node.max_iterations === 'number' ? node.max_iterations : 100;
        maxRow.appendChild(textInput(rounds, (value) => mutate(() => { node.max_iterations = Math.max(1, parseInt(value || '100', 10)); }), { type: 'number', min: 1, step: 1 }));
      }

      section(body, '状态列表');
      if (!Array.isArray(node.states)) node.states = [];
      if (!Array.isArray(node.cases)) node.cases = [];
      const states: any[] = node.states;
      const cases: any[] = node.cases;
      const terminalsOf = (): string[] => (Array.isArray(node.terminal_states) ? node.terminal_states : []);
      const caseFor = (name: unknown): any => cases.find((item: any) => item && item.value === name);
      const renderState = (state: any, index: number) => {
        const card = el('div', 'object-array-card');
        const head = el('div', 'object-array-head');
        head.appendChild(el('span', 'object-array-title', `状态 ${index + 1}`));
        const actions = el('div', 'object-array-actions');
        actions.appendChild(iconButton('object-array-move', '上移', 'arrow-up', () => mutate(() => { const updated = states.slice(); [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]; node.states = updated; })));
        actions.appendChild(iconButton('object-array-move', '下移', 'arrow-down', () => mutate(() => { const updated = states.slice(); [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]]; node.states = updated; })));
        actions.appendChild(iconButton('object-array-remove', '删除该状态', 'trash', () => mutate(() => {
          const removed = states[index];
          node.states = states.filter((_item: any, position: number) => position !== index);
          if (removed && typeof removed.name === 'string') {
            node.cases = cases.filter((item: any) => !item || item.value !== removed.name);
            if (Array.isArray(node.terminal_states)) node.terminal_states = node.terminal_states.filter((name: string) => name !== removed.name);
          }
        })));
        head.appendChild(actions);
        card.appendChild(head);

        const nameRow = field(card, '状态名');
        nameRow.appendChild(textInput(state.name || '', (value) => mutate(() => {
          const previous = state.name;
          state.name = value;
          const entry = caseFor(previous);
          if (entry) entry.value = value;
          if (Array.isArray(node.terminal_states)) node.terminal_states = node.terminal_states.map((name: string) => (name === previous ? value : name));
        }), { className: 'full' }));

        const templateRow = field(card, '模板图');
        templateRow.appendChild(textInput(state.template ?? '', (value) => mutate(() => {
          if (value) state.template = value;
          else delete state.template;
        }), { className: 'full' }));

        const templatesRow = field(card, '模板列表（逗号分隔，任一命中）');
        templatesRow.appendChild(textInput(Array.isArray(state.templates) ? state.templates.join(', ') : '', (value) => mutate(() => {
          const items = String(value).split(',').map((item) => item.trim()).filter(Boolean);
          if (items.length) state.templates = items;
          else delete state.templates;
        }), { className: 'full' }));

        const roiRow = field(card, '识别区域 [x, y, w, h]');
        roiRow.appendChild(textInput(Array.isArray(state.roi) ? state.roi.join(', ') : '', (value) => mutate(() => {
          const parts = String(value).split(',').map((item) => Number(item.trim()));
          if (parts.length === 4 && parts.every((item) => Number.isFinite(item))) state.roi = parts.map((item) => Math.round(item));
        }), { className: 'full' }));

        const thresholdRow = field(card, '匹配阈值');
        thresholdRow.appendChild(textInput(state.threshold ?? 0.85, (value) => mutate(() => { state.threshold = Number(value); }), { type: 'number', min: 0, step: 0.01 }));

        const terminalRow = field(card, '终止状态（识别到即结束）');
        terminalRow.appendChild(checkbox(terminalsOf().includes(state.name), (checked) => mutate(() => {
          const next = terminalsOf().filter((name) => name !== state.name);
          if (checked && state.name) next.push(state.name);
          node.terminal_states = next;
        })));

        const handlerRow = field(card, '处理子节点');
        const entry = caseFor(state.name);
        handlerRow.appendChild(selectInput(entry && entry.child || '', nodeChildrenOptions(node, entry && entry.child), (value) => mutate(() => {
          const current = caseFor(state.name);
          if (current) current.child = value;
          else node.cases.push({ value: state.name, child: value });
          node.children = node.cases.map((item: any) => item && item.child).filter((child: unknown) => typeof child === 'string');
        }), 'full'));
        return card;
      };
      states.forEach((state: any, index: number) => body.appendChild(renderState(state, index)));
      body.appendChild(addRowButton('添加状态', () => mutate(() => {
        const used = new Set(states.map((state: any) => state && state.name));
        let ordinal = states.length + 1;
        while (used.has(`状态${ordinal}`)) ordinal += 1;
        states.push({ name: `状态${ordinal}`, template: '' });
        node.states = states;
      })));

      if (nodeChildrenOptions(node, node.default_child).length) {
        const defaultRow = field(body, '未识别到任何状态时的兜底子节点');
        defaultRow.appendChild(selectInput(node.default_child || '', [{ value: '', label: '未设置（整机失败）' }, ...nodeChildrenOptions(node, node.default_child)], (value) => mutate(() => { node.default_child = value || undefined; }), 'full'));
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
      const childName = el('span', 'child-name', nodeDisplayTitle(nodeById(childId)) || '节点已移除');
      childName.title = childName.textContent || '';
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
      { value: '', label: '＋ 添加' }, { value: 'cooldown', label: 'Cooldown' },
      { value: 'timeout', label: 'Time Limit' }, { value: 'retry', label: 'Retry' }, { value: 'repeat', label: 'Repeat' },
      { value: 'do_once', label: 'Do Once' },
      { value: 'force_success', label: 'Force Success' },
    ], (type) => {
      const defaults: Record<string, DecoratorLike> = { cooldown: { type, seconds: 1 }, timeout: { type, seconds: 10 }, retry: { type, attempts: 2, delay_seconds: 0 }, repeat: { type, count: 2 }, do_once: { type, reset_on_failure: false }, force_success: { type } };
      const decorator = defaults[type];
      if (!decorator) return;
      mutate(() => {
        if (!Array.isArray(node.decorators)) node.decorators = [];
        node.decorators.push(decorator);
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
          const id = VariableSystemCreate(raw, 'inputs', `${nodeDisplayTitle(node)} · 重试配置`, { ...VariableSystemPresets.retry, _autoPublished: true }, { attempts: decorator.attempts ?? 1, delay_seconds: decorator.delay_seconds ?? 0 });
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
    const titles: Record<string, string> = { retry: '失败重试', repeat: '重复执行', cooldown: '冷却', timeout: '限时', do_once: '仅执行一次', force_success: '强制成功' };
    const subtitles: Record<string, string> = { retry: 'Retry', repeat: 'Repeat', cooldown: 'Cooldown', timeout: 'Time Limit', do_once: 'Do Once', force_success: 'Force Success' };
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
    if (decorator.type === 'cooldown' || decorator.type === 'timeout') {
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
    } else if (decorator.type === 'force_success') {
      // UE 的 Force Success：把这一步的失败改写成成功，于是它成为 Sequence 里的「可选分支」。
      // 没有参数，所以这里只给一句说明；改写方向是单向的（成功不会被改写成失败）。
      block.appendChild(el('div', 'do-once-note', '这一步失败也算成功：不会中断顺序节点，取消失败仍然中止。'));
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
