import { installImageShare, type ImageShareApi } from './image-share';

/** Freeze the actual detail layout, so export follows the same CSS and viewport. */
export function installSoulPlanShare(root: HTMLElement, api?: ImageShareApi): {
  show(detail: HTMLElement, origin: HTMLElement): void;
  close(): void; dispose(): void;
} {
  const doc = root.ownerDocument, win = doc.defaultView!;
  const preview = installImageShare(root, api, { className: 'soul-plan-share', title: '分享配装方案', caption: '按当前配装详情布局生成完整图片' });
  const text = (parent: ParentNode, selector: string): string => parent.querySelector(selector)?.textContent?.trim() ?? '';
  const render = async (detail: HTMLElement, active: () => boolean): Promise<HTMLCanvasElement | null> => {
    await doc.fonts.ready;
    if (!active()) return null;
    const origin = detail.getBoundingClientRect(), body = detail.querySelector<HTMLElement>('.soul-plan-detail-body')!;
    const bodyBounds = body.getBoundingClientRect(), bodyScroll = body.scrollTop;
    const height = Math.ceil(bodyBounds.top - origin.top + Math.max(bodyBounds.height, body.scrollHeight));
    const width = Math.ceil(origin.width), canvas = doc.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw Error('无法生成配装分享图片');
    const images = new Map<string, HTMLImageElement>(), paths = new Set<string>();
    const commands: (() => void)[] = [];
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left - origin.left, y: rect.top - origin.top + (element !== body && body.contains(element) ? bodyScroll : 0), width: rect.width, height: rect.height };
    };
    const radius = (value: string, rect: { width: number; height: number }): number =>
      Math.min(Math.min(rect.width, rect.height) / 2, value.endsWith('%') ? Math.min(rect.width, rect.height) * parseFloat(value) / 100 : parseFloat(value) || 0);
    const captureText = (node: Text): void => {
      const element = node.parentElement!, style = win.getComputedStyle(element), range = doc.createRange();
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, color = style.color;
      const lines: { value: string; x: number; y: number }[] = [];
      let offset = 0;
      for (const char of node.data) {
        range.setStart(node, offset); offset += char.length; range.setEnd(node, offset);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const x = rect.left - origin.left, y = rect.top - origin.top + (body.contains(element) ? bodyScroll : 0);
        const line = lines.at(-1);
        if (line && Math.abs(line.y - y) < 1) line.value += char;
        else lines.push({ value: char, x, y });
      }
      commands.push(() => {
        ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        for (const line of lines) ctx.fillText(line.value, line.x, line.y + ctx.measureText(line.value).fontBoundingBoxAscent);
      });
    };
    const capture = (element: HTMLElement): void => {
      if (element.matches('.soul-plan-detail-actions') || element.hidden) return;
      const style = win.getComputedStyle(element), rect = bounds(element);
      if (style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height) return;
      const background = style.backgroundColor, corners = radius(style.borderTopLeftRadius, rect);
      // Copy values now; the source can close or switch plans while artwork loads.
      const borders = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({
        width: parseFloat(style.getPropertyValue('border-' + side.toLowerCase() + '-width')),
        color: style.getPropertyValue('border-' + side.toLowerCase() + '-color'),
        visible: style.getPropertyValue('border-' + side.toLowerCase() + '-style') !== 'none',
      }));
      const shadow = style.boxShadow.match(/(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);
      commands.push(() => {
        ctx.save();
        if (shadow && element !== detail) { ctx.shadowColor = shadow[1]; ctx.shadowOffsetX = Number(shadow[2]); ctx.shadowOffsetY = Number(shadow[3]); ctx.shadowBlur = Number(shadow[4]); }
        ctx.fillStyle = background; ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.width, rect.height, corners); ctx.fill(); ctx.restore();
        const endpoints = [[rect.x, rect.y, rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height],
          [rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y, rect.x, rect.y + rect.height]];
        borders.forEach((border, i) => {
          if (!border.visible || !border.width) return;
          ctx.strokeStyle = border.color; ctx.lineWidth = border.width; ctx.beginPath();
          const [x1, y1, x2, y2] = endpoints[i]; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        });
      });
      const svg = element.querySelector(':scope > svg'), path = svg?.querySelector('path');
      if (svg && path) {
        const shape = path.getAttribute('d')!, outline = win.getComputedStyle(path), fill = outline.fill, stroke = outline.stroke, lineWidth = parseFloat(outline.strokeWidth);
        const svgRect = bounds(svg);
        commands.push(() => {
          ctx.save(); ctx.translate(svgRect.x, svgRect.y); ctx.scale(svgRect.width / 64, svgRect.height / 64);
          const vector = new Path2D(shape); ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.fill(vector); ctx.stroke(vector); ctx.restore();
        });
      }
      if (element.tagName === 'IMG') {
        const url = new URL((element as HTMLImageElement).src), asset = url.protocol === 'onmyoji-resource:' ? url.pathname.replace(/^\//, '') : '';
        if (asset) paths.add(asset);
        const parent = element.parentElement!, parentRect = bounds(parent), parentRadius = radius(win.getComputedStyle(parent).borderTopLeftRadius, parentRect);
        commands.push(() => {
          const image = images.get(asset); if (!image) return;
          ctx.save(); ctx.beginPath(); ctx.roundRect(parentRect.x, parentRect.y, parentRect.width, parentRect.height, parentRadius); ctx.clip();
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.width, rect.height, corners); ctx.clip();
          const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale;
          ctx.drawImage(image, rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h); ctx.restore();
        });
      }
      for (const node of element.childNodes) {
        if (node.nodeType === 3) captureText(node as Text);
        else if (node.nodeType === 1 && (node as Element).namespaceURI === 'http://www.w3.org/1999/xhtml') capture(node as HTMLElement);
      }
    };
    const background = win.getComputedStyle(detail).backgroundColor, note = text(detail, '[data-plan="note"]');
    capture(detail);
    canvas.dataset.slots = String(detail.querySelectorAll('.soul-plan-ring-soul').length);
    canvas.dataset.layoutWidth = String(width); canvas.dataset.layoutHeight = String(height);
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `配装方案，${note}，六件御魂及完整属性与套装效果`);
    if (api?.readAssetData) {
      const requested = [...paths];
      for (let start = 0; start < requested.length; start += 64) {
        if (!active()) return null;
        const assets = await api.readAssetData(requested.slice(start, start + 64));
        await Promise.all(assets.map(async asset => {
          const image = doc.createElement('img'); image.src = asset.dataUrl;
          try { await image.decode(); images.set(asset.path, image); } catch { /* Keep the existing placeholder. */ }
        }));
      }
    }
    if (!active()) return null;
    canvas.width = width * 2; canvas.height = height * 2; ctx.scale(2, 2);
    canvas.dataset.loadedPortraits = String(images.size);
    ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    for (const command of commands) command();
    return canvas;
  };
  return {
    show(detail, origin): void {
      const name = text(detail, '.soul-plan-hero strong') || '收藏方案';
      preview.show(active => render(detail, active), `${name}-配装方案-${new Date().toISOString().slice(0, 10)}.png`, origin);
    }, close: preview.close, dispose: preview.dispose,
  };
}
