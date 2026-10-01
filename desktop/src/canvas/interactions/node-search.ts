export type NodeSearchScope = 'all' | 'name' | 'action' | 'params' | 'refs';
export interface NodeSearchResult { nodeId: string; title: string; field: string; param: string; value: string; scope: NodeSearchScope }

export function searchNodes(nodes: any[], query: string, scope: NodeSearchScope = 'all', labels: { title?(node: any): string; action?(name: string): string; field?(name: string): string; reference?(ref: string): string } = {}): NodeSearchResult[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const results: NodeSearchResult[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!node?.id || seen.has(node.id)) continue;
    seen.add(node.id);
    const title = labels.title?.(node) || node.name || node.id;
    const add = (kind: NodeSearchScope, field: string, value: unknown, param = '', extra = '') => {
      if (scope !== 'all' && scope !== kind) return;
      const text = String(value ?? '');
      const haystack = `${field} ${text} ${extra}`.toLocaleLowerCase();
      const shownField = param && labels.field ? `${labels.field(param)}${field.startsWith(param) ? field.slice(param.length) : ''}` : field;
      if (words.every((word) => haystack.includes(word))) results.push({ nodeId: node.id, title, field: shownField, value: text, param, scope: kind });
    };
    add('name', '节点名称', title, '', node.id);
    if (node.action) add('action', '动作', node.action, '', labels.action?.(node.action));
    const visit = (value: unknown, path: string, param: string) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as any).ref === 'string') {
        const ref = (value as any).ref;
        add('refs', path, ref, param, `${labels.field?.(param) || ''} ${labels.reference?.(ref) || ''}`);
      } else if (Array.isArray(value)) value.forEach((child, index) => visit(child, `${path}.${index}`, param));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => { if (!key.startsWith('_')) visit(child, `${path}.${key}`, param); });
      else add('params', path, value, param, labels.field?.(param));
    };
    for (const [name, value] of Object.entries(node.params || {})) visit(value, name, name);
    for (const name of ['expression', 'condition', 'conditions', 'decorators', 'runs', 'ref', 'fields']) if (node[name] !== undefined) visit(node[name], name, '');
  }
  return results;
}

export function openNodeSearch(options: { nodes(): any[]; query?: string; labels: Parameters<typeof searchNodes>[3]; focus(result: NodeSearchResult): void; replace?(query: string): void }): void {
  document.querySelector('.node-search-overlay')?.remove();
  const previous = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'node-search-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'node-search-dialog';
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '搜索节点和参数');
  const head = document.createElement('div'); head.className = 'node-search-head';
  const input = document.createElement('input'); input.type = 'search'; input.className = 'ui-input'; input.placeholder = '搜索名称、动作、参数值、模板路径或引用'; input.setAttribute('aria-label', '搜索节点和参数'); input.value = options.query || '';
  const select = document.createElement('select'); select.className = 'ui-input'; select.setAttribute('aria-label', '搜索范围');
  for (const [value, label] of [['all', '全部'], ['name', '节点名称'], ['action', '动作'], ['params', '参数值'], ['refs', '变量和输出引用']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
  }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭';
  const count = document.createElement('div'); count.className = 'field-hint';
  const list = document.createElement('div'); list.className = 'node-search-results';
  const dismiss = () => { overlay.remove(); previous?.focus(); };
  close.addEventListener('click', dismiss);
  const render = () => {
    list.replaceChildren();
    const results = searchNodes(options.nodes(), input.value, select.value as NodeSearchScope, options.labels);
    count.textContent = !input.value.trim() ? '输入关键词；点结果定位到节点及参数。' : `${results.length} 处匹配${results.length > 500 ? '，显示前 500 处，请缩小搜索范围' : ''}`;
    for (const result of results.slice(0, 500)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'node-search-result';
      const title = document.createElement('strong'); title.textContent = `${result.title} · ${result.field}`;
      const value = document.createElement('span'); value.textContent = result.value; button.title = `${result.title}\n${result.field}: ${result.value}`;
      button.append(title, value); button.addEventListener('click', () => { dismiss(); options.focus(result); }); list.appendChild(button);
    }
  };
  input.addEventListener('input', render); select.addEventListener('change', render);
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) dismiss(); });
  overlay.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Enter' && event.target === input) { event.preventDefault(); list.querySelector<HTMLButtonElement>('button')?.click(); }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('input, select, button'));
      if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && event.target === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  });
  head.append(input, select);
  if (options.replace) {
    const replace = document.createElement('button'); replace.type = 'button'; replace.textContent = '批量替换…';
    replace.addEventListener('click', () => { const query = input.value; dismiss(); options.replace?.(query); }); head.append(replace);
  }
  head.append(close); dialog.append(head, count, list); overlay.appendChild(dialog); document.body.appendChild(overlay); render(); input.focus();
}
