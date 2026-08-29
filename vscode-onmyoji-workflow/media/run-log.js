(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const state = {
    descriptor: null,
    status: 'idle',
    rows: [],
    openRows: new Map(),
    engineOutput: '',
    filter: 'tasks',
    view: 'steps',
    runStartedAt: null,
    runFinishedAt: null,
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

  function formatRelative(ts) {
    if (!state.runStartedAt || !Number.isFinite(Number(ts))) return '';
    return `+${formatElapsed(Number(ts) * 1000 - state.runStartedAt)}`;
  }

  function setStatus(status) {
    state.status = status || 'idle';
    for (const name of Object.keys(statusText)) document.body.classList.remove(`status-${name}`);
    document.body.classList.add(`status-${state.status}`);
    $('status-label').textContent = statusText[state.status] || state.status;
    renderSummary();
  }

  function resetRun(descriptor) {
    state.descriptor = descriptor || null;
    state.rows = [];
    state.openRows.clear();
    state.runStartedAt = descriptor && Number(descriptor.startedAt) || null;
    state.runFinishedAt = null;
    $('workflow-name').textContent = descriptor && descriptor.workflow || '尚未运行';
    $('run-meta').textContent = descriptor ? `${descriptor.instance} · 等待运行事件` : '等待工作流';
    setStatus(descriptor && descriptor.status || 'idle');
  }

  function eventKey(event) {
    const step = event.step || {};
    return `${String(event.step_id || '')}:${String(step.execution_index ?? '')}`;
  }

  function acceptEvent(event, deferRender) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'run_started') {
      state.runStartedAt = Number(event.ts) * 1000;
      state.runFinishedAt = null;
      $('run-meta').textContent = [event.instance_id, event.run_id].filter(Boolean).join(' · ');
      setStatus(String(event.status || 'running'));
    } else if (event.type === 'run_finished') {
      state.runFinishedAt = Number(event.ts) * 1000;
      setStatus(String(event.status || 'failed'));
    } else if (event.type === 'step' && event.step && typeof event.step === 'object') {
      const step = event.step;
      const key = eventKey(event);
      if (step.status === 'running') {
        const row = {
          key: `${key}:${state.rows.length}`,
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
        state.rows.push(row);
        state.openRows.set(key, row);
      } else {
        let row = state.openRows.get(key);
        if (!row) {
          row = {
            key: `${key}:${state.rows.length}`,
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
          state.rows.push(row);
        }
        row.status = String(step.status || 'unknown');
        row.duration = Number.isFinite(Number(step.duration_ms)) ? Number(step.duration_ms) : null;
        row.error = step.error ? String(step.error) : '';
        row.thumbnail = event.thumbnail || event.screenshot || row.thumbnail || '';
        state.openRows.delete(key);
      }
    }
    if (!deferRender) render();
  }

  function renderSummary() {
    const completed = state.rows.filter((row) => row.action && row.status === 'succeeded').length;
    const failed = state.rows.filter((row) => row.status === 'failed').length;
    const current = [...state.rows].reverse().find((row) => row.status === 'running');
    $('completed-count').textContent = String(completed);
    $('failed-count').textContent = String(failed);
    $('current-step').textContent = current ? current.stepId : '-';
    const end = state.runFinishedAt || Date.now();
    $('elapsed').textContent = state.runStartedAt ? formatElapsed(end - state.runStartedAt) : '00:00.0';
  }

  function visibleRows() {
    if (state.filter === 'failed') return state.rows.filter((row) => row.status === 'failed');
    if (state.filter === 'tasks') return state.rows.filter((row) => Boolean(row.action));
    return state.rows;
  }

  function renderSteps() {
    const list = $('step-list');
    list.innerHTML = '';
    const rows = visibleRows();
    $('empty-state').classList.toggle('hidden', rows.length > 0);
    for (const row of rows) {
      const item = document.createElement('article');
      item.className = `step-row ${row.status}`;
      item.dataset.stepId = row.stepId;

      const rail = document.createElement('div');
      rail.className = 'step-rail';
      const dot = document.createElement('span'); dot.className = 'step-dot'; rail.appendChild(dot);

      const main = document.createElement('div'); main.className = 'step-main';
      const title = document.createElement('div'); title.className = 'step-title';
      const strong = document.createElement('strong'); strong.textContent = row.stepId || '(unknown)'; title.appendChild(strong);
      const action = document.createElement('span'); action.className = 'step-action'; action.textContent = row.action || row.nodeKind; title.appendChild(action);
      main.appendChild(title);
      if (row.error) { const error = document.createElement('div'); error.className = 'step-error'; error.textContent = row.error; main.appendChild(error); }
      const time = document.createElement('div'); time.className = 'step-time'; time.textContent = formatRelative(row.startedAt); main.appendChild(time);

      const side = document.createElement('div'); side.className = 'step-side';
      const duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = row.status === 'running' ? '运行中' : formatDuration(row.duration); side.appendChild(duration);
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
      if (data.processResult && data.processResult.stopped) setStatus('cancelled');
      render();
    } else if (data.type === 'runEvent') {
      acceptEvent(data.event, false);
    } else if (data.type === 'engineOutput') {
      state.engineOutput += String(data.chunk || '');
      if (state.engineOutput.length > 300000) state.engineOutput = state.engineOutput.slice(-300000);
      if (state.view === 'engine') render();
    } else if (data.type === 'processFinished') {
      if (data.stopped) setStatus('cancelled');
      else if (!state.runFinishedAt && data.code !== 0) setStatus('failed');
      render();
    } else if (data.type === 'cleared') {
      resetRun(null); state.engineOutput = ''; render();
    }
  });

  setInterval(() => {
    if (state.status === 'running' || state.status === 'starting' || state.status === 'queued') renderSummary();
  }, 100);
  vscode.postMessage({ type: 'ready' });
  window.__runLog = { state, acceptEvent, render, cleanOutput };
}());

