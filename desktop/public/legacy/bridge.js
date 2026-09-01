(() => {
  'use strict';

  const frameMode = new URLSearchParams(window.location.search).get('mode') === 'details' ? 'details' : 'canvas';
  document.body.classList.add(`desktop-${frameMode}-mode`);

  let persistedState = {};
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      window.parent.postMessage({ source: 'legacy-editor', message }, '*');
    },
    getState() {
      return persistedState;
    },
    setState(value) {
      persistedState = value || {};
      window.parent.postMessage({ source: 'legacy-editor-state', state: persistedState }, '*');
      return persistedState;
    },
  });

  window.addEventListener('message', (event) => {
    const envelope = event.data;
    if (!envelope || envelope.source !== 'desktop-shell') return;
    const payload = envelope.payload || {};
    if (payload.type === 'desktopPing') {
      window.parent.postMessage({ source: 'legacy-editor', message: { type: 'ready' } }, '*');
      return;
    }
    if (payload.type === 'desktopControl') {
      const command = String(payload.command || '');
      const buttonByCommand = {
        back: 'btn-back', run: 'btn-run', stop: 'btn-stop', save: 'btn-save', more: 'btn-more',
      };
      const buttonId = buttonByCommand[command];
      if (buttonId) document.getElementById(buttonId)?.click();
      else if (command === 'switchWorkflow') {
        const select = document.getElementById('workflow-select');
        if (select) {
          select.value = String(payload.value || '');
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (command === 'selectInstance') {
        const select = document.getElementById('instance-select');
        if (select) {
          select.value = String(payload.value || '');
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return;
    }
    window.dispatchEvent(new MessageEvent('message', { data: payload }));
  });
})();
