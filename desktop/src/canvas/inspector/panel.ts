/**
 * 详情面板外壳与通用控件：打开/清空、分区折叠、基础表单控件与按选中项分派渲染。
 * 原 `workflow-editor.js` 的 clearInspector/section/field/textInput/selectInput/
 * segmentedInput/checkbox/sectionCollapseStates/groupSections/renderInspector。
 *
 * 各详情渲染函数由调用方注入；渲染不修改文档（重命名/类型切换走注入命令）。
 * 详情内容渲染器（DetailInspectors 等）与面板互相引用：面板在内容模块之前创建，
 * 通过 `renderers` 记录在**分派时**读取各渲染器（入口按构造顺序填表）。
 */
import type { CanvasState } from '../state/canvas-state';
import type { Ui } from '../ui/elements';
import { isValueCardNode } from '../model/exec-ports';

/** 详情面板分派的各内容渲染器；入口按构造顺序填入真实实现。 */
export interface InspectorRenderers {
  renderTaskInspector(body: HTMLElement, node: any): void;
  renderCompositeInspector(body: HTMLElement, node: any): void;
  renderDecorators(body: HTMLElement, node: any): void;
  renderWorkflowInspector(): void;
  renderVariablesInspector(): void;
  renderInstanceRunInspector(): void;
  renderEdgeInspector(): void;
}

export interface InspectorPanelDeps {
  state: CanvasState;
  UI: Ui;
  $(id: string): HTMLElement;
  el(tag: string, className?: string, text?: string): HTMLElement;
  nodeById(id: string): any;
  hideAssetPathPreview(): void;
  types: readonly string[];
  typeNames: Record<string, string>;
  typeLabels: Record<string, string>;
  renameNode(nodeId: string, value: string): void;
  renameNodeGroup(groupId: string, value: string): void;
  changeNodeType(node: any, value: string): void;
  mutate(fn: () => void): void;
  deleteSelection(): void;
  renderers: InspectorRenderers;
}

export interface InspectorPanel {
  clearInspector(title: string): HTMLElement;
  section(body: HTMLElement, title: string, action?: HTMLElement): HTMLElement;
  field(body: HTMLElement, label: string, hint?: string): HTMLElement;
  textInput(value: unknown, onChange: (value: string) => void, options?: Record<string, unknown>): HTMLElement;
  selectInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void, className?: string): HTMLElement;
  segmentedInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void): HTMLElement;
  checkbox(value: boolean, onChange: (value: boolean) => void): HTMLElement;
  groupSections(root: Element): void;
  renderInspector(): void;
}

export function createInspectorPanel(deps: InspectorPanelDeps): InspectorPanel {
  const {
    state, UI, $, el, nodeById, hideAssetPathPreview, types, typeNames, typeLabels,
    renameNode, renameNodeGroup, changeNodeType, mutate, deleteSelection, renderers,
  } = deps;

  function clearInspector(title: string): HTMLElement {
    UI.closeDropdowns?.();
    hideAssetPathPreview();
    $('inspector-title').textContent = title;
    const empty = $('inspector-empty');
    const body = $('inspector-body');
    empty.classList.add('hidden');
    body.classList.remove('hidden');
    body.innerHTML = '';
    return body;
  }

  function section(body: HTMLElement, title: string, action?: HTMLElement): HTMLElement {
    const header = UI.sectionHeader({ title, action, className: 'section-header' });
    body.appendChild(header);
    return header;
  }

  function field(body: HTMLElement, label: string, hint?: string): HTMLElement {
    const row = el('label', 'field');
    const caption = el('span', 'field-label', label);
    if (hint) caption.title = hint;
    row.appendChild(caption);
    body.appendChild(row);
    return row;
  }

  function textInput(value: unknown, onChange: (value: string) => void, options: Record<string, unknown> = {}): HTMLElement {
    return UI.input({ ...options, value, onChange });
  }

  function selectInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void, className = ''): HTMLElement {
    return UI.dropdown({ value, options, onChange, className });
  }

  function segmentedInput(value: unknown, options: Array<{ value: string; label: string }>, onChange: (value: string) => void): HTMLElement {
    return UI.segmented({ value, options, onChange });
  }

  function checkbox(value: boolean, onChange: (value: boolean) => void): HTMLElement {
    return UI.checkbox({ checked: value, onChange });
  }

  function sectionCollapseStates(): Record<string, boolean> {
    if (!state.sectionCollapsed || typeof state.sectionCollapsed !== 'object') state.sectionCollapsed = {};
    return state.sectionCollapsed as Record<string, boolean>;
  }

  function groupSections(root: Element): void {
    for (const header of Array.from(root.querySelectorAll<HTMLElement>('.section-header'))) {
      if (header.dataset.grouped === '1') continue;
      header.dataset.grouped = '1';
      const wrap = el('div', 'section-content');
      let next = header.nextSibling;
      while (next && !(next instanceof Element && next.classList.contains('section-header'))) {
        const item = next;
        next = next.nextSibling;
        wrap.appendChild(item);
      }
      header.after(wrap);
      const key = header.textContent!.trim();
      if (sectionCollapseStates()[key]) {
        wrap.classList.add('collapsed');
        header.classList.add('collapsed');
      }
      header.tabIndex = 0;
      header.setAttribute('role', 'button');
      header.setAttribute('aria-expanded', String(!wrap.classList.contains('collapsed')));
      const toggle = (): void => {
        const collapsed = wrap.classList.toggle('collapsed');
        header.classList.toggle('collapsed', collapsed);
        header.setAttribute('aria-expanded', String(!collapsed));
        sectionCollapseStates()[key] = collapsed;
      };
      header.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('select, button, input, label')) return;
        toggle();
      });
      header.addEventListener('keydown', (event) => {
        if (event.target !== header || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        toggle();
      });
    }
  }

  function renderInspector(): void {
    if (!state.raw) return;
    hideAssetPathPreview();
    // 下拉列表使用 body 级浮层；详情面板切换或清空时必须先销毁，
    // 否则宿主控件被重建后菜单仍会悬浮在旧位置。
    UI.closeDropdowns?.();
    queueMicrotask(() => groupSections($('inspector-body')));
    const selected = [...state.selected];
    const selectedNode = selected.length === 1 ? nodeById(selected[0]) : null;
    // 值卡片（布尔判断 / 拆分）没有详情面板：内容在卡片上就地编辑（浮动编辑器）。
    const valueCardSelected = Boolean(selectedNode) && isValueCardNode(selectedNode);
    const open = state.inspector === 'workflow'
      || state.inspector === 'variables'
      || Boolean(state.selectedRun)
      || Boolean(state.selectedEdge)
      || Boolean(selectedNode && !valueCardSelected);
    $('inspector').classList.toggle('hidden', !open);
    $('editor-main').classList.toggle('inspector-open', open);
    if (!open) {
      $('inspector-title').textContent = '详细信息';
      $('inspector-empty').textContent = '选择一个节点';
      $('inspector-empty').classList.remove('hidden');
      $('inspector-body').classList.add('hidden');
      $('inspector-body').innerHTML = '';
      return;
    }
    if (state.inspector === 'workflow') { renderers.renderWorkflowInspector(); return; }
    if (state.inspector === 'variables') { renderers.renderVariablesInspector(); return; }
    if (state.selectedRun) { renderers.renderInstanceRunInspector(); return; }
    if (state.selectedEdge) { renderers.renderEdgeInspector(); return; }
    if (selected.length !== 1) {
      $('inspector-title').textContent = selected.length ? `${selected.length} 个节点` : '详细信息';
      $('inspector-empty').textContent = selected.length ? '可拖动或按 Delete 删除所选节点' : '选择一个节点';
      $('inspector-empty').classList.remove('hidden');
      $('inspector-body').classList.add('hidden');
      return;
    }
    const node = selectedNode;
    if (!node) return;
    const body = clearInspector(node.name || node.id);
    if (node._nodeGroup) {
      section(body, '节点组');
      const nameRow = field(body, '名称');
      const nameInput = textInput(node.name || '', (value) => renameNodeGroup(node.id, value)) as HTMLInputElement;
      // 与普通节点共用 F2 聚焦约定，宿主无需区分目标类型。
      nameInput.id = 'inspector-node-name';
      nameRow.appendChild(nameInput);
      return;
    }
    section(body, '节点');
    const basics = el('div', 'node-basics');
    body.appendChild(basics);
    const idRow = field(basics, 'ID', '引用与运行事件使用的稳定标识');
    idRow.appendChild(textInput(node.id, (value) => renameNode(node.id, value.trim())));
    const nameRow = field(basics, '名称');
    // 固定 id：F2 重命名（editor.rename → renameSelection）靠它聚焦名称输入框。
    const nameInput = textInput(node.name || '', (value) => mutate(() => { if (value.trim()) node.name = value.trim(); else delete node.name; })) as HTMLInputElement;
    nameInput.id = 'inspector-node-name';
    nameRow.appendChild(nameInput);
    if (node.type !== 'root') {
      const typeRow = field(basics, '类型');
      typeRow.appendChild(selectInput(node.type, types.filter((type) => type !== 'root').map((type) => ({ value: type, label: typeNames[type] || typeLabels[type] })), (value) => changeNodeType(node, value)));
    }
    if (node.type === 'task') renderers.renderTaskInspector(body, node);
    else renderers.renderCompositeInspector(body, node);
    if (node.type !== 'root') renderers.renderDecorators(body, node);
    const remove = el('button', 'danger full-command', '删除节点');
    remove.addEventListener('click', deleteSelection);
    body.appendChild(remove);
  }

  return { clearInspector, section, field, textInput, selectInput, segmentedInput, checkbox, groupSections, renderInspector };
}
