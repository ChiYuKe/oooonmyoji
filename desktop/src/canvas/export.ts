/**
 * 画布导出：把工作流画布序列化为 SVG 位图，并把模板缩略图内嵌为 data URL。
 * 原 `editor-export.js`；主编辑器通过工厂注入状态与 DOM 依赖。
 */

export interface ExportState {
  exportBusy: boolean;
  raw?: { id?: unknown } | null;
  documentName?: string;
}

export interface ExportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ExportDeps {
  state: ExportState;
  graph: SVGSVGElement;
  vscode: { postMessage(message: unknown): void };
  bounds(): ExportBounds;
  wrap: HTMLElement;
  toast(message: string, error?: boolean): void;
  NS: string;
}

export interface ExportController {
  exportFullCanvasImage(): Promise<void>;
  setExportBusy(value: boolean): void;
  collectExportTemplatePaths(root: ParentNode): string[];
  applyInlineThumbnails(root: ParentNode, dataUrls: Map<string, string>): number;
}

const SVG_EXPORT_STYLE_PROPERTIES = [
  'color', 'display', 'visibility', 'opacity',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'letter-spacing',
  'text-anchor', 'dominant-baseline', 'paint-order', 'shape-rendering', 'vector-effect', 'filter',
];

export function createEditorExport(deps: ExportDeps): ExportController {
  const { state, graph, vscode, bounds, wrap, toast, NS } = deps;

  function inlineSvgStyles(source: Element, target: Element): void {
    const computed = window.getComputedStyle(source);
    for (const property of SVG_EXPORT_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) (target as HTMLElement | SVGElement).style.setProperty(property, value, computed.getPropertyPriority(property));
    }
    const sourceChildren = Array.from(source.children);
    const targetChildren = Array.from(target.children);
    sourceChildren.forEach((child, index) => inlineSvgStyles(child, targetChildren[index]));
  }

  function loadSvgImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法渲染工作流画布'));
      image.src = dataUrl;
    });
  }

  function requestAssetDataUrls(paths: string[]): Promise<Map<string, string>> {
    if (!paths.length) return Promise.resolve(new Map());
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let settled = false;
      let timer = 0;
      const finish = (map: Map<string, string>): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', listener);
        clearTimeout(timer);
        resolve(map);
      };
      const listener = (event: MessageEvent): void => {
        const message = (event.data || {}) as { type?: unknown; requestId?: unknown; items?: unknown };
        if (message.type !== 'assetData' || message.requestId !== requestId) return;
        const map = new Map<string, string>();
        for (const entry of Array.isArray(message.items) ? message.items : []) {
          const item = entry as { path?: unknown; dataUrl?: unknown };
          if (item && typeof item.path === 'string' && typeof item.dataUrl === 'string') map.set(item.path, item.dataUrl);
        }
        finish(map);
      };
      timer = window.setTimeout(() => finish(new Map()), 8000);
      window.addEventListener('message', listener);
      vscode.postMessage({ type: 'requestAssetData', requestId, paths });
    });
  }

  /** 收集画布上需要内嵌的模板路径（运行截图已是 data URL，无需请求）。 */
  function collectExportTemplatePaths(root: ParentNode): string[] {
    const paths = new Set<string>();
    for (const image of root.querySelectorAll('image.node-preview-image')) {
      const href = image.getAttribute('href') || '';
      if (href && !href.startsWith('data:')) {
        const templatePath = image.getAttribute('data-template-path') || '';
        if (templatePath) paths.add(templatePath);
      }
    }
    return [...paths];
  }

  /** 把导出克隆里的缩略图 <image> 换成内嵌 data URL，返回保留数量。 */
  function applyInlineThumbnails(root: ParentNode, dataUrls: Map<string, string>): number {
    let count = 0;
    for (const image of root.querySelectorAll('image.node-preview-image')) {
      const href = image.getAttribute('href') || '';
      if (href.startsWith('data:')) { count += 1; continue; }
      const dataUrl = dataUrls.get(image.getAttribute('data-template-path') || '');
      if (dataUrl) { image.setAttribute('href', dataUrl); count += 1; }
    }
    return count;
  }

  async function inlineExportThumbnails(exported: Element): Promise<number> {
    const paths = collectExportTemplatePaths(exported);
    const dataUrls = paths.length ? await requestAssetDataUrls(paths) : new Map<string, string>();
    return applyInlineThumbnails(exported, dataUrls);
  }

  function encodeSvgDataUrl(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }

  function setExportBusy(value: boolean): void {
    state.exportBusy = value;
  }

  async function exportFullCanvasImage(): Promise<void> {
    if (!state.raw || state.exportBusy) return;
    setExportBusy(true);
    try {
      const padding = 56;
      const box = bounds();
      const logicalWidth = Math.max(1, Math.ceil(box.maxX - box.minX + padding * 2));
      const logicalHeight = Math.max(1, Math.ceil(box.maxY - box.minY + padding * 2));
      const exported = graph.cloneNode(true) as SVGSVGElement;
      inlineSvgStyles(graph, exported);
      exported.removeAttribute('id');
      exported.setAttribute('xmlns', NS);
      exported.setAttribute('width', String(logicalWidth));
      exported.setAttribute('height', String(logicalHeight));
      exported.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
      exported.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      const world = exported.querySelector('.graph-world');
      if (!world) throw new Error('工作流画布尚未准备好');
      world.setAttribute('transform', `translate(${padding - box.minX},${padding - box.minY})`);
      exported.querySelectorAll('.connection-preview, .marquee, .edge-hit, .edge-rewire').forEach((element) => element.remove());
      // 缩略图保留进导出：把模板 <image> 的外部资源 URI 替换为内嵌 data URL，
      // 运行截图本身已是 data URL。请求失败或文件缺失时只跳过该图，不阻断导出。
      await inlineExportThumbnails(exported);

      const serialized = new XMLSerializer().serializeToString(exported);
      const image = await loadSvgImage(encodeSvgDataUrl(serialized));
      const maxDimension = 8192;
      const maxPixels = 32 * 1024 * 1024;
      const rasterScale = Math.min(
        2,
        maxDimension / logicalWidth,
        maxDimension / logicalHeight,
        Math.sqrt(maxPixels / (logicalWidth * logicalHeight)),
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(logicalWidth * rasterScale));
      canvas.height = Math.max(1, Math.floor(logicalHeight * rasterScale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建图片画布');
      const wrapStyle = window.getComputedStyle(wrap);
      const rootStyle = window.getComputedStyle(document.documentElement);
      context.fillStyle = wrapStyle.backgroundColor || '#1e1f22';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const gridStep = 24 * rasterScale;
      if (gridStep >= 4) {
        context.beginPath();
        for (let x = 0.5; x < canvas.width; x += gridStep) { context.moveTo(x, 0); context.lineTo(x, canvas.height); }
        for (let y = 0.5; y < canvas.height; y += gridStep) { context.moveTo(0, y); context.lineTo(canvas.width, y); }
        context.strokeStyle = rootStyle.getPropertyValue('--grid').trim() || 'rgba(153, 157, 168, 0.1)';
        context.lineWidth = 1;
        context.stroke();
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const workflowName = String(state.raw.id || state.documentName || 'workflow')
        .replace(/\.json$/i, '')
        .replace(/[\\/\x00-\x1f<>:"|?*]/g, '_')
        .trim() || 'workflow';
      vscode.postMessage({
        type: 'saveCanvasImage',
        filename: `${workflowName}-layout.png`,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        logicalWidth,
        logicalHeight,
      });
    } catch (error) {
      setExportBusy(false);
      toast(`导出完整画布失败：${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  return { exportFullCanvasImage, setExportBusy, collectExportTemplatePaths, applyInlineThumbnails };
}
