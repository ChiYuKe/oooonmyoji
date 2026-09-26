/**
 * 画布文字折行：SVG 的 `<text>` 不会自己换行，注释框那种「一句话」很容易横着跑出框外。
 *
 * 宽度来源分两层：
 * - 真 DOM 里用 canvas 2D 按字符量（`measureText`），按字符缓存：同一段文字反复重绘
 *   （拖动、缩放、改尺寸）只量一次；
 * - 没有 canvas（node 测试、SSR）时退化成固定估算表，保证同一段文字在两边都能折出稳定的行。
 *
 * 折行规则按中文排版来：标点可以悬挂（不把「。」挤到下一行开头），拉丁词优先在空格处断，
 * 没有断点的长串硬断。行首不会出现收尾标点。
 */

/** 单字符宽度测量（px，世界坐标）。 */
export interface CharMeasure {
  (char: string): number;
}

/** 不允许出现在行首的收尾标点：折到它时让它挂在上一行末尾。 */
const HANGING = new Set(Array.from('、。，．！？：；）〕］｝〉》」』】…—·,.:;!?)]}'));

/** 全角/东亚宽字符：按一个字宽算。 */
function isFullWidth(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f)      // 韩文字母
    || (code >= 0x2e80 && code <= 0xa4cf)        // 中日韩部首、假名、注音、汉字
    || (code >= 0xac00 && code <= 0xd7a3)        // 韩文音节
    || (code >= 0xf900 && code <= 0xfaff)        // 兼容汉字
    || (code >= 0xfe30 && code <= 0xfe6f)        // 兼容形式
    || (code >= 0xff00 && code <= 0xff60)        // 全角 ASCII
    || (code >= 0xffe0 && code <= 0xffe6);
}

/** 没有 canvas 时的宽度估算：全角一个字宽、拉丁半个、其余介于两者之间。 */
export function estimateCharWidth(char: string, fontSize: number): number {
  const code = char.codePointAt(0) ?? 0;
  if (char === '\t') return (fontSize * 2) || 16;
  if (code < 0x20) return 0;
  if (isFullWidth(code)) return fontSize;
  if (code < 0x80) return fontSize * 0.55;
  return fontSize * 0.85;
}

/**
 * 造一个按字符缓存的测量函数。`fontFamily` 由调用方从真实节点上取，
 * 保证量出来的宽度和 SVG 里渲染用的是同一套字体。
 */
export function createCharMeasure(options: { fontSize: number; fontFamily?: string; fontWeight?: string }): CharMeasure {
  const fontSize = Number(options.fontSize) || 12;
  const font = `${options.fontWeight || '600'} ${fontSize}px ${options.fontFamily || 'sans-serif'}`;
  const cache = new Map<string, number>();
  // null = 还没试过拿 canvas；undefined = 试过但没有（测试环境）。
  let context: any = null;
  return (char: string): number => {
    const hit = cache.get(char);
    if (hit !== undefined) return hit;
    if (context === null) {
      try {
        const canvas = (globalThis as any).document?.createElement?.('canvas');
        context = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : undefined;
        if (context) context.font = font;
      } catch {
        context = undefined;
      }
    }
    let width: number | undefined;
    if (context && typeof context.measureText === 'function') {
      try {
        const measured = context.measureText(char).width;
        if (Number.isFinite(measured)) width = measured;
      } catch {
        width = undefined;
      }
    }
    if (width === undefined) width = estimateCharWidth(char, fontSize);
    cache.set(char, width);
    return width;
  };
}

/**
 * 折行：按 `maxWidth`（世界坐标 px）把文字切成若干行。
 * 显式换行（`\n`）保留成独立的行，空行也保留（注释里可以空一行）。
 */
export function wrapText(text: string, maxWidth: number, measure: CharMeasure): string[] {
  const limit = Math.max(1, Number(maxWidth) || 0);
  const lines: string[] = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const chars = Array.from(paragraph);
    let line: string[] = [];
    let width = 0;
    /** 行内最后一个空白的位置：拉丁词优先在这里断。 */
    let lastSpace = -1;
    const flush = (): void => {
      lines.push(line.join(''));
      line = [];
      width = 0;
      lastSpace = -1;
    };
    for (const char of chars) {
      const charWidth = measure(char);
      if (line.length && width + charWidth > limit) {
        if (HANGING.has(char)) {
          // 标点悬挂：这一行多带它一个，别让它跑到下一行开头。
          line.push(char);
          flush();
          continue;
        }
        if (lastSpace > 0) {
          const head = line.slice(0, lastSpace);
          const tail = line.slice(lastSpace + 1);
          lines.push(head.join(''));
          line = tail;
          width = tail.reduce((sum, item) => sum + measure(item), 0);
          lastSpace = -1;
        } else {
          flush();
        }
      }
      line.push(char);
      width += charWidth;
      if (char === ' ' || char === '\t') lastSpace = line.length - 1;
    }
    if (line.length) flush();
    if (!chars.length) lines.push('');
  }
  // 行尾空白不留（空行本身保留）。
  return lines.map((item) => item.replace(/[ \t]+$/, ''));
}
