/**
 * ROI/模板截取弹层：在截图上框选区域，按模式写回 rect 或上传裁剪后的模板。
 * 原 `editor-roi-picker.js`；主编辑器通过工厂注入状态与 DOM 依赖。
 */

export interface RoiRequestState {
  requestId: string;
  mode: 'asset' | 'rect';
  targetPath?: string;
  nodeId: string;
  key: string;
  applyValue?: (value: number[]) => void;
  returnToAssetBrowser?: boolean;
}

export interface RoiPickerSource {
  roi: RoiRequestState | null;
  raw: { resolution?: [number, number] } | null;
}

export interface RoiPickerMessage {
  requestId?: unknown;
  dataUrl?: string;
  width?: number;
  height?: number;
  referenceResolution?: [number, number];
}

export interface RoiNode {
  action?: string;
  params: Record<string, unknown>;
}

export type CreateRoiElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

export interface EditorRoiPickerDeps {
  state: RoiPickerSource;
  $(id: string): HTMLElement;
  el: CreateRoiElement;
  mutate(fn: () => void): void;
  vscode: { postMessage(message: unknown): void };
  toast(message: string, error?: boolean): void;
  nodeById(id: string): RoiNode | undefined;
  restoreAssetBrowserAfterRoi(): void;
}

export interface EditorRoiPicker {
  openRoiPicker(message: RoiPickerMessage): void;
}

export function createEditorRoiPicker(deps: EditorRoiPickerDeps): EditorRoiPicker {
  const { state, $, el, mutate, vscode, toast, nodeById, restoreAssetBrowserAfterRoi } = deps;

  function openRoiPicker(message: RoiPickerMessage): void {
    const request = state.roi;
    if (!request || request.requestId !== message.requestId) return;
    const overlay = $('roi-picker');
    overlay.innerHTML = '';
    overlay.classList.remove('hidden');
    const dialog = el('div', 'roi-dialog');
    const head = el('div', 'roi-head', request.targetPath ? '重新截取模板' : request.mode === 'asset' ? '截取模板' : '选择区域');
    dialog.appendChild(head);
    const stage = el('div', 'roi-stage');
    const image = el('img');
    image.src = message.dataUrl ?? '';
    stage.appendChild(image);
    const selection = el('div', 'roi-selection');
    stage.appendChild(selection);
    dialog.appendChild(stage);
    const actions = el('div', 'roi-actions');
    const cancel = el('button', '', '取消');
    const confirm = el('button', 'primary', '确认');
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    const data = { x1: 0, y1: 0, x2: 0, y2: 0, dragging: false };
    const update = (): void => {
      selection.style.left = `${Math.min(data.x1, data.x2)}px`;
      selection.style.top = `${Math.min(data.y1, data.y2)}px`;
      selection.style.width = `${Math.abs(data.x2 - data.x1)}px`;
      selection.style.height = `${Math.abs(data.y2 - data.y1)}px`;
    };
    const point = (event: MouseEvent): { x: number; y: number } => {
      const rect = stage.getBoundingClientRect();
      return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
    };
    stage.addEventListener('mousedown', (event) => {
      const p = point(event);
      data.x1 = data.x2 = p.x;
      data.y1 = data.y2 = p.y;
      data.dragging = true;
      update();
    });
    const move = (event: MouseEvent): void => {
      if (!data.dragging) return;
      const p = point(event);
      data.x2 = p.x;
      data.y2 = p.y;
      update();
    };
    const up = (): void => {
      data.dragging = false;
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    cancel.addEventListener('click', () => {
      const pending = state.roi;
      overlay.classList.add('hidden');
      state.roi = null;
      if (pending && pending.returnToAssetBrowser) restoreAssetBrowserAfterRoi();
    });
    confirm.addEventListener('click', () => {
      const rect = stage.getBoundingClientRect();
      const ref = message.referenceResolution || state.raw?.resolution || [1920, 1080];
      const x = Math.round(Math.min(data.x1, data.x2) * ref[0] / rect.width);
      const y = Math.round(Math.min(data.y1, data.y2) * ref[1] / rect.height);
      const width = Math.round(Math.abs(data.x2 - data.x1) * ref[0] / rect.width);
      const height = Math.round(Math.abs(data.y2 - data.y1) * ref[1] / rect.height);
      if (width < 1 || height < 1) {
        toast('请选择有效区域', true);
        return;
      }
      const pending = state.roi;
      const node = pending ? nodeById(pending.nodeId) : undefined;
      if (pending?.mode === 'rect') {
        if (typeof pending.applyValue === 'function') mutate(() => pending.applyValue!([x, y, width, height]));
        else if (node) mutate(() => { node.params[pending.key] = [x, y, width, height]; });
      } else if (pending) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        try {
          const context = canvas.getContext('2d');
          if (!context) throw new Error('浏览器无法创建图片画布');
          const imageWidth = message.width ?? 0;
          const imageHeight = message.height ?? 0;
          context.drawImage(
            image,
            x * imageWidth / ref[0], y * imageHeight / ref[1],
            width * imageWidth / ref[0], height * imageHeight / ref[1],
            0, 0, width, height,
          );
          const targetPath = String(pending.targetPath || '');
          const extension = targetPath.slice(targetPath.lastIndexOf('.')).toLocaleLowerCase();
          const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
          vscode.postMessage({ type: 'saveTemplate', requestId: pending.requestId, nodeId: pending.nodeId, key: pending.key, filename: `${pending.nodeId}-${pending.key}.png`, targetPath: pending.targetPath, dataUrl: canvas.toDataURL(mime) });
        } catch (error) {
          toast(String(error), true);
        }
      }
      overlay.classList.add('hidden');
      if (pending?.mode === 'rect') state.roi = null;
    });
  }

  return { openRoiPicker };
}
