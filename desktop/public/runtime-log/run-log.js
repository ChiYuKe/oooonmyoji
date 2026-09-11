(function () {
  'use strict';

  const desktopHost = {
    postMessage(message) {
      window.parent.postMessage({ source: 'desktop-run-log', message }, '*');
    },
  };
  const state = {
    descriptor: null,
    sources: [],
    activeSource: 'default',
    runs: new Map(),
    engineOutput: '',
    filter: 'tasks',
    view: 'steps',
    runningDurationNodes: [],
  };

  try {
    const savedView = window.localStorage.getItem('onmyoji-studio.runtime-log-view');
    if (savedView === 'steps' || savedView === 'engine') state.view = savedView;
  } catch { /* 独立打开或受限环境下忽略 */ }

  const $ = (id) => document.getElementById(id);

  // 工作台统一接管 HTML 控件的 title，避免出现浏览器原生提示框。
  function installCustomTooltips() {
    const embedded = window.parent !== window;
    let tooltipNode = null;
    let activeTarget = null;
    const ensureTooltip = () => {
      if (!tooltipNode) {
        tooltipNode = document.createElement('div');
        tooltipNode.className = 'app-tooltip hidden';
        tooltipNode.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipNode);
      }
      return tooltipNode;
    };
    const sendToParent = (message) => window.parent.postMessage({ source: 'onmyoji-tooltip', ...message }, '*');
    const show = (target) => {
      const text = target.dataset.tooltip || '';
      if (!text) return hide();
      const rect = target.getBoundingClientRect();
      activeTarget = target;
      if (embedded) {
        sendToParent({ type: 'show', text, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } });
        return;
      }
      const node = ensureTooltip();
      node.textContent = text;
      node.classList.remove('hidden');
      position(node, rect);
    };
    const hide = () => {
      activeTarget = null;
      if (embedded) sendToParent({ type: 'hide' });
      else if (tooltipNode) tooltipNode.classList.add('hidden');
    };
    const position = (node, rect) => {
      const margin = 8;
      const gap = 7;
      node.style.left = '0px';
      node.style.top = '0px';
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const x = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin));
      let y = rect.bottom + gap;
      if (y + height > window.innerHeight - margin) y = rect.top - height - gap;
      y = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
      node.style.left = `${Math.round(x)}px`;
      node.style.top = `${Math.round(y)}px`;
    };
    const targetForEvent = (event) => {
      const target = event.target;
      return target instanceof Element ? target.closest('[data-tooltip]') : null;
    };
    const scan = () => {
      document.querySelectorAll('[title]').forEach((element) => {
        if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.tagName === 'IFRAME') return;
        const label = element.getAttribute('title') && element.getAttribute('title').trim();
        if (!label) return;
        element.dataset.tooltip = label;
        element.removeAttribute('title');
        if (!element.getAttribute('aria-label') && /^(BUTTON|INPUT|SELECT)$/.test(element.tagName)) {
          element.setAttribute('aria-label', label.replace(/\s+/g, ' '));
        }
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { attributes: true, attributeFilter: ['title'], childList: true, subtree: true });
    document.addEventListener('mouseover', (event) => {
      const target = targetForEvent(event);
      if (target) show(target); else hide();
    });
    document.addEventListener('mouseout', (event) => {
      if (!activeTarget || event.target !== activeTarget) return;
      const related = event.relatedTarget;
      if (!(related instanceof Node) || !activeTarget.contains(related)) hide();
    });
    document.addEventListener('focusin', (event) => {
      const target = targetForEvent(event);
      if (target) show(target);
    });
    document.addEventListener('focusout', (event) => {
      if (activeTarget && event.target === activeTarget) hide();
    });
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('blur', hide);
  }
  installCustomTooltips();

  /** 时间线最多渲染的行数：超出时只显示最新的这一数量，统计数据仍按全部行计算。 */
  const MAX_VISIBLE_ROWS = 300;
  const statusText = {
    idle: '待命', starting: '正在启动', queued: '排队中', running: '运行中', retrying: '重试中',
    succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断',
  };

  function cleanOutput(value) {
    return String(value || '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
      .replace(/\r(?!\n)/g, '\n');
  }

  function formatDuration(value) {
    if (value === null || value === undefined) return '—';
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) return '';
    if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
    if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 2 : 1)} s`;
    return `${Math.floor(milliseconds / 60000)}m ${Math.round((milliseconds % 60000) / 1000)}s`;
  }

  function formatElapsed(milliseconds) {
    const value = Math.max(0, Number(milliseconds) || 0);
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const tenths = Math.floor((value % 1000) / 100);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  function formatRelative(ts, run) {
    if (!run.runStartedAt || !Number.isFinite(Number(ts))) return '';
    return `+${formatElapsed(Number(ts) * 1000 - run.runStartedAt)}`;
  }

  function normalizeMaterials(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && typeof item === 'object').map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || item.id || '未知材料'),
      quantity: Number.isFinite(Number(item.quantity)) && item.quantity !== null ? Number(item.quantity) : null,
      unresolved: Math.max(0, Number(item.unresolved_occurrences) || 0),
    }));
  }

  function formatQuantity(material) {
    if (material.quantity === null) return '?';
    return material.unresolved > 0 ? `${material.quantity}+?` : String(material.quantity);
  }

  function makeRun(source) {
    return {
      source,
      status: source.status || 'idle',
      rows: [],
      openRows: new Map(),
      expandedRows: new Set(),
      scrollTop: 0,
      runStartedAt: Number(source.startedAt) || null,
      runFinishedAt: null,
      runId: '',
      materialTotals: {},
      rewardBattles: new Set(),
    };
  }

  function activeRun() {
    return state.runs.get(state.activeSource) || makeRun({ id: 'default', status: 'idle' });
  }

  function sourceIdForEvent(event) {
    if (event.log_source && state.runs.has(String(event.log_source))) return String(event.log_source);
    if (event.instance_id) {
      const source = state.sources.find((item) => item.instance === String(event.instance_id));
      if (source) return source.id;
    }
    return state.activeSource;
  }

  function updateIdentity() {
    const run = activeRun();
    const source = run.source || {};
    const multi = state.sources.length > 1;
    $('workflow-name').textContent = state.descriptor
      ? (multi ? `${state.descriptor.workflow} · ${source.label || source.instance}` : state.descriptor.workflow)
      : run.rows.length > 0 ? '最近一次运行' : '尚未运行';
    $('run-meta').textContent = state.descriptor
      ? [source.label || source.instance || state.descriptor.instance, run.runId || '等待运行事件'].filter(Boolean).join(' · ')
      : '等待工作流';
  }

  function renderSourceTabs() {
    const container = $('source-tabs');
    const visible = state.sources.length > 1;
    container.classList.toggle('hidden', !visible);
    document.body.classList.toggle('has-sources', visible);
    container.innerHTML = '';
    for (const source of state.sources) {
      const run = state.runs.get(source.id);
      const button = document.createElement('button');
      button.className = `ui-button${source.id === state.activeSource ? ' active' : ''}`;
      button.dataset.sourceId = source.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(source.id === state.activeSource));
      const dot = document.createElement('span'); dot.className = `source-dot ${run ? run.status : 'idle'}`;
      const labelText = source.label || source.instance;
      const label = document.createElement('strong'); label.textContent = labelText;
      button.append(dot, label);
      button.title = [labelText, source.instance].filter(Boolean).join(' · ');
      button.addEventListener('click', () => {
        state.activeSource = source.id;
        updateIdentity();
        setStatus(activeRun().status);
        render();
      });
      container.appendChild(button);
    }
  }

  function setStatus(status, run = activeRun(), updateView = true) {
    run.status = status || 'idle';
    if (!updateView) return;
    if (run !== activeRun()) {
      renderSourceTabs();
      return;
    }
    for (const name of Object.keys(statusText)) document.body.classList.remove(`status-${name}`);
    document.body.classList.add(`status-${run.status}`);
    $('status-label').textContent = statusText[run.status] || run.status;
    renderSourceTabs();
    renderSummary();
  }

  function resetRun(descriptor) {
    state.descriptor = descriptor || null;
    state.runs = new Map();
    state.sources = descriptor && Array.isArray(descriptor.sources) && descriptor.sources.length > 0
      ? descriptor.sources.map((source) => ({ ...source, id: String(source.id) }))
      : [{
          id: 'default', label: '', workflow: descriptor && descriptor.workflow || '',
          instance: descriptor && descriptor.instance || '', startedAt: descriptor && descriptor.startedAt,
          status: descriptor && descriptor.status || 'idle',
        }];
    for (const source of state.sources) state.runs.set(source.id, makeRun(source));
    state.activeSource = state.sources[0].id;
    updateIdentity();
    renderSourceTabs();
    setStatus(activeRun().status);
  }

  function applyProcessResult(result) {
    if (!result || typeof result !== 'object') return;
    const status = result.stopped ? 'cancelled' : result.code === 0 ? 'succeeded' : 'failed';
    for (const run of state.runs.values()) {
      if (!run.runFinishedAt && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
        setStatus(status, run, false);
      }
    }
    if (status === 'failed'
      && [...state.runs.values()].every((run) => run.rows.length === 0)
      && state.engineOutput.trim()) state.view = 'engine';
  }

  function eventKey(event) {
    const step = event.step || {};
    const workflow = Array.isArray(step.workflow_path)
      ? step.workflow_path.map(String).join('>')
      : String(step.workflow_id || '');
    return `${String(event.run_id || '')}:${workflow}:${String(event.step_id || '')}:${String(step.execution_index ?? '')}`;
  }

  function semanticStepStatus(step) {
    const status = String(step.status || 'unknown');
    if (status === 'succeeded' && step.action === 'vision.match_template') return 'matched';
    if (status === 'failed' && step.error_category === 'not_matched') return 'not_matched';
    return status;
  }

  function hasOwn(value, key) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
  }

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function fileLabel(value) {
    const normalized = String(value || '').replace(/\\/g, '/');
    return normalized.split('/').filter(Boolean).pop() || normalized;
  }

  function formatNumber(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return Number.isInteger(number) ? String(number) : number.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  }

  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : '';
  }

  function formatPoint(x, y) {
    return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? `(${Math.round(Number(x))}, ${Math.round(Number(y))})` : '';
  }

  function formatRect(value) {
    if (!Array.isArray(value) || value.length < 4) return '';
    return `[${value.slice(0, 4).map((item) => Math.round(Number(item) || 0)).join(', ')}]`;
  }

  function firstMatch(row) {
    const output = Array.isArray(row.output) ? row.output : [];
    if (output[0] && typeof output[0] === 'object') return output[0];
    const match = asObject(row.params).match;
    return match && typeof match === 'object' ? match : {};
  }

  function workflowResultLabel(status) {
    return ({ succeeded: '成功', failed: '失败', cancelled: '已取消' })[String(status || '')] || '';
  }

  function describeStep(row) {
    if (row.kind === 'reward') {
      return {
        operation: '统计本局奖励',
        facts: [`识别 ${row.materials.length} 种材料`],
      };
    }

    const params = asObject(row.params);
    const output = row.output;
    const outputObject = asObject(output);
    const facts = [];
    let operation = '';

    if (row.action === 'vision.match_template' || row.action === 'vision.wait_template') {
      const match = firstMatch(row);
      const template = params.template || match.template;
      const present = params.present !== false;
      operation = row.action === 'vision.match_template'
        ? `匹配模板${template ? `：${fileLabel(template)}` : ''}`
        : `等待模板${present ? '出现' : '消失'}${template ? `：${fileLabel(template)}` : ''}`;
      if (row.action === 'vision.wait_template' && Number.isFinite(Number(params.timeout_seconds))) facts.push(`超时 ${formatNumber(params.timeout_seconds)} s`);
      if (Number.isFinite(Number(params.threshold ?? match.threshold))) facts.push(`阈值 ${formatPercent(params.threshold ?? match.threshold)}`);
      if (params.roi || match.roi) facts.push(`ROI ${formatRect(params.roi || match.roi)}`);
      if (Array.isArray(output)) facts.push(`命中 ${output.length} 个`);
      if (Number.isFinite(Number(match.confidence))) facts.push(`最高匹配 ${formatPercent(match.confidence)}`);
    } else if (row.action === 'vision.wait_any') {
      const templates = Array.isArray(params.templates) ? params.templates : [];
      operation = `等待任一模板${templates.length ? ` · ${templates.length} 个候选` : ''}`;
      if (Number.isFinite(Number(params.timeout_seconds))) facts.push(`超时 ${formatNumber(params.timeout_seconds)} s`);
      if (params.roi) facts.push(`ROI ${formatRect(params.roi)}`);
    } else if (row.action === 'input.tap' || row.action === 'input.tap_match') {
      const match = asObject(params.match);
      const point = formatPoint(outputObject.x ?? params.x, outputObject.y ?? params.y);
      const template = match.template;
      operation = row.action === 'input.tap'
        ? `点击坐标${point ? `：${point}` : ''}`
        : `点击匹配位置${template ? `：${fileLabel(template)}` : (point ? `：${point}` : '')}`;
      if (row.action === 'input.tap_match' && point && template) facts.push(`实际坐标 ${point}`);
      if (Number(outputObject.offset_x) || Number(outputObject.offset_y)) facts.push(`实际偏移 ${formatPoint(outputObject.offset_x, outputObject.offset_y)}`);
      if (Number.isFinite(Number(outputObject.interval_seconds)) && Number(outputObject.interval_seconds) > 0) facts.push(`点击前等待 ${formatNumber(outputObject.interval_seconds)} s`);
      if (Number.isFinite(Number(params.hold_ms)) && Number(params.hold_ms) > 0) facts.push(`按住 ${formatNumber(params.hold_ms)} ms`);
      if (hasOwn(outputObject, 'revalidated')) facts.push(outputObject.revalidated ? '已重新校验' : '未重新校验');
    } else if (row.action === 'core.log') {
      const message = params.message ?? outputObject.message;
      operation = `输出日志${message !== undefined ? `：${String(message)}` : ''}`;
    } else if (row.action === 'core.sleep') {
      const seconds = params.seconds ?? outputObject.seconds;
      operation = `等待${Number.isFinite(Number(seconds)) ? ` ${formatNumber(seconds)} 秒` : ''}`;
    } else if (row.action === 'core.capture') {
      operation = '截取当前屏幕';
      if (outputObject.width && outputObject.height) facts.push(`画面 ${outputObject.width} × ${outputObject.height}`);
    } else if (row.action === 'core.save_frame') {
      operation = `保存屏幕截图${params.name ? `：${params.name}` : ''}`;
      if (outputObject.path) facts.push(`已保存到 ${outputObject.path}`);
    } else if (row.action === 'core.assert') {
      operation = `检查条件${params.message ? `：${params.message}` : ''}`;
      if (hasOwn(outputObject, 'asserted')) facts.push(outputObject.asserted ? '条件成立' : '条件不成立');
    } else if (row.action === 'vision.wait_text') {
      operation = `等待文字${params.present === false ? '消失' : '出现'}${params.text ? `：“${params.text}”` : ''}`;
      if (Number.isFinite(Number(params.timeout_seconds))) facts.push(`超时 ${formatNumber(params.timeout_seconds)} s`);
      if (params.roi) facts.push(`ROI ${formatRect(params.roi)}`);
      if (Number.isFinite(Number(outputObject.matched))) facts.push(`命中 ${outputObject.matched} 处`);
    } else if (row.action === 'vision.ocr') {
      operation = '识别屏幕文字';
      if (params.roi) facts.push(`ROI ${formatRect(params.roi)}`);
      if (Array.isArray(output)) facts.push(`识别 ${output.length} 项`);
    } else if (row.action === 'stats.enqueue_reward') {
      operation = `提交奖励识别${params.layer ? `：第 ${params.layer} 层` : ''}`;
      if (params.roi) facts.push(`ROI ${formatRect(params.roi)}`);
      if (hasOwn(outputObject, 'accepted')) facts.push(outputObject.accepted ? '后台已接收' : '后台未接收');
    } else if (row.action === 'workflow.run') {
      const workflow = params.workflow || outputObject.workflow;
      operation = `运行子工作流${workflow ? `：${fileLabel(workflow).replace(/\.json$/i, '')}` : ''}`;
      if (outputObject.status) facts.push(`子工作流${workflowResultLabel(outputObject.status)}`);
    } else if (row.action === 'workflow.select' || row.action === 'workflow.sequence') {
      const workflows = Array.isArray(params.workflows) ? params.workflows : [];
      operation = row.action === 'workflow.select'
        ? `依次选择可用子工作流${workflows.length ? `：共 ${workflows.length} 个` : ''}`
        : `按顺序运行子工作流${workflows.length ? `：共 ${workflows.length} 个` : ''}`;
      if (Array.isArray(outputObject.attempts)) facts.push(`已执行 ${outputObject.attempts.length} 个`);
      if (outputObject.workflow) facts.push(`${row.action === 'workflow.select' ? '选中' : '最后执行'} ${fileLabel(outputObject.workflow).replace(/\.json$/i, '')}`);
    } else if (!row.action && row.nodeKind) {
      operation = ({
        root: '启动工作流', selector: '按顺序选择可用分支', sequence: '按顺序执行子节点',
        simple_parallel: '并行执行主任务和后台任务',
      })[row.nodeKind] || `执行 ${row.nodeKind} 节点`;
    } else {
      operation = row.action ? `执行动作：${row.action}` : '执行节点';
    }

    if (row.attempts > 1) facts.push(`尝试 ${row.attempts} 次`);
    if (row.repeats > 1) facts.push(`重复 ${row.repeats} 次`);
    if (row.decorator === 'do_once') facts.push('Do Once · 本次运行已执行过，跳过');
    return { operation, facts };
  }

  function rowStatusLabel(row) {
    if (row.kind === 'reward') return row.status === 'succeeded' ? '已统计' : '统计失败';
    return ({
      running: '运行中', succeeded: '已完成', matched: '已匹配', failed: '失败',
      not_matched: '未匹配', branch_miss: '分支跳过', cancelled: '已取消',
    })[row.status] || row.status || '未知';
  }

  function branchReason(row) {
    const source = row.recoveredByName ? `“${row.recoveredByName}”选择器` : '上级选择器';
    if (row.decorator === 'condition' || row.errorCategory === 'condition') return `节点条件不满足，${source}已转到其他分支`;
    if (row.errorCategory === 'not_matched') return `模板未达到匹配阈值，${source}已转到其他分支`;
    if (row.action === 'vision.wait_template') return `等待目标超时，${source}已转到其他分支`;
    if (row.recoveredVia) return `子工作流分支未完成，${source}已转到其他分支`;
    return `当前分支未完成，${source}已转到其他分支`;
  }

  function failureReason(row) {
    if (row.status === 'branch_miss') return branchReason(row);
    if (row.status === 'not_matched') return '模板未达到匹配阈值';
    if (row.errorCategory === 'condition') return '节点条件不满足';
    if (row.errorCategory === 'workflow_timeout') return '工作流执行超时';
    if (row.errorCategory === 'node_timeout' || row.errorCategory === 'action_timeout') return '节点执行超时';
    return row.error || '';
  }

  function formatDetailValue(value) {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return String(value);
    }
  }

  function workflowReferenceId(step) {
    const output = step && step.output;
    const reference = output && typeof output === 'object' ? String(output.workflow || '') : '';
    if (!reference) return '';
    const filename = reference.replace(/\\/g, '/').split('/').pop() || '';
    return filename.replace(/\.json$/i, '');
  }

  function recoverNestedWorkflowRows(run, parentRow, step) {
    if (step.status !== 'branch_miss' || step.action !== 'workflow.run') return;
    const parentIndex = run.rows.indexOf(parentRow);
    if (parentIndex < 0) return;
    const parentPath = Array.isArray(parentRow.workflowPath) ? parentRow.workflowPath : [];
    const referenceId = workflowReferenceId(step);
    const parentStarted = Number(step.started_at || parentRow.startedAt);
    const parentFinished = parentStarted + Math.max(0, Number(step.duration_ms) || 0) / 1000 + 0.001;
    for (let index = parentIndex + 1; index < run.rows.length; index += 1) {
      const candidate = run.rows[index];
      if (candidate.status !== 'failed' && candidate.status !== 'not_matched') continue;
      const path = Array.isArray(candidate.workflowPath) ? candidate.workflowPath : [];
      if (path.length <= parentPath.length) continue;
      if (!parentPath.every((part, pathIndex) => path[pathIndex] === part)) continue;
      if (referenceId && path[parentPath.length] !== referenceId) continue;
      if (candidate.startedAt < parentStarted || candidate.startedAt > parentFinished) continue;
      candidate.status = 'branch_miss';
      candidate.recoveredBy = String(step.recovered_by || '');
      candidate.recoveredByName = String(step.recovered_by_name || '');
      candidate.recoveredVia = String(step.step_id || parentRow.stepId || '');
    }
  }

  function acceptEvent(event, deferRender) {
    if (!event || typeof event !== 'object') return;
    const sourceId = sourceIdForEvent(event);
    const run = state.runs.get(sourceId) || activeRun();
    const updateView = !deferRender && run === activeRun();
    if (event.type === 'run_started') {
      const nextRunId = String(event.run_id || '');
      if (run.runId && nextRunId && run.runId !== nextRunId) {
        run.rows = [];
        run.openRows.clear();
        run.expandedRows.clear();
        run.scrollTop = 0;
        run.materialTotals = {};
        run.rewardBattles.clear();
      }
      run.runStartedAt = Number(event.ts) * 1000;
      run.runFinishedAt = null;
      run.runId = nextRunId;
      if (run === activeRun()) updateIdentity();
      setStatus(String(event.status || 'running'), run, updateView);
    } else if (event.type === 'run_finished') {
      run.runFinishedAt = Number(event.ts) * 1000;
      setStatus(String(event.status || 'failed'), run, updateView);
    } else if (event.type === 'reward_stats') {
      const battleIndex = Number(event.battle_index) || 0;
      const layer = Number(event.layer) || 1;
      const materials = normalizeMaterials(event.items);
      if (battleIndex > 0) run.rewardBattles.add(battleIndex);
      if (event.material_totals && typeof event.material_totals === 'object') {
        run.materialTotals = event.material_totals;
      }
      run.rows.push({
        key: `reward:${battleIndex}:${layer}:${run.rows.length}`,
        eventKey: `reward:${battleIndex}:${layer}`,
        stepId: battleIndex > 0 ? `第 ${battleIndex} 局奖励${layer > 1 ? ` · 第 ${layer} 页` : ''}` : '奖励统计',
        action: 'reward_stats',
        nodeKind: 'reward',
        kind: 'reward',
        status: String(event.status || 'succeeded'),
        startedAt: Number(event.ts),
        duration: null,
        error: event.error ? String(event.error) : '',
        thumbnail: event.screenshot || '',
        materials,
      });
    } else if (event.type === 'step' && event.step && typeof event.step === 'object') {
      const step = event.step;
      const key = eventKey(event);
      if (step.status === 'running') {
        const row = {
          key: `${key}:${run.rows.length}`,
          eventKey: key,
          stepId: String(event.step_id || ''),
          name: step.name ? String(step.name) : '',
          action: step.action ? String(step.action) : '',
          nodeKind: String(step.node_kind || step.node_type || ''),
          status: 'running',
          workflowPath: Array.isArray(step.workflow_path) ? step.workflow_path.map(String) : [],
          workflowDepth: Number(step.workflow_depth) || 0,
          startedAt: Number(step.ts || event.ts),
          duration: null,
          error: '',
          errorCategory: '',
          params: hasOwn(step, 'params') ? step.params : null,
          output: hasOwn(step, 'output') ? step.output : null,
          attempts: Number(step.attempts) || 0,
          repeats: Number(step.repeats) || 0,
          decorator: String(step.decorator || ''),
          originalStatus: String(step.original_status || ''),
          recoveredBy: String(step.recovered_by || ''),
          recoveredByName: String(step.recovered_by_name || ''),
          recoveredVia: String(step.recovered_via || ''),
          thumbnail: event.thumbnail || event.screenshot || '',
        };
        run.rows.push(row);
        run.openRows.set(key, row);
      } else {
        let row = run.openRows.get(key);
        const startedAt = Number(step.started_at);
        if (!row && step.status === 'branch_miss') {
          row = [...run.rows].reverse().find((candidate) => (
            candidate.eventKey === key
            && (candidate.status === 'failed' || candidate.status === 'not_matched' || candidate.status === 'branch_miss')
            && (!Number.isFinite(startedAt) || Math.abs(candidate.startedAt - startedAt) < 0.001)
          ));
        }
        if (!row) {
          row = {
            key: `${key}:${run.rows.length}`,
            eventKey: key,
            stepId: String(event.step_id || ''),
            name: step.name ? String(step.name) : '',
            action: step.action ? String(step.action) : '',
            nodeKind: String(step.node_kind || step.node_type || ''),
            status: semanticStepStatus(step),
            workflowPath: Array.isArray(step.workflow_path) ? step.workflow_path.map(String) : [],
            workflowDepth: Number(step.workflow_depth) || 0,
            startedAt: Number(step.started_at || event.ts),
            duration: null,
            error: '',
            errorCategory: '',
            params: null,
            output: null,
            attempts: 0,
            repeats: 0,
            decorator: '',
            originalStatus: '',
            recoveredBy: '',
            recoveredByName: '',
            recoveredVia: '',
            thumbnail: '',
          };
          run.rows.push(row);
        }
        row.status = semanticStepStatus(step);
        row.name = step.name ? String(step.name) : row.name;
        row.action = step.action ? String(step.action) : row.action;
        row.workflowPath = Array.isArray(step.workflow_path) ? step.workflow_path.map(String) : row.workflowPath;
        row.workflowDepth = Number(step.workflow_depth) || row.workflowDepth || 0;
        if (Number.isFinite(startedAt)) row.startedAt = startedAt;
        row.duration = Number.isFinite(Number(step.duration_ms)) ? Number(step.duration_ms) : null;
        row.error = step.error ? String(step.error) : '';
        row.errorCategory = step.error_category ? String(step.error_category) : '';
        if (hasOwn(step, 'params')) row.params = step.params;
        if (hasOwn(step, 'output')) row.output = step.output;
        row.attempts = Number(step.attempts) || row.attempts || 0;
        row.repeats = Number(step.repeats) || row.repeats || 0;
        row.decorator = step.decorator ? String(step.decorator) : row.decorator || '';
        row.originalStatus = step.original_status ? String(step.original_status) : row.originalStatus || '';
        row.recoveredBy = step.recovered_by ? String(step.recovered_by) : '';
        row.recoveredByName = step.recovered_by_name ? String(step.recovered_by_name) : row.recoveredByName || '';
        row.recoveredVia = step.recovered_via ? String(step.recovered_via) : row.recoveredVia || '';
        row.thumbnail = event.thumbnail || event.screenshot || row.thumbnail || '';
        recoverNestedWorkflowRows(run, row, step);
        run.openRows.delete(key);
      }
    }
    if (!deferRender) {
      renderSourceTabs();
      if (run === activeRun()) render();
    }
  }

  function renderSummary() {
    const run = activeRun();
    const completed = run.rows.filter((row) => row.kind !== 'reward' && row.action && (row.status === 'succeeded' || row.status === 'matched')).length;
    const failed = run.rows.filter((row) => row.kind !== 'reward' && (row.status === 'failed' || row.status === 'not_matched')).length;
    const current = [...run.rows].reverse().find((row) => row.status === 'running');
    // Older sessions can provide events without a run descriptor. Infer a
    // display status from the rows so the summary does not contradict itself.
    if (!state.descriptor && run.rows.length > 0) {
      const hasHardFailure = run.rows.some((row) => row.status === 'failed');
      const inferred = current ? 'running' : hasHardFailure ? 'failed' : 'succeeded';
      $('status-label').textContent = statusText[inferred];
      for (const name of Object.keys(statusText)) document.body.classList.remove(`status-${name}`);
      document.body.classList.add(`status-${inferred}`);
    }
    $('completed-count').textContent = String(completed);
    $('failed-count').textContent = String(failed);
    $('failed-count').parentElement.classList.toggle('has-failures', failed > 0);
    $('current-step').textContent = current ? (current.name || '未命名任务') : '-';
    $('current-step').parentElement.classList.toggle('hidden', !current);
    $('current-step').title = current ? (current.name || '未命名任务') : '';
    $('btn-stop').disabled = ![...state.runs.values()].some((item) => ['running', 'starting', 'queued', 'retrying'].includes(item.status));
    const end = run.runFinishedAt || Date.now();
    $('elapsed').textContent = run.runStartedAt ? formatElapsed(end - run.runStartedAt) : '00:00.0';
  }

  function renderRewardSummary() {
    const summary = $('reward-summary');
    const totals = $('reward-totals');
    const run = activeRun();
    const materials = Object.entries(run.materialTotals || {}).map(([id, item]) => ({
      id,
      name: String(item && item.name || id),
      quantity: Number.isFinite(Number(item && item.quantity)) ? Number(item.quantity) : null,
      unresolved: Math.max(0, Number(item && item.unresolved_occurrences) || 0),
    }));
    const visible = materials.length > 0;
    summary.classList.toggle('hidden', !visible);
    document.body.classList.toggle('has-rewards', visible);
    $('reward-battles').textContent = `${run.rewardBattles.size} 局`;
    totals.innerHTML = '';
    for (const material of materials) {
      const chip = document.createElement('span'); chip.className = 'reward-chip'; chip.dataset.materialId = material.id;
      const name = document.createElement('span'); name.className = 'reward-name'; name.textContent = material.name;
      const quantity = document.createElement('strong'); quantity.textContent = `×${formatQuantity(material)}`;
      chip.append(name, quantity); totals.appendChild(chip);
    }
  }

  function visibleRows() {
    const rows = activeRun().rows;
    if (state.filter === 'failed') return rows.filter((row) => row.status === 'failed' || row.status === 'not_matched');
    if (state.filter === 'tasks') return rows.filter((row) => Boolean(row.action));
    return rows;
  }

  function appendStepDetails(main, row) {
    const entries = [];
    entries.push(['节点 ID', row.stepId]);
    if (row.action) entries.push(['动作类型', row.action]);
    const description = describeStep(row);
    entries.push(['执行操作', description.operation]);
    if (description.facts.length) entries.push(['执行信息', description.facts.join(' · ')]);
    const relative = formatRelative(row.startedAt, activeRun());
    if (relative) entries.push(['开始时间', relative]);
    if (row.params !== null && row.params !== undefined) entries.push(['实际参数', row.params]);
    if (row.output !== null && row.output !== undefined) entries.push(['节点输出', row.output]);
    if (row.workflowDepth > 0 && row.workflowPath.length > 0) entries.push(['调用路径', row.workflowPath.join(' > ')]);
    if (row.errorCategory) entries.push(['错误分类', row.errorCategory]);
    if (row.recoveredByName) entries.push(['恢复来源', row.recoveredByName]);
    if (row.error) entries.push([row.status === 'branch_miss' ? '原始未完成原因' : '原始错误', row.error]);
    if (entries.length === 0) return;

    const details = document.createElement('div'); details.className = 'step-details';
    const grid = document.createElement('div'); grid.className = 'detail-grid';
    for (const [labelText, value] of entries) {
      const label = document.createElement('span'); label.className = 'detail-label'; label.textContent = labelText;
      const content = document.createElement(typeof value === 'object' && value !== null ? 'pre' : 'span');
      content.className = 'detail-value'; content.textContent = formatDetailValue(value);
      grid.append(label, content);
    }
    details.appendChild(grid);
    if (row.thumbnail) {
      const screenshot = document.createElement('button'); screenshot.type = 'button'; screenshot.className = 'ui-button screenshot-button';
      const image = document.createElement('img'); image.className = 'thumb'; image.src = row.thumbnail; image.alt = ''; image.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = '查看运行截图';
      screenshot.append(image, label); screenshot.addEventListener('click', () => openLightbox(row.thumbnail, screenshot));
      details.appendChild(screenshot);
    }
    main.appendChild(details);
  }

  function currentRowDuration(row) {
    if (row.status === 'running') return Math.max(0, Date.now() - Number(row.startedAt || 0) * 1000);
    return row.duration;
  }

  function updateRunningDurations() {
    for (const entry of state.runningDurationNodes) {
      entry.node.textContent = formatDuration(currentRowDuration(entry.row));
    }
  }

  let renderedRun = null;
  function renderSteps() {
    const list = $('step-list');
    const run = activeRun();
    if (renderedRun) {
      renderedRun.scrollTop = list.scrollTop;
      for (const item of list.children) {
        if (item.open) renderedRun.expandedRows.add(item.dataset.rowKey);
        else renderedRun.expandedRows.delete(item.dataset.rowKey);
      }
    }
    const focusedRow = renderedRun === run ? document.activeElement?.closest('.step-row')?.dataset.rowKey : null;
    renderedRun = run;
    list.innerHTML = '';
    state.runningDurationNodes = [];
    const all = visibleRows();
    const rows = all.length > MAX_VISIBLE_ROWS ? all.slice(all.length - MAX_VISIBLE_ROWS) : all;
    $('empty-state').classList.toggle('hidden', rows.length > 0);
    const capNote = $('cap-note');
    capNote.textContent = all.length > MAX_VISIBLE_ROWS ? `最近 ${MAX_VISIBLE_ROWS} / ${all.length} 条` : `${all.length} 条`;
    capNote.title = all.length > MAX_VISIBLE_ROWS ? `仅展示最近 ${MAX_VISIBLE_ROWS} 条，统计包含全部步骤` : '当前筛选下的步骤数量';
    for (const row of rows) {
      const item = document.createElement('details');
      item.className = `step-row ${row.status}`;
      if (row.kind === 'reward') item.classList.add('reward');
      item.dataset.stepId = row.stepId;
      item.dataset.rowKey = row.key;
      item.open = run.expandedRows.has(row.key);
      item.addEventListener('toggle', () => {
        // Ignore delayed toggle events from a row replaced by a live update.
        if (!item.isConnected) return;
        if (item.open) run.expandedRows.add(row.key); else run.expandedRows.delete(row.key);
      });
      const overview = document.createElement('summary'); overview.className = 'step-overview';
      const dot = document.createElement('span'); dot.className = 'step-dot'; dot.setAttribute('aria-hidden', 'true');
      const title = document.createElement('strong'); title.className = 'step-title';
      title.textContent = row.name || (row.kind === 'reward' ? row.stepId : '未命名任务'); title.title = title.textContent;
      overview.append(dot, title);
      const description = describeStep(row);
      const context = document.createElement('span'); context.className = 'step-context';
      const operation = document.createElement('span'); operation.className = 'step-operation'; operation.textContent = description.operation; operation.title = description.operation; context.appendChild(operation);
      // Keep outcomes in the overview; configuration and timing stay in details.
      const highlights = description.facts.filter(fact => /^(命中|最高匹配|实际坐标|尝试|重复|子工作流|识别)/.test(fact)).slice(0, 2);
      if (highlights.length > 0) {
        const facts = document.createElement('span'); facts.className = 'step-facts';
        for (const factText of highlights) {
          const fact = document.createElement('span'); fact.textContent = factText; facts.appendChild(fact);
        }
        context.appendChild(facts);
      }
      if (row.thumbnail) {
        const attachment = document.createElement('span'); attachment.className = 'step-attachment'; attachment.textContent = '含截图';
        context.appendChild(attachment);
      }
      overview.appendChild(context);
      if (row.kind === 'reward') {
        const materials = document.createElement('span'); materials.className = 'step-materials';
        materials.textContent = row.materials.length > 0
          ? row.materials.map((material) => `${material.name} ×${formatQuantity(material)}`).join(' · ')
          : '未识别到材料';
        overview.appendChild(materials);
      }
      const reasonText = failureReason(row);
      if (reasonText) {
        const reason = document.createElement('span');
        reason.className = row.status === 'branch_miss' ? 'step-note' : 'step-error';
        reason.textContent = `${row.status === 'branch_miss' ? '跳过原因' : '失败原因'}：${reasonText}`;
        overview.appendChild(reason);
      }
      const side = document.createElement('span'); side.className = 'step-side';
      const rowStatus = document.createElement('span'); rowStatus.className = 'row-status'; rowStatus.textContent = rowStatusLabel(row); side.appendChild(rowStatus);
      const duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = formatDuration(currentRowDuration(row)); duration.title = '节点耗时'; side.appendChild(duration);
      if (row.status === 'running') state.runningDurationNodes.push({ node: duration, row });
      const chevron = document.createElement('span'); chevron.className = 'step-chevron'; chevron.textContent = '›'; chevron.setAttribute('aria-hidden', 'true');
      overview.append(side, chevron);
      item.appendChild(overview);
      appendStepDetails(item, row);
      list.appendChild(item);
      if (row.key === focusedRow) overview.focus({ preventScroll: true });
    }
    updateRunningDurations();
    if ($('auto-scroll').checked && !focusedRow && rows.length > 0) {
      const current = list.lastElementChild;
      list.scrollTop = current && current.clientHeight > list.clientHeight
        ? Math.max(0, current.offsetTop - list.offsetTop)
        : list.scrollHeight;
    } else list.scrollTop = run.scrollTop;
  }

  function render() {
    renderSummary();
    renderRewardSummary();
    renderSteps();
    $('engine-output').textContent = cleanOutput(state.engineOutput);
    $('steps-view').classList.toggle('hidden', state.view !== 'steps');
    $('engine-view').classList.toggle('hidden', state.view !== 'engine');
    $('tab-steps').classList.toggle('active', state.view === 'steps');
    $('tab-engine').classList.toggle('active', state.view === 'engine');
    $('tab-steps').setAttribute('aria-selected', String(state.view === 'steps'));
    $('tab-engine').setAttribute('aria-selected', String(state.view === 'engine'));
    $('filters').classList.toggle('hidden', state.view !== 'steps');
    $('cap-note').classList.toggle('hidden', state.view !== 'steps');
    if (state.view === 'engine' && $('auto-scroll').checked) $('engine-view').scrollTop = $('engine-view').scrollHeight;
  }

  let lightboxTrigger = null;
  function openLightbox(source, trigger) {
    lightboxTrigger = trigger;
    $('lightbox-image').src = source;
    $('lightbox').classList.remove('hidden');
    $('lightbox-close').focus();
  }

  function closeLightbox() { $('lightbox').classList.add('hidden'); if (lightboxTrigger?.isConnected) lightboxTrigger.focus(); }

  $('step-list').addEventListener('scroll', () => { activeRun().scrollTop = $('step-list').scrollTop; });
  $('auto-scroll').addEventListener('change', () => { if ($('auto-scroll').checked) render(); });
  document.addEventListener('keydown', event => {
    if ($('lightbox').classList.contains('hidden')) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'Tab') { event.preventDefault(); $('lightbox-close').focus(); }
  });

  $('tab-steps').addEventListener('click', () => {
    state.view = 'steps';
    try { window.localStorage.setItem('onmyoji-studio.runtime-log-view', 'steps'); } catch { /* ignore */ }
    render();
  });
  $('tab-engine').addEventListener('click', () => {
    state.view = 'engine';
    try { window.localStorage.setItem('onmyoji-studio.runtime-log-view', 'engine'); } catch { /* ignore */ }
    render();
  });
  $('btn-stop').addEventListener('click', () => desktopHost.postMessage({ type: 'stopWorkflow' }));
  $('btn-clear').addEventListener('click', () => desktopHost.postMessage({ type: 'clear' }));
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (event) => { if (event.target === $('lightbox')) closeLightbox(); });
  for (const button of document.querySelectorAll('#filters button')) {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter || 'tasks';
      for (const item of document.querySelectorAll('#filters button')) {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      }
      renderSteps();
    });
  }

  for (const tablist of document.querySelectorAll('[role="tablist"]')) {
    tablist.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(event.target);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      // Source tabs are regenerated by the click handler.
      tablist.querySelectorAll('[role="tab"]')[next]?.focus();
    });
  }

  window.addEventListener('message', (message) => {
    const data = message.data || {};
    if (data.type === 'init') {
      resetRun(data.descriptor);
      state.engineOutput = String(data.engineOutput || '');
      for (const event of Array.isArray(data.events) ? data.events : []) acceptEvent(event, true);
      applyProcessResult(data.processResult);
      updateIdentity();
      renderSourceTabs();
      setStatus(activeRun().status);
      render();
    } else if (data.type === 'runEvent') {
      acceptEvent(data.event, false);
    } else if (data.type === 'engineOutput') {
      state.engineOutput += String(data.chunk || '');
      if (state.engineOutput.length > 300000) state.engineOutput = state.engineOutput.slice(-300000);
      if (state.view === 'engine') render();
    } else if (data.type === 'processFinished') {
      applyProcessResult(data);
      setStatus(activeRun().status);
      render();
    } else if (data.type === 'cleared') {
      resetRun(null); state.engineOutput = ''; render();
    }
  });

  setInterval(() => {
    const status = activeRun().status;
    if (status === 'running' || status === 'starting' || status === 'queued') {
      renderSummary();
      updateRunningDurations();
    }
  }, 100);
  desktopHost.postMessage({ type: 'ready' });
  window.__runLog = { state, acceptEvent, render, cleanOutput };
}());
