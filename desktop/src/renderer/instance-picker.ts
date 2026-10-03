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
  update(instances: RuntimeInstance[], selectedId: string, disabled?: boolean): void;
  render(instances: RuntimeInstance[], selectedId: string, disabled?: boolean): void;
  install(getSelectedId: () => string): void;
  dispose(): void;
}

export interface InstancePickerOptions {
  label?: (instance: RuntimeInstance) => string;
  optionLabel?: (instance: RuntimeInstance) => string;
  emptyLabel?: string;
  menuHeading?: string;
}

/** Owns the instance popup's DOM and focus behavior; selection remains with the workspace. */
export function createInstancePicker(
  elements: InstancePickerElements,
  onSelect: (instanceId: string) => void,
  options: InstancePickerOptions = {},
): InstancePicker {
  const { picker, trigger, triggerLabel, menu } = elements;
  const label = options.label ?? instanceLabel;
  const optionLabel = options.optionLabel ?? label;
  const cleanups: Array<() => void> = [];
  let installed = false;

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

  function update(instances: RuntimeInstance[], selectedId: string, disabled = false): void {
    const selected = instances.find((instance) => instance.id === selectedId);
    triggerLabel.textContent = selected ? label(selected) : options.emptyLabel ?? '未检测到运行实例';
    trigger.disabled = instances.length === 0 || disabled;
    trigger.setAttribute('aria-label', selected ? `运行实例：${label(selected)}` : '运行实例');
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

  function render(instances: RuntimeInstance[], selectedId: string, disabled = false): void {
    const optionElements = instances.map((instance) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'instance-option';
      option.dataset.instanceId = instance.id;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const label = document.createElement('span');
      label.className = 'instance-option-label';
      label.textContent = optionLabel(instance);
      const check = document.createElement('span');
      check.className = 'instance-option-check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      option.append(label, check);
      option.addEventListener('click', () => onSelect(instance.id));
      return option;
    });
    const children: HTMLElement[] = [];
    if (options.menuHeading) {
      const heading = document.createElement('div');
      heading.className = 'instance-menu-heading';
      heading.textContent = options.menuHeading;
      children.push(heading);
    }
    children.push(...optionElements);
    menu.replaceChildren(...children);
    close();
    update(instances, selectedId, disabled);
  }

  function install(getSelectedId: () => string): void {
    if (installed) return;
    installed = true;
    const onClick = (event: MouseEvent): void => {
      event.stopPropagation();
      toggle(getSelectedId());
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(true);
      else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle(getSelectedId());
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!picker.contains(target) && !menu.contains(target)) close();
    };
    const onResize = (): void => close();
    const onScroll = (): void => close();
    trigger.addEventListener('click', onClick);
    trigger.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    cleanups.push(() => trigger.removeEventListener('click', onClick), () => trigger.removeEventListener('keydown', onKeyDown),
      () => document.removeEventListener('pointerdown', onPointerDown, true), () => window.removeEventListener('resize', onResize),
      () => window.removeEventListener('scroll', onScroll, true));
  }

  function dispose(): void {
    close();
    for (const cleanup of cleanups.splice(0)) cleanup();
    installed = false;
    if (menu.parentElement === document.body) picker.append(menu);
  }

  return { close, toggle, update, render, install, dispose };
}
