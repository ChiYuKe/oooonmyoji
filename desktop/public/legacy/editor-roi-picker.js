/*
 * ROI/模板截取弹层：在截图上框选区域，按模式写回 rect 或上传裁剪后的模板。
 * 主文件通过 window.StudioEditorRoiPicker({ ... }) 注入依赖。
 */
(() => {
  'use strict';

  window.StudioEditorRoiPicker = function StudioEditorRoiPicker(deps) {
    const { state, $, el, mutate, vscode, toast, nodeById, restoreAssetBrowserAfterRoi } = deps;

    function openRoiPicker(message) {
      if (!state.roi || state.roi.requestId !== message.requestId) return;
      let overlay = $('roi-picker'); overlay.innerHTML = ''; overlay.classList.remove('hidden');
      const dialog = el('div', 'roi-dialog'); const head = el('div', 'roi-head', state.roi.targetPath ? '重新截取模板' : state.roi.mode === 'asset' ? '截取模板' : '选择区域'); dialog.appendChild(head);
      const stage = el('div', 'roi-stage'); const image = el('img'); image.src = message.dataUrl; stage.appendChild(image); const selection = el('div', 'roi-selection'); stage.appendChild(selection); dialog.appendChild(stage);
      const actions = el('div', 'roi-actions'); const cancel = el('button', '', '取消'); const confirm = el('button', 'primary', '确认'); actions.appendChild(cancel); actions.appendChild(confirm); dialog.appendChild(actions); overlay.appendChild(dialog);
      const data = { x1: 0, y1: 0, x2: 0, y2: 0, dragging: false };
      const update = () => { selection.style.left = `${Math.min(data.x1, data.x2)}px`; selection.style.top = `${Math.min(data.y1, data.y2)}px`; selection.style.width = `${Math.abs(data.x2 - data.x1)}px`; selection.style.height = `${Math.abs(data.y2 - data.y1)}px`; };
      const point = (event) => { const rect = stage.getBoundingClientRect(); return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) }; };
      stage.addEventListener('mousedown', (event) => { const p = point(event); data.x1 = data.x2 = p.x; data.y1 = data.y2 = p.y; data.dragging = true; update(); });
      const move = (event) => { if (!data.dragging) return; const p = point(event); data.x2 = p.x; data.y2 = p.y; update(); };
      const up = () => { data.dragging = false; };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      cancel.addEventListener('click', () => {
        const request = state.roi;
        overlay.classList.add('hidden');
        state.roi = null;
        if (request && request.returnToAssetBrowser) restoreAssetBrowserAfterRoi();
      });
      confirm.addEventListener('click', () => {
        const rect = stage.getBoundingClientRect(); const ref = message.referenceResolution || state.raw.resolution || [1920, 1080];
        const x = Math.round(Math.min(data.x1, data.x2) * ref[0] / rect.width); const y = Math.round(Math.min(data.y1, data.y2) * ref[1] / rect.height);
        const width = Math.round(Math.abs(data.x2 - data.x1) * ref[0] / rect.width); const height = Math.round(Math.abs(data.y2 - data.y1) * ref[1] / rect.height);
        if (width < 1 || height < 1) { toast('请选择有效区域', true); return; }
        const request = state.roi; const node = nodeById(request.nodeId);
        if (request.mode === 'rect') {
          if (typeof request.applyValue === 'function') mutate(() => request.applyValue([x, y, width, height]));
          else if (node) mutate(() => { node.params[request.key] = [x, y, width, height]; });
        } else {
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          try {
            const context = canvas.getContext('2d'); context.drawImage(image, x * message.width / ref[0], y * message.height / ref[1], width * message.width / ref[0], height * message.height / ref[1], 0, 0, width, height);
            const extension = String(request.targetPath || '').slice(String(request.targetPath || '').lastIndexOf('.')).toLocaleLowerCase();
            const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
            vscode.postMessage({ type: 'saveTemplate', requestId: request.requestId, nodeId: request.nodeId, key: request.key, filename: `${request.nodeId}-${request.key}.png`, targetPath: request.targetPath, dataUrl: canvas.toDataURL(mime) });
          } catch (error) { toast(String(error), true); }
        }
        overlay.classList.add('hidden'); if (request.mode === 'rect') state.roi = null;
      });
    }

    return { openRoiPicker };
  };
})();
