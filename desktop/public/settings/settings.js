(() => {
  'use strict';
  const root = document.getElementById('module-settings');
  if (!root) return;
  const tabs = [...root.querySelectorAll('[data-settings-page]')];
  function select(tab) {
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      root.querySelector(`#settings-page-${item.dataset.settingsPage}`).classList.toggle('hidden', !active);
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next]); tabs[next].focus();
    });
  });
  const choices = [...root.querySelectorAll('[name="appearance-theme"]')];
  const theme = window.StudioTheme;
  function sync(value) { choices.forEach(choice => { choice.checked = choice.value === value; }); }
  theme.subscribe(sync);
  choices.forEach(choice => choice.addEventListener('change', () => {
    if (!choice.checked) return;
    const saved = theme.set(choice.value);
    sync(theme.get());
    root.querySelector('#settings-theme-feedback').textContent = saved ? `已切换到${theme.name(theme.get())}，下次启动沿用。` : '主题保存失败，已保留原设置。';
  }));

  const shortcuts = window.StudioShortcuts;
  const shortcutList = root.querySelector('#settings-shortcuts-list');
  if (shortcuts && shortcutList) {
    setupShortcuts(shortcuts, shortcutList, root.querySelector('#settings-shortcuts-feedback'), root.querySelector('#settings-shortcuts-reset-all'));
  }

  function setupShortcuts(api, container, feedback, resetAll) {
    let recording = null;

    function labelFor(id) {
      return api.definitions.find(definition => definition.id === id)?.label || id;
    }

    function setFeedback(message) {
      if (!feedback) return;
      feedback.textContent = message || '';
    }

    function stopRecording() {
      if (!recording) return;
      recording.button.classList.remove('recording');
      recording = null;
      render();
    }

    function render() {
      if (recording) return;
      container.textContent = '';
      for (const group of api.groups) {
        const definitions = api.definitions.filter(definition => definition.group === group.id);
        if (!definitions.length) continue;
        const heading = document.createElement('h3');
        heading.className = 'settings-section-title';
        heading.textContent = group.label;
        container.appendChild(heading);
        const list = document.createElement('ul');
        list.className = 'shortcut-list';
        for (const definition of definitions) {
          const item = document.createElement('li');
          item.className = 'shortcut-row';
          item.dataset.shortcutId = definition.id;
          const action = document.createElement('span');
          action.className = 'shortcut-action';
          action.textContent = definition.label;
          const keys = document.createElement('span');
          keys.className = 'shortcut-keys';
          const current = api.format(api.get(definition.id));
          const capture = document.createElement('button');
          capture.type = 'button';
          capture.className = 'shortcut-capture';
          capture.dataset.shortcutCapture = definition.id;
          capture.textContent = current;
          capture.title = '点击后按下新的快捷键组合';
          capture.setAttribute('aria-label', `${definition.label}：${current}`);
          const reset = document.createElement('button');
          reset.type = 'button';
          reset.className = 'shortcut-reset';
          reset.dataset.shortcutReset = definition.id;
          reset.textContent = '↺';
          reset.title = '恢复默认';
          reset.disabled = !api.isCustom(definition.id);
          reset.setAttribute('aria-label', `恢复${definition.label}的默认快捷键`);
          keys.append(capture, reset);
          item.append(action, keys);
          list.appendChild(item);
        }
        container.appendChild(list);
      }
    }

    api.subscribe(() => { if (!recording) render(); });

    container.addEventListener('click', event => {
      const target = event.target;
      // 设置面板可能被移到独立窗口，跨文档用 instanceof 判断会失败。
      if (!target || typeof target.closest !== 'function') return;
      const reset = target.closest('[data-shortcut-reset]');
      if (reset) {
        api.reset(reset.dataset.shortcutReset);
        setFeedback('');
        render();
        return;
      }
      const capture = target.closest('[data-shortcut-capture]');
      if (!capture) return;
      setFeedback('');
      if (recording && recording.button === capture) { stopRecording(); return; }
      if (recording) stopRecording();
      recording = { id: capture.dataset.shortcutCapture, button: capture };
      capture.classList.add('recording');
      capture.textContent = '按下快捷键…';
    });

    container.addEventListener('keydown', event => {
      if (!recording) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { stopRecording(); return; }
      const binding = api.bindingFromEvent(event);
      if (!binding) return;
      const result = api.set(recording.id, binding);
      if (!result.ok) {
        setFeedback(result.reason === 'conflict' ? `该组合已被“${labelFor(result.conflictId)}”使用` : '无法设置该快捷键');
        return;
      }
      setFeedback('');
      stopRecording();
    });

    container.addEventListener('focusout', () => { if (recording) stopRecording(); });

    if (resetAll) {
      resetAll.addEventListener('click', () => {
        api.resetAll();
        setFeedback('');
        render();
      });
    }
  }
})();
