/**
 * 画布注释框（UE Comment）：文档顶层 `comments` 的可视化与编辑。
 *
 * 设计取舍：注释框**自己一个图层**（`.comments`，挂在 `.graph-world` 最前面，画在连线与卡片
 * 之下），并且不参与卡片/连线的签名与补丁机制——它们数量少、结构简单，整层按内容签名重建即可。
 * 这样既不会拖慢 500 节点量级的高频路径，也不用改动 `render-controller` 的那套增量逻辑。
 *
 * 交互：拖标题栏移动、拖右下角改尺寸、双击标题就地改文字、标题栏右侧 × 删除；
 * 所有写操作都包在 `mutate` 里（一次操作 = 一条历史）。
 */

export interface CanvasComment {
  id: string;
  text: string;
  at: { x: number; y: number };
  size?: { w: number; h: number };
  tint?: string;
}

export interface CanvasCommentsDeps {
  state: any;
  /** 画布 SVG 宿主（`.graph-world` 就挂在它下面）。 */
  host: any;
  svgEl(tag: string, attrs?: Record<string, any>, parent?: any): any;
  mutate(fn: () => void): void;
  render(flags?: any): void;
  worldPoint(event: any): { x: number; y: number };
  /** 就地改文字用的浮层宿主（与节点改名同一套：HTML 输入框盖在 SVG 上）。 */
  wrap: HTMLElement;
  el(tag: string, className?: string, text?: string): HTMLElement;
  toast?(message: string, isError?: boolean): void;
  /** 拖拽开始/结束交给 pointer 模块（它统一处理 autoPan、历史与重绘）。 */
  startCommentDrag?(event: any, comment: CanvasComment, mode: 'move' | 'resize'): void;
}

export interface CanvasComments {
  render(): void;
  /** 在文档坐标处新建一个注释框（默认尺寸，文字待改）。 */
  create(x: number, y: number): CanvasComment | null;
  remove(id: string): void;
  rename(id: string, text: string): void;
  selectedId(): string;
  setSelected(id: string): void;
  /** 就地编辑某个注释框的标题（双击标题栏、或新建后自动进入）。 */
  editText(id: string): boolean;
  hitTest(x: number, y: number): CanvasComment | null;
  list(): CanvasComment[];
  closeEditor(): void;
}

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 200;
const TITLE_HEIGHT = 28;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
/** 注释框的留白：与卡片一样贴 8 像素网格，视觉上和卡片对齐。 */
const GRID = 8;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function roundToGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export function createCanvasComments(deps: CanvasCommentsDeps): CanvasComments {
  const { state, host, svgEl, mutate, render, worldPoint, wrap, el } = deps;
  let layer: any = null;
  let selected = '';
  let signature = '';
  let editor: { id: string; shell: HTMLElement; input: HTMLInputElement } | null = null;

  /** 注释框列表：文档里的 `comments` 是唯一真相（v5 直接透传，没有旁表）。 */
  function list(): CanvasComment[] {
    const raw = state.raw;
    if (!raw || typeof raw !== 'object') return [];
    if (!Array.isArray(raw.comments)) return [];
    return raw.comments.filter((item: any): item is CanvasComment => isRecord(item) && typeof item.id === 'string');
  }

  function table(): CanvasComment[] {
    const raw = state.raw;
    if (!raw || typeof raw !== 'object') return [];
    if (!Array.isArray(raw.comments)) raw.comments = [];
    return raw.comments;
  }

  function sizeOf(comment: CanvasComment): { w: number; h: number } {
    const size = comment.size;
    if (isRecord(size) && Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0) {
      return { w: Math.trunc(size.w), h: Math.trunc(size.h) };
    }
    return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
  }

  function nextId(): string {
    const used = new Set(list().map((comment) => comment.id));
    let index = 1;
    while (used.has(`comment_${index}`)) index += 1;
    return `comment_${index}`;
  }

  function setSelected(id: string): void {
    if (selected === id) return;
    selected = id;
  }

  function ensureLayer(): any {
    const world = host && typeof host.querySelector === 'function' ? host.querySelector('.graph-world') : null;
    if (!world) return null;
    // 图层只建一次；文档整体替换时如果 `.graph-world` 被换掉，这里会重新挂上去。
    if (layer && typeof layer.isConnected === 'boolean' && layer.isConnected) return layer;
    // 插到最前面：注释框是背景标注，必须画在连线与卡片之下。
    layer = svgEl('g', { class: 'comments' });
    if (typeof world.insertBefore === 'function' && world.firstChild) world.insertBefore(layer, world.firstChild);
    else world.appendChild(layer);
    return layer;
  }

  /** 注释框内容签名：文字、坐标、尺寸、选中态、缩放分级都影响画出来的东西。 */
  function contentSignature(): string {
    const parts = list().map((comment) => {
      const size = sizeOf(comment);
      return `${comment.id}|${comment.at?.x},${comment.at?.y}|${size.w}x${size.h}|${comment.tint || ''}|${comment.text}`;
    });
    return `${parts.join('||')}#${selected}`;
  }

  function removeElement(element: any): void {
    if (element && typeof element.remove === 'function') element.remove();
  }

  function closeEditor(): void {
    if (!editor) return;
    editor.shell.remove();
    editor = null;
  }

  function commitEditor(): void {
    const current = editor;
    if (!current) return;
    const text = current.input.value;
    closeEditor();
    const comment = list().find((item) => item.id === current.id);
    if (!comment || comment.text === text) return;
    mutate(() => {
      for (const item of table()) if (isRecord(item) && item.id === current.id) item.text = text;
    });
    render({ graph: true, minimap: true, panels: true, selection: true });
  }

  function positionEditor(active: { id: string; shell: HTMLElement; input: HTMLInputElement }): void {
    const comment = list().find((item) => item.id === active.id);
    if (!comment) return;
    const wrapRect = wrap.getBoundingClientRect();
    const zoom = Number(state.zoom) || 1;
    const left = wrapRect.left + (comment.at.x * zoom + state.panX);
    const top = wrapRect.top + (comment.at.y * zoom + state.panY);
    active.shell.style.left = `${Math.round(left)}px`;
    active.shell.style.top = `${Math.round(top)}px`;
    active.shell.style.width = `${Math.round(Math.max(MIN_WIDTH, sizeOf(comment).w) * zoom)}px`;
    active.shell.style.height = `${Math.round(TITLE_HEIGHT * zoom)}px`;
  }

  function editText(id: string): boolean {
    const comment = list().find((item) => item.id === id);
    if (!comment) return false;
    closeEditor();
    const shell = el('div', 'comment-text-editor');
    const input = document.createElement('input');
    input.className = 'comment-text-input';
    input.type = 'text';
    input.value = comment.text;
    input.placeholder = '注释文字';
    input.spellcheck = false;
    input.setAttribute('aria-label', '注释文字');
    shell.appendChild(input);
    wrap.appendChild(shell);
    const active = { id, shell, input };
    editor = active;
    positionEditor(active);
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        commitEditor();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor();
        render({ graph: true, minimap: true });
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (editor && editor.shell === shell) commitEditor();
      }, 0);
    });
    input.focus();
    input.select();
    return true;
  }

  function create(x: number, y: number): CanvasComment | null {
    if (!state.raw || typeof state.raw !== 'object') return null;
    const comment: CanvasComment = {
      id: nextId(),
      text: '注释',
      at: { x: roundToGrid(x), y: roundToGrid(y) },
      size: { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT },
    };
    mutate(() => {
      table().push(comment);
    });
    selected = comment.id;
    render({ graph: true, minimap: true, panels: true, selection: true });
    return comment;
  }

  function remove(id: string): void {
    if (!list().some((comment) => comment.id === id)) return;
    mutate(() => {
      const tableRef = table();
      const index = tableRef.findIndex((item: any) => isRecord(item) && item.id === id);
      if (index >= 0) tableRef.splice(index, 1);
    });
    if (selected === id) selected = '';
    if (editor && editor.id === id) closeEditor();
    render({ graph: true, minimap: true, panels: true, selection: true });
  }

  function rename(id: string, text: string): void {
    if (!list().some((comment) => comment.id === id)) return;
    mutate(() => {
      for (const item of table()) if (isRecord(item) && item.id === id) item.text = text;
    });
    render({ graph: true, minimap: true, panels: true, selection: true });
  }

  function hitTest(x: number, y: number): CanvasComment | null {
    const comments = list();
    // 后画的在上：从后往前找。
    for (let index = comments.length - 1; index >= 0; index -= 1) {
      const comment = comments[index];
      const size = sizeOf(comment);
      if (x >= comment.at.x && x <= comment.at.x + size.w && y >= comment.at.y && y <= comment.at.y + size.h) {
        return comment;
      }
    }
    return null;
  }

  function buildComment(comment: CanvasComment): any {
    const size = sizeOf(comment);
    const group = svgEl('g', {
      class: `comment-box${selected === comment.id ? ' selected' : ''}${comment.tint ? ` tint-${comment.tint}` : ''}`,
      transform: `translate(${comment.at.x}, ${comment.at.y})`,
      'data-comment-id': comment.id,
    }, layer);
    svgEl('rect', { class: 'comment-frame', x: 0, y: 0, width: size.w, height: size.h, rx: 4 }, group);
    const title = svgEl('g', { class: 'comment-title-bar' }, group);
    svgEl('rect', { class: 'comment-title-fill', x: 0, y: 0, width: size.w, height: TITLE_HEIGHT }, title);
    const label = svgEl('text', { class: 'comment-title', x: 10, y: TITLE_HEIGHT / 2 }, title);
    label.textContent = comment.text || '注释';
    const removeButton = svgEl('text', {
      class: 'comment-remove',
      x: size.w - 20,
      y: TITLE_HEIGHT / 2,
    }, title);
    removeButton.textContent = '×';
    // 右下角改尺寸把手。
    svgEl('path', {
      class: 'comment-resize',
      d: `M ${size.w - 14} ${size.h - 2} L ${size.w - 2} ${size.h - 14} M ${size.w - 8} ${size.h - 2} L ${size.w - 2} ${size.h - 8}`,
    }, group);
    return group;
  }

  function bindComment(element: any, comment: CanvasComment): void {
    element.addEventListener('pointerdown', (event: any) => {
      const target = event.target;
      const className = String(target?.getAttribute?.('class') || '');
      if (className.includes('comment-remove')) {
        event.preventDefault();
        event.stopPropagation();
        remove(comment.id);
        return;
      }
      setSelected(comment.id);
      if (className.includes('comment-resize')) {
        deps.startCommentDrag?.(event, comment, 'resize');
        return;
      }
      deps.startCommentDrag?.(event, comment, 'move');
    });    element.addEventListener('dblclick', (event: any) => {
      // 双击标题栏改文字；双击框体本身只是选中。
      const y = worldPoint(event).y - comment.at.y;
      if (y > TITLE_HEIGHT) return;
      event.preventDefault();
      event.stopPropagation();
      editText(comment.id);
    });
    element.addEventListener('contextmenu', (event: any) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function render_(): void {
    const target = ensureLayer();
    if (!target) return;
    const next = contentSignature();
    if (next === signature) return;
    signature = next;
    if (typeof target.replaceChildren === 'function') target.replaceChildren();
    else target.innerHTML = '';
    for (const comment of list()) bindComment(buildComment(comment), comment);
    if (editor) positionEditor(editor);
  }

  return {
    render: render_,
    create,
    remove,
    rename,
    selectedId: () => selected,
    setSelected,
    editText,
    hitTest,
    list,
    closeEditor,
  };
}
