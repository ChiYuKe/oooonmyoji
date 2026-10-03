import type { OnmyojiDesktopApi } from '../shared/contracts';

export type ImageShareApi = Partial<Pick<OnmyojiDesktopApi, 'saveCanvas' | 'readAssetData' | 'copyImageToClipboard'>>;

/** The same canvas is previewed, saved and copied, including all scrollable content. */
export function installImageShare(root: HTMLElement, api: ImageShareApi | undefined,
  options: { className: string; title: string; caption: string }): {
  show(render: (active: () => boolean) => Promise<HTMLCanvasElement | null>, filename: string, origin: HTMLElement): void;
  close(): void; dispose(): void;
} {
  const doc = root.ownerDocument, dialog = doc.createElement('dialog');
  dialog.className = `soul-optimizer shikigami-share ${options.className}`; dialog.setAttribute('aria-label', options.title);
  dialog.innerHTML = `<header class="soul-optimizer-header"><div><h2></h2><p></p></div><button type="button" data-build-share="close" aria-label="关闭分享" autofocus>×</button></header>
    <div class="shikigami-share-toolbar"><button type="button" data-build-share="zoom" aria-pressed="false">原尺寸</button><button type="button" data-build-share="save">保存图片</button><button type="button" data-build-share="copy">复制</button><span data-build-share="status" role="status" aria-live="polite"></span></div>
    <div class="shikigami-share-preview" data-build-share="preview" aria-label="完整分享图片预览"></div>`;
  dialog.querySelector('h2')!.textContent = options.title; dialog.querySelector('header p')!.textContent = options.caption; root.append(dialog);
  const el = <T extends HTMLElement>(key: string): T => dialog.querySelector<T>(`[data-build-share="${key}"]`)!;
  const save = el<HTMLButtonElement>('save'), copy = el<HTMLButtonElement>('copy');
  let canvas: HTMLCanvasElement | null = null, generation = 0, disposed = false, fullSize = false;
  let anchor: HTMLElement | null = null, filename = '', saving = false, copying = false;
  const close = (): void => {
    generation++; canvas = null; el('preview').replaceChildren(); const origin = anchor; anchor = null;
    if (dialog.open) { dialog.close(); if (origin?.isConnected && !root.closest('[hidden]')) origin.focus({ preventScroll: true }); }
  };
  el('close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  const zoom = (): void => {
    if (canvas) canvas.style.width = fullSize ? `${canvas.width / 2}px` : '100%';
    el('zoom').textContent = fullSize ? '适应窗口' : '原尺寸'; el('zoom').setAttribute('aria-pressed', String(fullSize));
  };
  el('zoom').addEventListener('click', () => { fullSize = !fullSize; zoom(); });
  for (const operation of ['save', 'copy'] as const) el(operation).addEventListener('click', async () => {
    if (!canvas || (operation === 'save' ? saving || !api?.saveCanvas : copying || !api?.copyImageToClipboard)) return;
    const version = generation, image = canvas;
    if (operation === 'save') saving = true; else copying = true;
    (el(operation) as HTMLButtonElement).disabled = true; el('status').textContent = operation === 'save' ? '正在保存完整图片…' : '正在复制完整图片…';
    try {
      const dataUrl = image.toDataURL('image/png');
      const result = operation === 'save' ? await api!.saveCanvas!({ filename, dataUrl, purpose: 'share' }) : await api!.copyImageToClipboard!(dataUrl);
      if (!disposed && version === generation) el('status').textContent = operation === 'save'
        ? result ? '图片已保存，可以发送给好友。' : '已取消保存。' : '图片已复制到剪贴板，可直接粘贴发送。';
    } catch (error) {
      if (!disposed && version === generation) el('status').textContent = error instanceof Error ? error.message : '操作失败，请重试';
    } finally {
      if (operation === 'save') saving = false; else copying = false;
      if (!disposed && dialog.open) (el(operation) as HTMLButtonElement).disabled = !canvas || !(operation === 'save' ? api?.saveCanvas : api?.copyImageToClipboard);
    }
  });
  return {
    show(render, name, origin): void {
      const version = ++generation, active = (): boolean => !disposed && version === generation && dialog.open;
      anchor = origin; filename = name; canvas = null; fullSize = false; zoom(); save.disabled = copy.disabled = true;
      el('preview').replaceChildren(); el('status').textContent = '正在渲染完整图片…';
      if (!dialog.open) dialog.showModal(); el('preview').scrollTop = 0;
      void render(active).then(output => {
        if (!active() || !output) return;
        canvas = output; zoom(); el('preview').replaceChildren(output); save.disabled = !api?.saveCanvas || saving; copy.disabled = !api?.copyImageToClipboard || copying;
        el('status').textContent = `完整配置 · ${output.width} × ${output.height}`;
      }).catch(error => { if (active()) el('status').textContent = error instanceof Error ? error.message : '图片生成失败，请重试'; });
    }, close,
    dispose(): void { disposed = true; close(); dialog.remove(); },
  };
}
