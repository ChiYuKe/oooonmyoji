(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const NS = 'http://www.w3.org/2000/svg';
  const CARD_W = 236;
  const CARD_H = 64;
  const GAP_Y = 16;
  const GAP_X = 132;
  const PAD = 28;
  const MAX_NAME = 20;

  const state = { workflows: [], currentUri: '', currentName: '', outgoing: [], incoming: [], unresolved: [] };
  const $ = (id) => document.getElementById(id);

  function svgEl(tag, attrs, parent) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    if (parent) parent.appendChild(element);
    return element;
  }

  function baseName(value) {
    const text = String(value || '');
    const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
    return slash >= 0 ? text.slice(slash + 1) : text;
  }

  function clip(text, max) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  /** 按目标 URI 合并引用条目（同一脚本被多处引用时归并为一张卡）。 */
  function groupEntries(entries) {
    const map = new Map();
    for (const entry of entries || []) {
      const key = entry.uri;
      const group = map.get(key) || { uri: key, name: entry.name, entries: [] };
      group.entries.push(entry);
      map.set(key, group);
    }
    return [...map.values()];
  }

  /** 图模型：中心卡 + 出边组 + 入边组。 */
  function graphModel() {
    return {
      center: { uri: state.currentUri, name: state.currentName },
      outgoing: groupEntries(state.outgoing),
      incoming: state.incoming.map((group) => ({ uri: group.source.uri, name: group.source.name, entries: group.entries })),
    };
  }

  /** 横向贝塞尔连线（左右方向）。 */
  function linkPath(x1, y1, x2, y2) {
    const dx = x2 - x1;
    return `M ${x1} ${y1} C ${x1 + dx / 2} ${y1}, ${x2 - dx / 2} ${y2}, ${x2} ${y2}`;
  }

  function renderTooltip(entries, event, cardName) {
    const tip = $('tooltip');
    const head = document.createElement('strong');
    head.textContent = cardName;
    tip.appendChild(head);
    for (const entry of entries) {
      const line = document.createElement('div');
      line.textContent = `${entry.nodeName ? `${entry.nodeName} (${entry.nodeId})` : entry.nodeId} → ${entry.reference}`;
      tip.appendChild(line);
    }
    tip.classList.remove('hidden');
    positionTooltip(tip, event);
  }

  function positionTooltip(tip, event) {
    const rect = $('graph').getBoundingClientRect();
    const left = event.clientX - rect.left + 12;
    const top = event.clientY - rect.top + 12;
    tip.style.left = `${Math.min(left, rect.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(top, rect.height - tip.offsetHeight - 8)}px`;
  }

  function hideTooltip() { $('tooltip').classList.add('hidden'); $('tooltip').innerHTML = ''; }

  // 单击切换、双击打开：250ms 内第二次点击同一张卡视为打开。
  let lastClickUri = '';
  let lastClickTime = 0;
  let pendingSwitch = null;

  function onCardClick(uri) {
    const now = Date.now();
    if (pendingSwitch) { clearTimeout(pendingSwitch); pendingSwitch = null; }
    if (uri === state.currentUri) return;
    if (uri === lastClickUri && now - lastClickTime < 250) {
      lastClickUri = '';
      vscode.postMessage({ type: 'openWorkflow', uri });
      return;
    }
    lastClickUri = uri;
    lastClickTime = now;
    pendingSwitch = setTimeout(() => {
      pendingSwitch = null;
      lastClickUri = '';
      vscode.postMessage({ type: 'switchWorkflow', uri });
    }, 250);
  }

  function card(node, layoutX, layoutY, extra) {
    const g = svgEl('g', { class: `ref-card ${extra || ''}` });
    g.setAttribute('data-uri', node.uri);
    g.setAttribute('data-kind', node.kind);
    g.setAttribute('transform', `translate(${layoutX},${layoutY})`);
    const rect = svgEl('rect', { class: 'card-box', width: CARD_W, height: CARD_H, rx: 10, ry: 10 }, g);
    const title = svgEl('text', { class: 'card-title', x: 14, y: 26 }, g);
    title.textContent = clip(baseName(node.name), MAX_NAME);
    const sub = svgEl('text', { class: 'card-sub', x: 14, y: 47 }, g);
    sub.textContent = clip(node.sub || String(node.name || ''), 40);
    if (node.count !== undefined) {
      const count = svgEl('text', { class: 'card-count', x: CARD_W - 14, y: 26 }, g);
      count.setAttribute('text-anchor', 'end');
      count.textContent = `×${node.count}`;
    }
    g.addEventListener('click', (event) => {
      event.stopPropagation();
      onCardClick(node.uri);
    });
    g.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'openWorkflow', uri: node.uri });
    });
    g.addEventListener('mousemove', (event) => {
      if (node.entries && node.entries.length > 0 && node.kind !== 'center') {
        const tip = $('tooltip');
        if (tip.classList.contains('hidden')) {
          renderTooltip(node.entries, event, baseName(node.name));
        }
        positionTooltip(tip, event);
      }
    });
    g.addEventListener('mouseleave', hideTooltip);
    void rect;
    return g;
  }

  function render() {
    $('workflow-name').textContent = baseName(state.currentName) || '尚未选择';
    $('workflow-path').textContent = state.currentName || '';
    renderPicker();
    renderSummary();
    renderGraph();
  }

  function renderPicker() {
    const select = $('workflow-select');
    select.innerHTML = '';
    for (const file of state.workflows) {
      const option = document.createElement('option');
      option.value = file.uri;
      option.textContent = file.rel || file.name;
      if (file.uri === state.currentUri) option.selected = true;
      select.appendChild(option);
    }
  }

  function renderSummary() {
    const outgoingCards = groupEntries(state.outgoing).length;
    const incomingCount = state.incoming.reduce((sum, group) => sum + group.entries.length, 0);
    $('outgoing-count').textContent = String(outgoingCards);
    $('incoming-count').textContent = String(state.incoming.length);
    $('unresolved-count').textContent = String(state.unresolved.length);
    const outgoingTotal = $('outgoing-total');
    if (outgoingTotal) outgoingTotal.textContent = `共 ${state.outgoing.length} 处`;
    const incomingTotal = $('incoming-total');
    if (incomingTotal) incomingTotal.textContent = `共 ${incomingCount} 处`;
  }

  function renderGraph() {
    const svg = $('graph');
    svg.innerHTML = '';
    const model = graphModel();
    const hasAny = model.outgoing.length > 0 || model.incoming.length > 0 || model.center.uri;
    $('empty-state').classList.toggle('hidden', hasAny);
    if (!model.center.uri) return;

    const defs = svgEl('defs', {}, svg);
    for (const [id, color] of Object.entries({ 'arrow-out': '#58a6cf', 'arrow-in': '#d9a441' })) {
      const marker = svgEl('marker', { id, markerWidth: 10, markerHeight: 8, refX: 9, refY: 4, orient: 'auto' }, defs);
      svgEl('path', { d: 'M 0,0 L 10,4 L 0,8 z', fill: color }, marker);
    }

    // 布局：中心卡居中，出边在右列，入边在左列，各自纵向均匀排布。
    const rowStep = CARD_H + GAP_Y;
    const center = { uri: model.center.uri, name: model.center.name, kind: 'center', entries: [] };
    const outgoingCards = model.outgoing.map((group, index) => ({
      uri: group.uri,
      name: group.name,
      kind: 'out',
      entries: group.entries,
      count: group.entries.length,
      sub: `引用 ${group.entries.length} 处`,
    }));
    const incomingCards = model.incoming.map((group, index) => ({
      uri: group.uri,
      name: group.name,
      kind: 'in',
      entries: group.entries,
      count: group.entries.length,
      sub: `被引用 ${group.entries.length} 处`,
    }));

    const centerX = 0;
    const outX = CARD_W / 2 + GAP_X;
    const inX = -CARD_W / 2 - GAP_X;
    const centerY = 0;
    const outYs = outgoingCards.map((_, index) => centerY - ((outgoingCards.length - 1) * rowStep) / 2 + index * rowStep);
    const inYs = incomingCards.map((_, index) => centerY - ((incomingCards.length - 1) * rowStep) / 2 + index * rowStep);

    // 连线先画（在卡片之下）：出边 = 中心 → 目标；入边 = 来源 → 中心。
    const links = svgEl('g', { class: 'ref-links' }, svg);
    outgoingCards.forEach((cardInfo, index) => {
      const fromX = CARD_W / 2;
      const toX = outX - CARD_W / 2;
      svgEl('path', {
        class: 'ref-link out',
        d: linkPath(fromX, centerY, toX, outYs[index]),
        'marker-end': 'url(#arrow-out)',
        'data-kind': 'out',
        'data-from': center.uri,
        'data-to': cardInfo.uri,
      }, links);
    });
    incomingCards.forEach((cardInfo, index) => {
      const fromX = inX + CARD_W / 2;
      const toX = -CARD_W / 2;
      svgEl('path', {
        class: 'ref-link in',
        d: linkPath(fromX, inYs[index], toX, centerY),
        'marker-end': 'url(#arrow-in)',
        'data-kind': 'in',
        'data-from': cardInfo.uri,
        'data-to': center.uri,
      }, links);
    });

    const cards = svgEl('g', { class: 'ref-cards' }, svg);
    cards.appendChild(card(center, -CARD_W / 2, centerY - CARD_H / 2));
    outgoingCards.forEach((cardInfo, index) => cards.appendChild(card(cardInfo, outX - CARD_W / 2, outYs[index] - CARD_H / 2)));
    incomingCards.forEach((cardInfo, index) => cards.appendChild(card(cardInfo, inX - CARD_W / 2, inYs[index] - CARD_H / 2)));

    // viewBox 包住全部内容并居中留白。
    const minX = Math.min(inX - CARD_W / 2, centerX - CARD_W / 2);
    const maxX = Math.max(outX + CARD_W / 2, centerX + CARD_W / 2);
    const allYs = [centerY, ...outYs, ...inYs];
    const minY = Math.min(...allYs) - CARD_H / 2;
    const maxY = Math.max(...allYs) + CARD_H / 2;
    svg.setAttribute('viewBox', `${minX - PAD} ${minY - PAD} ${maxX - minX + PAD * 2} ${maxY - minY + PAD * 2}`);
  }

  $('workflow-select').addEventListener('change', () => {
    const uri = $('workflow-select').value;
    if (!uri || uri === state.currentUri) return;
    vscode.postMessage({ type: 'switchWorkflow', uri });
  });
  $('btn-refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'init') return;
    state.workflows = Array.isArray(data.workflows) ? data.workflows : [];
    state.currentUri = String(data.currentUri || '');
    state.currentName = String(data.currentName || '');
    state.outgoing = Array.isArray(data.outgoing) ? data.outgoing : [];
    state.incoming = Array.isArray(data.incoming) ? data.incoming : [];
    state.unresolved = Array.isArray(data.unresolved) ? data.unresolved : [];
    render();
    window.__refViewer = { state, render, graphModel };
  });

  vscode.postMessage({ type: 'ready' });
}());