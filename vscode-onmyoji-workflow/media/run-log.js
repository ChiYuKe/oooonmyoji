(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const state = {
    descriptor: null,
    sources: [],
    activeSource: 'default',
    runs: new Map(),
    engineOutput: '',
    filter: 'tasks',
    view: 'steps',
  };

  const $ = (id) => document.getElementById(id);
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
      : '尚未运行';
    $('run-meta').textContent = state.descriptor
      ? [source.instance || state.descriptor.instance, run.runId || '等待运行事件'].filter(Boolean).join(' · ')
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
      button.className = source.id === state.activeSource ? 'active' : '';
      button.dataset.sourceId = source.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(source.id === state.activeSource));
      const dot = document.createElement('span'); dot.className = `source-dot ${run ? run.status : 'idle'}`;
      const label = document.createElement('strong'); label.textContent = source.label || source.instance;
      const instance = document.createElement('span'); instance.textContent = source.instance;
      button.append(dot, label, instance);
      button.addEventListener('click', () => {
        state.activeSource = source.id;
        updateIdentity();
        renderSourceTabs();
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

  function eventKey(event) {
    const step = event.step || {};
    return `${String(event.step_id || '')}:${String(step.execution_index ?? '')}`;
  }

  function acceptEvent(event, deferRender) {
    if (!event || typeof event !== 'object') return;
    const sourceId = sourceIdForEvent(event);
    const run = state.runs.get(sourceId) || activeRun();
    const updateView = !deferRender && run === activeRun();
    if (event.type === 'run_started') {
      run.runStartedAt = Number(event.ts) * 1000;
      run.runFinishedAt = null;
      run.runId = String(event.run_id || '');
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
          action: step.action ? String(step.action) : '',
          nodeKind: String(step.node_kind || step.node_type || ''),
          status: 'running',
          startedAt: Number(step.ts || event.ts),
          duration: null,
          error: '',
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
            && (candidate.status === 'failed' || candidate.status === 'branch_miss')
            && (!Number.isFinite(startedAt) || Math.abs(candidate.startedAt - startedAt) < 0.001)
          ));
        }
        if (!row) {
          row = {
            key: `${key}:${run.rows.length}`,
            eventKey: key,
            stepId: String(event.step_id || ''),
            action: step.action ? String(step.action) : '',
            nodeKind: String(step.node_kind || step.node_type || ''),
            status: String(step.status || 'unknown'),
            startedAt: Number(step.started_at || event.ts),
            duration: null,
            error: '',
            thumbnail: '',
          };
          run.rows.push(row);
        }
        row.status = String(step.status || 'unknown');
        if (Number.isFinite(startedAt)) row.startedAt = startedAt;
        row.duration = Number.isFinite(Number(step.duration_ms)) ? Number(step.duration_ms) : null;
        row.error = step.error ? String(step.error) : '';
        row.recoveredBy = step.recovered_by ? String(step.recovered_by) : '';
        row.thumbnail = event.thumbnail || event.screenshot || row.thumbnail || '';
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
    const completed = run.rows.filter((row) => row.kind !== 'reward' && row.action && row.status === 'succeeded').length;
    const failed = run.rows.filter((row) => row.kind !== 'reward' && row.status === 'failed').length;
    const current = [...run.rows].reverse().find((row) => row.status === 'running');
    $('completed-count').textContent = String(completed);
    $('failed-count').textContent = String(failed);
    $('current-step').textContent = current ? current.stepId : '-';
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
    if (state.filter === 'failed') return rows.filter((row) => row.status === 'failed');
    if (state.filter === 'tasks') return rows.filter((row) => Boolean(row.action));
    return rows;
  }

  function renderSteps() {
    const list = $('step-list');
    list.innerHTML = '';
    const rows = visibleRows();
    $('empty-state').classList.toggle('hidden', rows.length > 0);
    for (const row of rows) {
      const item = document.createElement('article');
      item.className = `step-row ${row.status}`;
      if (row.kind === 'reward') item.classList.add('reward');
      item.dataset.stepId = row.stepId;

      const rail = document.createElement('div');
      rail.className = 'step-rail';
      const dot = document.createElement('span'); dot.className = 'step-dot'; rail.appendChild(dot);

      const main = document.createElement('div'); main.className = 'step-main';
      const title = document.createElement('div'); title.className = 'step-title';
      const strong = document.createElement('strong'); strong.textContent = row.stepId || '(unknown)'; title.appendChild(strong);
      const action = document.createElement('span'); action.className = 'step-action'; action.textContent = row.action || row.nodeKind; title.appendChild(action);
      main.appendChild(title);
      if (row.kind === 'reward') {
        const materials = document.createElement('div'); materials.className = 'step-materials';
        materials.textContent = row.materials.length > 0
          ? row.materials.map((material) => `${material.name} ×${formatQuantity(material)}`).join(' · ')
          : '未识别到材料';
        main.appendChild(materials);
      }
      if (row.error) { const error = document.createElement('div'); error.className = 'step-error'; error.textContent = row.error; main.appendChild(error); }
      const time = document.createElement('div'); time.className = 'step-time'; time.textContent = formatRelative(row.startedAt, activeRun()); main.appendChild(time);

      const side = document.createElement('div'); side.className = 'step-side';
      const duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = row.status === 'running'
        ? '运行中'
        : (row.status === 'branch_miss'
          ? '分支未命中'
          : (row.kind === 'reward' ? (row.status === 'succeeded' ? '已统计' : '统计失败') : formatDuration(row.duration)));
      side.appendChild(duration);
      if (row.thumbnail) {
        const image = document.createElement('img'); image.className = 'thumb'; image.src = row.thumbnail; image.alt = row.stepId; image.addEventListener('click', () => openLightbox(row.thumbnail)); side.appendChild(image);
      }
      item.append(rail, main, side);
      list.appendChild(item);
    }
    if ($('auto-scroll').checked && rows.length > 0) list.scrollTop = list.scrollHeight;
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
    if (state.view === 'engine' && $('auto-scroll').checked) $('engine-view').scrollTop = $('engine-view').scrollHeight;
  }

  function openLightbox(source) {
    $('lightbox-image').src = source;
    $('lightbox').classList.remove('hidden');
  }

  function closeLightbox() { $('lightbox').classList.add('hidden'); }

  $('tab-steps').addEventListener('click', () => { state.view = 'steps'; render(); });
  $('tab-engine').addEventListener('click', () => { state.view = 'engine'; render(); });
  $('btn-stop').addEventListener('click', () => vscode.postMessage({ type: 'stopWorkflow' }));
  $('btn-clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (event) => { if (event.target === $('lightbox')) closeLightbox(); });
  for (const button of document.querySelectorAll('#filters button')) {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter || 'tasks';
      for (const item of document.querySelectorAll('#filters button')) item.classList.toggle('active', item === button);
      renderSteps();
    });
  }

  window.addEventListener('message', (message) => {
    const data = message.data || {};
    if (data.type === 'init') {
      resetRun(data.descriptor);
      state.engineOutput = String(data.engineOutput || '');
      for (const event of Array.isArray(data.events) ? data.events : []) acceptEvent(event, true);
      if (data.processResult && data.processResult.stopped) {
        for (const run of state.runs.values()) setStatus('cancelled', run, false);
      }
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
      for (const run of state.runs.values()) {
        if (data.stopped) setStatus('cancelled', run, false);
        else if (!run.runFinishedAt && data.code !== 0) setStatus('failed', run, false);
      }
      setStatus(activeRun().status);
      render();
    } else if (data.type === 'cleared') {
      resetRun(null); state.engineOutput = ''; render();
    }
  });

  setInterval(() => {
    const status = activeRun().status;
    if (status === 'running' || status === 'starting' || status === 'queued') renderSummary();
  }, 100);
  vscode.postMessage({ type: 'ready' });
  window.__runLog = { state, acceptEvent, render, cleanOutput };
}());
