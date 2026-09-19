/**
 * 参数编辑控件：参数行、字面量/结构化/数组/条件控件与字面量缓存。
 * 原 `workflow-editor.js` 的 actionDropdown 至 nodeChildrenOptions 区间。
 *
 * 依赖由调用方注入；控件只通过 onChange 回传编辑结果，不直接修改文档。
 */
import type { Ui } from '../ui/elements';
import type { CanvasState } from '../state/canvas-state';
import { KEY_NAMES, keyOptionLabel } from '../../shared/parameter-types';
import { paramColorSwatch, paramPointParts } from '../render/param-rows';
import { isBindingValue } from '../../shared/workflow/bindings';
import { parameterLiteralCache, parameterLiteralCacheKey } from '../state/literal-cache';

type UiNode = any;

export interface ParameterControlsDeps {
  state: CanvasState;
  mutate(fn: () => void): void;
  UI: Ui;
  el(tag: string, className?: string, text?: string): UiNode;
  $(id: string): HTMLElement;
  clone<T>(value: T): T;
  toast(message: string, isError?: boolean): void;
  defaultValue(definition: any): any;
  allRefs(node: any, definition?: any, includePossible?: boolean): string[];
  referenceLabel(ref: string): string;
  fieldLabel(name: string): string;
  enumOption(value: string): string;
  actionLabel(name: string): string;
  bindAssetPreview(input: UiNode): void;
  assetPreviewForPath(path: string): any;
  assetPathStatus(path: string): any;
  openAssetBrowser(...args: any[]): void;
  requestRoi(...args: any[]): void;
  inputParameterMetadata(definition?: any): any;
  ACTION_LABELS: Record<string, string>;
  requestTemplateCheck(...args: any[]): void;
  /** 兼容引用的选择与「提升为变量」都在画布上做（参数端点拖线 / 端口右键菜单），详情栏不再提供入口。 */
  variableLinks(): Record<string, any>;
  /** 变量显示名（`variables.时长` → 「时长（秒）」），用于绑定说明。 */
  variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback?: string): string;
  requestTemplateReplacement(...args: any[]): void;
  appendMissingAssetAction(...args: any[]): void;
  openWorkflowBrowser(...args: any[]): void;
  renderInspector(): void;
  VariableSystem: { visible(raw: any, owner: any, nodeId: any): boolean; defaultAt(raw: any, ref: any, nodeId?: any): any };
  selectInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void, className?: string): UiNode;
  textInput(value: unknown, onChange: (value: string) => void, options?: Record<string, unknown>): UiNode;
  checkbox(value: boolean, onChange: (value: boolean) => void): UiNode;
  segmentedInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void): UiNode;
  field(body: UiNode, label: string, hint?: string): UiNode;
}

export function createParameterControls(deps: ParameterControlsDeps) {
  const {
    state, mutate, UI, el, $, clone, toast, defaultValue, allRefs, referenceLabel,
    fieldLabel, enumOption, actionLabel, bindAssetPreview, assetPreviewForPath, assetPathStatus,
    openAssetBrowser, requestRoi, inputParameterMetadata, VariableSystem,
    requestTemplateReplacement, appendMissingAssetAction, openWorkflowBrowser, renderInspector,
    ACTION_LABELS, requestTemplateCheck, variableLinks, variableDisplayNameOf,
    selectInput, textInput, checkbox, segmentedInput, field,
  } = deps;
  function actionDropdown(node: any): UiNode {
    return UI.dropdown({
      value: node.action || '',
      options: state.catalog.map((spec) => ({
        value: spec.name,
        label: actionLabel(spec.name),
        detail: ACTION_LABELS[spec.name] ? spec.name : '',
        title: spec.description || spec.name,
      })),
      onChange: (value: string) => mutate(() => {
        node.action = value;
        node.params = {};
        clearParameterLiteralCache(node.id);
        if (state.raw?._inputParams && typeof state.raw._inputParams === 'object') delete state.raw!._inputParams[node.id];
      }),
      searchable: true,
      placeholder: '搜索动作…',
      emptyText: '没有匹配的动作',
    });
  }

  function renderParameter(body: UiNode, node: any, name: string, definition: any): void {
    const block = el('div', 'parameter-block');
    const heading = el('div', 'parameter-heading');
    const headingName = el('span', '', `${fieldLabel(name)}${definition.required ? ' *' : ''}`);
    headingName.title = name;
    heading.appendChild(headingName);
    const headingActions = el('div', 'parameter-heading-actions');
    const exists = Object.prototype.hasOwnProperty.call(node.params, name);
    if (!definition.required && definition.default === undefined) {
      const enabled = checkbox(exists, (checked) => mutate(() => {
        if (checked) node.params[name] = defaultValue(definition);
        else { delete node.params[name]; clearParameterLiteralCache(node.id, name); }
      }));
      const toggleLabel = el('label', 'parameter-enable'); toggleLabel.appendChild(enabled); toggleLabel.appendChild(el('span', '', '启用'));
      headingActions.appendChild(toggleLabel);
    }
    if (name === 'template' && node.action === 'vision.wait_template') {
      const multi = el('button', 'parameter-check', '多模板');
      multi.type = 'button';
      multi.title = '切换为按顺序匹配多个模板，首个命中后立即返回';
      multi.addEventListener('click', () => convertWaitTemplateToAny(node));
      headingActions.appendChild(multi);
    }
    if (name === 'templates' && node.action === 'vision.wait_any') {
      const single = el('button', 'parameter-check', '单模板');
      single.type = 'button';
      single.title = '模板列表只有一项时切回单模板等待';
      single.addEventListener('click', () => convertWaitAnyToTemplate(node));
      headingActions.appendChild(single);
    }
    if (name === 'threshold' && ['vision.match_template', 'vision.wait_template'].includes(node.action)) {
      const check = el('button', 'parameter-check', '检查'); check.title = '获取当前画面并执行模板匹配';
      let pointerPending = false;
      check.addEventListener('mousedown', (event: MouseEvent) => {
        if (event.button !== 0) return;
        pointerPending = true;
        setTimeout(() => { if (pointerPending) { pointerPending = false; requestTemplateCheck(node.id); } }, 0);
      });
      check.addEventListener('click', () => { if (!pointerPending) requestTemplateCheck(node.id); });
      headingActions.appendChild(check);
    }
    // 这里原来还挂一个「绑定 ▾」下拉（选兼容引用 / 提升为变量）。连线一律回画布做：
    // 卡片参数端点拖线、节点输出引用口、变量卡片拖线，端口右键菜单里也有「提升为变量」。
    heading.appendChild(headingActions);
    block.appendChild(heading);
    if (definition.description) block.appendChild(el('div', 'field-hint', definition.description));
    if (!exists && !definition.required && definition.default === undefined) { body.appendChild(block); return; }
    const value = exists
      ? node.params[name]
      : definition.default !== undefined
        ? clone(definition.default)
        : defaultValue(definition);
    const bound = value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && Object.keys(value).length === 1;
    if (bound) {
      // 引用是在画布上连出来的：详情栏不再提供「固定值 / 变量」模式切换与引用下拉，
      // 这里只如实说明当前连的是什么，改动一律回画布做。
      // 文案只按**参数里的引用**判断，不看连线映射：映射可能缺项（旧文档、手工改过的
      // JSON），按引用判断才不会出现「同一个绑定两种说法」。
      const ref = String(value.ref);
      const variableRef = /^(inputs|variables)\.([^\.]+)/.exec(ref);
      const shown = variableRef
        ? variableDisplayNameOf(variableRef[1] as 'inputs' | 'variables', ref.slice(variableRef[1].length + 1))
        : referenceLabel(ref);
      const note = el('div', 'field-hint parameter-bound-note', variableRef
        ? `已连接变量 ${shown}（在画布上管理）`
        : `已连接引用 ${shown}（在画布上管理）`);
      note.title = ref;
      block.appendChild(note);
    } else {
      block.appendChild(literalControl(node, name, definition, value, headingActions));
    }
    body.appendChild(block);
  }

  function rememberParameterLiteral(node: any, name: string, value: any): void {
    if (!node || value === undefined || isBindingValue(value)) return;
    parameterLiteralCache(state)[parameterLiteralCacheKey(node, name)] = clone(value);
  }

  function restoreParameterLiteral(node: any, name: string, definition: any): any {
    const cache = parameterLiteralCache(state);
    const key = parameterLiteralCacheKey(node, name);
    if (Object.prototype.hasOwnProperty.call(cache, key)) return clone(cache[key]);
    return definition.default !== undefined ? clone(definition.default) : defaultValue(definition);
  }

  function clearParameterLiteralCache(nodeId: string, name?: string): void {
    const cache = parameterLiteralCache(state);
    if (name !== undefined) {
      delete cache[`${nodeId}:${name}`];
      return;
    }
    const prefix = `${nodeId}:`;
    Object.keys(cache).forEach((key) => { if (key.startsWith(prefix)) delete cache[key]; });
  }

  function convertWaitTemplateToAny(node: any): any {
    if (!node || node.action !== 'vision.wait_template') return;
    const oldParams = node.params && typeof node.params === 'object' && !Array.isArray(node.params) ? node.params : {};
    if (oldParams.present === false || isBindingValue(oldParams.present)) {
      toast('等待消失或动态存在性暂不支持多模板', true);
      return;
    }
    const template = oldParams.template;
    const hasTemplate = isBindingValue(template)
      || (typeof template === 'string' && template.trim());
    if (!hasTemplate) {
      toast('请先选择一个模板，再切换为多模板', true);
      return;
    }
    const nextParams: Record<string, any> = { templates: [clone(template)] };
    ['timeout_seconds', 'roi', 'threshold', 'scale_search'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(oldParams, key)) nextParams[key] = clone(oldParams[key]);
    });
    mutate(() => {
      node.action = 'vision.wait_any';
      node.params = nextParams;
      delete inputParameterMetadata()[node.id];
    });
    toast('已切换为多模板匹配');
  }

  function convertWaitAnyToTemplate(node: any): any {
    if (!node || node.action !== 'vision.wait_any') return;
    const oldParams = node.params && typeof node.params === 'object' && !Array.isArray(node.params) ? node.params : {};
    const templates = oldParams.templates;
    if (isBindingValue(templates)) {
      toast('动态模板列表暂不支持切回单模板', true);
      return;
    }
    if (!Array.isArray(templates) || templates.length !== 1) {
      toast('请先将模板列表保留为一项，再切回单模板', true);
      return;
    }
    const template = templates[0];
    const hasTemplate = isBindingValue(template)
      || (typeof template === 'string' && template.trim());
    if (!hasTemplate) {
      toast('请先选择一个有效模板', true);
      return;
    }
    const nextParams: Record<string, any> = { template: clone(template), present: true };
    ['timeout_seconds', 'roi', 'threshold', 'scale_search'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(oldParams, key)) nextParams[key] = clone(oldParams[key]);
    });
    mutate(() => {
      node.action = 'vision.wait_template';
      node.params = nextParams;
      delete inputParameterMetadata()[node.id];
    });
    toast('已切换为单模板等待');
  }

  /** 坐标点：X/Y 两个整数输入。 */
  /** 坐标点：两个整数输入（X/Y），改动一个轴时保留另一个轴当前输入的值。 */
  function pointControl(value: any, onChange: (value: any) => void): UiNode {
    const shell = el('div', 'rect-control point-control');
    const parts = paramPointParts(value);
    const inputs: Record<string, any> = {};
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
      const input = textInput(parts[axis], (next) => onChange(axisChange(axis, next)), { type: 'number', step: 1 });
      inputs[axis] = input;
      shell.appendChild(input);
    });
    return shell;
  }

  /** 颜色：文本 + 原生取色器（两边同步）。 */
  function colorControl(value: any, onChange: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    const input = textInput(value ?? '', onChange, { placeholder: '#rrggbb' });
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'definition-color-picker';
    picker.value = paramColorSwatch(value) || '#000000';
    picker.title = '选择颜色';
    picker.addEventListener('input', () => { input.value = picker.value; onChange(picker.value); });
    shell.appendChild(input);
    shell.appendChild(picker);
    return shell;
  }

  /** 按键：文本 + 常用 keyevent 选择器（选中后回填文本）。 */
  function keyControl(value: any, onChange: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    const input = textInput(value ?? '', onChange, { placeholder: 'BACK' });
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
      onChange(picker.value);
    });
    shell.appendChild(input);
    shell.appendChild(picker);
    return shell;
  }

  /** 时长：数值输入 + 秒单位。 */
  function durationControl(definition: any, value: any, onChange: (value: any) => void): UiNode {
    const shell = el('div', 'inline-control');
    shell.appendChild(textInput(value, (next) => onChange(parseFloat(next || '0')), {
      type: 'number', min: definition.min, max: definition.max, step: 'any',
    }));
    shell.appendChild(el('span', 'definition-unit', '秒'));
    return shell;
  }

  function literalControl(node: any, name: string, definition: any, value: any, headingActions?: any): UiNode {
    const workflowParameter = node.action === 'workflow.run' && name === 'workflow';
    const set = (next: any) => mutate(() => {
      const changed = node.params[name] !== next;
      node.params[name] = next;
      if (workflowParameter && changed) node.params.inputs = {};
    });
    if (Array.isArray(definition.enum) && definition.enum.length) {
      return selectInput(JSON.stringify(value), definition.enum.map((item: any) => ({ value: JSON.stringify(item), label: enumOption(item) })), (next: string) => set(JSON.parse(next)), 'full');
    }
    if (definition.type === 'boolean') return checkbox(!!value, set);
    if (definition.type === 'number' || definition.type === 'integer') {
      return textInput(value, (next: string) => set(definition.type === 'integer' ? parseInt(next || '0', 10) : parseFloat(next || '0')), { type: 'number', min: definition.min, max: definition.max, step: definition.type === 'integer' ? 1 : 'any' });
    }
    if (definition.type === 'duration') return durationControl(definition, value, set);
    if (definition.type === 'point') return pointControl(value, set);
    if (definition.type === 'color') return colorControl(value, set);
    if (definition.type === 'key') return keyControl(value, set);
    if (definition.type === 'rect') {
      return UI.rect({ value, onChange: set, label: fieldLabel(name), onPick: () => requestRoi(node.id, name, 'rect') });
    }
    if (definition.type === 'array' || definition.type === 'object' || definition.type === 'any') {
      return complexValueControl(`task:${node.id}:${name}`, definition, value, set, { node, key: name, headingActions });
    }
    const shell = el('div', 'inline-control');
    const input = textInput(value, set, { placeholder: definition.type === 'asset' ? 'assets/templates/...' : workflowParameter ? '_folder/workflow.json' : '' });
    if (definition.type === 'asset' && assetPathStatus(value) === 'missing') input.classList.add('asset-missing');
    if (definition.type === 'asset' || assetPreviewForPath(value)) bindAssetPreview(input);
    shell.appendChild(input);
    if (definition.type === 'asset') {
      const browse = el('button', '', '浏览'); browse.title = '浏览 assets 中的图片'; browse.addEventListener('click', () => openAssetBrowser(node.id, name, value)); shell.appendChild(browse);
      const pick = el('button', '', '截取'); pick.addEventListener('click', () => requestRoi(node.id, name, 'asset')); shell.appendChild(pick);
      const replace = el('button', '', '替换'); replace.title = '从当前画面截取并覆盖当前模板'; replace.addEventListener('click', () => requestTemplateReplacement(node.id, name, input.value)); shell.appendChild(replace);
      appendMissingAssetAction(shell, node, name, value, set);
    } else if (workflowParameter) {
      const browse = el('button', '', '浏览'); browse.title = '浏览 workflows 中的脚本'; browse.addEventListener('click', () => openWorkflowBrowser(node.id, name, value)); shell.appendChild(browse);
    }
    return shell;
  }

  function paramJsonModes(): Record<string, any> {
    if (!state.paramJsonModes || typeof state.paramJsonModes !== 'object' || Array.isArray(state.paramJsonModes)) state.paramJsonModes = {};
    return state.paramJsonModes;
  }

  function cardExpansion(key: string, fallback = true): boolean {
    if (!state.cardExpansion || typeof state.cardExpansion !== 'object' || Array.isArray(state.cardExpansion)) state.cardExpansion = {};
    if (!Object.prototype.hasOwnProperty.call(state.cardExpansion, key)) state.cardExpansion[key] = fallback;
    return state.cardExpansion[key];
  }

  function jsonModeToggle(key: string): UiNode {
    const jsonMode = !!paramJsonModes()[key];
    const toggle = el('button', 'structured-mode-toggle', jsonMode ? '结构化' : 'JSON');
    toggle.type = 'button';
    toggle.dataset.tip = jsonMode ? '切换到结构化表单' : '切换到 JSON 文本编辑';
    toggle.addEventListener('click', () => {
      paramJsonModes()[key] = !jsonMode;
      renderInspector();
    });
    return toggle;
  }

  function complexValueControl(key: string, definition: any, value: any, set: (value: any) => void, ctx: any = {}): UiNode {
    const jsonMode = !!paramJsonModes()[key];
    const shell = el('div', 'structured-shell');
    if (ctx.headingActions instanceof Element) ctx.headingActions.prepend(jsonModeToggle(key));
    else {
      const toolbar = el('div', 'structured-toolbar');
      toolbar.appendChild(jsonModeToggle(key));
      shell.appendChild(toolbar);
    }
    if (jsonMode) {
      const area = el('textarea', 'json-value'); area.value = JSON.stringify(value, null, 2);
      area.addEventListener('change', () => { try { set(JSON.parse(area.value)); } catch { toast('不是有效 JSON', true); } });
      shell.appendChild(area);
      return shell;
    }
    const control = structuredControl(definition, value, set, ctx, key);
    if (control) { shell.appendChild(control); return shell; }
    const area = el('textarea', 'json-value'); area.value = JSON.stringify(value, null, 2);
    area.addEventListener('change', () => { try { set(JSON.parse(area.value)); } catch { toast('不是有效 JSON', true); } });
    shell.appendChild(area);
    return shell;
  }

  function scalarDefinitionUsable(definition: any): boolean {
    if (!definition || typeof definition !== 'object') return false;
    if (Array.isArray(definition.enum) && definition.enum.length) return true;
    return ['string', 'number', 'integer', 'boolean', 'asset', 'path', 'rect', 'duration', 'point', 'color', 'key'].includes(definition.type);
  }

  /** 没有声明 items/properties 时按当前值推断结构，避免把结构化参数丢给 JSON 文本框。 */
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

  /** 固定长度数组（如随机间隔的 [min, max]）：正好 N 个输入，不给增删按钮。 */
  function fixedArrayLength(definition: any): number | null {
    const min = definition && definition.min_items;
    const max = definition && definition.max_items;
    if (!Number.isInteger(min) || min !== max) return null;
    return min >= 1 && min <= 8 ? min : null;
  }

  function structuredControl(definition: any, value: any, onChange: (value: any) => void, ctx: any = {}, key: string = ''): UiNode | null {
    const def = definition && typeof definition === 'object' ? definition : {};
    if (Array.isArray(def.enum) && def.enum.length) return null;
    if (isBindingValue(value)) return bindingControl(def, value, onChange, ctx);
    if (def.type === 'object') {
      const properties = declaredObjectProperties(def) || inferredObjectProperties(def, value);
      if (properties) return objectFieldsControl({ ...def, properties }, value, onChange, ctx, key);
      return null;
    }
    if (def.type === 'array') {
      if (Array.isArray(def.prefixItems) && def.prefixItems.length) {
        return tupleControl(def, value, onChange, ctx);
      }
      const itemDef = declaredArrayItem(def) || inferredArrayItem(def, value);
      if (!itemDef) return null;
      if (itemDef.type === 'object') {
        const properties = declaredObjectProperties(itemDef)
          || inferredObjectProperties(itemDef, Array.isArray(value) && value.length ? value[0] : undefined);
        if (properties) return objectArrayControl(def, { ...itemDef, properties }, value, onChange, ctx, key);
        return null;
      }
      if (scalarDefinitionUsable(itemDef)) {
        return scalarArrayControl(def, itemDef, value, onChange, ctx);
      }
      return null;
    }
    return null;
  }

  /** 清单声明里的数组元素定义。 */
  function declaredArrayItem(definition: any): any {
    const items = definition && definition.items;
    return items && typeof items === 'object' && !Array.isArray(items) ? items : null;
  }

  /** 没有声明 items 时按当前值/默认值推断元素类型（列表元素为空则交给调用方再回退）。 */
  function inferredArrayItem(definition: any, value: any): any {
    const list = Array.isArray(value) ? value : [];
    if (list.length) return inferredDefinition(list[0]);
    const fallback = definition && Array.isArray(definition.default) ? definition.default : [];
    if (fallback.length) return inferredDefinition(fallback[0]);
    if (definition && Array.isArray(definition.prefixItems) && definition.prefixItems.length) return definition.prefixItems[0];
    return { type: 'string' };
  }

  /** 清单声明里的对象字段。 */
  function declaredObjectProperties(definition: any): Record<string, any> | null {
    const properties = definition && definition.properties;
    return properties && typeof properties === 'object' && Object.keys(properties).length ? properties : null;
  }

  /** 没有声明 properties 时按当前值/默认值的键推断字段（空对象则无法推断）。 */
  function inferredObjectProperties(definition: any, value: any): Record<string, any> | null {
    const sample = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : (definition && definition.default !== null && typeof definition.default === 'object' && !Array.isArray(definition.default) ? definition.default : null);
    if (!sample || !Object.keys(sample).length) return null;
    const properties: Record<string, any> = {};
    for (const [key, item] of Object.entries(sample)) properties[key] = inferredDefinition(item);
    return properties;
  }

  function objectFieldsControl(definition: any, value: any, onChange: (value: any) => void, ctx: any, key: string): UiNode {
    const holder = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const wrap = el('div', 'structured-object');
    for (const [name, child] of Object.entries<any>(definition.properties)) {
      const row = el('div', 'structured-field');
      const caption = el('div', 'structured-field-caption');
      const label = el('span', 'structured-field-label', `${fieldLabel(name)}${child && child.required ? ' *' : ''}`);
      label.title = name;
      if (child && child.description) label.title += ` — ${child.description}`;
      caption.appendChild(label);
      const refs = ctx.node ? allRefs(ctx.node, child, true) : [];
      if (!isBindingValue(holder[name]) && refs.length) {
        caption.appendChild(iconButton('field-binding-toggle', '绑定父级引用', '引用', () => onChange({ ...holder, [name]: { ref: refs[0] || '' } })));
      }
      row.appendChild(caption);
      row.appendChild(nestedValueControl(child, holder[name], (next) => onChange({ ...holder, [name]: next }), ctx, `${key}.${name}`));
      wrap.appendChild(row);
    }
    return wrap;
  }

  function bindingControl(definition: any, value: any, onChange: (value: any) => void, ctx: any): UiNode {
    const shell = el('div', 'binding-control');
    const refs = ctx.node ? allRefs(ctx.node, definition, true) : [];
    const current = value.ref;
    const options = refs.includes(current) ? refs : [current, ...refs];
    shell.appendChild(selectInput(current, options.length ? options.map((item) => ({ value: item, label: referenceLabel(item) })) : [{ value: current, label: current || '没有可用引用' }], (next) => onChange({ ref: next }), 'full'));
    shell.appendChild(iconButton('scalar-array-remove', '解除引用，改为常量', 'unlink', () => {
      const restored = VariableSystem.defaultAt(state.raw, current);
      onChange(restored === undefined ? defaultValue(definition) : restored);
    }));
    return shell;
  }

  function nestedValueControl(definition: any, value: any, onChange: (value: any) => void, ctx: any, key: string): UiNode {
    if (isBindingValue(value)) return bindingControl(definition || {}, value, onChange, ctx);
    const structured = structuredControl(definition, value, onChange, ctx, key);
    if (structured) return structured;
    const scalar = scalarValueControl(definition, value, onChange, ctx);
    if (scalar) return scalar;
    const area = el('textarea', 'json-value compact-json'); area.value = JSON.stringify(value, null, 2);
    area.addEventListener('change', () => { try { onChange(JSON.parse(area.value)); } catch { toast('不是有效 JSON', true); } });
    return area;
  }

  function scalarValueControl(definition: any, value: any, onChange: (value: any) => void, ctx: any = {}): UiNode | null {
    const def = definition || {};
    if (Array.isArray(def.enum) && def.enum.length) {
      return selectInput(JSON.stringify(value === undefined ? def.default : value), def.enum.map((item: any) => ({ value: JSON.stringify(item), label: enumOption(item) })), (next: string) => onChange(JSON.parse(next)), 'full');
    }
    if (def.type === 'boolean') return checkbox(!!value, onChange);
    if (def.type === 'number' || def.type === 'integer') {
      return textInput(value, (next: string) => onChange(def.type === 'integer' ? parseInt(next || '0', 10) : parseFloat(next || '0')), { type: 'number', min: def.min, max: def.max, step: def.type === 'integer' ? 1 : 'any' });
    }
    if (def.type === 'duration') return durationControl(def, value, onChange);
    if (def.type === 'point') return pointControl(value, onChange);
    if (def.type === 'color') return colorControl(value, onChange);
    if (def.type === 'key') return keyControl(value, onChange);
    if (def.type === 'rect') {
      const shell = el('div', 'rect-control');
      const values = Array.isArray(value) && value.length === 4 ? value : [0, 0, 100, 100];
      values.forEach((item: number, index: number) => shell.appendChild(textInput(item, (next: string) => { const updated = values.slice(); updated[index] = parseInt(next || '0', 10); onChange(updated); }, { type: 'number' })));
      if (ctx.node) {
        const pick = el('button', 'rect-pick'); pick.dataset.tip = '框选区域'; pick.appendChild(iconSvg('crop')); pick.addEventListener('click', () => requestRoi(ctx.node.id, ctx.key || '', 'rect', { applyValue: (rect: any) => onChange(rect) }));
        shell.appendChild(pick);
      }
      return shell;
    }
    if (def.type === 'asset' || def.type === 'path') {
      const shell = el('div', 'inline-control');
      const input = textInput(value, onChange, { placeholder: def.type === 'asset' ? 'assets/templates/...' : '' });
      if (def.type === 'asset' && assetPathStatus(value) === 'missing') input.classList.add('asset-missing');
      if (def.type === 'asset' || assetPreviewForPath(value)) bindAssetPreview(input);
      shell.appendChild(input);
      if (def.type === 'asset') {
        const browse = el('button', '', '浏览'); browse.title = '浏览 assets 中的图片';
        browse.addEventListener('click', () => openAssetBrowser(ctx.node ? ctx.node.id : '', ctx.key || '', value, (assetPath: any) => onChange(assetPath)));
        shell.appendChild(browse);
        if (ctx.node) {
          const pick = el('button', '', '截取'); pick.title = '从当前画面截取模板';
          pick.addEventListener('click', () => requestRoi(ctx.node.id, ctx.key || '', 'asset', { applyValue: (assetPath: any) => onChange(assetPath) }));
          shell.appendChild(pick);
          const replace = el('button', '', '替换'); replace.title = '从当前画面截取并覆盖当前模板';
          replace.addEventListener('click', () => requestTemplateReplacement(ctx.node.id, ctx.key || '', input.value, { applyValue: (assetPath: any) => onChange(assetPath) }));
          shell.appendChild(replace);
          appendMissingAssetAction(shell, ctx.node, ctx.key || '', value, onChange);
        }
      }
      return shell;
    }
    if (def.type === 'string') return textInput(value ?? '', onChange);
    return null;
  }

  function tupleControl(definition: any, value: any, onChange: (value: any) => void, ctx: any): UiNode {
    const list = Array.isArray(value) ? value : [];
    const wrap = el('div', 'scalar-array');
    definition.prefixItems.forEach((itemDef: any, index: number) => {
      const row = el('div', 'scalar-array-row');
      row.appendChild(nestedValueControl(itemDef, list[index], (next) => { const updated = list.slice(); updated[index] = next; onChange(updated); }, ctx, ''));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function scalarArrayControl(definition: any, itemDef: any, value: any, onChange: (value: any) => void, ctx: any): UiNode {
    const list = Array.isArray(value) ? value : [];
    const wrap = el('div', 'scalar-array');
    const fixed = fixedArrayLength(definition);
    if (fixed !== null) {
      // 固定长度（如随机间隔要求正好两项）：只给 N 个输入框，不给增删与排序。
      for (let index = 0; index < fixed; index += 1) {
        const row = el('div', 'scalar-array-row');
        const current = list[index] === undefined ? itemDefaultValue(itemDef) : list[index];
        row.appendChild(nestedValueControl(itemDef, current, (next) => {
          const updated = list.slice();
          while (updated.length < fixed) updated.push(itemDefaultValue(itemDef));
          updated[index] = next;
          onChange(updated);
        }, ctx, ''));
        wrap.appendChild(row);
      }
      return wrap;
    }
    list.forEach((item, index) => {
      const row = el('div', 'scalar-array-row');
      row.appendChild(nestedValueControl(itemDef, item, (next) => { const updated = list.slice(); updated[index] = next; onChange(updated); }, ctx, ''));
      row.appendChild(iconButton('object-array-move', '上移', 'arrow-up', () => {
        if (index === 0) return;
        const updated = list.slice(); [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]; onChange(updated);
      }));
      row.appendChild(iconButton('object-array-move', '下移', 'arrow-down', () => {
        if (index >= list.length - 1) return;
        const updated = list.slice(); [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]]; onChange(updated);
      }));
      row.appendChild(iconButton('scalar-array-remove', '删除该项', 'trash', () => {
        if (definition.min_items !== undefined && list.length <= definition.min_items) { toast(`至少需要 ${definition.min_items} 项`, true); return; }
        const updated = list.slice(); updated.splice(index, 1); onChange(updated);
      }));
      wrap.appendChild(row);
    });
    wrap.appendChild(addRowButton(`添加一项`, () => {
      if (definition.max_items !== undefined && list.length >= definition.max_items) { toast(`最多 ${definition.max_items} 项`, true); return; }
      onChange([...list, itemDefaultValue(itemDef)]);
    }));
    return wrap;
  }

  function itemDefaultValue(definition: any): any {
    if (definition && definition.default !== undefined) return clone(definition.default);
    if (definition && definition.type === 'integer') return 0;
    if (definition && (definition.type === 'number' || definition.type === 'duration')) return 0;
    if (definition && definition.type === 'boolean') return false;
    if (definition && definition.type === 'point') return { x: 0, y: 0 };
    if (definition && definition.type === 'color') return '#000000';
    if (definition && definition.type === 'enum' && Array.isArray(definition.enum) && definition.enum.length) return clone(definition.enum[0]);
    return '';
  }

  function objectArrayControl(definition: any, itemDef: any, value: any, onChange: (value: any) => void, ctx: any, key: string): UiNode {
    const list = Array.isArray(value) ? value : [];
    const wrap = el('div', 'object-array');
    list.forEach((item, index) => {
      const holder = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      const cardKey = `${key}[${index}]`;
      const card = el('div', 'object-array-card');
      const head = el('div', 'object-array-head');
      let expanded = cardExpansion(cardKey, true);
      const fold = el('button', `object-array-fold${expanded ? '' : ' folded'}`);
      fold.type = 'button';
      fold.dataset.tip = expanded ? '折叠' : '展开';
      fold.setAttribute('aria-expanded', String(expanded));
      fold.appendChild(iconSvg('chevron'));
      head.appendChild(fold);
      head.appendChild(el('span', 'object-array-title', `#${index + 1} ${objectArraySummary(itemDef, holder)}`));
      const actions = el('div', 'object-array-actions');
      actions.appendChild(iconButton('object-array-move', '上移', 'arrow-up', () => {
        if (index === 0) return;
        const updated = list.slice(); [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]; onChange(updated);
      }));
      actions.appendChild(iconButton('object-array-move', '下移', 'arrow-down', () => {
        if (index >= list.length - 1) return;
        const updated = list.slice(); [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]]; onChange(updated);
      }));
      actions.appendChild(iconButton('object-array-remove', '删除该项', 'trash', () => {
        if (definition.min_items !== undefined && list.length <= definition.min_items) { toast(`至少需要 ${definition.min_items} 项`, true); return; }
        const updated = list.slice(); updated.splice(index, 1); onChange(updated);
      }));
      head.appendChild(actions);
      let itemBody: UiNode | null = null;
      const renderCardBody = () => {
        if (itemBody) return;
        itemBody = el('div', 'object-array-body');
        itemBody.appendChild(objectFieldsControl(itemDef, holder, (next) => { const updated = list.slice(); updated[index] = next; onChange(updated); }, ctx, cardKey));
        card.appendChild(itemBody);
      };
      const toggleCard = () => {
        expanded = !expanded;
        state.cardExpansion[cardKey] = expanded;
        fold.classList.toggle('folded', !expanded);
        fold.dataset.tip = expanded ? '折叠' : '展开';
        fold.setAttribute('aria-expanded', String(expanded));
        if (expanded) renderCardBody();
        else if (itemBody) { itemBody.remove(); itemBody = null; }
      };
      fold.addEventListener('click', (event: MouseEvent) => { event.stopPropagation(); toggleCard(); });
      head.addEventListener('click', (event: MouseEvent) => {
        if ((event.target as Element)?.closest('button')) return;
        toggleCard();
      });
      card.appendChild(head);
      if (expanded) renderCardBody();
      wrap.appendChild(card);
    });
    wrap.appendChild(addRowButton('添加一项', () => {
      if (definition.max_items !== undefined && list.length >= definition.max_items) { toast(`最多 ${definition.max_items} 项`, true); return; }
      if (!state.cardExpansion || typeof state.cardExpansion !== 'object') state.cardExpansion = {};
      state.cardExpansion[`${key}[${list.length}]`] = true;
      const item: Record<string, any> = {};
      for (const [name, child] of Object.entries<any>(itemDef.properties)) {
        if (child && child.required) item[name] = itemDefaultValue(child);
      }
      onChange([...list, item]);
    }));
    return wrap;
  }

  function objectArraySummary(itemDef: any, holder: any): string {
    const parts = [];
    for (const name of Object.keys(itemDef.properties || {})) {
      const value = holder[name];
      if (value === undefined || value === null || value === '') continue;
      const text = isBindingValue(value) ? `← ${referenceLabel(value.ref)}` : typeof value === 'object' ? JSON.stringify(value) : String(value);
      parts.push(text);
      if (parts.length >= 2) break;
    }
    return parts.length ? parts.join(' · ') : '（空）';
  }

  function iconButton(className: string, title: string, text: string, onClick: () => void): UiNode {
    const button = el('button', className);
    button.type = 'button';
    button.dataset.tip = title;
    if (ICON_SVG[text]) button.appendChild(iconSvg(text));
    else button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  const ICON_SVG = UI.ICON_SVG;
  const iconSvg = (name: string): UiNode => UI.icon(name);

  function addRowButton(label: string, onClick: () => void): UiNode {
    const button = el('button', 'structured-add');
    button.type = 'button';
    button.appendChild(iconSvg('plus'));
    button.appendChild(el('span', '', label));
    button.addEventListener('click', onClick);
    return button;
  }

  const CONDITION_OPERATORS = ['exists', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'and', 'or', 'not'];
  const CONDITION_GROUP_OPERATORS = ['and', 'or'];
  const CONDITION_UNARY_OPERATORS = ['not'];

  function conditionControl(value: any, onChange: (value: any) => void, ctx: any = {}): UiNode {
    const wrap = el('div', 'condition-control');
    if (typeof value === 'boolean' || value === undefined || value === null) {
      const current = !!value;
      const row = el('div', 'scalar-array-row');
      row.appendChild(selectInput(String(current), [{ value: 'true', label: '真' }, { value: 'false', label: '假' }], (next) => onChange(next === 'true'), 'full'));
      row.appendChild(iconButton('scalar-array-remove', '改为条件表达式', 'ƒ', () => onChange({ eq: [1, 1] })));
      wrap.appendChild(row);
      const hint = el('div', 'field-hint', '当前是固定真假值；点 ƒ 可改为条件表达式。');
      wrap.appendChild(hint);
      return wrap;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      onChange({ eq: [1, 1] });
      return wrap;
    }
    const operator = Object.keys(value)[0];
    const operands = value[operator];
    const head = el('div', 'condition-head');
    head.appendChild(selectInput(operator, CONDITION_OPERATORS.map((item) => ({ value: item, label: conditionOperatorLabel(item) })), (next) => onChange(conditionOperatorDefault(next)), 'condition-operator'));
    wrap.appendChild(head);
    const applyOperands = (next: any) => onChange({ [operator]: next });
    const replaceOperatorValue = (next: any) => onChange(next);
    if (CONDITION_GROUP_OPERATORS.includes(operator)) {
      const list = Array.isArray(operands) ? operands : [];
      list.forEach((item, index) => {
        const row = el('div', 'condition-nested-row');
        row.appendChild(conditionControl(item, (next) => { const updated = list.slice(); updated[index] = next; replaceOperatorValue({ [operator]: updated }); }, ctx));
        row.appendChild(iconButton('scalar-array-remove', '删除该条件', 'trash', () => {
          const updated = list.slice(); updated.splice(index, 1); replaceOperatorValue({ [operator]: updated });
        }));
        wrap.appendChild(row);
      });
      wrap.appendChild(addRowButton('添加子条件', () => replaceOperatorValue({ [operator]: [...list, { eq: [1, 1] }] })));
      return wrap;
    }
    if (CONDITION_UNARY_OPERATORS.includes(operator)) {
      wrap.appendChild(conditionControl(operands, (next) => applyOperands(next), ctx));
      return wrap;
    }
    if (operator === 'exists') {
      wrap.appendChild(conditionOperandControl(operands, (next) => applyOperands(next), ctx, true));
      return wrap;
    }
    const pair = Array.isArray(operands) ? operands : ['', ''];
    const shell = el('div', 'condition-pair');
    ['左值', '右值'].forEach((label, side) => {
      const row = el('div', 'condition-pair-row');
      row.appendChild(el('span', 'condition-pair-label', label));
      row.appendChild(conditionOperandControl(pair[side], (next) => { const updated = pair.slice(); updated[side] = next; applyOperands(updated); }, ctx));
      shell.appendChild(row);
    });
    wrap.appendChild(shell);
    return wrap;
  }

  function conditionOperatorLabel(operator: string): string {
    return { exists: '存在引用 (exists)', eq: '等于 (eq)', ne: '不等于 (ne)', gt: '大于 (gt)', gte: '大于等于 (gte)', lt: '小于 (lt)', lte: '小于等于 (lte)', contains: '包含 (contains)', and: '且 (and)', or: '或 (or)', not: '非 (not)' }[operator] || operator;
  }

  function conditionOperatorDefault(operator: string): any {
    if (CONDITION_GROUP_OPERATORS.includes(operator)) return { [operator]: [{ eq: [1, 1] }] };
    if (CONDITION_UNARY_OPERATORS.includes(operator)) return { [operator]: { eq: [1, 1] } };
    if (operator === 'exists') return { exists: { ref: '' } };
    return { [operator]: ['', ''] };
  }

  function conditionOperandControl(value: any, onChange: (value: any) => void, ctx: any = {}, referenceOnly = false): UiNode {
    const bound = value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string';
    const mode = bound ? 'binding' : referenceOnly ? 'binding' : 'literal';
    const wrap = el('div', 'condition-operand');
    const refs = ctx.node ? allRefs(ctx.node, null, true) : [];
    if (!referenceOnly) {
      wrap.appendChild(selectInput(mode, [
        { value: 'literal', label: '常量' },
        { value: 'binding', label: '引用' },
      ], (next) => onChange(next === 'binding' ? { ref: refs[0] || '' } : conditionLiteralDefault(value))));
    }
    if (mode === 'binding') {
      const current = bound ? value.ref : '';
      const options = refs.includes(current) || !current ? refs : [current, ...refs];
      wrap.appendChild(selectInput(current, options.length ? options.map((item) => ({ value: item, label: referenceLabel(item) })) : [{ value: '', label: '没有可用引用' }], (next) => onChange({ ref: next }), 'full'));
    } else {
      wrap.appendChild(textInput(value, (next) => onChange(conditionParseLiteral(next)), { className: 'full' }));
    }
    return wrap;
  }

  function conditionLiteralDefault(previous: any): any {
    if (typeof previous === 'number') return 0;
    if (typeof previous === 'boolean') return false;
    return '';
  }

  function conditionParseLiteral(text: string): any {
    const trimmed = String(text).trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
    return trimmed;
  }

  function nodeChildrenOptions(node: any, current: string): Array<{ value: string; label: string }> {
    const children = Array.isArray(node && node.children) ? node.children : [];
    const options = children.map((childId: string) => ({ value: childId, label: childId }));
    if (current && !children.includes(current)) options.unshift({ value: current, label: `${current}（已失效）` });
    return options;
  }

  return {
    actionDropdown, renderParameter,
    parameterLiteralCache: () => parameterLiteralCache(state),
    parameterLiteralCacheKey,
    rememberParameterLiteral,
    restoreParameterLiteral, clearParameterLiteralCache, convertWaitTemplateToAny, convertWaitAnyToTemplate,
    literalControl, paramJsonModes, cardExpansion, jsonModeToggle, complexValueControl, scalarDefinitionUsable,
    structuredControl, objectFieldsControl, bindingControl, nestedValueControl, scalarValueControl,
    tupleControl, scalarArrayControl, itemDefaultValue, objectArrayControl, objectArraySummary, iconButton,
    ICON_SVG, iconSvg, addRowButton, CONDITION_OPERATORS, CONDITION_GROUP_OPERATORS, CONDITION_UNARY_OPERATORS,
    conditionControl, conditionOperatorLabel, conditionOperatorDefault, conditionOperandControl,
    conditionLiteralDefault, conditionParseLiteral, nodeChildrenOptions,
  };
}
