/**
 * 值卡片（布尔判断 / 拆分）的浮动编辑器：贴着卡片打开的一块 HTML 面板，
 * 就地编辑「判断条件」与「拆分字段」。
 *
 * 为什么不做在详情面板里：这两类卡片是纯引脚卡片（UE 的值节点），编辑对象就是卡片
 * 自己的内容，面板会把视线从卡片上拽走。浮层与行内参数编辑器共用同一套定位/销毁约定
 * （world → 屏幕坐标、滚轮重新贴位、点外面提交、Esc 关闭）。
 */
import type { CanvasState } from '../state/canvas-state';
import { worldRectToScreen } from '../render/param-rows';
import { renderBoolJudgeFields, renderBreakFields, type ValueCardFieldDeps } from '../inspector/value-card-fields';

export interface ValueCardEditorDeps {
  state: CanvasState;
  wrap: HTMLElement;
  el(tag: string, className?: string, text?: string): HTMLElement;
  mutate(fn: () => void): void;
  nodeById(id: string): any;
  position(node: any): { x: number; y: number };
  nodeWidth: number;
  /** 卡片内容的渲染实现（与详情面板共用一份）。 */
  fields: Omit<ValueCardFieldDeps, 'mutate'>;
  /** 装饰器列表（值卡片也能挂装饰器，跟着一起搬过来）。 */
  renderDecorators?(body: HTMLElement, node: any): void;
  /** 重命名（浮动面板顶部的名称输入框）。 */
  renameNode(nodeId: string, name: string): void;
  /** 卡片标题（UE 风格的类型派生标题；缺省时退回 `name || id`）。 */
  displayTitle?(node: any): string;
}

export interface CanvasValueCardEditor {
  open(nodeId: string): boolean;
  close(): void;
  refresh(): void;
  isOpen(): boolean;
}

interface ActiveValueCardEditor {
  node: any;
  shell: HTMLElement;
  body: HTMLElement;
  closed: boolean;
}

/** 面板宽度（屏幕像素，不随缩放变化，保证输入框始终可读）。 */
const PANEL_WIDTH = 300;

export function createValueCardEditor(deps: ValueCardEditorDeps): CanvasValueCardEditor {
  const { state, wrap, el, mutate, nodeById, position, nodeWidth } = deps;
  let active: ActiveValueCardEditor | null = null;

  function detach(editor: ActiveValueCardEditor): void {
    if (editor.closed) return;
    editor.closed = true;
    editor.shell.remove();
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('blur', onWindowBlur);
    if (active === editor) active = null;
  }

  function close(): void {
    if (active) detach(active);
  }

  /** 面板贴在卡片下方：左缘对齐卡片，纵向从卡片头部下面开始，整块不随缩放变形。 */
  function positionEditor(editor: ActiveValueCardEditor): void {
    const pos = position(editor.node);
    const wrapRect = wrap.getBoundingClientRect();
    const screen = worldRectToScreen({ x: pos.x, y: pos.y + 44, width: nodeWidth, height: 120 }, {
      left: wrapRect.left,
      top: wrapRect.top,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
    });
    const maxLeft = Math.max(8, wrapRect.width - PANEL_WIDTH - 8);
    editor.shell.style.left = `${Math.round(Math.min(Math.max(8, screen.left), maxLeft))}px`;
    editor.shell.style.top = `${Math.round(Math.max(8, screen.top))}px`;
    editor.shell.style.width = `${PANEL_WIDTH}px`;
  }

  /** 重建面板内容：每次改文档后按最新节点重建，表单不会拿着过期快照。 */
  function build(editor: ActiveValueCardEditor): void {
    const node = editor.node;
    editor.body.innerHTML = '';
    // 只有进阶内容：结构体/运算符走节点菜单，名称走结构树 F2（与 UE 一致）。
    if (node.type === 'bool_judge') renderBoolJudgeFields(editor.body, node, fieldDeps(editor));
    else renderBreakFields(editor.body, node, fieldDeps(editor));
    deps.renderDecorators?.(editor.body, node);
  }

  /** 把 mutate 包成「改完就重建」：字段增删改后表单立即反映最新状态。 */
  function fieldDeps(editor: ActiveValueCardEditor): ValueCardFieldDeps {
    return {
      ...deps.fields,
      mutate: (fn: () => void) => {
        mutate(fn);
        if (!editor.closed) build(editor);
      },
    };
  }

  function onDocumentPointerDown(event: Event): void {
    const editor = active;
    if (!editor) return;
    const target = event.target as Node | null;
    if (target && editor.shell.contains(target)) return;
    // 点面板外面：收起面板（内容已即时落盘，不需要提交动作）。
    detach(editor);
  }

  function onDocumentKeyDown(event: KeyboardEvent): void {
    if (!active || event.key !== 'Escape') return;
    // 条件控件里的下拉浮层自己会吃 Esc，这里只处理面板本身。
    event.stopPropagation();
    detach(active);
  }

  function onWindowBlur(): void {
    close();
  }

  function refresh(): void {
    const editor = active;
    if (!editor) return;
    if (!nodeById(String(editor.node.id || ''))) {
      detach(editor);
      return;
    }
    positionEditor(editor);
  }

  function isOpen(): boolean {
    return Boolean(active);
  }

  function open(nodeId: string): boolean {
    const node = nodeById(nodeId);
    if (!node) return false;
    close();
    const shell = el('div', 'value-card-editor');
    const head = el('div', 'value-card-editor-head');
    const title = el('span', 'value-card-editor-title', String(deps.displayTitle?.(node) || node.name || node.id || ''));
    head.appendChild(title);
    head.appendChild(el('span', 'value-card-editor-kind', node.type === 'bool_judge' ? '布尔判断' : '拆分'));
    const body = el('div', 'value-card-editor-body');
    shell.appendChild(head);
    shell.appendChild(body);
    document.body.appendChild(shell);
    const editor: ActiveValueCardEditor = { node, shell, body, closed: false };
    active = editor;
    build(editor);
    positionEditor(editor);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('blur', onWindowBlur);
    return true;
  }

  return { open, close, refresh, isOpen };
}
