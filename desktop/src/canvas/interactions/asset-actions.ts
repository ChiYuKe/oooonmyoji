/**
 * 资产路径与 ROI 请求：路径规范化/状态、素材清单刷新、缺失素材修复入口、ROI 拾取请求。
 * 原 `workflow-editor.js` 的 normalizedAssetPath 至 requestRoi 区间。
 */
import type { CanvasState } from '../state/canvas-state';

export interface AssetActionsDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
  el(tag: string, className?: string, text?: string): any;
  vscode: any;
  requestTemplateReplacement(...args: any[]): void;
}

export function createAssetActions(deps: AssetActionsDeps) {
  const { state, $, el, vscode, requestTemplateReplacement } = deps;
  function normalizedAssetPath(value: any): string {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  }

  function assetPathStatus(value: any): string {
    const normalized = normalizedAssetPath(value);
    if (!normalized || !state.assetPaths) return 'unknown';
    return state.assetPaths.has(normalized) ? 'available' : 'missing';
  }

  function requestAssetInventory(): void {
    if (state.assetPaths || state.assetInventoryRequestId || !state.raw) return;
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.assetInventoryRequestId = requestId;
    vscode.postMessage({ type: 'listAssetImages', requestId });
  }

  function appendMissingAssetAction(shell: any, node: any, key: string, value: any, onChange: (value: any) => void): void {
    if (!node || assetPathStatus(value) !== 'missing') return;
    const normalized = normalizedAssetPath(value);
    const hint = el('div', 'asset-missing-hint');
    hint.appendChild(el('span', '', '找不到此模板图片'));
    const repair = el('button', 'small-command', '从当前画面补齐');
    repair.type = 'button';
    repair.title = `截取后保存为 ${normalized}`;
    repair.addEventListener('click', () => requestTemplateReplacement(node.id, key, normalized, { targetPath: normalized, applyValue: onChange }));
    hint.appendChild(repair);
    shell.appendChild(hint);
  }

  function requestRoi(nodeId: string, key: string, mode: string, options: any = {}): void {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.roi = { requestId, nodeId, key, mode, ...options };
    vscode.postMessage({ type: 'pickRoi', requestId, nodeId, key, mode, targetPath: options.targetPath, instanceId: state.instanceId, referenceResolution: state.raw.resolution || [1920, 1080] });
  }

  return { normalizedAssetPath, assetPathStatus, requestAssetInventory, appendMissingAssetAction, requestRoi };
}