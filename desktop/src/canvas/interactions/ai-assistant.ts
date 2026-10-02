import type { CanvasBridge } from '../bridge';
import type { CanvasState } from '../state/canvas-state';
import { documentText } from '../state/document-text';
import { type AiSuggestionResult } from '../../shared/ai-assistant';
import { aiWorkflowContext } from '../../shared/ai-context';
import { editingDialog, editingElement as el } from '../ui/editing-dialog';
import { nodeDisplayTitle } from '../model/node-title';

export function createCardAiAssistant(deps: {
  state: CanvasState; bridge: CanvasBridge;
  nodeById(id: string): any;
  rename(node: any, name: string): void;
  toast(message: string, error?: boolean): void;
}) {
  const { state, bridge } = deps;
  let pending: { id: string; timer: ReturnType<typeof setTimeout>; receive(message: Record<string, unknown>): void } | undefined;
  function forget() { if (pending) clearTimeout(pending.timer); pending = undefined; }
  bridge.subscribe(message => {
    if (message.type !== 'aiSuggestionsResult' || message.requestId !== pending?.id) return;
    const request = pending!; forget(); request.receive(message);
  });

  function open(node: any): void {
    forget();
    const uri = state.docUri, raw = state.raw, snapshot = documentText(state);
    const { dialog, overlay, close } = editingDialog('AI 卡片建议');
    overlay.classList.add('ai-card-overlay');
    dialog.classList.add('ai-card-dialog');
    dialog.querySelector('.editing-dialog-head strong')?.prepend(el('span', 'ai-card-mark', '✦'));
    const context = el('div', 'ai-card-context');
    const cardName = el('strong', 'ai-card-context-name', nodeDisplayTitle(node)); cardName.title = nodeDisplayTitle(node);
    context.append(el('span', 'ai-card-eyebrow', '当前卡片'), cardName);
    const scope = el('details', 'ai-card-scope');
    const scopeSummary = el('summary');
    const scopeControls = el('div', 'ai-card-scope-controls');
    const rangeLabel = el('label', '', '上下游各 ');
    const range = el('select', 'ui-input'); range.setAttribute('aria-label', '上下游节点数量');
    for (const value of [0, 1, 3, 5]) { const option = el('option', '', `${value} 个节点`); option.value = String(value); range.append(option); }
    range.value = '3'; rangeLabel.append(range);
    const imageLabel = el('label', 'ai-card-image-toggle');
    const includeImages = el('input'); includeImages.type = 'checkbox'; includeImages.checked = true;
    imageLabel.append(includeImages, document.createTextNode('附带模板图片'));
    scopeControls.append(rangeLabel, imageLabel);
    const scopeContent = el('div', 'ai-card-scope-content');
    scope.append(scopeSummary, scopeControls, scopeContent);
    function collectContext() { return aiWorkflowContext(state.raw, node, state.catalog, Number(range.value)); }
    function renderScope() {
      scopeContent.textContent = '';
      try {
        const bundle = collectContext();
        scopeSummary.textContent = `本次参考：上游 ${bundle.upstream.length} · 下游 ${bundle.downstream.length} · 图片 ${includeImages.checked ? bundle.templates.length : 0}`;
        for (const [title, nodes] of [['上游', bundle.upstream], ['下游', bundle.downstream]] as const) {
          scopeContent.append(el('p', 'ai-card-neighbors', `${title}：${nodes.length ? nodes.map(item => nodeDisplayTitle(item)).join('、') : '无相连节点'}`));
        }
        if (includeImages.checked && bundle.templates.length) {
          const images = el('div', 'ai-card-images');
          for (const template of bundle.templates) {
            const figure = el('figure');
            if (state.assetsBaseUri) {
              const image = el('img'); image.alt = template.path; image.loading = 'lazy';
              image.src = state.assetsBaseUri + template.path.split('/').slice(1).map(encodeURIComponent).join('/');
              figure.append(image);
            }
            const caption = el('figcaption', '', template.path); caption.title = `${template.path} · ${template.nodeIds.join(', ')}`;
            figure.append(caption); images.append(figure);
          }
          scopeContent.append(images);
        }
        scopeContent.append(el('p', 'ai-card-scope-note', includeImages.checked
          ? `点击获取后，将这些节点与最多 6 张模板图片发送至已配置的 AI 服务。需使用支持图片的模型。${bundle.omittedTemplateCount ? `另有 ${bundle.omittedTemplateCount} 张图片未附带。` : ''}`
          : '点击获取后，仅发送这些节点的文字信息与模板路径。'));
      } catch (error) { scopeSummary.textContent = '参考范围需要调整'; scopeContent.append(el('p', '', (error as Error).message)); }
    }
    range.addEventListener('change', renderScope); includeImages.addEventListener('change', renderScope); renderScope();
    const modes = el('div', 'ai-card-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '建议类型');
    let mode: 'name' | 'advice' = 'name';
    let selectedName = '';
    let busy = false;
    const modeButtons: HTMLButtonElement[] = [];
    const description = el('p', 'ai-card-description');
    const field = el('label', 'ai-card-field');
    const caption = el('span', 'ai-card-field-caption', '补充要求'); caption.append(el('span', '', '可选'));
    const instruction = el('textarea', 'ui-input ai-card-instruction'); instruction.rows = 3; instruction.maxLength = 1000;
    instruction.setAttribute('aria-label', '建议要求'); field.append(caption, instruction);
    const presets = el('div', 'ai-card-presets'); presets.setAttribute('aria-label', '常用要求');
    const controls = el('div', 'ai-card-controls');
    const shortcut = el('span', 'ai-card-shortcut', 'Ctrl + Enter 生成');
    const generate = el('button', 'ai-card-primary', '获取建议'); generate.type = 'button';
    controls.append(shortcut, generate);
    const feedback = el('p', 'ai-card-feedback'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
    const results = el('div', 'ai-card-results'); results.setAttribute('aria-live', 'polite'); results.hidden = true;
    const applyRow = el('div', 'ai-card-apply'); applyRow.hidden = true;
    const selectionHint = el('span', 'ai-card-selection-hint', '选择一个名称');
    const apply = el('button', 'ai-card-primary', '应用名称'); apply.type = 'button'; apply.disabled = true;
    applyRow.append(selectionHint, apply);
    const footer = el('div', 'ai-card-footer');
    const settings = el('button', 'ai-card-settings', 'AI 设置'); settings.type = 'button';
    settings.addEventListener('click', () => { forget(); close(); bridge.post({ type: 'openAiSettings' }); });
    footer.append(el('span', '', '按需发送所列节点与勾选的图片 · 可能消耗 API 额度'), settings);
    function status(text: string, kind: 'error' | 'pending' | 'success' = 'error') {
      feedback.textContent = text; feedback.hidden = !text; feedback.dataset.kind = kind;
    }
    function setBusy(value: boolean) {
      busy = value; generate.disabled = value; instruction.disabled = value;
      range.disabled = value; includeImages.disabled = value;
      modeButtons.forEach(button => { button.disabled = value; });
      presets.querySelectorAll('button').forEach(button => { button.disabled = value; });
      generate.textContent = value ? '正在生成…' : '获取建议';
      generate.classList.toggle('is-loading', value);
      results.setAttribute('aria-busy', String(value));
    }
    function resetResults() { selectedName = ''; results.textContent = ''; results.hidden = true; applyRow.hidden = true; apply.disabled = true; selectionHint.textContent = '选择一个名称'; }
    function renderMode() {
      modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
      description.textContent = mode === 'name' ? '结合模板画面与前后流程生成名称，选择后再应用。' : '结合模板画面与前后流程，梳理动作与参数建议。';
      instruction.placeholder = mode === 'name' ? '例如：控制在 12 字以内，突出等待目标' : '例如：希望更快识别按钮，超时后继续执行';
      presets.textContent = '';
      const choices = mode === 'name'
        ? [['简短明确', '名称简短明确，控制在 12 字以内'], ['突出目标', '名称突出识别或操作的目标'], ['体现操作', '名称清楚体现正在执行的操作']]
        : [['检查参数', '检查现有参数是否合理，指出需要调整的项目'], ['处理超时', '说明如何处理识别失败或超时'], ['优化流程', '给出当前卡片在流程中的使用建议']];
      for (const [title, text] of choices) {
        const chip = el('button', 'ai-card-preset', title); chip.type = 'button';
        chip.addEventListener('click', () => {
          const value = instruction.value.trim();
          if (!value.includes(text)) instruction.value = (value ? `${value}；${text}` : text).slice(0, instruction.maxLength);
          instruction.focus();
        }); presets.append(chip);
      }
    }
    for (const [value, title] of [['name', '命名候选'], ['advice', '动作与参数']] as const) {
      const button = el('button', 'ai-card-mode', title); button.type = 'button'; button.dataset.mode = value;
      button.addEventListener('click', () => { if (mode === value || busy) return; mode = value; resetResults(); status(''); renderMode(); });
      modes.append(button); modeButtons.push(button);
    }
    renderMode();
    const current = () => state.docUri === uri && state.raw === raw && documentText(state) === snapshot && Boolean(deps.nodeById(node.id));
    apply.addEventListener('click', () => {
      if (!selectedName) return;
      if (!current()) { status('工作流已变化，请关闭并重新打开 AI 建议。'); apply.disabled = true; return; }
      deps.rename(deps.nodeById(node.id), selectedName); close(); deps.toast('已应用 AI 命名，可用 Ctrl+Z 撤销');
    });
    function receive(message: Record<string, unknown>) {
      if (!overlay.isConnected) return;
      setBusy(false);
      if (message.error) { status(String(message.error)); return; }
      const value = message.result as AiSuggestionResult;
      if (!current()) { status('工作流已变化，请关闭并重新打开 AI 建议。'); return; }
      results.append(el('span', 'ai-card-result-heading', mode === 'name' ? '选择一个名称' : '参考建议'));
      results.hidden = false;
      const candidates: HTMLButtonElement[] = [];
      if (mode === 'name' && Array.isArray(value?.names)) for (const name of value.names) {
        if (typeof name !== 'string' || !name.trim() || name.length > 80) continue;
        const choice = el('button', 'ai-card-candidate'); choice.type = 'button'; choice.title = name;
        choice.dataset.aiName = name.trim(); choice.setAttribute('aria-pressed', 'false');
        choice.append(el('span', 'ai-card-choice-indicator'), el('span', 'ai-card-choice-name', name));
        choice.addEventListener('click', () => {
          if (!current()) { status('工作流已变化，请关闭并重新打开 AI 建议。'); apply.disabled = true; return; }
          selectedName = name.trim(); candidates.forEach(item => item.setAttribute('aria-pressed', String(item === choice)));
          apply.disabled = false; selectionHint.textContent = '应用后可用 Ctrl+Z 撤销';
        });
        candidates.push(choice); results.append(choice);
      }
      applyRow.hidden = !candidates.length;
      if (mode === 'advice' && Array.isArray(value?.advice)) for (const [index, text] of value.advice.entries()) {
        if (typeof text !== 'string' || !text.trim()) continue;
        const item = el('div', 'ai-card-advice'); item.append(el('span', 'ai-card-advice-number', String(index + 1)), el('p', '', text)); results.append(item);
      }
      if (results.childElementCount === 1) { results.hidden = true; status('AI 未提供可用建议，请重新获取。'); return; }
      status(mode === 'name' ? `已生成 ${candidates.length} 个命名候选` : '建议供参考，请结合实际效果手动调整。', 'success');
    }
    generate.addEventListener('click', () => {
      if (!current()) { status('工作流已变化，请关闭并重新打开 AI 建议。'); return; }
      let bundle: ReturnType<typeof collectContext>;
      try { bundle = collectContext(); }
      catch (error) { status((error as Error).message); return; }
      forget(); resetResults(); setBusy(true); status('正在分析卡片与相关流程，请稍候…', 'pending');
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { if (pending?.id !== id) return; forget(); receive({ error: 'AI 请求超时，请稍后重试' }); }, 50000);
      pending = { id, timer, receive };
      bridge.post({ type: 'aiSuggestions', requestId: id, request: { mode, instruction: instruction.value.trim(), context: bundle.context,
        templatePaths: includeImages.checked ? bundle.templates.map(item => item.path) : [] } });
    });
    instruction.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); if (!busy) generate.click(); }
    });
    dialog.append(context, scope, modes, description, field, presets, controls, feedback, results, applyRow, footer); instruction.focus();
  }
  return { open };
}
