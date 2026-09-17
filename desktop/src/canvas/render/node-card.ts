/**
 * 节点卡片渲染：节点外观、运行状态、变量引脚、装饰器行、端口与卡片级交互。
 * 原 `workflow-editor.js` 的 renderNode/renderNodePreview。
 *
 * 渲染函数不修改文档；选择、拖拽与连线都经注入的指针/命令回调。
 */
import type { CanvasState } from '../state/canvas-state';
import type { CardsNodeCards } from './cards';
import { nodeCardSummary } from './card-values';
import { paramColorSwatch, paramRowEditable, paramRowGeometry, paramRowKind, paramRowValueView } from './param-rows';
import type { ParamRowLike } from './param-rows';

export interface NodePreviewInfo {
  uri: string;
  path?: string;
}

/** 卡片参数行的折叠状态：total 为动作定义里的参数总数，hidden 为当前折叠掉的数量。 */
export interface NodeParamRowInfo {
  expanded: boolean;
  total: number;
  hidden: number;
}

export interface NodeParamEditorRequest {
  node: any;
  pin: any;
  /** 值区热区的世界坐标矩形（就地编辑器按视口换算成屏幕坐标）。 */
  rect: { x: number; y: number; width: number; height: number };
  clientX: number;
  clientY: number;
  world: { x: number; y: number };
}

export interface NodeRenderDeps {
  state: CanvasState;
  svgEl(tag: string, attrs: Record<string, any>, parent: any): any;
  nodeCards: CardsNodeCards;
  position(node: any): { x: number; y: number };
  nodeHeight(node: any): number;
  subWorkflowRef(node: any): string;
  templatePreview(node: any): NodePreviewInfo | null;
  compositeSubtitle(node: any): string;
  variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback?: string): string;
  decoratorLabel(decorator: any): string;
  nodeVariablePins(node: any): ParamRowLike[];
  openLightbox(src: string): void;
  disconnectVariableFromPin(nodeId: string, param: string): void;
  startVariableConnectionFromPin(event: any, nodeId: string, param: string): void;
  openPortContextMenu(event: any): { x: number; y: number } | null;
  showMenu(x: number, y: number, items: any[], options?: Record<string, unknown>): void;
  nodeVariablePinMenuItems(nodeId: string, pin: any, point: { x: number; y: number }): any[];
  nodeInputPortMenuItems(nodeId: string, point: { x: number; y: number }): any[];
  nodeOutputPortMenuItems(nodeId: string, point: { x: number; y: number }): any[];
  startConnectionFromInput(event: any, nodeId: string): void;
  startConnection(event: any, nodeId: string): void;
  startNodeDrag(event: any, nodeId: string): void;
  registerCardPress(key: string, event: { clientX: number; clientY: number }): boolean;
  requestInspector(selection: unknown): void;
  requestOpenSubWorkflow(nodeId: string): void;
  render(): void;
  contextMenuSuppressedByPan(): boolean;
  copySelection(): void;
  cutSelection(): void;
  deleteSelection(): void;
  /** 参数行的折叠状态与开关；缺省时按“全部展开”以外的旧行为渲染。 */
  paramRowInfo?(node: any): NodeParamRowInfo;
  toggleParamRows?(nodeId: string): void;
  /** 点击参数行的值区：交由就地编辑器决定菜单/输入框/详情栏。 */
  openParamEditor?(request: NodeParamEditorRequest): void;
  paramRowMenuItems?(nodeId: string, pin: any, point: { x: number; y: number }): any[];
  compactValue?(value: unknown, max?: number): string;
  typeIcons: Record<string, string>;
  typeNames: Record<string, string>;
  runLabels: Record<string, string>;
  nodeWidth: number;
  baseHeight: number;
  portRadius: number;
  decoratorHeight: number;
  runVariableHeight: number;
  variablePinX: number;
  preview: { x: number; y: number; width: number; height: number };
}

export interface CanvasNodeCardRenderer {
  renderNode(layer: any, node: any): void;
}

export function createNodeCardRenderer(deps: NodeRenderDeps): CanvasNodeCardRenderer {
  const {
    state, svgEl, nodeCards, position, nodeHeight, subWorkflowRef, templatePreview, compositeSubtitle,
    variableDisplayNameOf, decoratorLabel, nodeVariablePins, openLightbox,
    disconnectVariableFromPin, startVariableConnectionFromPin, openPortContextMenu, showMenu,
    nodeVariablePinMenuItems, nodeInputPortMenuItems, nodeOutputPortMenuItems,
    startConnectionFromInput, startConnection, startNodeDrag, registerCardPress, requestInspector,
    requestOpenSubWorkflow, render, contextMenuSuppressedByPan, copySelection, cutSelection, deleteSelection,
    paramRowInfo, toggleParamRows, openParamEditor, paramRowMenuItems, compactValue,
    typeIcons, typeNames, runLabels, nodeWidth, baseHeight, portRadius, decoratorHeight, runVariableHeight,
    variablePinX, preview,
  } = deps;

  const compact = compactValue ?? ((value: unknown, max = 24) => {
    let text: string;
    if (value === undefined) text = '未传值';
    else if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { ref?: unknown }).ref === 'string') text = `← ${(value as { ref: string }).ref}`;
    else if (typeof value === 'string') text = value;
    else { try { text = JSON.stringify(value); } catch { text = String(value); } }
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  });

  function renderNodePreview(group: any, previewInfo: NodePreviewInfo, className: string, preserveAspectRatio: string, onOpen?: string): void {
    const frame = svgEl('rect', { class: 'node-preview-frame', x: preview.x, y: preview.y, width: preview.width, height: preview.height, rx: 3 }, group);
    const image = svgEl('image', {
      class: `node-preview-image ${className}`,
      href: previewInfo.uri,
      x: preview.x + 1,
      y: preview.y + 1,
      width: preview.width - 2,
      height: preview.height - 2,
      preserveAspectRatio,
      'data-template-path': previewInfo.path || undefined,
    }, group);
    const stop = (event: { stopPropagation(): void }): void => event.stopPropagation();
    image.addEventListener('mousedown', stop);
    image.addEventListener('pointerdown', stop);
    image.addEventListener('click', (event: any) => { event.stopPropagation(); openLightbox(onOpen || previewInfo.uri); });
    image.addEventListener('error', () => { image.remove(); frame.remove(); });
    const title = svgEl('title', {}, image);
    title.textContent = previewInfo.path || '运行截图';
  }

  function renderNode(layer: any, node: any): void {
    const pos = position(node);
    const height = nodeHeight(node);
    const run = state.run.get(node.id);
    const subRef = subWorkflowRef(node);
    const template = templatePreview(node);
    const classes = ['node', 'studio-card', `type-${node.type}`];
    if (subRef) classes.push('node-subworkflow');
    if (state.selected.has(node.id)) classes.push('selected');
    if (state.connect && state.connect.hover === node.id) classes.push('connect-hover');
    if (state.variableConnect && state.variableConnect.hover && state.variableConnect.hover.nodeId === node.id) classes.push('connect-hover');
    if (run && run.status) classes.push(`run-${run.status}`);
    const group = svgEl('g', { class: classes.join(' '), transform: `translate(${pos.x},${pos.y})`, 'data-id': node.id }, layer);
    group.dataset.id = node.id;
    const body = svgEl('rect', { class: 'node-box card-body', width: nodeWidth, height, rx: 5 }, group);
    const head = svgEl('rect', { class: 'node-head card-head', x: 1, y: 1, width: nodeWidth - 2, height: 32, rx: 4 }, group);
    svgEl('rect', { class: 'node-accent card-accent', x: 1, y: 10, width: 3, height: 14, rx: 1 }, group);
    svgEl('line', { class: 'node-header-rule', x1: 1, y1: 33, x2: nodeWidth - 1, y2: 33 }, group);
    const iconPlate = svgEl('rect', { class: 'node-icon-plate', x: 10, y: 7, width: 20, height: 20, rx: 4 }, group);
    svgEl('text', { class: 'node-icon', x: 20, y: 22, 'text-anchor': 'middle' }, group).textContent = typeIcons[node.type] || '•';
    const hasRunStatus = Boolean(run && run.status);
    const rows = paramRowInfo ? paramRowInfo(node) : null;
    const pins = nodeVariablePins(node);
    const showRowToggle = node.type === 'task' && Boolean(rows && rows.total > 0 && toggleParamRows);
    nodeCards.text(group, { className: 'node-name card-title', x: 39, y: 22, value: node.name || node.id, width: nodeWidth - (showRowToggle ? 71 : 51), size: 12 });
    nodeCards.text(group, { className: 'node-type card-kicker', x: 14, y: 47, value: subRef ? '子工作流' : typeNames[node.type] || node.type, width: 130, size: 10 });
    svgEl('title', {}, group).textContent = `${node.name || node.id}\nID: ${node.id}${hasRunStatus ? `\n${runLabels[run.status] || run.status}${run.error ? `：${run.error}` : ''}` : ''}`;
    if (showRowToggle && rows) {
      const caret = svgEl('text', {
        class: `param-rows-toggle${rows.expanded ? ' expanded' : ''}`,
        x: nodeWidth - 14,
        y: 22,
        'text-anchor': 'end',
      }, group);
      caret.textContent = rows.expanded ? '▾' : (rows.hidden > 0 ? `▸ ${rows.hidden}` : '▸');
      const caption = svgEl('title', {}, caret);
      caption.textContent = rows.expanded ? '收起参数行（只显示必填与已配置）' : `展开全部参数行（还有 ${rows.hidden} 项未显示）`;
      // 箭头是标题栏上的按钮：不要触发节点拖拽（同类监听在下方批量注册，先注册者优先）。
      caret.addEventListener('mousedown', (event: any) => { event.preventDefault(); event.stopImmediatePropagation(); });
      caret.addEventListener('click', (event: any) => { event.preventDefault(); event.stopPropagation(); toggleParamRows?.(node.id); });
    }
    if (hasRunStatus) {
      svgEl('circle', { class: 'run-dot', cx: nodeWidth - 74, cy: 43, r: 3 }, group);
      nodeCards.text(group, { className: 'run-label', x: nodeWidth - 14, y: 47, value: runLabels[run.status] || run.status, width: 52, size: 10, anchor: 'end' });
    }
    const subtitle = node.type === 'task'
      ? (subRef ? subRef.split(/[\\/]/).pop() : (node.action || '未选择动作'))
      : compositeSubtitle(node);
    const hasPreview = Boolean(template || (run && run.thumbnail));
    nodeCards.text(group, { className: 'node-subtitle card-description', x: 14, y: 66, value: subtitle, width: hasPreview ? 148 : nodeWidth - 28, size: 11 });
    // 参数已经以内联行呈现，摘要只报数量（折叠时给出“已显示 / 全部”）。
    const metaValue = node.type === 'task'
      ? (pins.length
        ? (rows && rows.hidden > 0 ? `${pins.length} / ${rows.total} 项参数 · 点值编辑` : `${pins.length} 项参数 · 点值编辑`)
        : '详情栏编辑参数')
      : nodeCardSummary(node);
    nodeCards.text(group, { className: 'node-meta card-meta', x: 14, y: 84, value: metaValue, width: hasPreview ? 148 : run && Number.isFinite(run.duration) ? 160 : nodeWidth - 28, size: 10 });
    if (run && run.thumbnail) {
      const uri = run.thumbnail.startsWith('data:') ? run.thumbnail : `data:image/png;base64,${run.thumbnail}`;
      renderNodePreview(group, { uri, path: '' }, 'step-thumb', 'xMidYMid slice', run.screenshot || uri);
    } else if (template) renderNodePreview(group, template, 'template-thumb', 'xMidYMid meet');
    else if (run && Number.isFinite(run.duration)) {
      nodeCards.text(group, { className: 'node-duration', x: nodeWidth - 14, y: 84, value: run.duration < 1000 ? `${run.duration} ms` : `${(run.duration / 1000).toFixed(1)} s`, width: 66, size: 10, anchor: 'end' });
    }
    const pinOffset = pins.length * runVariableHeight;
    pins.forEach((pin, index) => {
      const row = paramRowGeometry({ nodeWidth, baseHeight, rowHeight: runVariableHeight, index, pinX: variablePinX });
      const kind = paramRowKind(pin.definition);
      const checked = Boolean(pin.configured ? pin.value : pin.definition && pin.definition.default);
      svgEl('line', { class: 'param-row-rule', x1: 0, y1: row.y, x2: nodeWidth, y2: row.y }, group);
      svgEl('circle', {
        class: `port port-variable type-${pin.type}${pin.variable ? ' bound' : ''}${pin.configured ? ' configured' : ''}`,
        cx: row.portX,
        cy: row.centerY,
        r: 5.5,
      }, group);
      // UE 风格：参数名在行内，值靠右；复杂参数只显示摘要，展开仍在详情栏。
      const label = nodeCards.text(group, {
        className: `param-row-label${pin.required && !pin.configured ? ' required' : ''}`,
        x: row.labelX,
        y: row.centerY + 4,
        value: pin.label || pin.param,
        width: row.labelWidth,
        size: 10,
      });
      label.style.pointerEvents = 'none';
      const view = paramRowValueView(pin, compact, pin.variable
        ? variableDisplayNameOf(pin.scope === 'variables' ? 'variables' : 'inputs', pin.variable, pin.label)
        : undefined);
      if (kind === 'boolean' && paramRowEditable(kind)) {
        svgEl('rect', {
          class: `param-row-check tone-${view.tone}${checked ? ' checked' : ''}`,
          x: row.valueRight - 11,
          y: row.centerY - 5.5,
          width: 11,
          height: 11,
          rx: 2.5,
        }, group).style.pointerEvents = 'none';
        if (checked) {
          svgEl('path', {
            class: 'param-row-check-mark',
            d: `M ${row.valueRight - 8.6} ${row.centerY - 0.4} l 2.4 2.8 l 4.2 -5`,
            fill: 'none',
          }, group).style.pointerEvents = 'none';
        }
      } else {
        // 颜色参数在值前面挂一个色块，和详情栏/变量卡保持一致。
        const swatch = kind === 'color'
          ? paramColorSwatch(pin.configured ? pin.value : pin.definition && pin.definition.default)
          : null;
        const valueText = nodeCards.text(group, {
          className: `param-row-value tone-${view.tone}`,
          x: row.valueRight,
          y: row.centerY + 4,
          value: view.text,
          width: row.valueWidth - (swatch ? 14 : 0),
          size: 10,
          anchor: 'end',
        });
        valueText.style.pointerEvents = 'none';
        if (swatch) {
          svgEl('rect', {
            class: 'param-row-swatch',
            x: row.valueRight - row.valueWidth + 2,
            y: row.centerY - 5,
            width: 10,
            height: 10,
            rx: 2,
            fill: swatch,
          }, group).style.pointerEvents = 'none';
        }
        // nodeCards.text 已带一个 title（显示文本）；这里替换成更完整的参数提示。
        const caption: any = valueText.querySelectorAll('title')[0];
        if (caption) caption.textContent = view.title;
      }
      const hit = svgEl('circle', { class: 'variable-port-hit', cx: row.portX, cy: row.centerY, r: 10, 'data-node': node.id, 'data-param': pin.param }, group);
      hit.addEventListener('pointerdown', (event: any) => {
        event.stopPropagation();
        if (event.altKey) {
          disconnectVariableFromPin(node.id, pin.param);
          return;
        }
        startVariableConnectionFromPin(event, node.id, pin.param);
      });
      hit.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeVariablePinMenuItems(node.id, pin, point));
      });
      const valueHit = svgEl('rect', {
        class: `param-row-hit tone-${view.tone}`,
        x: row.hit.x,
        y: row.hit.y,
        width: row.hit.width,
        height: row.hit.height,
        rx: 3,
        'data-node': node.id,
        'data-param': pin.param,
      }, group);
      valueHit.addEventListener('pointerdown', (event: any) => {
        // 值区是行内编辑器：吞掉事件，避免触发框选/平移/节点拖拽。
        event.stopPropagation();
      });
      valueHit.addEventListener('click', (event: any) => {
        event.preventDefault();
        event.stopPropagation();
        const point = position(node);
        openParamEditor?.({
          node,
          pin,
          rect: { x: point.x + row.hit.x, y: point.y + row.hit.y, width: row.hit.width, height: row.hit.height },
          clientX: event.clientX,
          clientY: event.clientY,
          world: { x: point.x + row.hit.x, y: point.y + row.centerY },
        });
      });
      valueHit.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        const items = paramRowMenuItems ? paramRowMenuItems(node.id, pin, point) : nodeVariablePinMenuItems(node.id, pin, point);
        showMenu(event.clientX, event.clientY, items);
      });
    });
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];
    decorators.forEach((decorator: any, index: number) => {
      const y = baseHeight + pinOffset + index * decoratorHeight;
      svgEl('line', { class: 'decorator-rule', x1: 0, y1: y, x2: nodeWidth, y2: y }, group);
      svgEl('text', { class: 'decorator-icon', x: 14, y: y + 15 }, group).textContent = '◇';
      nodeCards.text(group, { className: 'decorator-label', x: 32, y: y + 15, value: decoratorLabel(decorator), width: nodeWidth - 46, size: 10 });
    });
    if (node.type !== 'root') {
      const input = svgEl('circle', { class: 'port port-in', cx: nodeWidth / 2, cy: 0, r: portRadius, 'data-node': node.id }, group);
      input.addEventListener('pointerdown', (event: any) => startConnectionFromInput(event, node.id));
      input.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeInputPortMenuItems(node.id, point));
      });
    }
    if (node.type !== 'task') {
      const output = svgEl('circle', { class: 'port port-out', cx: nodeWidth / 2, cy: height, r: portRadius, 'data-node': node.id }, group);
      output.addEventListener('pointerdown', (event: any) => startConnection(event, node.id));
      output.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeOutputPortMenuItems(node.id, point));
      });
    }
    const handleNodeMouseDown = (event: any): void => {
      if (event.button !== 0) { startNodeDrag(event, node.id); return; }
      requestInspector({ kind: 'node', nodeId: node.id });
      const isDouble = registerCardPress(node.id, event);
      if (isDouble) {
        event.preventDefault();
        event.stopPropagation();
        if (subRef) { requestOpenSubWorkflow(node.id); return; }
        state.selected = new Set([node.id]);
        state.selectedRun = null;
        state.inspector = 'node';
        render();
        return;
      }
      startNodeDrag(event, node.id);
    };
    [body, head, iconPlate, ...group.querySelectorAll('text')].forEach((surface: any) => surface.addEventListener('mousedown', handleNodeMouseDown));
    if (subRef) {
      // 子流程节点右键菜单：直接进入子工作流视图
      group.addEventListener('contextmenu', (event: any) => {
        event.preventDefault();
        event.stopPropagation();
        if (contextMenuSuppressedByPan()) return;
        state.selected = new Set([node.id]);
        state.selectedRun = null;
        render();
        showMenu(event.clientX, event.clientY, [
          { label: '进入子工作流视图', run: () => requestOpenSubWorkflow(node.id) },
          'separator',
          { label: '复制 (Ctrl+C)', run: () => copySelection() },
          { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
          { label: '删除节点', danger: true, run: () => deleteSelection() },
        ]);
      });
    } else {
      // 普通节点右键菜单（UE 风格）：复制 / 剪切 / 删除
      group.addEventListener('contextmenu', (event: any) => {
        event.preventDefault();
        event.stopPropagation();
        if (contextMenuSuppressedByPan()) return;
        state.selected = new Set([node.id]);
        state.selectedRun = null;
        render();
        showMenu(event.clientX, event.clientY, [
          { label: '复制 (Ctrl+C)', run: () => copySelection() },
          { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
          'separator',
          { label: '删除节点', danger: true, run: () => deleteSelection() },
        ]);
      });
    }
  }

  return { renderNode };
}
