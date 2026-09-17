/**
 * 模板即时检查弹层：抓取当前画面并展示模板匹配结果与 ROI 框。
 * 原 `editor-template-check.js`；主编辑器通过工厂注入状态与 DOM 依赖。
 */
import type { ParameterInfo } from '../../shared/contracts';

export interface TemplateCheckMatch {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface TemplateCheckResult {
  dataUrl: string;
  width: number;
  height: number;
  roi: [number, number, number, number];
  matches: TemplateCheckMatch[];
}

export interface TemplateCheckSession {
  requestId: string;
  nodeId: string;
  template: string;
  threshold: number;
  status: 'loading' | 'success' | 'error';
  result: TemplateCheckResult | null;
  error: string;
}

export interface TemplateCheckState {
  raw: {
    inputs?: Record<string, unknown>;
    resolution?: [number, number];
    [key: string]: unknown;
  } | null;
  instanceId?: string;
  templateCheck?: TemplateCheckSession | null;
}

export interface TemplateCheckNode {
  action?: string;
  params?: Record<string, unknown>;
}

export type CreateTemplateCheckElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

export interface TemplateCheckDeps {
  state: TemplateCheckState;
  $(id: string): HTMLElement;
  el: CreateTemplateCheckElement;
  nodeById(id: string): TemplateCheckNode | undefined;
  catalogByName(action: string | undefined): { parameters?: Record<string, ParameterInfo> } | undefined;
  clone<T>(value: T): T;
  vscode: { postMessage(message: unknown): void };
  toast(message: string, error?: boolean): void;
}

export interface TemplateCheckController {
  requestTemplateCheck(nodeId: string): void;
  closeTemplateCheck(): void;
  renderTemplateCheck(): void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function createTemplateCheck(deps: TemplateCheckDeps): TemplateCheckController {
  const { state, $, el, nodeById, catalogByName, clone, vscode, toast } = deps;

  function templateCheckParam(node: TemplateCheckNode, name: string, fallback: unknown): unknown {
    const definition = catalogByName(node.action)?.parameters?.[name] as ParameterInfo | undefined;
    let value: unknown = Object.prototype.hasOwnProperty.call(node.params || {}, name)
      ? node.params![name]
      : definition && definition.default !== undefined ? clone(definition.default) : fallback;
    const binding = asRecord(value);
    if (binding && typeof binding.ref === 'string') {
      const prefix = 'inputs.';
      if (binding.ref.startsWith(prefix)) {
        const inputs = asRecord(state.raw?.inputs) ?? {};
        const entry = inputs[binding.ref.slice(prefix.length)];
        if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'default')) value = (entry as { default: unknown }).default;
        else if (entry !== undefined && (typeof entry !== 'object' || entry === null)) value = entry;
        else throw new Error(`${name} 引用没有可用的默认值`);
      } else {
        throw new Error(`${name} 使用了运行时引用，无法即时检查`);
      }
    }
    return value;
  }

  function requestTemplateCheck(nodeId: string): void {
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
        referenceResolution: state.raw?.resolution || [1920, 1080],
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function closeTemplateCheck(): void {
    const overlay = $('template-check');
    if (overlay) overlay.classList.add('hidden');
    state.templateCheck = null;
  }

  function templateCheckBox(className: string, rect: number[], width: number, height: number, label: string): HTMLElement {
    const box = el('div', className);
    box.style.left = `${Math.max(0, rect[0]) / width * 100}%`;
    box.style.top = `${Math.max(0, rect[1]) / height * 100}%`;
    box.style.width = `${Math.max(0, Math.min(width - rect[0], rect[2])) / width * 100}%`;
    box.style.height = `${Math.max(0, Math.min(height - rect[1], rect[3])) / height * 100}%`;
    box.appendChild(el('span', 'template-check-box-label', label));
    return box;
  }

  function renderTemplateCheck(): void {
    const check = state.templateCheck;
    const overlay = $('template-check');
    if (!check || !overlay) return;
    overlay.innerHTML = '';
    const dialog = el('div', 'template-check-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '模板检查');
    const head = el('div', 'template-check-head');
    const heading = el('div', 'template-check-heading');
    heading.appendChild(el('strong', '', '模板检查'));
    heading.appendChild(el('span', '', check.template));
    const headActions = el('div', 'template-check-head-actions');
    if (check.status !== 'loading') {
      const refresh = el('button', 'icon-button', '↻');
      refresh.title = '重新检查';
      refresh.setAttribute('aria-label', '重新检查');
      refresh.addEventListener('click', () => requestTemplateCheck(check.nodeId));
      headActions.appendChild(refresh);
    }
    const close = el('button', 'icon-button', '×');
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeTemplateCheck);
    headActions.appendChild(close);
    head.appendChild(heading);
    head.appendChild(headActions);
    dialog.appendChild(head);

    if (check.status === 'loading') {
      dialog.appendChild(el('div', 'template-check-status', '正在获取当前画面并匹配…'));
      overlay.appendChild(dialog);
      return;
    }
    if (check.status === 'error') {
      dialog.appendChild(el('div', 'template-check-status error', check.error || '模板检查失败'));
      overlay.appendChild(dialog);
      return;
    }

    const result = check.result;
    if (!result) return;
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const summary = el('div', 'template-check-summary');
    summary.appendChild(el('span', 'template-check-chip roi', result.roi[0] === 0 && result.roi[1] === 0 && result.roi[2] === result.width && result.roi[3] === result.height ? '全画面 ROI' : 'ROI'));
    summary.appendChild(el('span', 'template-check-chip', `阈值 ${check.threshold.toFixed(3)}`));
    summary.appendChild(el('span', `template-check-chip ${matches.length ? 'matched' : 'missed'}`, `命中 ${matches.length}`));
    if (matches.length) summary.appendChild(el('span', 'template-check-chip matched', `最高 ${Math.max(...matches.map((item) => item.confidence)).toFixed(3)}`));
    dialog.appendChild(summary);

    const viewport = el('div', 'template-check-viewport');
    const stage = el('div', 'template-check-stage');
    stage.style.aspectRatio = `${result.width} / ${result.height}`;
    const image = el('img');
    image.src = result.dataUrl;
    image.alt = '当前实例画面';
    stage.appendChild(image);
    stage.appendChild(templateCheckBox('template-check-roi', result.roi, result.width, result.height, 'ROI'));
    matches.forEach((match, index) => stage.appendChild(templateCheckBox(
      'template-check-match',
      [match.x, match.y, match.width, match.height],
      result.width,
      result.height,
      `${index + 1}  ${match.confidence.toFixed(3)}`,
    )));
    viewport.appendChild(stage);
    dialog.appendChild(viewport);
    const message = matches.length
      ? `找到 ${matches.length} 个达到阈值的匹配结果`
      : `未找到达到阈值 ${check.threshold.toFixed(3)} 的匹配结果`;
    dialog.appendChild(el('div', `template-check-footer ${matches.length ? 'matched' : 'missed'}`, message));
    overlay.appendChild(dialog);
  }

  return { requestTemplateCheck, closeTemplateCheck, renderTemplateCheck };
}
