/**
 * 卡片参数行的就地编辑：UE 风格的行内控件分派（变量菜单 / 勾选切换 / 枚举菜单 / 数值与文本输入）。
 * 资源与结构体参数不做行内编辑，直接送到详情栏（对应 UE 里必须展开的结构体）。
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
  paramLiteralText, paramPointParts, paramRowKind, parseParamLiteral, worldRectToScreen,
} from '../render/param-rows';
import type { ParamRowLike, ParamRowKind, ParamRowRect } from '../render/param-rows';

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
  } = deps;

  let active: ActiveEditor | null = null;

  function sameValue(left: unknown, right: unknown): boolean {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return left === right;
    }
  }

  /** 写入一个字面量；undefined 表示移除该参数（回到定义默认值）。 */
  function applyParamLiteral(node: any, param: string, value: unknown): void {
    mutate(() => {
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
    });
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
  ): void {
    closeInlineEditor();
    const definition = pin.definition || {};
    const shell = el('div', 'inline-param-editor');
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
  function openKeyMenu(node: any, pin: ParamRowLike, clientX: number, clientY: number, anchor: () => ParamRowRect): void {
    const definition = pin.definition || {};
    const current = paramKeyText(paramEditorCurrentValue(pin));
    const items: MenuEntry[] = KEY_NAMES.map((name) => ({
      label: `${name === current ? '● ' : ''}${keyOptionLabel(name)}`,
      run: () => applyParamLiteral(node, String(pin.param), name),
    }));
    items.push('separator');
    items.push({ label: '自定义…', run: () => openLiteralInput(node, pin, anchor, 'key') });
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

  function openParamEditor(request: NodeParamEditorRequest): void {
    const { node, pin, rect, clientX, clientY, world } = request;
    const param = String(pin && pin.param ? pin.param : '');
    if (!node || !param) return;
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
        toast(`${fieldLabel(param)}：${!current ? '已开启' : '已关闭'}`);
        return;
      }
      case 'enum-menu':
        closeInlineEditor();
        openEnumMenu(node, pin, clientX, clientY);
        return;
      case 'input': {
        const kind = paramRowKind(pin.definition);
        if (kind === 'key') {
          closeInlineEditor();
          openKeyMenu(node, pin, clientX, clientY, () => rect);
          return;
        }
        openLiteralInput(node, pin, () => rect, kind);
        return;
      }
      default:
        // 资源与结构体参数：详情栏才是完整编辑器。
        closeInlineEditor();
        requestInspector?.({ kind: 'node', nodeId: node.id });
        toast(`${fieldLabel(param)} 需要在详情栏编辑`);
    }
  }

  return { openParamEditor, closeInlineEditor, refreshInlineEditor, inlineEditorOpen, setParamLiteral: applyParamLiteral };
}