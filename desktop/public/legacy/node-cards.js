/* Shared SVG card typography. Geometry remains owned by the workflow editor. */
(() => {
  'use strict';
  function widthOf(text, size) {
    return [...text].reduce((width, char) => width + size * (/[^\u0000-\u00ff]|[MW@%]/.test(char) ? 1 : .62), 0);
  }
  function fit(value, width, size = 11) {
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
  function text(parent, {className, x, y, value, width, size = 11, anchor = 'start'}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    for (const [name, value] of Object.entries({class:className,x,y,'font-size':size,'text-anchor':anchor})) node.setAttribute(name, String(value));
    node.textContent = fit(value, width, size);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = String(value ?? '');
    node.appendChild(title); parent.appendChild(node); return node;
  }
  window.NodeCards = {fit, text, widthOf};
})();
