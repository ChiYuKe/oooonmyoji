/**
 * 卡片参数行的就地编辑：UE 风格的行内控件分派（变量菜单 / 勾选切换 / 枚举菜单 / 数值与文本输入 /
 * 模板图选择 / 区域框选）。结构体参数不做行内编辑，直接送到详情栏。
 *
 * 画布是纯 SVG，没有原生可编辑控件，所以输入框用固定定位的 HTML 浮层贴在行上：
 * 世界坐标 → 视口坐标换算在 param-rows.worldRectToScreen，浮层随 pan/zoom 重定位（refresh）。
 */
import type { CanvasState } from '../state/canvas-state';
import type { MenuEntry } from '../ui/overlays';
import type { NodeParamEditorRequest } from '../render/node-card';
import { KEY_NAMES, keyOptionLabel } from '../../shared/parameter-types';
import {
  paramColorSwatch, paramEditorAction, paramEditorCurrentValue, paramEnumOptions, paramKeyText,
  paramLiteralText, paramPointParts, paramRectParts, paramRowKindOf, paramTupleCells, paramTupleElementText,
  paramTupleItemKind, parseParamLiteral, parseParamTuple, worldRectToScreen,
} from '../render/param-rows';
import type { ParamRowLike, ParamRowKind, ParamRowRect, ParamRowDefinition } from '../render/param-rows';

export interface InlineEditorDeps {
  state: CanvasState;
  wrap: HTMLElement;
  el(tag: string, className?: string, text?: string): HTMLElement;
  mutate(fn: () => void): void;
  clearParameterLiteralCache(nodeId: string, name?: string): void;
  rememberParameterLiteral(node: any, name: string, value: unknown): void;
  variableLinks(): Record<string, any>;
  showMenu(x: number, y: number, items: MenuEntry[], options?: Record<string, unknown>): void;
  nodeVariablePinMenuItems(nodeId: string, pin: any, point: { x: number; y: number }): MenuEntry[];
  requestInspector?(selection: unknown): void;
  toast(message: string, error?: boolean): void;
  enumOption(value: string): string;
  fieldLabel(name: string): string;
  /** 素材浏览器：选中后通过 applyValue 直接写回卡片行。 */
  openAssetBrowser?(nodeId: string, key: string, currentPath: string, applyValue?: ((value: string) => void) | null): void;
  /** ROI 拾取：mode='asset' 截取模板图，mode='rect' 框选区域。 */
  requestRoi?(nodeId: string, key: string, mode: 'asset' | 'rect', options?: Record<string, unknown>): void;
}

export interface CanvasInlineEditor {
  /** 卡片值区点击入口：按参数类型决定菜单、切换、输入框或详情栏。 */
  openParamEditor(request: NodeParamEditorRequest): void;
  closeInlineEditor(): void;
  /** 画布重绘（平移、缩放、运行状态刷新）后重新贴合当前行。 */
  refreshInlineEditor(): void;
  inlineEditorOpen(): boolean;
  /** 写入字面量；undefined 表示移除该参数（回到定义默认值）。 */
  setParamLiteral(node: any, param: string, value: unknown): void;
}

interface ActiveEditor {
  node: any;
  pin: ParamRowLike;
  param: string;
  kind: ParamRowKind;
  anchor: () => ParamRowRect;
  shell: HTMLElement;
  input: HTMLInputElement;
  /** 读取浮层内容（坐标点是两个输入框，颜色带取色器，所以不直接读 input.value）。 */
  read: () => { ok: true; value: unknown } | { ok: false; error: string };
  closed: boolean;
}

export function createCanvasInlineEditor(deps: InlineEditorDeps): CanvasInlineEditor {
  const {
    state, wrap, el, mutate, clearParameterLiteralCache, rememberParameterLiteral, variableLinks,
    showMenu, nodeVariablePinMenuItems, requestInspector, toast, enumOption, fieldLabel,
    openAssetBrowser, requestRoi,
  } = deps;

  let active: ActiveEditor | null = null;

  function sameValue(left: unknown, right: unknown): boolean {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return left === right;
    }
  }

  /** 布尔行的状态名：卡片声明了 on_label/off_label 就用它，否则用通用说法。 */
  function toggleLabelsOf(pin: ParamRowLike): { on: string; off: string } {
    const on = typeof pin.onLabel === 'string' && pin.onLabel ? pin.onLabel : '已开启';
    const off = typeof pin.offLabel === 'string' && pin.offLabel ? pin.offLabel : '已关闭';
    return { on, off };
  }

  /**
   * 写入一个字面量（不做历史记录）：undefined 表示移除该参数（回到定义默认值）。
   * 素材浏览器与 ROI 拾取弹层自己会包一层 mutate，所以它们用这个裸写入。
   */
  function writeParamLiteral(node: any, param: string, value: unknown): void {
    if (!node.params || typeof node.params !== 'object' || Array.isArray(node.params)) node.params = {};
    if (param.startsWith('inputs.')) {
      const name = param.slice('inputs.'.length);
      if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
      if (value === undefined) delete node.params.inputs[name];
      else node.params.inputs[name] = value;
    } else if (value === undefined) delete node.params[param];
    else node.params[param] = value;
    delete variableLinks()[`${node.id}:${param}`];
    if (value === undefined) clearParameterLiteralCache(node.id, param);
    else rememberParameterLiteral(node, param, value);
  }

  /** 写入一个字面量并记一次历史（行内控件与菜单直接调用）。 */
  function applyParamLiteral(node: any, param: string, value: unknown): void {
    mutate(() => writeParamLiteral(node, param, value));
  }

  function detach(editor: ActiveEditor): void {
    editor.closed = true;
    editor.shell.remove();
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('wheel', onDocumentWheel, true);
    window.removeEventListener('blur', onWindowBlur);
    if (active === editor) active = null;
  }

  function closeInlineEditor(): void {
    if (active) detach(active);
  }

  function onDocumentPointerDown(event: Event): void {
    const editor = active;
    if (!editor) return;
    const target = event.target as Node | null;
    if (target && editor.shell.contains(target)) return;
    // 点其它行/其它节点：先落盘当前输入，再让新交互继续（新浮层由 click 打开）。
    commit(editor);
  }

  function onDocumentWheel(): void {
    if (active) detach(active);
  }

  function onWindowBlur(): void {
    if (active) detach(active);
  }

  function positionShell(editor: ActiveEditor): void {
    const rect = editor.anchor();
    const wrapRect = wrap.getBoundingClientRect();
    const screen = worldRectToScreen(rect, {
      left: wrapRect.left,
      top: wrapRect.top,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
    });
    editor.shell.style.left = `${Math.round(screen.left)}px`;
    editor.shell.style.top = `${Math.round(screen.top)}px`;
    editor.shell.style.width = `${Math.round(screen.width)}px`;
    editor.shell.style.height = `${Math.round(screen.height)}px`;
  }

  function refreshInlineEditor(): void {
    if (active) positionShell(active);
  }

  function inlineEditorOpen(): boolean {
    return Boolean(active);
  }

  function commit(editor: ActiveEditor): void {
    if (editor.closed) return;
    const parsed = editor.read();
    if (!parsed.ok) {
      toast(`${editor.param}：${parsed.error}`, true);
      editor.input.focus();
      return;
    }
    detach(editor);
    applyParamLiteral(editor.node, editor.param, parsed.value);
  }

  /** 行内输入框：数值/时长/颜色/按键共用一套样式。 */
  function literalInput(className: string, type: string, value: string, label: string): HTMLInputElement {
    const input = document.createElement('input');
    input.className = `ui-input inline-param-input${className ? ` ${className}` : ''}`;
    input.type = type;
    input.value = value;
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    return input;
  }

  function openLiteralInput(
    node: any,
    pin: ParamRowLike,
    anchor: () => ParamRowRect,
    kind: ParamRowKind,
    valueAlign: 'left' | 'right' = 'right',
  ): void {
    closeInlineEditor();
    const definition = pin.definition || {};
    const tupleClass = kind === 'tuple' ? ' inline-param-tuple' : '';
    const shell = el('div', `inline-param-editor${valueAlign === 'left' ? ' value-align-left' : ''}${tupleClass}`);
    const current = paramEditorCurrentValue(pin);
    const label = fieldLabel(String(pin.param));
    let primary: HTMLInputElement;
    let read: ActiveEditor['read'];

    if (kind === 'point') {
      // 坐标点：X/Y 两个整数输入，回车一次提交整点。
      const parts = paramPointParts(current);
      const xInput = literalInput('inline-param-axis', 'number', String(parts.x), `${label} X`);
      const yInput = literalInput('inline-param-axis', 'number', String(parts.y), `${label} Y`);
      xInput.step = '1';
      yInput.step = '1';
      shell.appendChild(el('span', 'inline-param-axis-label', 'X'));
      shell.appendChild(xInput);
      shell.appendChild(el('span', 'inline-param-axis-label', 'Y'));
      shell.appendChild(yInput);
      primary = xInput;
      read = () => {
        const rawX = xInput.value.trim();
        const rawY = yInput.value.trim();
        if (!rawX || !rawY) return { ok: false, error: '坐标需要数值' };
        const x = Number(rawX);
        const y = Number(rawY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: '坐标需要数值' };
        return { ok: true, value: { x: Math.round(x), y: Math.round(y) } };
      };
    } else if (kind === 'rect') {
      // 区域：X/Y/宽/高 四个整数输入，回车一次提交整个区域。
      const rect = paramRectParts(current) || [0, 0, 0, 0];
      const names = ['X', 'Y', '宽', '高'];
      const fields = names.map((name, index) => {
        const input = literalInput('inline-param-axis', 'number', String(rect[index]), `${label} ${name}`);
        input.step = '1';
        if (index >= 2) input.min = '0';
        shell.appendChild(el('span', 'inline-param-axis-label', name));
        shell.appendChild(input);
        return input;
      });
      primary = fields[0];
      read = () => parseParamLiteral('rect', fields.map((input) => input.value.trim()).join(', '), definition);
    } else if (kind === 'tuple') {
      // 固定长度数组：每个元素一个输入格（随机间隔 → 最小值 / 最大值），回车一次提交整行。
      const itemKind = paramTupleItemKind(definition);
      const itemDefinition: ParamRowDefinition = { ...(definition.items || {}) };
      const cells = paramTupleCells(definition, current);
      const fields = cells.map((cellValue, index) => {
        const input = literalInput('inline-param-tuple-input', itemKind === 'string' || itemKind === 'key' ? 'text' : 'number', paramTupleElementText(itemKind, cellValue), `${label} 第 ${index + 1} 项`);
        if (typeof itemDefinition.min === 'number') input.min = String(itemDefinition.min);
        if (typeof itemDefinition.max === 'number') input.max = String(itemDefinition.max);
        input.step = itemKind === 'integer' ? '1' : 'any';
        shell.appendChild(input);
        return input;
      });
      primary = fields[0];
      read = () => parseParamTuple(definition, fields.map((input) => input.value));
    } else if (kind === 'color') {
      // 颜色：色块点开原生取色器，文本仍可手写 #rrggbb。
      const text = literalInput('', 'text', paramLiteralText(kind, current), label);
      text.placeholder = '#rrggbb';
      const swatch = el('label', 'inline-param-swatch');
      swatch.title = '选择颜色';
      const picker = literalInput('inline-param-color', 'color', paramColorSwatch(current) || '#000000', `${label} 取色`);
      swatch.style.background = picker.value;
      picker.addEventListener('input', () => {
        text.value = picker.value;
        swatch.style.background = picker.value;
      });
      text.addEventListener('input', () => {
        const swatchColor = paramColorSwatch(text.value);
        if (!swatchColor) return;
        picker.value = swatchColor;
        swatch.style.background = swatchColor;
      });
      swatch.appendChild(picker);
      shell.appendChild(swatch);
      shell.appendChild(text);
      primary = text;
      read = () => parseParamLiteral('color', text.value, definition);
    } else {
      const type = kind === 'string' || kind === 'key' ? 'text' : 'number';
      primary = literalInput('', type, paramLiteralText(kind, current === undefined && kind === 'string' ? '' : current), label);
      if (kind === 'integer' || kind === 'number' || kind === 'duration') {
        if (typeof definition.min === 'number') primary.min = String(definition.min);
        if (typeof definition.max === 'number') primary.max = String(definition.max);
        primary.step = kind === 'integer' ? '1' : 'any';
      }
      shell.appendChild(primary);
      if (kind === 'duration') shell.appendChild(el('span', 'inline-param-unit', '秒'));
      read = () => parseParamLiteral(kind, primary.value, definition);
    }

    const editor: ActiveEditor = { node, pin, param: String(pin.param), kind, anchor, shell, input: primary, read, closed: false };
    document.body.appendChild(shell);
    active = editor;
    positionShell(editor);
    const onKeyDown = (event: KeyboardEvent) => {
      // 画布快捷键监听在 window 上；这里必须挡住，否则输入会被当成画布操作。
      event.stopPropagation();
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        commit(editor);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        detach(editor);
      }
    };
    const inputs = Array.from(shell.querySelectorAll('input')) as HTMLInputElement[];
    for (const input of inputs) {
      input.addEventListener('keydown', onKeyDown);
      input.addEventListener('blur', () => {
        if (editor.closed) return;
        // 点击外部时 pointerdown 已提交；这里的 blur 只负责收尾（例如按 Tab 离开）。
        window.setTimeout(() => {
          if (editor.closed) return;
          if (shell.contains(document.activeElement)) return;
          commit(editor);
        }, 0);
      });
    }
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('wheel', onDocumentWheel, true);
    window.addEventListener('blur', onWindowBlur);
    primary.focus();
    primary.select();
  }

  /** 按键：常用 keyevent 选择器，仍可自定义令牌。 */
  function openKeyMenu(node: any, pin: ParamRowLike, clientX: number, clientY: number, anchor: () => ParamRowRect, valueAlign: 'left' | 'right' = 'right'): void {
    const definition = pin.definition || {};
    const current = paramKeyText(paramEditorCurrentValue(pin));
    const items: MenuEntry[] = KEY_NAMES.map((name) => ({
      label: `${name === current ? '● ' : ''}${keyOptionLabel(name)}`,
      run: () => applyParamLiteral(node, String(pin.param), name),
    }));
    items.push('separator');
    items.push({ label: '自定义…', run: () => openLiteralInput(node, pin, anchor, 'key', valueAlign) });
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
      items.push({
        label: `恢复默认 ${String(definition.default)}`,
        run: () => applyParamLiteral(node, String(pin.param), undefined),
      });
    }
    items.push({ label: '在详情栏编辑', run: () => requestInspector?.({ kind: 'node', nodeId: node.id }) });
    showMenu(clientX, clientY, items);
  }

  /** 枚举：选项菜单（可搜索），并支持恢复默认与转到详情栏。 */
  function openEnumMenu(node: any, pin: ParamRowLike, clientX: number, clientY: number): void {
    const definition = pin.definition || {};
    const options = paramEnumOptions(definition, enumOption);
    const current = paramEditorCurrentValue(pin);
    const items: MenuEntry[] = options.map((option) => ({
      label: `${sameValue(option.value, current) ? '● ' : ''}${option.label}`,
      run: () => applyParamLiteral(node, String(pin.param), option.value),
    }));
    items.push('separator');
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
      items.push({
        label: `恢复默认 ${String(definition.default)}`,
        run: () => applyParamLiteral(node, String(pin.param), undefined),
      });
    }
    items.push({ label: '在详情栏编辑', run: () => requestInspector?.({ kind: 'node', nodeId: node.id }) });
    showMenu(clientX, clientY, items);
  }

  /** 恢复默认与详情栏入口：资源/区域菜单共用。 */
  function appendedRowItems(node: any, pin: ParamRowLike, configured: boolean): MenuEntry[] {
    const definition = pin.definition || {};
    const items: MenuEntry[] = [];
    if (configured) {
      items.push('separator');
      items.push({ label: '清除本行取值', run: () => applyParamLiteral(node, String(pin.param), undefined) });
    }
    items.push('separator');
    if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
      items.push({
        label: `恢复默认 ${String(definition.default)}`,
        run: () => applyParamLiteral(node, String(pin.param), undefined),
      });
    }
    items.push({ label: '在详情栏编辑', run: () => requestInspector?.({ kind: 'node', nodeId: node.id }) });
    return items;
  }

  /**
   * 模板/资源参数：素材浏览器里挑一张已有图片，或直接从当前画面截取一张保存为模板。
   * 两条路径都拿裸写入当 applyValue（弹层自己包 mutate）。
   */
  function openAssetMenu(node: any, pin: ParamRowLike, clientX: number, clientY: number): void {
    const param = String(pin.param);
    const current = paramEditorCurrentValue(pin);
    const currentPath = typeof current === 'string' ? current : '';
    const write = (value: unknown): void => writeParamLiteral(node, param, value);
    const items: MenuEntry[] = [];
    if (openAssetBrowser) {
      items.push({
        label: currentPath ? '更换模板图…' : '选择模板图…',
        run: () => openAssetBrowser(node.id, param, currentPath, (path: string) => write(path)),
      });
    }
    if (requestRoi) {
      items.push({
        label: '从当前画面截取…',
        run: () => requestRoi(node.id, param, 'asset', { applyValue: write }),
      });
    }
    if (!items.length) {
      requestInspector?.({ kind: 'node', nodeId: node.id });
      return;
    }
    items.push(...appendedRowItems(node, pin, pin.configured === true));
    showMenu(clientX, clientY, items);
  }

  /** 区域参数：直接在当前画面上框选，或手输四个坐标。 */
  function openRectMenu(node: any, pin: ParamRowLike, clientX: number, clientY: number, anchor: () => ParamRowRect, valueAlign: 'left' | 'right' = 'right'): void {
    const param = String(pin.param);
    const write = (value: unknown): void => writeParamLiteral(node, param, value);
    const items: MenuEntry[] = [];
    if (requestRoi) {
      items.push({
        label: '在当前画面上框选…',
        run: () => requestRoi(node.id, param, 'rect', { applyValue: write }),
      });
    }
    items.push({ label: '手动输入四坐标…', run: () => openLiteralInput(node, pin, anchor, 'rect', valueAlign) });
    items.push(...appendedRowItems(node, pin, pin.configured === true));
    showMenu(clientX, clientY, items);
  }

  function openParamEditor(request: NodeParamEditorRequest): void {
    const { node, pin, rect, clientX, clientY, world, valueAlign } = request;
    const param = String(pin && pin.param ? pin.param : '');
    if (!node || !param) return;
    const align = valueAlign === 'left' ? 'left' : 'right';
    switch (paramEditorAction(pin)) {
      case 'binding-menu':
        // 已绑定变量：复用端口菜单（定位变量卡片 / 断开链接 / 复制引用）。
        closeInlineEditor();
        showMenu(clientX, clientY, nodeVariablePinMenuItems(node.id, pin, world));
        return;
      case 'toggle': {
        closeInlineEditor();
        const current = Boolean(paramEditorCurrentValue(pin));
        applyParamLiteral(node, param, !current);
        const labels = toggleLabelsOf(pin);
        toast(`${fieldLabel(param)}：${!current ? labels.on : labels.off}`);
        return;
      }
      case 'enum-menu':
        closeInlineEditor();
        openEnumMenu(node, pin, clientX, clientY);
        return;
      case 'asset-menu':
        closeInlineEditor();
        openAssetMenu(node, pin, clientX, clientY);
        return;
      case 'roi-menu':
        closeInlineEditor();
        openRectMenu(node, pin, clientX, clientY, () => rect, align);
        return;
      case 'input': {
        const kind = paramRowKindOf(pin, pin.definition);
        if (kind === 'key') {
          closeInlineEditor();
          openKeyMenu(node, pin, clientX, clientY, () => rect, align);
          return;
        }
        openLiteralInput(node, pin, () => rect, kind, align);
        return;
      }
      default:
        // 结构体参数：详情栏才是完整编辑器。
        closeInlineEditor();
        requestInspector?.({ kind: 'node', nodeId: node.id });
        toast(`${fieldLabel(param)} 需要在详情栏编辑`);
    }
  }

  return { openParamEditor, closeInlineEditor, refreshInlineEditor, inlineEditorOpen, setParamLiteral: applyParamLiteral };
}