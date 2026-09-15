/**
 * 引用查看器：以图形方式展示某个工作流 / 模板 / 目录的被引用者与依赖。
 * 通过依赖注入拿到工作台控制器与主进程能力，自身持有查看器状态。
 */
import {
  ArrowLeft,
  Box,
  FileJson2,
  Image,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Waypoints,
  X,
  createElement,
} from 'lucide';
import type { ReferenceGraph, ReferenceItem, ReferenceNode } from '../shared/contracts';
import type { WorkbenchFrameController } from './docking';

export interface ReferenceViewerDeps {
  getWorkbenchFrame: () => WorkbenchFrameController | undefined;
  getReferenceGraph: (path: string) => Promise<ReferenceGraph>;
  contentName: (path: string) => string;
  showToast: (message: string, error?: boolean) => void;
  errorMessage: (error: unknown) => string;
}

export interface ReferenceViewer {
  open(path: string, sourceDocument: Document): void;
  close(): void;
}

export function createReferenceViewer(deps: ReferenceViewerDeps): ReferenceViewer {
  const { getWorkbenchFrame, getReferenceGraph, contentName, showToast, errorMessage } = deps;

let referenceViewerDocument: Document | undefined;
let referenceViewerPanel: HTMLElement | undefined;
let referenceViewerBody: HTMLElement | undefined;
let referenceViewerTrailEl: HTMLElement | undefined;
let referenceViewerKeyHandler: ((event: KeyboardEvent) => void) | undefined;
let referenceTrail: string[] = [];
let referenceViewerToken = 0;
let referenceViewerGraph: ReferenceGraph | undefined;
let referenceViewerCanvas: HTMLElement | undefined;
let referenceViewerZoom = 1;
let referenceViewerQuery = '';
let referenceViewerPan = { x: 0, y: 0 };
let referenceViewerResizeObserver: ResizeObserver | undefined;
let referenceViewerLocationDisposable: { dispose(): void } | undefined;

function closeReferenceViewer(): void {
  referenceViewerToken += 1;
  if (referenceViewerPanel && referenceViewerKeyHandler) {
    referenceViewerPanel.removeEventListener('keydown', referenceViewerKeyHandler, true);
  }
  getWorkbenchFrame()?.dockviewApi.getPanel('referenceViewer')?.api.close();
  referenceViewerPanel?.remove();
  referenceViewerResizeObserver?.disconnect();
  referenceViewerLocationDisposable?.dispose();
  referenceViewerPanel = undefined;
  referenceViewerBody = undefined;
  referenceViewerTrailEl = undefined;
  referenceViewerKeyHandler = undefined;
  referenceViewerDocument = undefined;
  referenceViewerGraph = undefined;
  referenceViewerCanvas = undefined;
  referenceViewerZoom = 1;
  referenceViewerQuery = '';
  referenceViewerPan = { x: 0, y: 0 };
  referenceViewerResizeObserver = undefined;
  referenceViewerLocationDisposable = undefined;
  referenceTrail = [];
}

function referenceKindIcon(kind: ReferenceNode['kind']): SVGSVGElement {
  const icon = kind === 'workflow' ? FileJson2 : kind === 'asset' ? Image : kind === 'catalog' ? Box : Waypoints;
  return createElement(icon, { width: '15', height: '15', 'aria-hidden': 'true' }) as SVGSVGElement;
}

function referenceKindLabel(kind: ReferenceNode['kind']): string {
  if (kind === 'workflow') return '工作流';
  if (kind === 'asset') return '模板图片';
  if (kind === 'catalog') return '奖励目录';
  return '其他';
}

function renderReferenceTrail(doc: Document): void {
  if (!referenceViewerTrailEl) return;
  const backButton = doc.querySelector<HTMLButtonElement>('.reference-viewer-nav button');
  if (backButton) backButton.disabled = referenceTrail.length <= 1;
  referenceViewerTrailEl.replaceChildren();
  referenceTrail.forEach((path, index) => {
    const crumb = doc.createElement('button');
    crumb.type = 'button';
    crumb.className = `reference-trail-crumb${index === referenceTrail.length - 1 ? ' current' : ''}`;
    crumb.textContent = contentName(path);
    crumb.title = path;
    crumb.addEventListener('click', () => {
      referenceTrail = referenceTrail.slice(0, index + 1);
      void renderReferenceViewer();
    });
    referenceViewerTrailEl!.appendChild(crumb);
    if (index < referenceTrail.length - 1) {
      const sep = doc.createElement('span');
      sep.className = 'reference-trail-sep';
      sep.textContent = '/';
      referenceViewerTrailEl!.appendChild(sep);
    }
  });
}

function referenceNodeMatches(node: ReferenceNode, query: string): boolean {
  if (!query) return true;
  const haystack = `${node.name} ${node.path} ${node.workflowId ?? ''}`.toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function appendReferenceNode(doc: Document, layer: HTMLElement, item: ReferenceItem | undefined, node: ReferenceNode, side: 'target' | 'incoming' | 'outgoing', x: number, y: number, width: number): void {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `reference-graph-node ${side} kind-${node.kind}${node.exists ? '' : ' missing'}`;
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.width = `${width}px`;
  button.setAttribute('aria-label', `${referenceKindLabel(node.kind)} ${node.name}`);
  if (side !== 'target') {
    button.title = '点击查看该内容的引用';
    button.addEventListener('click', () => navigateReferenceViewer(node.path));
  }
  const icon = doc.createElement('span');
  icon.className = 'reference-graph-node-icon';
  icon.appendChild(referenceKindIcon(node.kind));
  const text = doc.createElement('span');
  text.className = 'reference-graph-node-text';
  const name = doc.createElement('strong');
  name.textContent = node.name;
  const pathEl = doc.createElement('small');
  pathEl.textContent = node.path;
  text.append(name, pathEl);
  if (item && item.contexts.length) {
    const count = doc.createElement('em');
    count.textContent = `${item.contexts.length} 处引用`;
    text.appendChild(count);
  }
  button.append(icon, text);
  layer.appendChild(button);
}

function renderReferenceGraph(doc: Document, graph: ReferenceGraph): void {
  const canvas = referenceViewerCanvas;
  if (!canvas) return;
  const zoomControls = canvas.querySelector<HTMLElement>('.reference-zoom-controls');
  canvas.replaceChildren();
  const edges = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edges.classList.add('reference-graph-edges');
  edges.setAttribute('aria-hidden', 'true');
  const layer = doc.createElement('div');
  layer.className = 'reference-graph-nodes';
  canvas.append(edges, layer);
  const width = Math.max(canvas.clientWidth, 320);
  const height = Math.max(canvas.clientHeight, 440);
  const hasBothSides = graph.referencedBy.length > 0 && graph.references.length > 0;
  const nodeWidth = hasBothSides
    ? Math.min(188, Math.max(108, (width - 80) / 3))
    : Math.min(188, Math.max(142, (width - 64) / 2));
  const nodeHeight = 70;
  const filteredIncoming = graph.referencedBy.filter((item) => referenceNodeMatches(item.target, referenceViewerQuery));
  const filteredOutgoing = graph.references.filter((item) => referenceNodeMatches(item.target, referenceViewerQuery));
  const centerX = hasBothSides
    ? width / 2 - nodeWidth / 2
    : filteredIncoming.length > 0
      ? width * .7 - nodeWidth / 2
      : filteredOutgoing.length > 0
        ? width * .3 - nodeWidth / 2
        : width / 2 - nodeWidth / 2;
  const centerY = height / 2 - nodeHeight / 2;
  const sideMargin = width >= 720 ? 70 : 18;
  const incomingX = sideMargin;
  const outgoingX = width - nodeWidth - sideMargin;
  const placeY = (index: number, total: number): number => Math.max(26, height / 2 - (total - 1) * 48 + index * 96 - nodeHeight / 2);
  const paths: string[] = [];
  filteredIncoming.forEach((item, index) => {
    const y = placeY(index, filteredIncoming.length);
    appendReferenceNode(doc, layer, item, item.target, 'incoming', incomingX, y, nodeWidth);
    const sy = y + nodeHeight / 2;
    paths.push(`M ${incomingX + nodeWidth} ${sy} C ${incomingX + nodeWidth + 80} ${sy}, ${centerX - 80} ${centerY + nodeHeight / 2}, ${centerX} ${centerY + nodeHeight / 2}`);
  });
  filteredOutgoing.forEach((item, index) => {
    const y = placeY(index, filteredOutgoing.length);
    appendReferenceNode(doc, layer, item, item.target, 'outgoing', outgoingX, y, nodeWidth);
    const sy = y + nodeHeight / 2;
    paths.push(`M ${centerX + nodeWidth} ${centerY + nodeHeight / 2} C ${centerX + nodeWidth + 80} ${centerY + nodeHeight / 2}, ${outgoingX - 80} ${sy}, ${outgoingX} ${sy}`);
  });
  appendReferenceNode(doc, layer, undefined, graph.target, 'target', centerX, centerY, nodeWidth);
  edges.setAttribute('viewBox', `0 0 ${width} ${height}`);
  edges.setAttribute('preserveAspectRatio', 'none');
  for (const pathData of paths) {
    const edge = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    edge.setAttribute('d', pathData);
    edge.classList.add('reference-graph-edge');
    edges.appendChild(edge);
  }
  if (zoomControls) canvas.appendChild(zoomControls);
  canvas.style.setProperty('--reference-zoom', String(referenceViewerZoom));
  canvas.style.setProperty('--reference-pan-x', `${referenceViewerPan.x}px`);
  canvas.style.setProperty('--reference-pan-y', `${referenceViewerPan.y}px`);
}

function observeReferenceCanvas(): void {
  const canvas = referenceViewerCanvas;
  if (!canvas) return;
  referenceViewerResizeObserver?.disconnect();
  const ownerWindow = canvas.ownerDocument.defaultView;
  const ResizeObserverCtor = ownerWindow?.ResizeObserver;
  if (!ownerWindow || !ResizeObserverCtor) return;
  let frameId: number | undefined;
  referenceViewerResizeObserver = new ResizeObserverCtor(() => {
    if (frameId !== undefined) ownerWindow.cancelAnimationFrame(frameId);
    frameId = ownerWindow.requestAnimationFrame(() => {
      frameId = undefined;
      const graph = referenceViewerGraph;
      if (graph && referenceViewerCanvas === canvas) renderReferenceGraph(canvas.ownerDocument, graph);
    });
  });
  referenceViewerResizeObserver.observe(canvas);
}

function createReferenceControl(doc: Document, label: string, value: string, type: 'number' | 'checkbox' = 'number'): HTMLElement {
  const row = doc.createElement('label');
  row.className = 'reference-filter-row';
  row.appendChild(doc.createTextNode(label));
  const input = doc.createElement('input');
  input.type = type;
  if (type === 'checkbox') input.checked = true;
  else { input.value = value; input.min = '1'; input.max = '20'; }
  row.appendChild(input);
  return row;
}

async function renderReferenceViewer(): Promise<void> {
  const doc = referenceViewerDocument;
  const body = referenceViewerBody;
  if (!doc || !body || referenceTrail.length === 0) return;
  const current = referenceTrail[referenceTrail.length - 1];
  const token = ++referenceViewerToken;

  renderReferenceTrail(doc);
  body.replaceChildren();
  const loading = doc.createElement('div');
  loading.className = 'reference-loading';
  const spinner = doc.createElement('span');
  spinner.className = 'loading-spinner';
  loading.append(spinner, doc.createTextNode('正在分析引用…'));
  body.appendChild(loading);

  let graph: ReferenceGraph;
  try {
    graph = await getReferenceGraph(current);
  } catch (error) {
    if (referenceViewerDocument !== doc || referenceViewerToken !== token || referenceTrail[referenceTrail.length - 1] !== current) return;
    body.replaceChildren();
    const failure = doc.createElement('div');
    failure.className = 'reference-section-empty';
    failure.textContent = `引用分析失败：${errorMessage(error)}`;
    body.appendChild(failure);
    showToast(errorMessage(error), true);
    return;
  }
  if (referenceViewerDocument !== doc || referenceViewerToken !== token || referenceTrail[referenceTrail.length - 1] !== current) return;

  referenceViewerGraph = graph;
  body.replaceChildren();
  const workspace = doc.createElement('div');
  workspace.className = 'reference-workspace';
  const sidebar = doc.createElement('aside');
  sidebar.className = 'reference-sidebar';
  const search = doc.createElement('label');
  search.className = 'reference-search';
  search.appendChild(createElement(Search, { width: '15', height: '15', 'aria-hidden': 'true' }));
  const searchInput = doc.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索...';
  searchInput.value = referenceViewerQuery;
  searchInput.addEventListener('input', () => { referenceViewerQuery = searchInput.value.trim(); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  search.appendChild(searchInput);
  sidebar.appendChild(search);
  sidebar.appendChild(createReferenceControl(doc, '搜索引用者深度', '1'));
  sidebar.appendChild(createReferenceControl(doc, '搜索依赖性深度', '1'));
  sidebar.appendChild(createReferenceControl(doc, '搜索宽度限制', '20', 'checkbox'));
  const filter = doc.createElement('label');
  filter.className = 'reference-filter-row';
  filter.appendChild(doc.createTextNode('集过滤器'));
  const select = doc.createElement('select');
  select.innerHTML = '<option>None</option><option>工作流</option><option>模板图片</option><option>奖励目录</option>';
  filter.appendChild(select);
  sidebar.appendChild(filter);
  const summary = doc.createElement('div');
  summary.className = 'reference-sidebar-summary';
  summary.innerHTML = `<strong>${graph.target.name}</strong><span>${graph.target.path}</span><span>${graph.referencedBy.length} 个引用者 · ${graph.references.length} 个依赖</span>`;
  sidebar.appendChild(summary);
  const canvas = doc.createElement('div');
  canvas.className = 'reference-graph-canvas';
  referenceViewerCanvas = canvas;
  let dragOrigin: { x: number; y: number; panX: number; panY: number } | undefined;
  canvas.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragOrigin = { x: event.clientX, y: event.clientY, panX: referenceViewerPan.x, panY: referenceViewerPan.y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragOrigin) return;
    referenceViewerPan = { x: dragOrigin.panX + event.clientX - dragOrigin.x, y: dragOrigin.panY + event.clientY - dragOrigin.y };
    canvas.style.setProperty('--reference-pan-x', `${referenceViewerPan.x}px`);
    canvas.style.setProperty('--reference-pan-y', `${referenceViewerPan.y}px`);
  });
  const stopGraphDrag = (event: PointerEvent): void => {
    if (!dragOrigin) return;
    dragOrigin = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', stopGraphDrag);
  canvas.addEventListener('pointercancel', stopGraphDrag);
  const zoom = doc.createElement('div');
  zoom.className = 'reference-zoom-controls';
  const zoomOut = doc.createElement('button');
  zoomOut.type = 'button'; zoomOut.title = '缩小'; zoomOut.appendChild(createElement(Minus, { width: '14', height: '14', 'aria-hidden': 'true' }));
  zoomOut.addEventListener('click', () => { referenceViewerZoom = Math.max(.6, referenceViewerZoom - .1); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  const zoomIn = doc.createElement('button');
  zoomIn.type = 'button'; zoomIn.title = '放大'; zoomIn.appendChild(createElement(Plus, { width: '14', height: '14', 'aria-hidden': 'true' }));
  zoomIn.addEventListener('click', () => { referenceViewerZoom = Math.min(1.6, referenceViewerZoom + .1); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  zoom.append(zoomOut, zoomIn);
  canvas.appendChild(zoom);
  workspace.append(sidebar, canvas);
  body.appendChild(workspace);
  observeReferenceCanvas();
  window.requestAnimationFrame(() => renderReferenceGraph(doc, graph));
}

function openReferenceViewer(path: string, _sourceDocument: Document): void {
  closeReferenceViewer();
  const doc = document;
  referenceViewerDocument = doc;
  referenceTrail = [path];

  getWorkbenchFrame()?.show('referenceViewer');
  const host = doc.querySelector<HTMLElement>('#module-reference-viewer');
  if (!host) return;

  const panel = doc.createElement('div');
  panel.className = 'reference-viewer';
  panel.tabIndex = -1;

  const header = doc.createElement('div');
  header.className = 'reference-viewer-header';
  const trailEl = doc.createElement('div');
  trailEl.className = 'reference-viewer-trail';
  const nav = doc.createElement('div');
  nav.className = 'reference-viewer-nav';
  const backButton = doc.createElement('button');
  backButton.type = 'button'; backButton.className = 'panel-action'; backButton.title = '后退';
  backButton.disabled = true;
  backButton.appendChild(createElement(ArrowLeft, { width: '14', height: '14', 'aria-hidden': 'true' }));
  backButton.addEventListener('click', () => { if (referenceTrail.length > 1) { referenceTrail.pop(); void renderReferenceViewer(); } });
  nav.appendChild(backButton);
  const refreshButton = doc.createElement('button');
  refreshButton.type = 'button'; refreshButton.className = 'panel-action'; refreshButton.title = '刷新';
  refreshButton.appendChild(createElement(RefreshCw, { width: '14', height: '14', 'aria-hidden': 'true' }));
  refreshButton.addEventListener('click', () => void renderReferenceViewer());
  nav.appendChild(refreshButton);
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'panel-action';
  closeButton.title = '关闭 (Esc)';
  closeButton.setAttribute('aria-label', '关闭');
  closeButton.appendChild(createElement(X, { width: '14', height: '14', 'aria-hidden': 'true' }));
  closeButton.addEventListener('click', closeReferenceViewer);
  header.append(nav, trailEl, closeButton);

  const body = doc.createElement('div');
  body.className = 'reference-viewer-body';

  const footer = doc.createElement('div');
  footer.className = 'reference-viewer-footer';
  footer.textContent = '拖动画布可浏览引用关系 · 点击节点逐层跳转 · Esc 关闭';

  panel.append(header, body, footer);
  host.replaceChildren(panel);

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeReferenceViewer();
  };
  panel.addEventListener('keydown', keyHandler, true);

  referenceViewerPanel = panel;
  referenceViewerBody = body;
  referenceViewerTrailEl = trailEl;
  referenceViewerKeyHandler = keyHandler;

  const dockPanel = getWorkbenchFrame()?.dockviewApi.getPanel('referenceViewer');
  referenceViewerLocationDisposable = dockPanel?.api.onDidLocationChange(() => {
    window.setTimeout(() => {
      const ownerDocument = referenceViewerPanel?.ownerDocument;
      if (dockPanel.api.location.type === 'popout' && ownerDocument && ownerDocument !== document) {
        ownerDocument.title = '引用查看器 - Onmyoji Studio';
        const popoutTitle = ownerDocument.querySelector<HTMLElement>('.popout-title');
        if (popoutTitle) popoutTitle.textContent = '引用查看器';
      }
      observeReferenceCanvas();
      if (referenceViewerGraph && referenceViewerCanvas) renderReferenceGraph(referenceViewerCanvas.ownerDocument, referenceViewerGraph);
    }, 0);
  });

  void renderReferenceViewer();
  window.setTimeout(() => getWorkbenchFrame()?.popout('referenceViewer'), 0);
}

/** 跳转到引用图中的另一个节点（层层跳转）。 */
function navigateReferenceViewer(path: string): void {
  referenceTrail.push(path);
  referenceViewerQuery = '';
  referenceViewerPan = { x: 0, y: 0 };
  void renderReferenceViewer();
}


  return { open: openReferenceViewer, close: closeReferenceViewer };
}
