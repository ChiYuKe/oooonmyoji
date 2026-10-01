import type { OnmyojiDesktopApi } from '../shared/contracts';

export interface DiffRow { left: string | null; right: string | null; changed: boolean }
export function workflowDiff(leftText: string, rightText: string): DiffRow[] {
  const left = leftText.replace(/\r/g, '').split('\n');
  const right = rightText.replace(/\r/g, '').split('\n');
  const rows: DiffRow[] = [];
  let a = 0, b = 0;
  if ((left.length + 1) * (right.length + 1) <= 1_000_000) {
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      table[i * width + j] = left[i] === right[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
    while (a < left.length || b < right.length) {
      if (a < left.length && b < right.length && left[a] === right[b]) rows.push({ left: left[a++], right: right[b++], changed: false });
      else if (a < left.length && (b === right.length || table[(a + 1) * width + b] >= table[a * width + b + 1])) rows.push({ left: left[a++], right: null, changed: true });
      else rows.push({ left: null, right: right[b++], changed: true });
    }
  } else {
    // Large documents still show every line without allocating a quadratic table.
    while (a < left.length && b < right.length && left[a] === right[b]) rows.push({ left: left[a++], right: right[b++], changed: false });
    let endA = left.length, endB = right.length;
    while (endA > a && endB > b && left[endA - 1] === right[endB - 1]) { endA--; endB--; }
    while (a < endA || b < endB) rows.push({ left: a < endA ? left[a++] : null, right: b < endB ? right[b++] : null, changed: true });
    while (a < left.length) rows.push({ left: left[a++], right: right[b++], changed: false });
  }
  return rows;
}

export async function openWorkflowHistory(options: {
  uri: string;
  api: Pick<OnmyojiDesktopApi, 'listWorkflowHistory' | 'readWorkflowHistory'>;
  currentText(): string;
  restore(text: string): Promise<boolean>;
  showError(error: unknown): void;
}): Promise<void> {
  document.querySelector('.workflow-history-overlay')?.remove();
  const previous = document.activeElement as HTMLElement | null;
  const make = (tag: string, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
  const overlay = make('div', 'workflow-history-overlay');
  const dialog = make('div', 'workflow-history-dialog');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '工作流版本历史');
  const head = make('div', 'workflow-history-head');
  head.appendChild(make('strong', '', '版本历史'));
  const close = make('button', '', '关闭') as HTMLButtonElement; close.type = 'button'; head.appendChild(close);
  const status = make('div', 'workflow-history-status', '正在读取版本…'); status.setAttribute('role', 'status');
  const body = make('div', 'workflow-history-body');
  const list = make('div', 'workflow-history-list'); list.setAttribute('aria-label', '已保存的版本');
  const detail = make('div', 'workflow-history-detail');
  const columns = make('div', 'workflow-history-columns'); columns.append(make('span', '', '历史版本'), make('span', '', '当前编辑内容'));
  const diff = make('div', 'workflow-history-diff');
  const restore = make('button', '', '恢复此版本') as HTMLButtonElement; restore.type = 'button'; restore.disabled = true;
  detail.append(columns, diff, restore); body.append(list, detail); dialog.append(head, status, body); overlay.appendChild(dialog); document.body.appendChild(overlay);
  let closed = false, revision = 0, selectedText = '', restoring = false;
  const dismiss = () => { if (restoring) return; closed = true; revision++; overlay.remove(); previous?.focus(); };
  close.addEventListener('click', dismiss);
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) dismiss(); });
  overlay.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.disabled);
      if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && event.target === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  });
  const display = (text: string) => {
    const rows = workflowDiff(text, options.currentText()); diff.replaceChildren();
    const fragment = document.createDocumentFragment();
    let leftLine = 0, rightLine = 0, removed = 0, added = 0;
    for (const row of rows) {
      for (const side of ['left', 'right'] as const) {
        const value = row[side];
        const number = value === null ? '' : String(side === 'left' ? ++leftLine : ++rightLine);
        const line = make('div', `workflow-history-line${row.changed && value !== null ? ` ${side === 'left' ? 'removed' : 'added'}` : ''}`);
        const gutter = make('span', 'workflow-history-line-number', number);
        line.append(gutter, make('span', '', value === null ? ' ' : value || ' ')); fragment.appendChild(line);
        if (row.changed && value !== null) { if (side === 'left') removed++; else added++; }
      }
    }
    diff.appendChild(fragment); status.textContent = `相对历史版本：新增 ${added} 行，移除 ${removed} 行。恢复可用 Ctrl+Z 撤销；保存后仍保留历史。`;
    restore.disabled = text === options.currentText();
  };
  restore.addEventListener('click', async () => {
    if (restore.disabled || restoring) return;
    revision++;
    restoring = true; restore.disabled = true; close.disabled = true;
    list.inert = true;
    try { if (await options.restore(selectedText)) { restoring = false; dismiss(); } else display(selectedText); }
    catch (error) { options.showError(error); display(selectedText); }
    finally { restoring = false; close.disabled = false; list.inert = false; }
  });
  close.focus();
  try {
    const entries = await options.api.listWorkflowHistory(options.uri);
    if (closed) return;
    if (!entries.length) { status.textContent = '还没有保存历史。从下一次保存开始记录，并保留保存前的版本。'; return; }
    const select = async (id: string, button: HTMLButtonElement) => {
      if (restoring) return;
      const request = ++revision; restore.disabled = true; status.textContent = '正在读取版本…';
      for (const item of Array.from(list.querySelectorAll('button'))) item.setAttribute('aria-pressed', String(item === button));
      try {
        const text = await options.api.readWorkflowHistory(options.uri, id);
        if (closed || request !== revision) return;
        selectedText = text; display(text);
      } catch (error) { if (!closed && request === revision) { status.textContent = '读取版本失败，请选择其他版本或重试。'; options.showError(error); } }
    };
    for (const entry of entries) {
      const button = make('button', '', `${new Date(entry.at).toLocaleString('zh-CN')} · ${(entry.bytes / 1024).toFixed(1)} KB`) as HTMLButtonElement;
      button.type = 'button'; button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => void select(entry.id, button)); list.appendChild(button);
    }
    await select(entries[0].id, list.querySelector<HTMLButtonElement>('button')!);
  } catch (error) { if (!closed) { status.textContent = '读取历史失败，请关闭后重试。'; options.showError(error); } }
}
