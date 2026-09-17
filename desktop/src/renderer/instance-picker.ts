import type { RuntimeInstance } from '../shared/contracts';

export function instanceLabel(instance: RuntimeInstance): string {
  return instance.displayName
    || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
}

export interface InstancePickerElements {
  picker: HTMLDivElement;
  trigger: HTMLButtonElement;
  triggerLabel: HTMLElement;
  menu: HTMLDivElement;
}

export interface InstancePicker {
  close(restoreFocus?: boolean): void;
  toggle(selectedId: string): void;
  update(instances: RuntimeInstance[], selectedId: string): void;
  render(instances: RuntimeInstance[], selectedId: string): void;
  install(getSelectedId: () => string): void;
}

/** Owns the instance popup's DOM and focus behavior; selection remains with the workspace. */
export function createInstancePicker(
  elements: InstancePickerElements,
  onSelect: (instanceId: string) => void,
): InstancePicker {
  const { picker, trigger, triggerLabel, menu } = elements;

  function close(restoreFocus = false): void {
    if (menu.hidden) return;
    menu.hidden = true;
    picker.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function position(): void {
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(triggerRect.width, menu.offsetWidth, 92);
    const left = Math.min(Math.max(8, triggerRect.left), Math.max(8, window.innerWidth - menuWidth - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(triggerRect.bottom + 4)}px`;
    menu.style.minWidth = `${Math.round(triggerRect.width)}px`;
  }

  function update(instances: RuntimeInstance[], selectedId: string): void {
    const selected = instances.find((instance) => instance.id === selectedId);
    triggerLabel.textContent = selected ? instanceLabel(selected) : '未检测到运行实例';
    trigger.disabled = instances.length === 0;
    trigger.setAttribute('aria-label', selected ? `运行实例：${instanceLabel(selected)}` : '运行实例');
    menu.querySelectorAll<HTMLButtonElement>('[data-instance-id]').forEach((option) => {
      const isSelected = option.dataset.instanceId === selectedId;
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
  }

  function toggle(selectedId: string): void {
    if (trigger.disabled) return;
    if (!menu.hidden) {
      close();
      return;
    }
    // Dockview can reparent the toolbar. Keep the popup in the document paint layer.
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    menu.hidden = false;
    picker.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    position();
    menu.querySelector<HTMLButtonElement>(`[data-instance-id="${CSS.escape(selectedId)}"]`)?.focus();
  }

  function render(instances: RuntimeInstance[], selectedId: string): void {
    const options = instances.map((instance) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'instance-option';
      option.dataset.instanceId = instance.id;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const label = document.createElement('span');
      label.className = 'instance-option-label';
      label.textContent = instanceLabel(instance);
      const check = document.createElement('span');
      check.className = 'instance-option-check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      option.append(label, check);
      option.addEventListener('click', () => onSelect(instance.id));
      return option;
    });
    menu.replaceChildren(...options);
    close();
    update(instances, selectedId);
  }

  function install(getSelectedId: () => string): void {
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      toggle(getSelectedId());
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close(true);
      else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle(getSelectedId());
      }
    });
    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Node;
      if (!picker.contains(target) && !menu.contains(target)) close();
    }, true);
    window.addEventListener('resize', () => close());
    window.addEventListener('scroll', () => close(), true);
  }

  return { close, toggle, update, render, install };
}
