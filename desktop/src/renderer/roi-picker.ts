/**
 * ROI / 模板截取选择器。
 *
 * 由主窗口承载一个模态层：iframe 请求截取后，主窗口展示当前画面并让用户框选，
 * 再把结果（rect 或保存后的模板路径）回传给来源 iframe。
 * 这里通过依赖注入拿到 DOM 引用与回调，自身持有唯一的进行中请求状态。
 */
import type { SaveTemplateRequest } from '../shared/contracts';

export interface RoiPickerRequest {
  requestId: string;
  nodeId: string;
  key: string;
  mode: 'asset' | 'rect';
  targetPath?: string;
  /** 结果落到哪份画布：持有文档的那一份（详情栏只是镜像，收不到写权）。 */
  sourceFrame: HTMLIFrameElement;
  /**
   * 请求方自己的 iframe（当它与 sourceFrame 不同时）：
   * 结果同时回给它，好让它的 ROI 状态、素材浏览器返回流程照旧收尾。
   */
  requestFrame?: HTMLIFrameElement;
  referenceResolution: [number, number];
  imageWidth: number;
  imageHeight: number;
  dataUrl: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dragging: boolean;
  busy: boolean;
}

export interface RoiPickerDeps {
  modal: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  stage: HTMLElement;
  image: HTMLImageElement;
  selection: HTMLElement;
  hint: HTMLElement;
  cancelButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  postToFrame: (frame: HTMLIFrameElement, payload: Record<string, unknown>) => void;
  showToast: (message: string, error?: boolean) => void;
  errorMessage: (error: unknown) => string;
  saveTemplate: (request: SaveTemplateRequest) => Promise<string>;
}

export interface RoiPicker {
  /** 打开选择器；已有进行中的请求会先取消。 */
  open(request: Omit<RoiPickerRequest, 'x1' | 'y1' | 'x2' | 'y2' | 'dragging' | 'busy'>): void;
  /** 绑定模态层内的指针与按钮事件，只需调用一次。 */
  bind(): void;
  /** 取消当前请求并回传给来源 iframe。 */
  cancel(): void;
  /** 是否有进行中的请求。 */
  isOpen(): boolean;
}

export function createRoiPicker(deps: RoiPickerDeps): RoiPicker {
  const {
    modal, title, subtitle, stage, image, selection, hint,
    cancelButton, confirmButton, closeButton,
    postToFrame, showToast, errorMessage, saveTemplate,
  } = deps;

  let state: RoiPickerRequest | undefined;

  function hide(): void {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    image.removeAttribute('src');
    selection.style.display = 'none';
    confirmButton.disabled = false;
    cancelButton.disabled = false;
    closeButton.disabled = false;
    hint.textContent = '拖动鼠标框选区域';
  }

  /** 回传结果：持有文档的画布必须收到（它才有写权），请求方自己也要收到（收尾用它）。 */
  function reply(request: RoiPickerRequest, payload: Record<string, unknown>): void {
    postToFrame(request.sourceFrame, payload);
    const requester = request.requestFrame;
    if (requester && requester !== request.sourceFrame) postToFrame(requester, payload);
  }

  function cancel(): void {
    const request = state;
    if (!request || request.busy) return;
    state = undefined;
    hide();
    reply(request, { type: 'roiPickerCancelled', requestId: request.requestId });
  }

  function imageBounds(): { image: DOMRect; stage: DOMRect } | undefined {
    const imageRect = image.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (imageRect.width < 1 || imageRect.height < 1 || stageRect.width < 1 || stageRect.height < 1) return undefined;
    return { image: imageRect, stage: stageRect };
  }

  function pointerPoint(event: PointerEvent): { x: number; y: number } | undefined {
    const bounds = imageBounds();
    if (!bounds) return undefined;
    return {
      x: Math.max(0, Math.min(bounds.image.width, event.clientX - bounds.image.left)),
      y: Math.max(0, Math.min(bounds.image.height, event.clientY - bounds.image.top)),
    };
  }

  function renderSelection(): void {
    const current = state;
    const bounds = imageBounds();
    if (!current || !bounds) return;
    const left = bounds.image.left - bounds.stage.left;
    const top = bounds.image.top - bounds.stage.top;
    const x = Math.min(current.x1, current.x2);
    const y = Math.min(current.y1, current.y2);
    const width = Math.abs(current.x2 - current.x1);
    const height = Math.abs(current.y2 - current.y1);
    selection.style.display = width > 0 && height > 0 ? 'block' : 'none';
    selection.style.left = `${left + x}px`;
    selection.style.top = `${top + y}px`;
    selection.style.width = `${width}px`;
    selection.style.height = `${height}px`;
  }

  function selectedRoi(): [number, number, number, number] | undefined {
    const current = state;
    const bounds = imageBounds();
    if (!current || !bounds) return undefined;
    const [referenceWidth, referenceHeight] = current.referenceResolution;
    if (referenceWidth < 1 || referenceHeight < 1) return undefined;
    const x = Math.round(Math.min(current.x1, current.x2) * referenceWidth / bounds.image.width);
    const y = Math.round(Math.min(current.y1, current.y2) * referenceHeight / bounds.image.height);
    const width = Math.round(Math.abs(current.x2 - current.x1) * referenceWidth / bounds.image.width);
    const height = Math.round(Math.abs(current.y2 - current.y1) * referenceHeight / bounds.image.height);
    const safeX = Math.max(0, Math.min(referenceWidth - 1, x));
    const safeY = Math.max(0, Math.min(referenceHeight - 1, y));
    const safeWidth = Math.max(0, Math.min(referenceWidth - safeX, width));
    const safeHeight = Math.max(0, Math.min(referenceHeight - safeY, height));
    if (safeWidth < 1 || safeHeight < 1) return undefined;
    return [safeX, safeY, safeWidth, safeHeight];
  }

  function mimeFor(targetPath: string): string {
    const extension = targetPath.slice(targetPath.lastIndexOf('.')).toLocaleLowerCase();
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.webp') return 'image/webp';
    return 'image/png';
  }

  async function confirm(): Promise<void> {
    const current = state;
    if (!current || current.busy) return;
    const roi = selectedRoi();
    if (!roi) {
      showToast('请选择有效区域', true);
      return;
    }

    if (current.mode === 'rect') {
      state = undefined;
      hide();
      reply(current, {
        type: 'roiPickerResult',
        requestId: current.requestId,
        nodeId: current.nodeId,
        key: current.key,
        roi,
      });
      return;
    }

    const bounds = imageBounds();
    if (!bounds) return;
    const sourceWidth = image.naturalWidth || current.imageWidth;
    const sourceHeight = image.naturalHeight || current.imageHeight;
    const sourceX = Math.min(current.x1, current.x2) * sourceWidth / bounds.image.width;
    const sourceY = Math.min(current.y1, current.y2) * sourceHeight / bounds.image.height;
    const sourceW = Math.abs(current.x2 - current.x1) * sourceWidth / bounds.image.width;
    const sourceH = Math.abs(current.y2 - current.y1) * sourceHeight / bounds.image.height;
    const canvas = document.createElement('canvas');
    canvas.width = roi[2];
    canvas.height = roi[3];
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建截图画布');
      context.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, canvas.width, canvas.height);
      current.busy = true;
      confirmButton.disabled = true;
      cancelButton.disabled = true;
      closeButton.disabled = true;
      hint.textContent = '正在保存模板…';
      const savedPath = await saveTemplate({
        targetPath: current.targetPath,
        filename: `${current.nodeId}-${current.key}.png`,
        dataUrl: canvas.toDataURL(mimeFor(current.targetPath || '')),
      });
      if (state?.requestId !== current.requestId) return;
      state = undefined;
      hide();
      reply(current, {
        type: 'templateSaved',
        requestId: current.requestId,
        nodeId: current.nodeId,
        key: current.key,
        path: savedPath,
      });
    } catch (error) {
      if (state?.requestId === current.requestId) {
        state = undefined;
        hide();
        reply(current, { type: 'roiPickerError', requestId: current.requestId, message: errorMessage(error) });
      }
      showToast(errorMessage(error), true);
    }
  }

  function open(request: Omit<RoiPickerRequest, 'x1' | 'y1' | 'x2' | 'y2' | 'dragging' | 'busy'>): void {
    if (state) cancel();
    state = { ...request, x1: 0, y1: 0, x2: 0, y2: 0, dragging: false, busy: false };
    title.textContent = request.targetPath ? '重新截取模板' : request.mode === 'asset' ? '截取模板' : '选择区域';
    subtitle.textContent = request.mode === 'asset' ? '从当前画面框选需要保存的区域' : '从当前画面框选识别区域';
    hint.textContent = '拖动鼠标框选区域';
    confirmButton.disabled = false;
    selection.style.display = 'none';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    image.onload = () => renderSelection();
    image.src = request.dataUrl;
    window.requestAnimationFrame(() => renderSelection());
  }

  function bind(): void {
    stage.addEventListener('pointerdown', (event) => {
      const current = state;
      const point = pointerPoint(event);
      if (!current || current.busy || !point) return;
      event.preventDefault();
      current.x1 = point.x;
      current.y1 = point.y;
      current.x2 = point.x;
      current.y2 = point.y;
      current.dragging = true;
      stage.setPointerCapture?.(event.pointerId);
      renderSelection();
    });
    stage.addEventListener('pointermove', (event) => {
      const current = state;
      if (!current?.dragging || current.busy) return;
      const point = pointerPoint(event);
      if (!point) return;
      current.x2 = point.x;
      current.y2 = point.y;
      renderSelection();
    });
    const finishDrag = (event: PointerEvent) => {
      if (!state?.dragging) return;
      state.dragging = false;
      if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };
    stage.addEventListener('pointerup', finishDrag);
    stage.addEventListener('pointercancel', finishDrag);
    cancelButton.addEventListener('click', cancel);
    closeButton.addEventListener('click', cancel);
    confirmButton.addEventListener('click', () => void confirm());
    modal.addEventListener('pointerdown', (event) => {
      if (event.target === modal) cancel();
    });
  }

  return { open, bind, cancel, isOpen: () => Boolean(state) };
}
