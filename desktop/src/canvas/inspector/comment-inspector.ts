/**
 * 注释框（UE Comment）的详情面板：颜色、字号、标题文字，以及位置 / 尺寸的只读摘要。
 *
 * 注释框不是节点，选中态存在 `state.inspector = 'comment'` + `state.selectedCommentId` 上
 * （见 `canvas/comments.ts` 的 `setSelected`）。面板只读状态、写文档走注入的注释命令，
 * 每次改动都会 `mutate` 成一条历史并重绘。
 *
 * 注意：可见的这个面板跑在**镜像画布**里（`canvas.html?mode=details`）。镜像没有文档写权，
 * 它的改动要经「改镜像副本 → documentStateChanged → 壳层 replaceDocument 回真画布」才能生效
 * （合见 `renderer/editor-host.ts`）。所以这里的每一次改动都必须真的走 `mutate`。
 */
import type { CanvasState } from '../state/canvas-state';

type UiNode = any;

export interface CommentInspectorDeps {
  state: CanvasState;
  el(tag: string, className?: string, text?: string): UiNode;
  clearInspector(title: string): UiNode;
  section(body: UiNode, title: string, action?: UiNode): UiNode;
  field(body: UiNode, label: string, hint?: string): UiNode;
  textInput(value: unknown, onChange: (value: string) => void, options?: Record<string, unknown>): UiNode;
  /** 分类色候选（与文档里能写的 tint 一致）：`value` 是写回文档的色名。 */
  tints: ReadonlyArray<{ value: string; label: string }>;
  /** 色名 → 具体颜色：取色器初始值与快捷色块用它。 */
  tintColors: Readonly<Record<string, string>>;
  /** 没有分类色时的默认底色（「默认」按钮与取色器初值）。 */
  defaultTint: string;
  /** 文档里的 tint 是色名还是 `#rrggbb`，都由这里解析（与画布渲染同一份规则）。 */
  resolveTint(tint: unknown): string;
  /** 文档里的 opacity → 实际用的值（与画布渲染同一份规则）。 */
  resolveOpacity(opacity: unknown): number;
  opacityRange: { min: number; fallback: number };
  fontSizeRange: { min: number; max: number; fallback: number };
  comments: {
    remove(id: string): void;
    setText(id: string, text: string): void;
    setTint(id: string, tint: string): void;
    setFontSize(id: string, size: number): void;
    setOpacity(id: string, opacity: number): void;
  };
}

export interface CommentInspector {
  renderCommentInspector(): void;
}

export function createCommentInspector(deps: CommentInspectorDeps): CommentInspector {
  const { state, el, clearInspector, section, field, textInput, tints, tintColors, defaultTint, resolveTint, resolveOpacity, opacityRange, fontSizeRange, comments } = deps;
  const presetColors = tints.filter((item) => item.value);

  function selected(): any {
    const id = String(state.selectedCommentId || '');
    if (!id) return null;
    const list = state.raw && Array.isArray(state.raw.comments) ? state.raw.comments : [];
    return list.find((item: any) => item && item.id === id) || null;
  }

  function sizeOf(comment: any): { w: number; h: number } {
    const size = comment && comment.size;
    if (size && Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0) {
      return { w: Math.trunc(size.w), h: Math.trunc(size.h) };
    }
    return { w: 360, h: 200 };
  }

  /** 颜色一行：自由取色器 + 「默认」+ 常用色快捷块。 */
  function colorControl(comment: any): UiNode {
    const line = el('div', 'inline-control');
    const picker = el('input', 'comment-inspector-color');
    picker.type = 'color';
    picker.value = resolveTint(comment.tint) || defaultTint;
    picker.setAttribute('aria-label', '注释框颜色');
    // 取色器给什么就存什么（`#rrggbb`）：文档里 tint 允许字符串，色名照旧兼容。
    picker.addEventListener('change', () => comments.setTint(comment.id, String(picker.value || '')));
    line.appendChild(picker);

    const reset = el('button', 'ghost comment-inspector-tint-reset', '默认');
    reset.title = '回到默认灰蓝';
    reset.addEventListener('click', () => comments.setTint(comment.id, ''));
    line.appendChild(reset);

    if (presetColors.length) {
      const presets = el('div', 'comment-inspector-presets');
      for (const preset of presetColors) {
        const swatch = el('button', 'comment-inspector-swatch');
        swatch.title = preset.label;
        const color = tintColors[preset.value] || defaultTint;
        if (swatch.style && typeof swatch.style.setProperty === 'function') swatch.style.setProperty('--swatch-color', color);
        else if (typeof swatch.setAttribute === 'function') swatch.setAttribute('style', `--swatch-color:${color}`);
        swatch.addEventListener('click', () => comments.setTint(comment.id, preset.value));
        presets.appendChild(swatch);
      }
      line.appendChild(presets);
    }
    return line;
  }

  /** 不透明度一行：滑块（拖动时就显示百分比，松手才写文档，免得刷一屏历史）+ 100% 复位。 */
  function opacityControl(comment: any): UiNode {
    const minPercent = Math.round(opacityRange.min * 100);
    const percent = Math.round(resolveOpacity(comment.opacity) * 100);
    const line = el('div', 'inline-control');
    const slider = el('input', 'comment-inspector-opacity');
    slider.type = 'range';
    slider.min = String(minPercent);
    slider.max = '100';
    slider.step = '5';
    slider.value = String(percent);
    slider.setAttribute('aria-label', '注释框不透明度');
    const value = el('span', 'comment-inspector-opacity-value', `${percent}%`);
    slider.addEventListener('input', () => { value.textContent = `${slider.value}%`; });
    slider.addEventListener('change', () => comments.setOpacity(comment.id, Number(slider.value) / 100));
    line.appendChild(slider);
    line.appendChild(value);
    const reset = el('button', 'ghost comment-inspector-opacity-reset', '100%');
    reset.title = '回到完全不透明';
    reset.addEventListener('click', () => comments.setOpacity(comment.id, 1));
    line.appendChild(reset);
    return line;
  }

  function renderCommentInspector(): void {
    const comment = selected();
    if (!comment) {
      // 注释被删掉（或文档换了）时别留一个空面板：退回空态，下一帧按新的选中项重画。
      state.inspector = 'node';
      const empty = el('div', 'field-hint', '选择一个节点');
      clearInspector('详细信息').appendChild(empty);
      return;
    }
    const text = typeof comment.text === 'string' ? comment.text : '';
    const firstLine = text.split('\n')[0].trim();
    const body = clearInspector(firstLine ? firstLine.slice(0, 24) : '注释框');

    section(body, '注释框');
    const textRow = field(body, '标题', '长文字会按框宽自动折行；回车换行');
    const area = el('textarea', 'comment-inspector-text');
    area.value = text;
    area.placeholder = '注释文字';
    area.addEventListener('change', () => comments.setText(comment.id, area.value));
    textRow.appendChild(area);

    const tintRow = field(body, '颜色', '取色器自由选；「默认」回灰蓝。色名写法（warning 等）继续兼容');
    tintRow.appendChild(colorControl(comment));

    const opacityRow = field(body, '透明度', '整框（框线 / 标题栏 / 文字）一起透；最低 10%，否则框就点不着了');
    opacityRow.appendChild(opacityControl(comment));

    const fontRow = field(body, '字号', '标题字号（世界坐标像素）：行高随之变化');
    fontRow.appendChild(textInput(comment.fontSize || fontSizeRange.fallback, (value) => comments.setFontSize(comment.id, parseInt(value, 10)), {
      type: 'number', min: fontSizeRange.min, max: fontSizeRange.max, step: 1,
    }));

    section(body, '位置与尺寸');
    const size = sizeOf(comment);
    const at = comment.at && Number.isFinite(comment.at.x) && Number.isFinite(comment.at.y) ? comment.at : { x: 0, y: 0 };
    body.appendChild(el('div', 'field-hint', `位置 ${Math.round(at.x)}, ${Math.round(at.y)} · 尺寸 ${size.w} × ${size.h}`));
    body.appendChild(el('div', 'field-hint', '拖动标题栏移动，拖右下角把手改尺寸。'));

    const remove = el('button', 'danger full-command', '删除注释框');
    remove.addEventListener('click', () => comments.remove(comment.id));
    body.appendChild(remove);
  }

  return { renderCommentInspector };
}
