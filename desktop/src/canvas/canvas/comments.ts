/**
 * 画布注释框（UE Comment）：文档顶层 `comments` 的可视化与编辑。
 *
 * 设计取舍：注释框**自己一个图层**（`.comments`，挂在 `.graph-world` 最前面，画在连线与卡片
 * 之下），并且不参与卡片/连线的签名与补丁机制——它们数量少、结构简单，整层按内容签名重建即可。
 * 这样既不会拖慢 500 节点量级的高频路径，也不用改动 `render-controller` 的那套增量逻辑。
 *
 * 标题按框宽自动折行（SVG `<text>` 不会换行，长句子会横着跑出框外）：行数决定标题栏高度，
 * 文字裁在框内；显式换行（`\n`，DSL 里是 `|` 文本块）照旧保留。折行只影响画法，
 * `text` 里存的仍是原始字符串。
 *
 * 交互：拖标题栏移动、拖右下角改尺寸、双击标题就地改文字、标题栏右侧 × 删除；
 * 所有写操作都包在 `mutate` 里（一次操作 = 一条历史）。
 */

import { createCharMeasure, wrapText, type CharMeasure } from './text-wrap';

export interface CanvasComment {
  id: string;
  text: string;
  at: { x: number; y: number };
  size?: { w: number; h: number };
  /** 分类色：`warning` / `danger` / `success` / `info`，缺省走灰蓝。 */
  tint?: string;
  /** 标题字号（世界坐标 px）：缺省 12。 */
  fontSize?: number;
  /** 整框不透明度：(0, 1]，缺省 1（字段不写）。 */
  opacity?: number;
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
  /** 选中注释框时把变量卡片选中让出去（与卡片/连线的选中互斥）。 */
  clearVariableSelection?(): void;
  /**
   * 把当前选中项投影给「详细信息」面板。
   *
   * 可见的详情面板是壳层里的**镜像画布**（`canvas.html?mode=details`），画布自己的
   * `#inspector` 在 `desktop-canvas-mode` 下是隐藏的；所以选中注释框必须像节点那样
   * `postMessage` 出去，否则面板永远停在「选择一个节点」。
   */
  requestInspector?(): void;
}

export interface CanvasComments {
  render(): void;
  /** 在文档坐标处新建一个注释框（默认尺寸，文字待改）。 */
  create(x: number, y: number): CanvasComment | null;
  remove(id: string): void;
  rename(id: string, text: string): void;
  /** 详情面板用的同一个入口：改标题文字。 */
  setText(id: string, text: string): void;
  /** 详情面板：改分类色（`''` = 默认灰蓝）。 */
  setTint(id: string, tint: string): void;
  /** 详情面板：改标题字号（自动夹到允许区间）。 */
  setFontSize(id: string, fontSize: number): void;
  /** 详情面板：改整框不透明度（夹到 [0.1, 1]，1 直接删字段）。 */
  setOpacity(id: string, opacity: number): void;
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
/** 标题字号（世界坐标 px）：默认值 + 允许区间，详情面板与文档校验共用。 */
export const DEFAULT_COMMENT_FONT_SIZE = 12;
export const MIN_COMMENT_FONT_SIZE = 9;
export const MAX_COMMENT_FONT_SIZE = 32;
/** 注释框可选的分类色：与卡片同一套 tint 变量（空串 = 默认灰蓝）。 */
export const COMMENT_TINTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '默认' },
  { value: 'warning', label: '黄' },
  { value: 'danger', label: '红' },
  { value: 'success', label: '绿' },
  { value: 'info', label: '蓝' },
];
/** 分类色名 → 具体颜色：详情面板的取色器要拿它当初始值，也是渲染时的兜底。 */
export const COMMENT_TINT_COLORS: Readonly<Record<string, string>> = {
  warning: '#c9a227',
  danger: '#c0564f',
  success: '#5a9e6f',
  info: '#4a90d9',
};
/** 没有分类色时框体用的底色（与 `.comment-box` 的 CSS 变量默认值一致）。 */
export const DEFAULT_COMMENT_TINT = '#6b7785';
/** 整框不透明度的允许区间：最低留一点，否则框会彻底看不见、也点不着。 */
export const MIN_COMMENT_OPACITY = 0.1;
export const DEFAULT_COMMENT_OPACITY = 1;

/** 文档里的 opacity → 实际用的值（认不出的、越界的都夹回区间）。 */
export function commentOpacity(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_COMMENT_OPACITY;
  return Math.min(DEFAULT_COMMENT_OPACITY, Math.max(MIN_COMMENT_OPACITY, numeric));
}

/** `#rgb` / `#rrggbb`：分类色允许直接给颜色（详情面板的取色器就是走这一支）。 */
export function commentTintColor(tint: unknown): string {
  if (typeof tint !== 'string') return '';
  const value = tint.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return COMMENT_TINT_COLORS[value] || '';
}

/** 色名形态（warning / danger / …）：走 CSS class；直接给颜色的返回空串（走内联变量）。 */
export function commentTintName(tint: unknown): string {
  if (typeof tint !== 'string') return '';
  const value = tint.trim();
  return COMMENT_TINT_COLORS[value] ? value : '';
}
/** 标题左边距。删除按钮的占位由 `removeButtonSize()` 按字号算，右边不再写死。 */
const TITLE_PAD = 10;
/** 删除按钮与标题文字之间的缝。 */
const TITLE_BUTTON_GAP = 4;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
/** 注释框的留白：与卡片一样贴 8 像素网格，视觉上和卡片对齐。 */
const GRID = 8;

/** 标题字号 → 行高 / 单行标题栏高度：字号变了这两个跟着走。 */
export function commentLineHeight(fontSize: number): number {
  return fontSize + 4;
}
export function commentBarHeight(fontSize: number): number {
  return fontSize + 16;
}

/**
 * 删除按钮的方块边长与「×」字形大小：跟着标题字号一起长。
 * 方块比字形大一圈，保证好点（以前只有 14px 的字形，命中区就是那几个笔画）。
 */
export function removeButtonSize(fontSize: number): number {
  return Math.min(32, Math.max(24, Math.round(fontSize * 1.8)));
}
export function removeGlyphSize(fontSize: number): number {
  return Math.min(22, Math.max(16, Math.round(fontSize * 1.5)));
}

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
  let editor: { id: string; shell: HTMLElement; input: HTMLTextAreaElement } | null = null;

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

  /** 该注释框的字号：非法值一律回落到默认（文档可能被手改过）。 */
  function fontSizeOf(comment: CanvasComment): number {
    const value = comment.fontSize;
    if (Number.isFinite(value) && (value as number) >= MIN_COMMENT_FONT_SIZE && (value as number) <= MAX_COMMENT_FONT_SIZE) {
      return Math.round(value as number);
    }
    return DEFAULT_COMMENT_FONT_SIZE;
  }

  /** 该注释框的不透明度（1 = 不透明）。 */
  function opacityOf(comment: CanvasComment): number {
    return commentOpacity(comment.opacity);
  }

  /** 标题可用宽度：左边距 + 右边留给删除按钮的方块（按字号算）。 */
  function titleWidth(comment: CanvasComment): number {
    const fontSize = fontSizeOf(comment);
    const reserve = TITLE_PAD + removeButtonSize(fontSize) + TITLE_BUTTON_GAP;
    return Math.max(fontSize, sizeOf(comment).w - reserve);
  }

  /** 按字符缓存的测量函数；字体从图层上取，保证和 SVG 里渲染的是同一套（测试里没有则走估算表）。 */
  let familySeen = '';
  const measurers = new Map<number, CharMeasure>();
  function charMeasure(fontSize: number): CharMeasure {
    let family = familySeen;
    if (!family) {
      try {
        const view = (globalThis as any).getComputedStyle;
        if (typeof view === 'function' && layer) {
          family = String(view(layer).fontFamily || '');
          familySeen = family;
        }
      } catch {
        family = '';
      }
    }
    const cached = measurers.get(fontSize);
    if (cached) return cached;
    const measure = createCharMeasure({ fontSize, fontFamily: family || undefined, fontWeight: '600' });
    if (measurers.size > 8) measurers.clear();
    measurers.set(fontSize, measure);
    return measure;
  }

  /**
   * 折行结果缓存：拖动/缩放一帧会整层重建，同一段文字不能每帧都重折一遍。
   * 宽度只会按 8 像素网格变化（改尺寸也贴网格），所以缓存命中率很高。
   */
  const wrapCache = new Map<string, string[]>();
  function titleLines(text: string, width: number, fontSize: number): string[] {
    const key = `${fontSize}|${width}|${text}`;
    const hit = wrapCache.get(key);
    if (hit) return hit;
    const lines = wrapText(text || '注释', width, charMeasure(fontSize));
    if (wrapCache.size > 64) wrapCache.clear();
    wrapCache.set(key, lines);
    return lines;
  }

  /** 标题栏高度：字号定单行高度、行数定总高，最少一行、最多不超过框高。 */
  function headerHeight(comment: CanvasComment, text: string = comment.text): number {
    const fontSize = fontSizeOf(comment);
    const bar = commentBarHeight(fontSize);
    const lines = titleLines(text, titleWidth(comment), fontSize);
    return Math.max(bar, Math.min(bar + (lines.length - 1) * commentLineHeight(fontSize), sizeOf(comment).h));
  }

  /** 框高最多能完整放几行标题。 */
  function titleCapacity(comment: CanvasComment): number {
    const fontSize = fontSizeOf(comment);
    return Math.max(1, Math.floor((sizeOf(comment).h - commentBarHeight(fontSize)) / commentLineHeight(fontSize)) + 1);
  }

  /**
   * 真正画出来的行：框太矮时只画放得下的整行，末尾补省略号——
   * 否则最后一行会被裁成半个字，看着像画坏了（完整文字在就地编辑器里能看全）。
   */
  function visibleLines(comment: CanvasComment, lines: string[]): string[] {
    const capacity = titleCapacity(comment);
    if (lines.length <= capacity) return lines;
    const kept = lines.slice(0, capacity);
    const measure = charMeasure(fontSizeOf(comment));
    const width = titleWidth(comment);
    let last = kept[kept.length - 1];
    const ellipsis = measure('…');
    const used = (value: string): number => Array.from(value).reduce((sum, char) => sum + measure(char), 0);
    while (last && used(last) + ellipsis > width) last = last.slice(0, -1);
    kept[kept.length - 1] = `${last}…`;
    return kept;
  }

  function nextId(): string {
    const used = new Set(list().map((comment) => comment.id));
    let index = 1;
    while (used.has(`comment_${index}`)) index += 1;
    return `comment_${index}`;
  }

  /**
   * 选中注释框：唯一真相写进 `state`，详情面板与高亮都跟着它走。
   *
   * 注释框不是节点，选中态没法借 `state.selected`；`state.inspector` 正好是「详情面板
   * 当前该显示谁」的开关，注释框借用 `'comment'` 这一档，面板切到别的东西时高亮自动撤掉
   * （见 render_ 里的回收）。
   */
  function setSelected(id: string): void {
    if (selected === id) return;
    selected = id;
    state.selectedCommentId = id;
    if (!id) return;
    state.inspector = 'comment';
    // 注释框也是「当前选中的东西」：把卡片 / 连线 / 实例运行的选中让出来。
    // 不然 Delete 会删掉上一次选中的节点（面板却在显示注释框）。
    if (state.selected && typeof state.selected.clear === 'function') state.selected.clear();
    state.selectedEdge = null;
    state.selectedRun = null;
    deps.clearVariableSelection?.();
    // 把选区投影给壳层的详情栏镜像（可见的那个面板在它那边）。
    deps.requestInspector?.();
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

  /** 注释框内容签名：文字、坐标、尺寸、分类色、字号、不透明度、选中态都影响画出来的东西。 */
  function contentSignature(): string {
    const parts = list().map((comment) => {
      const size = sizeOf(comment);
      return `${comment.id}|${comment.at?.x},${comment.at?.y}|${size.w}x${size.h}|${comment.tint || ''}|${fontSizeOf(comment)}|${opacityOf(comment)}|${comment.text}`;
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

  function positionEditor(active: { id: string; shell: HTMLElement; input: HTMLTextAreaElement }): void {
    const comment = list().find((item) => item.id === active.id);
    if (!comment) return;
    const size = sizeOf(comment);
    const fontSize = fontSizeOf(comment);
    const lineHeight = commentLineHeight(fontSize);
    const bar = commentBarHeight(fontSize);
    const wrapRect = wrap.getBoundingClientRect();
    const zoom = Number(state.zoom) || 1;
    const left = wrapRect.left + (comment.at.x * zoom + state.panX);
    const top = wrapRect.top + (comment.at.y * zoom + state.panY);
    // 高度跟着折行结果走：写多行长文字时输入框和框里的标题一样高（不超过框体，超出就在框内滚动）。
    const lines = titleLines(active.input.value, titleWidth(comment), fontSize);
    const height = Math.max(bar, Math.min(bar + (lines.length - 1) * lineHeight, size.h));
    active.shell.style.left = `${Math.round(left)}px`;
    active.shell.style.top = `${Math.round(top)}px`;
    active.shell.style.width = `${Math.round(Math.max(MIN_WIDTH, size.w) * zoom)}px`;
    active.shell.style.height = `${Math.round(height * zoom)}px`;
    // 字号与行高随缩放走，否则浮层的换行位置和框里画出来的标题对不上。
    active.shell.style.fontSize = `${fontSize * zoom}px`;
    active.shell.style.lineHeight = `${lineHeight * zoom}px`;
  }

  function editText(id: string): boolean {
    const comment = list().find((item) => item.id === id);
    if (!comment) return false;
    closeEditor();
    const shell = el('div', 'comment-text-editor');
    // 多行输入：折行是画法，但用户也可能自己敲换行（DSL 里落成 `|` 文本块）。
    const input = document.createElement('textarea') as HTMLTextAreaElement;
    input.className = 'comment-text-input';
    input.value = comment.text;
    input.placeholder = '注释文字';
    input.spellcheck = false;
    input.rows = 1;
    input.setAttribute('aria-label', '注释文字');
    shell.appendChild(input);
    wrap.appendChild(shell);
    const active = { id, shell, input };
    editor = active;
    positionEditor(active);
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        // 回车留给换行；Ctrl/Cmd + 回车提交。
        event.preventDefault();
        commitEditor();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor();
        render({ graph: true, minimap: true });
      }
    });
    // 打字会改行数：浮层跟着长高 / 缩回去。
    input.addEventListener('input', () => positionEditor(active));
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
    setSelected(comment.id);
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
    if (selected === id) setSelected('');
    if (state.selectedCommentId === id) state.selectedCommentId = '';
    // 面板别留在已经没了的注释上：退回节点档再让镜像重画（镜像里就是「选择一个节点」）。
    if (state.inspector === 'comment') {
      state.inspector = 'node';
      deps.requestInspector?.();
    }
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

  /** 改标题文字（就地编辑器与详情面板共用）：空串照旧保留成空注释。 */
  function setText(id: string, text: string): void {
    rename(id, text);
  }

  /** 改分类色：`''` 表示回到默认灰蓝。 */
  function setTint(id: string, tint: string): void {
    if (!list().some((comment) => comment.id === id)) return;
    mutate(() => {
      for (const item of table()) {
        if (!isRecord(item) || item.id !== id) continue;
        if (tint) item.tint = tint;
        else delete item.tint;
      }
    });
    render({ graph: true, minimap: true, panels: true, selection: true });
  }

  /** 改字号：夹在允许区间里取整，缺省值直接删掉字段（文档里不留冗余）。 */
  function setFontSize(id: string, fontSize: number): void {
    if (!list().some((comment) => comment.id === id)) return;
    const wanted = Math.max(MIN_COMMENT_FONT_SIZE, Math.min(MAX_COMMENT_FONT_SIZE, Math.round(Number(fontSize))));
    if (!Number.isFinite(wanted)) return;
    mutate(() => {
      for (const item of table()) {
        if (!isRecord(item) || item.id !== id) continue;
        if (wanted === DEFAULT_COMMENT_FONT_SIZE) delete item.fontSize;
        else item.fontSize = wanted;
      }
    });
    render({ graph: true, minimap: true, panels: true, selection: true });
  }

  /** 改整框不透明度：入参夹到 [0.1, 1]（越界就是越界，不是"回默认"），回到 1 时删掉字段。 */
  function setOpacity(id: string, opacity: number): void {
    if (!list().some((comment) => comment.id === id)) return;
    const numeric = Number(opacity);
    if (!Number.isFinite(numeric)) return;
    const wanted = Math.round(Math.min(DEFAULT_COMMENT_OPACITY, Math.max(MIN_COMMENT_OPACITY, numeric)) * 100) / 100;
    mutate(() => {
      for (const item of table()) {
        if (!isRecord(item) || item.id !== id) continue;
        if (wanted >= DEFAULT_COMMENT_OPACITY) delete item.opacity;
        else item.opacity = wanted;
      }
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
    // 分类色有两种形态：色名（warning / danger / …，走 CSS class）与直接给的颜色
    // （`#rrggbb`，走内联的 `--card-tint`，详情面板的取色器就是这一支）。
    const named = commentTintName(comment.tint);
    const color = named ? '' : commentTintColor(comment.tint);
    const opacity = opacityOf(comment);
    const group = svgEl('g', {
      class: `comment-box${selected === comment.id ? ' selected' : ''}${named ? ` tint-${named}` : ''}`,
      transform: `translate(${comment.at.x}, ${comment.at.y})`,
      'data-comment-id': comment.id,
      // 整框（框线 / 标题栏 / 文字）一起透；不透明时不写这个属性，DOM 干净。
      ...(opacity < DEFAULT_COMMENT_OPACITY ? { opacity } : {}),
    }, layer);
    if (color) {
      // 自定义颜色：写在框体自己的 `--card-tint` 上，子元素（框线 / 标题栏）照旧读这个变量。
      if (group.style && typeof group.style.setProperty === 'function') group.style.setProperty('--card-tint', color);
      else group.setAttribute('style', `--card-tint:${color}`);
    }
    svgEl('rect', { class: 'comment-frame', x: 0, y: 0, width: size.w, height: size.h, rx: 4 }, group);
    const title = svgEl('g', { class: 'comment-title-bar' }, group);
    // 标题按框宽折行：字号定行高、行数定标题栏高度，长句子不会再横着跑出框外。
    const fontSize = fontSizeOf(comment);
    const lineHeight = commentLineHeight(fontSize);
    const bar = commentBarHeight(fontSize);
    const lines = visibleLines(comment, titleLines(comment.text || '注释', titleWidth(comment), fontSize));
    const header = Math.max(bar, Math.min(bar + (lines.length - 1) * lineHeight, size.h));
    svgEl('rect', { class: 'comment-title-fill', x: 0, y: 0, width: size.w, height: header }, title);
    // 行数再多也不画到框外：整块文字裁到框体大小（框太矮时多出来的行走编辑器里看）。
    const clipId = `comment-clip-${String(comment.id).replace(/[^\w-]/g, '_')}`;
    const clip = svgEl('clipPath', { id: clipId }, svgEl('defs', {}, title));
    svgEl('rect', { x: 0, y: 0, width: size.w, height: size.h }, clip);
    const textBlock = svgEl('g', { class: 'comment-title-lines', 'clip-path': `url(#${clipId})` }, title);
    lines.forEach((line, index) => {
      const label = svgEl('text', {
        class: 'comment-title',
        x: TITLE_PAD,
        y: bar / 2 + index * lineHeight,
        // 字号走属性：CSS 里那份只留给兜底，模型里的值优先（改字号要能立刻看见）。
        'font-size': fontSize,
      }, textBlock);
      label.textContent = line;
    });
    // 删除按钮：一个真正的方形按钮 —— 透明命中区 + 字形，悬停时整块高亮。
    // 以前只有一个 14px 的「×」字形，命中区就是那几个笔画，很难点中。
    const removeSize = removeButtonSize(fontSize);
    const removeGlyph = removeGlyphSize(fontSize);
    const removeCenterX = size.w - TITLE_PAD - removeSize / 2;
    const removeButton = svgEl('g', { class: 'comment-remove-button' }, title);
    svgEl('rect', {
      class: 'comment-remove-hit',
      x: removeCenterX - removeSize / 2,
      y: bar / 2 - removeSize / 2,
      width: removeSize,
      height: removeSize,
      rx: 3,
    }, removeButton);
    const removeGlyphEl = svgEl('text', {
      class: 'comment-remove',
      x: removeCenterX,
      y: bar / 2,
      // 字号同样走属性：CSS 里不写 font-size，否则会盖掉这里的值。
      'font-size': removeGlyph,
    }, removeButton);
    removeGlyphEl.textContent = '×';
    // 右下角改尺寸把手：先铺一条透明的加宽命中带，再画看得见的两段斜线。
    // 把手本体只有 1.5px 描边，照着角去点差两三像素就会落到框体上（变成整体移动）。
    const grip = `M ${size.w - 14} ${size.h - 2} L ${size.w - 2} ${size.h - 14} M ${size.w - 8} ${size.h - 2} L ${size.w - 2} ${size.h - 8}`;
    svgEl('path', { class: 'comment-resize comment-resize-hit', d: grip }, group);
    svgEl('path', { class: 'comment-resize', d: grip }, group);
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
      // 双击标题栏改文字；双击框体本身只是选中。标题栏折行后更高，命中范围跟着走。
      const y = worldPoint(event).y - comment.at.y;
      if (y > headerHeight(comment)) return;
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
    // 面板切到别的东西（选中卡片 / 连线 / 变量 / 工作流）时，注释框的高亮跟着撤掉：
    // 选中的唯一真相在 state，注释层只跟着它走，省得每个选中入口都来清一遍。
    if (selected && state.inspector !== 'comment') {
      selected = '';
      state.selectedCommentId = '';
    }
    const next = contentSignature();
    if (next !== signature) {
      signature = next;
      if (typeof target.replaceChildren === 'function') target.replaceChildren();
      else target.innerHTML = '';
      for (const comment of list()) bindComment(buildComment(comment), comment);
    }
    // 就地改文字的浮层贴合与内容签名无关：平移、缩放、拖别的东西都会改它的屏幕位置，
    // 放在签名判断之后的话输入框会原地不动（帧尾每帧都会调到这里）。
    if (editor) positionEditor(editor);
  }

  return {
    render: render_,
    create,
    remove,
    rename,
    setText,
    setTint,
    setFontSize,
    setOpacity,
    selectedId: () => selected,
    setSelected,
    editText,
    hitTest,
    list,
    closeEditor,
  };
}
