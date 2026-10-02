import type { CanvasBridge } from '../bridge';
import type { CanvasState } from '../state/canvas-state';
import type { CreationChoice, CreationContext } from './efficiency-tools';
import type { AiNodeCandidate, AiSuggestionResult } from '../../shared/ai-assistant';
import { aiCreationContext } from '../../shared/ai-context';
import { documentText } from '../state/document-text';
import { nodeDisplayTitle } from '../model/node-title';
import { editingElement as el } from '../ui/editing-dialog';

export function attachAiNodePicker(deps: {
  state: CanvasState; bridge: CanvasBridge; context: CreationContext; dialog: HTMLElement; overlay: HTMLElement;
  choices(): CreationChoice[]; create(choice: CreationChoice): void; close(): void;
}) {
  const { state, bridge, context, overlay } = deps;
  const uri = state.docUri, raw = state.raw, snapshot = documentText(state);
  const selectedId = state.selected.size === 1 ? [...state.selected][0] : undefined;
  const panel = el('section', 'ai-node-panel'); panel.setAttribute('aria-label', 'AI 节点推荐');
  const controls = el('div', 'ai-node-controls');
  const goal = el('input', 'ui-input'); goal.placeholder = '下一步想做什么？例如：识别成功后点击目标（可选）'; goal.maxLength = 1000; goal.setAttribute('aria-label', 'AI 节点推荐目标');
  const generate = el('button', 'ai-node-generate', '✦ AI 推荐节点'); generate.type = 'button';
  controls.append(goal, generate);
  const reference = el('details', 'ai-node-reference'); const summary = el('summary');
  const imagesLabel = el('label', 'ai-node-image-toggle'); const images = el('input'); images.type = 'checkbox'; images.checked = true;
  imagesLabel.append(images, document.createTextNode('附带模板图片（需支持图片的模型）'));
  const description = el('p', 'field-hint');
  const imageList = el('div', 'ai-card-images');
  const settings = el('button', 'ai-card-settings', 'AI 设置'); settings.type = 'button';
  settings.addEventListener('click', () => { deps.close(); bridge.post({ type: 'openAiSettings' }); });
  reference.append(summary, description, imagesLabel, imageList, settings);
  const status = el('p', 'ai-node-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const results = el('div', 'ai-node-results'); results.setAttribute('aria-live', 'polite'); results.hidden = true;
  panel.append(controls, reference, status, results);
  let pending: { id: string; timer: ReturnType<typeof setTimeout>; choices: Map<string, CreationChoice>; signatures: Map<string, string> } | undefined;
  const collect = () => aiCreationContext(state.raw, state.catalog, context, selectedId);
  const current = () => overlay.isConnected && state.docUri === uri && state.raw === raw && documentText(state) === snapshot;
  const signature = (choice: CreationChoice) => JSON.stringify([choice.id, choice.title, choice.type, choice.action, choice.params, choice.reusable]);
  const message = (text: string, error = false) => { status.textContent = text; status.hidden = !text; status.classList.toggle('editing-error', error); };
  function busy(value: boolean) { generate.disabled = value; goal.disabled = value; images.disabled = value; generate.textContent = value ? '正在推荐…' : '✦ AI 推荐节点'; }
  function forget() { if (pending) clearTimeout(pending.timer); pending = undefined; }
  try {
    const bundle = collect();
    const placement = bundle.direction === 'before' ? '创建上游' : bundle.direction === 'after' ? '创建下游' : bundle.direction === 'data-consumer' ? '连接输出' : '独立创建';
    summary.textContent = `${placement} · 参考${bundle.anchor ? `「${nodeDisplayTitle(bundle.anchor)}」` : '当前目标'} · 上游 ${bundle.upstream.length} / 下游 ${bundle.downstream.length} / 模板 ${bundle.templates.length}`;
    description.textContent = `上游：${bundle.upstream.map(node => nodeDisplayTitle(node)).join('、') || '无'}；下游：${bundle.downstream.map(node => nodeDisplayTitle(node)).join('、') || '无'}。仅点击推荐后发送这些节点、当前范围内可用节点的说明及勾选的图片。推荐不直接修改流程，可能消耗 API 额度。`;
    for (const item of bundle.templates) {
      const figure = el('figure');
      if (state.assetsBaseUri) {
        const image = el('img'); image.alt = item.path; image.loading = 'lazy'; image.src = state.assetsBaseUri + item.path.split('/').slice(1).map(encodeURIComponent).join('/'); figure.append(image);
      }
      figure.append(el('figcaption', '', item.path)); imageList.append(figure);
    }
    images.disabled = !bundle.templates.length;
  } catch (error) { summary.textContent = '参考节点不可用'; message((error as Error).message, true); generate.disabled = true; }
  const unsubscribe = bridge.subscribe(value => {
    if (value.type !== 'aiSuggestionsResult' || value.requestId !== pending?.id) return;
    const request = pending!; forget();
    if (!overlay.isConnected) return;
    busy(false);
    if (!current()) { message('工作流已变化，请重新打开选择器获取推荐。', true); return; }
    if (value.error) { message(String(value.error), true); return; }
    const result = value.result as AiSuggestionResult;
    const seen = new Set<string>();
    for (const recommendation of Array.isArray(result?.nodes) ? result.nodes.slice(0, 5) : []) {
      const choice = request.choices.get(recommendation.id);
      if (!choice || seen.has(choice.id) || typeof recommendation.reason !== 'string' || !recommendation.reason.trim() || recommendation.reason.length > 1000) continue;
      const latest = deps.choices().find(item => item.id === choice.id);
      if (!latest || signature(latest) !== request.signatures.get(choice.id)) continue;
      seen.add(choice.id);
      const row = el('div', 'ai-node-result'); const copy = el('div');
      copy.append(el('strong', '', `${seen.size === 1 ? '首选 · ' : ''}${choice.title}`), el('p', '', recommendation.reason));
      const apply = el('button', '', context.connection || context.reference ? '创建并连接' : '创建节点'); apply.type = 'button'; apply.dataset.aiChoice = choice.id;
      apply.addEventListener('click', () => {
        if (!current()) { message('工作流已变化，请重新打开选择器获取推荐。', true); return; }
        const available = deps.choices().find(item => item.id === choice.id);
        if (!available || signature(available) !== request.signatures.get(choice.id)) { message('此候选已变化或不再兼容，请重新获取推荐。', true); apply.disabled = true; return; }
        deps.create(available);
      });
      row.append(copy, apply); results.append(row);
    }
    results.hidden = !seen.size;
    message(seen.size ? `已推荐 ${seen.size} 个兼容节点，点击创建后可用 Ctrl+Z 撤销。` : 'AI 未推荐可用节点，请补充下一步目标后重试。', !seen.size);
  });
  generate.addEventListener('click', () => {
    if (!current()) { message('工作流已变化，请重新打开选择器获取推荐。', true); return; }
    try {
      const bundle = collect(), choices = deps.choices();
      const candidates: AiNodeCandidate[] = choices.map(choice => ({ id: choice.id, title: choice.title.slice(0, 240), type: choice.type, action: choice.action,
        description: choice.description?.slice(0, 600), parameterNames: Object.keys(state.catalog.find(spec => spec.name === choice.action)?.parameters || {}).slice(0, 100) }));
      if (!candidates.length) { message('当前没有兼容节点可供推荐。', true); return; }
      if (candidates.length > 600 || JSON.stringify(candidates).length > 80000) { message('可选节点过多，请缩小节点范围后重试。', true); return; }
      forget(); results.replaceChildren(); results.hidden = true; busy(true); message('正在结合上游与连接位置挑选节点…');
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { if (pending?.id !== id) return; forget(); if (overlay.isConnected) { busy(false); message('AI 请求超时，请稍后重试。', true); } }, 50000);
      pending = { id, timer, choices: new Map(choices.map(choice => [choice.id, choice])), signatures: new Map(choices.map(choice => [choice.id, signature(choice)])) };
      bridge.post({ type: 'aiSuggestions', requestId: id, request: { mode: 'node', context: bundle.context, instruction: goal.value.trim(), candidates,
        templatePaths: images.checked ? bundle.templates.map(item => item.path) : [] } });
    } catch (error) { forget(); busy(false); message((error as Error).message, true); }
  });
  goal.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!generate.disabled) generate.click(); } });
  const observer = new MutationObserver(() => { if (!overlay.isConnected) { forget(); unsubscribe(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true });
  return panel;
}
