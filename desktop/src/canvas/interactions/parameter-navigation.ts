const installed = new WeakSet<HTMLElement>();
/** Keep the next parameter focused even when committing a value rebuilds the inspector. */
export function installParameterNavigation(body: HTMLElement): void {
  if (installed.has(body)) return;
  installed.add(body);
  const inputs = (block: Element) => Array.from(block.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="checkbox"]):not([type="hidden"]), select, textarea')).filter((input) => !input.disabled && !('readOnly' in input && input.readOnly));
  body.addEventListener('keydown', (event) => {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || !['Tab', 'Enter'].includes(event.key)) return;
    const target = event.target as HTMLInputElement;
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || ['checkbox', 'color'].includes(target.type)) return;
    if (target.tagName === 'TEXTAREA' && event.key === 'Enter') return;
    const block = target.closest<HTMLElement>('[data-parameter-name]');
    if (!block || !body.contains(block)) return;
    const blocks = Array.from(body.querySelectorAll<HTMLElement>('[data-parameter-name]'));
    const currentInputs = inputs(block), cellIndex = currentInputs.indexOf(target);
    const direction = event.shiftKey ? -1 : 1;
    let nextBlock = blocks.indexOf(block), nextCell = cellIndex + direction;
    if (event.key === 'Enter' || nextCell < 0 || nextCell >= currentInputs.length) {
      nextBlock += direction;
      while (nextBlock >= 0 && nextBlock < blocks.length && !inputs(blocks[nextBlock]).length) nextBlock += direction;
      nextCell = direction === 1 ? 0 : -1;
    }
    if (nextBlock < 0 || nextBlock >= blocks.length) return;
    event.preventDefault(); event.stopPropagation();
    if (target.validity && !target.validity.valid) { target.reportValidity(); return; }
    const name = blocks[nextBlock].dataset.parameterName;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    queueMicrotask(() => {
      const next = Array.from(body.querySelectorAll<HTMLElement>('[data-parameter-name]')).find((item) => item.dataset.parameterName === name);
      if (!next) return;
      const controls = inputs(next), input = nextCell === -1 ? controls.at(-1) : controls[Math.min(nextCell, controls.length - 1)];
      input?.focus();
      if (input?.tagName === 'INPUT' && ['text', 'number', 'search'].includes(input.type)) (input as HTMLInputElement).select();
    });
  });
}
