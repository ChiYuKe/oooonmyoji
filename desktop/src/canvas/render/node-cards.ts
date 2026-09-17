/**
 * 共享 SVG 卡片文字排版；几何尺寸仍由画布编辑器负责。
 * 迁移期间 main.ts 以 window.NodeCards 暴露给旧编辑器。
 */

export interface NodeCards {
  widthOf(text: string, size: number): number;
  fit(value: unknown, width: number, size?: number): string;
  text(parent: SVGElement, options: {
    className?: string;
    x: number | string;
    y: number | string;
    value: unknown;
    width: number;
    size?: number;
    anchor?: string;
  }): SVGTextElement;
}

function widthOf(text: string, size: number): number {
  return [...text].reduce((width, char) => width + size * (/[^\u0000-\u00ff]|[MW@%]/.test(char) ? 1 : .62), 0);
}

function fit(value: unknown, width: number, size = 11): string {
  const text = String(value ?? '');
  if (widthOf(text, size) <= width) return text;
  if (width < size) return '';
  let result = '';
  for (const char of text) {
    if (widthOf(result + char, size) + size > width) break;
    result += char;
  }
  return result + '…';
}

function text(parent: SVGElement, options: {
  className?: string;
  x: number | string;
  y: number | string;
  value: unknown;
  width: number;
  size?: number;
  anchor?: string;
}): SVGTextElement {
  const { className, x, y, value, width, size = 11, anchor = 'start' } = options;
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  for (const [name, attribute] of Object.entries({ class: className, x, y, 'font-size': size, 'text-anchor': anchor })) {
    node.setAttribute(name, String(attribute));
  }
  node.textContent = fit(value, width, size);
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = String(value ?? '');
  node.appendChild(title);
  parent.appendChild(node);
  return node;
}

export function createNodeCards(): NodeCards {
  return { fit, text, widthOf };
}

export { fit, text, widthOf };
