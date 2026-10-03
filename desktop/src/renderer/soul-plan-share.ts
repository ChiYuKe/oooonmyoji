import { installImageShare, type ImageShareApi } from './image-share';

/** Export the displayed result, including saved-plan warnings, without recomputing the score. */
export function installSoulPlanShare(root: HTMLElement, api?: ImageShareApi): {
  show(detail: HTMLElement, origin: HTMLElement): void;
  close(): void; dispose(): void;
} {
  const doc = root.ownerDocument, win = doc.defaultView!;
  const preview = installImageShare(root, api, { className: 'soul-plan-share', title: '分享配装方案', caption: '完整展示六件御魂、评分、属性面板和套装效果' });
  const all = (parent: ParentNode, selector: string): HTMLElement[] => [...parent.querySelectorAll<HTMLElement>(selector)];
  const text = (parent: ParentNode, selector: string): string => parent.querySelector(selector)?.textContent?.trim() ?? '';
  const render = async (detail: HTMLElement, active: () => boolean): Promise<HTMLCanvasElement | null> => {
    const source = detail.cloneNode(true) as HTMLElement;
    const color = (selector: string, property = 'color', fallback = '#888'): string => {
      const node = detail.querySelector(selector); return node ? win.getComputedStyle(node).getPropertyValue(property) : fallback;
    };
    const style = win.getComputedStyle(detail), font = style.fontFamily;
    const theme = { background: style.backgroundColor, card: color('.soul-plan-equipment', 'background-color', '#303030'),
      button: color('.soul-plan-ring-soul', 'background-color', '#333'), table: color('.soul-plan-panel-table', 'background-color', '#222'),
      text: style.color, muted: color('.soul-plan-panel-note'), addition: color('.soul-panel-addition'), total: color('.soul-panel-total'),
      border: style.getPropertyValue('--border-soft').trim() || '#444' };
    const outlines = all(detail, '.soul-plan-ring-soul').map(slot => {
      const path = slot.querySelector('svg path'); return path ? win.getComputedStyle(path).stroke : theme.muted;
    });
    await doc.fonts.ready;
    const paths = [...new Set(all(source, 'img').map(node => {
      try { const url = new URL((node as HTMLImageElement).src); return url.protocol === 'onmyoji-resource:' ? url.pathname.replace(/^\//, '') : ''; } catch { return ''; }
    }).filter(Boolean))];
    const images = new Map<string, HTMLImageElement>();
    if (api?.readAssetData) for (let start = 0; start < paths.length; start += 64) {
      if (!active()) return null;
      const assets = await api.readAssetData(paths.slice(start, start + 64));
      await Promise.all(assets.map(async asset => {
        const image = doc.createElement('img'); image.src = asset.dataUrl;
        try { await image.decode(); images.set(asset.path, image); } catch { /* Missing local images retain their names. */ }
      }));
    }
    if (!active()) return null;
    const canvas = doc.createElement('canvas'), ctx = canvas.getContext('2d'); if (!ctx) throw Error('无法生成配装分享图片');
    const width = 1120, pad = 24, leftWidth = 556, rightX = pad + leftWidth + 20, rightWidth = width - pad - rightX;
    ctx.font = `12px ${font}`;
    const wrap = (value: string, max: number): string[] => {
      const result: string[] = []; let line = '';
      for (const letter of value) {
        if (letter === '\n' || (line && ctx.measureText(line + letter).width > max)) { result.push(line); line = ''; }
        if (letter !== '\n') line += letter;
      }
      if (line) result.push(line); return result;
    };
    const note = wrap(text(source, '.soul-plan-panel-note'), rightWidth - 24);
    const effects = all(source, '.soul-plan-effects > div').map(row => ({ row, title: text(row, 'strong'), lines: wrap(text(row, 'p'), rightWidth - 82) }));
    const panelHeight = 328 + note.length * 18, effectsHeight = 42 + effects.reduce((height, effect) => height + Math.max(42, 26 + effect.lines.length * 20) + 14, 0);
    const bodyY = 124, bodyHeight = Math.max(548, panelHeight + 16 + effectsHeight), height = bodyY + bodyHeight + 48;
    canvas.width = width * 2; canvas.height = height * 2; ctx.scale(2, 2);
    canvas.dataset.slots = String(all(source, '.soul-plan-ring-soul').length); canvas.dataset.loadedPortraits = String(images.size);
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `配装方案，${text(source, '[data-plan="note"]')}，六件御魂及完整属性与套装效果`);
    const label = (value: string, x: number, y: number, size = 12, color = theme.text, bold = false, align: CanvasTextAlign = 'left', max?: number): void => {
      ctx.fillStyle = color; ctx.font = `${bold ? '600' : '400'} ${size}px ${font}`; ctx.textAlign = align; ctx.fillText(value, x, y, max);
    };
    const box = (x: number, y: number, w: number, h: number, color: string): void => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); };
    const portrait = (parent: ParentNode, x: number, y: number, size: number, fallback: string, outlineColor = theme.muted): void => {
      const img = parent.querySelector<HTMLImageElement>('img');
      const image = img ? images.get(new URL(img.src).pathname.replace(/^\//, '')) : undefined;
      const shape = parent.querySelector('svg path')?.getAttribute('d');
      ctx.save();
      if (shape) {
        ctx.translate(x, y); ctx.scale(size / 64, size / 64); const outline = new Path2D(shape);
        ctx.strokeStyle = outlineColor; ctx.lineWidth = 2; ctx.stroke(outline); ctx.clip(outline);
        if (image) ctx.drawImage(image, 7, 7, 50, 50); else label(fallback.slice(0, 1), 32, 40, 24, theme.text, false, 'center');
      } else {
        ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
        if (image) ctx.drawImage(image, x, y, size, size); else { box(x, y, size, size, theme.table); label(fallback.slice(0, 1), x + size / 2, y + size * .67, size * .5, theme.text, false, 'center'); }
      }
      ctx.restore();
    };
    box(0, 0, width, height, theme.background); label('御魂配装方案', pad, 46, 24, theme.text, true);
    label(text(source, '[data-plan="note"]'), pad, 82, 16, theme.text, false, 'left', width - pad * 2);
    box(pad, bodyY, leftWidth, bodyHeight, theme.card); label('御魂装配', pad + 16, bodyY + 28, 12, theme.muted);
    const cx = pad + leftWidth / 2, cy = bodyY + bodyHeight / 2 + 12;
    const center = source.querySelector('.soul-plan-hero')!;
    const heroName = text(center, 'strong'); portrait(center, cx - 36, cy - 42, 72, heroName); label(heroName, cx, cy + 55, 16, theme.text, true, 'center');
    const offsets = [[-114, -142], [-173, 0], [-114, 142], [114, 142], [173, 0], [114, -142]];
    all(source, '.soul-plan-ring-soul').forEach((slot, i) => {
      const offset = offsets[Number(slot.dataset.position) - 1] ?? offsets[i], x = cx + offset[0], y = cy + offset[1];
      ctx.save(); ctx.shadowColor = 'rgba(0, 0, 0, .2)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
      ctx.fillStyle = theme.button; ctx.beginPath(); ctx.arc(x, y, 54, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      label(text(slot, 'small'), x, y - 38, 11, theme.muted, false, 'center');
      const name = text(slot, ':scope > span:last-child'); portrait(slot, x - 25, y - 29, 50, name, outlines[i]);
      label(name, x, y + 38, 12, theme.text, true, 'center', 102);
    });
    box(rightX, bodyY, rightWidth, panelHeight, theme.card); label('属性面板', rightX + 12, bodyY + 24, 12, theme.muted);
    const tableX = rightX + 12, tableY = bodyY + 38, tableWidth = rightWidth - 24;
    box(tableX, tableY, tableWidth, 274, theme.table);
    label('属性', tableX + 12, tableY + 22, 11, theme.muted); label('御魂加成', tableX + tableWidth * .67, tableY + 22, 11, theme.muted, false, 'right'); label('总属性', tableX + tableWidth - 12, tableY + 22, 11, theme.muted, false, 'right');
    all(source, '[data-panel-key]').forEach((row, i) => {
      const y = tableY + 51 + i * 29;
      ctx.strokeStyle = theme.border; ctx.beginPath(); ctx.moveTo(tableX + 12, y - 19); ctx.lineTo(tableX + tableWidth - 12, y - 19); ctx.stroke();
      label(text(row, 'th'), tableX + 12, y, 12, theme.muted); label(text(row, '.soul-panel-addition'), tableX + tableWidth * .67, y, 12, theme.addition, true, 'right'); label(text(row, '.soul-panel-total'), tableX + tableWidth - 12, y, 12, theme.total, true, 'right');
    });
    note.forEach((line, i) => label(line, rightX + 12, bodyY + 328 + i * 18, 12, theme.muted));
    let ey = bodyY + panelHeight + 16;
    box(rightX, ey, rightWidth, effectsHeight, theme.card); label('套装效果', rightX + 14, ey + 26, 12, theme.muted); ey += 42;
    effects.forEach(effect => {
      portrait(effect.row, rightX + 14, ey, 36, effect.title); label(effect.title, rightX + 62, ey + 14, 13, theme.text, true);
      effect.lines.forEach((line, i) => label(line, rightX + 62, ey + 36 + i * 20, 12, theme.muted));
      ey += Math.max(42, 26 + effect.lines.length * 20) + 14;
    });
    label('阴阳师 · 御魂配装', width - pad, height - 18, 11, theme.muted, false, 'right');
    return canvas;
  };
  return {
    show(detail, origin): void {
      const name = text(detail, '.soul-plan-hero strong') || '收藏方案';
      preview.show(active => render(detail, active), `${name}-配装方案-${new Date().toISOString().slice(0, 10)}.png`, origin);
    }, close: preview.close, dispose: preview.dispose,
  };
}
