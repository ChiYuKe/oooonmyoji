/*
 * 模板即时检查弹层：抓取当前画面并展示模板匹配结果与 ROI 框。
 * 主文件通过 window.StudioEditorTemplateCheck({ state, $, el, nodeById, catalogByName, clone, vscode, toast }) 注入依赖。
 */
(() => {
  'use strict';

  window.StudioEditorTemplateCheck = function StudioEditorTemplateCheck(deps) {
    const { state, $, el, nodeById, catalogByName, clone, vscode, toast } = deps;

    function templateCheckParam(node, name, fallback) {
      const definition = catalogByName(node.action)?.parameters?.[name] || {};
      let value = Object.prototype.hasOwnProperty.call(node.params || {}, name)
        ? node.params[name]
        : definition.default !== undefined ? clone(definition.default) : fallback;
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string') {
        const prefix = 'inputs.';
        if (value.ref.startsWith(prefix)) {
          const entry = state.raw.inputs && state.raw.inputs[value.ref.slice(prefix.length)];
          if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'default')) value = entry.default;
          else if (entry !== undefined && (typeof entry !== 'object' || entry === null)) value = entry;
          else throw new Error(`${name} 引用没有可用的默认值`);
        } else {
          throw new Error(`${name} 使用了运行时引用，无法即时检查`);
        }
      }
      return value;
    }

    function requestTemplateCheck(nodeId) {
      const node = nodeById(nodeId);
      if (!node) return;
      try {
        const template = templateCheckParam(node, 'template', '');
        const roi = templateCheckParam(node, 'roi', null);
        const threshold = Number(templateCheckParam(node, 'threshold', 0.85));
        const maxResults = Number(templateCheckParam(node, 'max_results', 20));
        const scaleSearch = Boolean(templateCheckParam(node, 'scale_search', false));
        if (typeof template !== 'string' || !template.trim()) throw new Error('请先选择模板图片');
        if (roi !== null && (!Array.isArray(roi) || roi.length !== 4 || !roi.every((value) => Number.isInteger(value)))) throw new Error('ROI 必须是 [x, y, width, height]');
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('匹配阈值必须在 0 到 1 之间');
        if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('最大匹配数必须为正整数');
        const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        state.templateCheck = { requestId, nodeId, template: template.trim(), threshold, status: 'loading', result: null, error: '' };
        $('template-check').classList.remove('hidden');
        renderTemplateCheck();
        vscode.postMessage({
          type: 'checkTemplate',
          requestId,
          nodeId,
          template: template.trim(),
          roi,
          threshold,
          maxResults,
          scaleSearch,
          instanceId: state.instanceId,
          referenceResolution: state.raw.resolution || [1920, 1080],
        });
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      }
    }

    function closeTemplateCheck() {
      const overlay = $('template-check');
      if (overlay) overlay.classList.add('hidden');
      state.templateCheck = null;
    }

    function templateCheckBox(className, rect, width, height, label) {
      const box = el('div', className);
      box.style.left = `${Math.max(0, rect[0]) / width * 100}%`;
      box.style.top = `${Math.max(0, rect[1]) / height * 100}%`;
      box.style.width = `${Math.max(0, Math.min(width - rect[0], rect[2])) / width * 100}%`;
      box.style.height = `${Math.max(0, Math.min(height - rect[1], rect[3])) / height * 100}%`;
      box.appendChild(el('span', 'template-check-box-label', label));
      return box;
    }

    function renderTemplateCheck() {
      const check = state.templateCheck;
      const overlay = $('template-check');
      if (!check || !overlay) return;
      overlay.innerHTML = '';
      const dialog = el('div', 'template-check-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '模板检查');
      const head = el('div', 'template-check-head');
      const heading = el('div', 'template-check-heading'); heading.appendChild(el('strong', '', '模板检查')); heading.appendChild(el('span', '', check.template));
      const headActions = el('div', 'template-check-head-actions');
      if (check.status !== 'loading') {
        const refresh = el('button', 'icon-button', '↻'); refresh.title = '重新检查'; refresh.setAttribute('aria-label', '重新检查'); refresh.addEventListener('click', () => requestTemplateCheck(check.nodeId)); headActions.appendChild(refresh);
      }
      const close = el('button', 'icon-button', '×'); close.title = '关闭'; close.setAttribute('aria-label', '关闭'); close.addEventListener('click', closeTemplateCheck); headActions.appendChild(close);
      head.appendChild(heading); head.appendChild(headActions); dialog.appendChild(head);

      if (check.status === 'loading') {
        dialog.appendChild(el('div', 'template-check-status', '正在获取当前画面并匹配…'));
        overlay.appendChild(dialog);
        return;
      }
      if (check.status === 'error') {
        const status = el('div', 'template-check-status error', check.error || '模板检查失败'); dialog.appendChild(status);
        overlay.appendChild(dialog);
        return;
      }

      const result = check.result;
      const matches = Array.isArray(result.matches) ? result.matches : [];
      const summary = el('div', 'template-check-summary');
      summary.appendChild(el('span', 'template-check-chip roi', result.roi[0] === 0 && result.roi[1] === 0 && result.roi[2] === result.width && result.roi[3] === result.height ? '全画面 ROI' : 'ROI'));
      summary.appendChild(el('span', 'template-check-chip', `阈值 ${check.threshold.toFixed(3)}`));
      summary.appendChild(el('span', `template-check-chip ${matches.length ? 'matched' : 'missed'}`, `命中 ${matches.length}`));
      if (matches.length) summary.appendChild(el('span', 'template-check-chip matched', `最高 ${Math.max(...matches.map((item) => item.confidence)).toFixed(3)}`));
      dialog.appendChild(summary);

      const viewport = el('div', 'template-check-viewport');
      const stage = el('div', 'template-check-stage'); stage.style.aspectRatio = `${result.width} / ${result.height}`;
      const image = el('img'); image.src = result.dataUrl; image.alt = '当前实例画面'; stage.appendChild(image);
      stage.appendChild(templateCheckBox('template-check-roi', result.roi, result.width, result.height, 'ROI'));
      matches.forEach((match, index) => stage.appendChild(templateCheckBox(
        'template-check-match',
        [match.x, match.y, match.width, match.height],
        result.width,
        result.height,
        `${index + 1}  ${match.confidence.toFixed(3)}`,
      )));
      viewport.appendChild(stage); dialog.appendChild(viewport);
      const message = matches.length
        ? `找到 ${matches.length} 个达到阈值的匹配结果`
        : `未找到达到阈值 ${check.threshold.toFixed(3)} 的匹配结果`;
      dialog.appendChild(el('div', `template-check-footer ${matches.length ? 'matched' : 'missed'}`, message));
      overlay.appendChild(dialog);
    }

    return { requestTemplateCheck, closeTemplateCheck, renderTemplateCheck };
  };
})();
