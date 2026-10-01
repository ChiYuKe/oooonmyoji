export const editingElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
};

export function editingDialog(title: string) {
  document.querySelector('.editing-dialog-overlay')?.remove();
  const previous = document.activeElement as HTMLElement | null;
  const overlay = editingElement('div', 'editing-dialog-overlay');
  const dialog = editingElement('div', 'editing-dialog');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title);
  const header = editingElement('div', 'editing-dialog-head');
  const closeButton = editingElement('button', '', '关闭'); closeButton.type = 'button';
  header.append(editingElement('strong', '', title), closeButton); dialog.append(header); overlay.append(dialog); document.body.append(overlay);
  const close = () => { overlay.remove(); previous?.focus(); };
  closeButton.addEventListener('click', close);
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('input, select, button, textarea')).filter((item) => !(item as HTMLInputElement).disabled && item.getAttribute('tabindex') !== '-1');
      if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && event.target === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  });
  return { overlay, dialog, close };
}
