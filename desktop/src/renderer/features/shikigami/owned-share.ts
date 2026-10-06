import { installImageShare, type ImageShareApi } from '../../ui/image-share';

export type OwnedShareApi = ImageShareApi;

/** Snapshot the displayed configuration, including its resolved panel, without recalculating it. */
export function installShikigamiOwnedShare(root: HTMLElement, api?: OwnedShareApi): {
  show(article: HTMLElement, heading: HTMLElement, name: string, origin: HTMLElement): void;
  close(): void; dispose(): void;
} {
  const doc = root.ownerDocument, win = doc.defaultView!;
  const preview = installImageShare(root, api, { className: 'shikigami-owned-share', title: '分享式神配置', caption: '完整展示技能等级、御魂装配和属性面板' });
  const text = (parent: ParentNode, selector: string): string => parent.querySelector(selector)?.textContent?.trim() ?? '';
  const all = (parent: ParentNode, selector: string): HTMLElement[] => [...parent.querySelectorAll<HTMLElement>(selector)];
  const render = async (article: HTMLElement, heading: HTMLElement, name: string, active: () => boolean): Promise<HTMLCanvasElement | null> => {
    // Copy text before awaiting assets so changing the account cannot change this export.
    const source = article.cloneNode(true) as HTMLElement, identity = heading.cloneNode(true) as HTMLElement;
    const style = win.getComputedStyle(article), font = style.fontFamily;
    const color = (selector: string, property = 'color', fallback = '#888'): string => {
      const node = article.querySelector<HTMLElement>(selector); return node ? win.getComputedStyle(node).getPropertyValue(property) : fallback;
    };
    const theme = { background: win.getComputedStyle(root).getPropertyValue('--surface').trim() || '#222', group: style.backgroundColor,
      card: color('.shikigami-owned-soul', 'background-color', '#222'), text: style.color,
      muted: color('h4'), accent: color('.shikigami-owned-addition'), total: color('.shikigami-owned-total'),
      main: color('.soul-main-attribute', 'color', '#d7b46a'), intrinsic: color('.soul-intrinsic-attribute', 'color', '#8bc9a4'),
      rollBackground: color('.soul-upgrade-count', 'background-color', '#d7b46a'), rollText: color('.soul-upgrade-count', 'color', '#222'),
      border: win.getComputedStyle(root).getPropertyValue('--border-soft').trim() || '#444' };
    const badgeColors = all(article, '.shikigami-owned-soul').map(slot => all(slot, '.soul-detail-badges span').map(badge => win.getComputedStyle(badge).color));
    await doc.fonts.ready;
    const paths = [...new Set(all(source, 'img').concat(all(identity, 'img')).map(img => {
      try { const url = new URL((img as HTMLImageElement).src); return url.protocol === 'onmyoji-resource:' ? url.pathname.replace(/^\//, '') : ''; } catch { return ''; }
    }).filter(Boolean))];
    const images = new Map<string, HTMLImageElement>();
    if (api?.readAssetData) for (let start = 0; start < paths.length; start += 64) {
      if (!active()) return null;
      const assets = await api.readAssetData(paths.slice(start, start + 64));
      await Promise.all(assets.map(async asset => {
        const img = doc.createElement('img'); img.src = asset.dataUrl;
        try { await img.decode(); images.set(asset.path, img); } catch { /* Keep a text placeholder for missing local artwork. */ }
      }));
    }
    if (!active()) return null;
    const output = doc.createElement('canvas'), ctx = output.getContext('2d'); if (!ctx) throw Error('无法生成配置分享图片');
    const width = 1120, margin = 24, gap = 12, inner = width - margin * 2, panelWidth = 284;
    const gearWidth = (inner - panelWidth - 18 - gap * 2) / 3, panelX = width - margin - panelWidth;
    const rows = all(source, '.shikigami-owned-soul').map(slot => all(slot, '.soul-main-attribute, .soul-sub-attribute, .soul-intrinsic-attribute'));
    const attributeOffsets = rows.map(attrs => {
      let y = 128, intrinsic = false;
      return attrs.map(attr => {
        if (!intrinsic && attr.classList.contains('soul-intrinsic-attribute')) { y += 14; intrinsic = true; }
        const offset = y; y += 26; return offset;
      });
    });
    const rowHeights = [0, 1].map(row => Math.max(200, ...attributeOffsets.slice(row * 3, row * 3 + 3).map(offsets => (offsets.at(-1) ?? 108) + 62)));
    const effects = all(source, '.shikigami-owned-set-effects > div');
    // Measure wrapping with the same font used for final drawing.
    ctx.font = `12px ${font}`;
    const lines = (value: string, max: number): string[] => {
      const result: string[] = []; let line = '';
      for (const letter of value) {
        if (letter === '\n' || (line && ctx.measureText(line + letter).width > max)) { result.push(line); line = ''; }
        if (letter !== '\n') line += letter;
      }
      if (line) result.push(line); return result;
    };
    const note = text(source, '.shikigami-owned-panel-note');
    const effectRows = effects.map(effect => [text(effect, 'strong'), ...all(effect, 'p').flatMap(p => lines(p.textContent ?? '', panelWidth - 24))]);
    const panelHeight = 304 + lines(note, panelWidth).length * 20 + (effects.length ? 40 : 0) + effectRows.reduce((sum, lines) => sum + 24 + lines.length * 21 + gap, 0);
    const skills = all(source, '.shikigami-owned-skill'), skillRows = Math.max(1, Math.ceil(skills.length / 3));
    const gearY = 192 + skillRows * 76, bodyHeight = Math.max(rowHeights[0] + gap + rowHeights[1], panelHeight);
    const height = gearY + bodyHeight + 40;
    output.width = width * 2; output.height = height * 2; ctx.scale(2, 2);
    output.dataset.slots = String(rows.length); output.dataset.loadedPortraits = String(images.size);
    output.dataset.heroName = name; output.dataset.configuration = text(source, 'h3');
    output.setAttribute('role', 'img'); output.setAttribute('aria-label', `${name} ${text(source, 'h3')}，完整技能等级、六件御魂及属性面板`);
    const label = (value: string, x: number, y: number, size = 12, color = theme.text, bold = false, align: CanvasTextAlign = 'left', max?: number): void => {
      ctx.fillStyle = color; ctx.font = `${bold ? '600' : '400'} ${size}px ${font}`; ctx.textAlign = align; ctx.fillText(value, x, y, max);
    };
    const box = (x: number, y: number, w: number, h: number, color = theme.card): void => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
    };
    const portrait = (parent: ParentNode, x: number, y: number, size: number, fallback: string): void => {
      const img = parent.querySelector<HTMLImageElement>('img');
      const path = img ? new URL(img.src).pathname.replace(/^\//, '') : '';
      const image = images.get(path), shape = parent.querySelector('svg path')?.getAttribute('d');
      ctx.save();
      if (shape) {
        ctx.translate(x, y); ctx.scale(size / 64, size / 64); const outline = new Path2D(shape);
        ctx.strokeStyle = theme.main; ctx.lineWidth = 2; ctx.stroke(outline); ctx.clip(outline);
        if (image) ctx.drawImage(image, 7, 7, 50, 50); else label(fallback.slice(0, 1), 32, 40, 24, theme.text, false, 'center');
      } else {
        ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
        if (image) ctx.drawImage(image, x, y, size, size); else { box(x, y, size, size); label(fallback.slice(0, 1), x + size / 2, y + size * .67, size * .5, theme.text, false, 'center'); }
      }
      ctx.restore();
    };
    box(0, 0, width, height, theme.background); box(margin - 8, 96, inner + 16, height - 120, theme.group);
    portrait(identity, margin, 24, 60, name); label(`${name} · 仓库配置`, margin + 76, 54, 22, theme.text, true);
    label(text(source, 'h3'), margin, 126, 15, theme.text, true);
    let badgeX = margin + 78;
    for (const badge of all(source, '.shikigami-owned-badges span')) {
      const value = badge.textContent ?? ''; ctx.font = `11px ${font}`; const w = ctx.measureText(value).width + 16;
      box(badgeX, 109, w, 24); label(value, badgeX + 8, 125, 11, theme.muted); badgeX += w + 6;
    }
    label(text(source, '.shikigami-owned-quantity'), width - margin, 126, 18, theme.text, true, 'right');
    label('技能等级', margin, 160, 12, theme.muted);
    if (!skills.length) label('该式神无可显示的技能等级。', margin, 198, 12, theme.muted);
    skills.forEach((skill, i) => {
      const w = (inner - gap * 2) / 3, x = margin + i % 3 * (w + gap), y = 174 + Math.floor(i / 3) * 76;
      box(x, y, w, 64); const name = text(skill, ':scope > div > span'); portrait(skill, x + 12, y + 12, 40, name);
      label(name, x + 62, y + 27, 13, theme.text, false, 'left', w - 74); label(text(skill, 'strong'), x + 62, y + 49, 12, theme.accent, true);
    });
    label('御魂装配', margin, gearY - 12, 12, theme.muted); label('属性面板', panelX, gearY - 12, 12, theme.muted);
    all(source, '.shikigami-owned-soul').forEach((slot, i) => {
      const x = margin + i % 3 * (gearWidth + gap), y = gearY + (i >= 3 ? rowHeights[0] + gap : 0);
      box(x, y, gearWidth, rowHeights[Math.floor(i / 3)]); label(text(slot, '.shikigami-owned-soul-heading'), x + 12, y + 22, 11, theme.muted);
      const identity = slot.querySelector('.shikigami-owned-soul-identity');
      if (!identity) { label(text(slot, '.shikigami-owned-empty-slot'), x + 12, y + 62, 13, theme.muted); return; }
      const name = text(identity, 'strong'); portrait(identity, x + 12, y + 35, 38, name); label(name, x + 62, y + 60, 13, theme.text, true, 'left', gearWidth - 74);
      let bx = x + 12;
      all(slot, '.soul-detail-badges span').forEach((badge, index) => { const value = badge.textContent ?? ''; label(value, bx, y + 92, 11, badgeColors[i]?.[index] ?? theme.muted); bx += value.length * 12 + 12; });
      ctx.strokeStyle = theme.border; ctx.beginPath(); ctx.moveTo(x + 12, y + 106); ctx.lineTo(x + gearWidth - 12, y + 106); ctx.stroke();
      rows[i].forEach((attr, index) => {
        const ay = y + attributeOffsets[i][index], main = attr.classList.contains('soul-main-attribute'), intrinsic = attr.classList.contains('soul-intrinsic-attribute');
        if (intrinsic && !rows[i][index - 1]?.classList.contains('soul-intrinsic-attribute')) {
          ctx.strokeStyle = theme.border; ctx.beginPath(); ctx.moveTo(x + 12, ay - 20); ctx.lineTo(x + gearWidth - 12, ay - 20); ctx.stroke();
        }
        label(text(attr, '.soul-detail-attribute-label') || attr.textContent || '', x + 12, ay, 11, main ? theme.main : intrinsic ? theme.intrinsic : theme.text, false, 'left', gearWidth - 105);
        const roll = text(attr, '.soul-upgrade-count');
        // Match the detail grid: reserve the 16px upgrade column even without a badge.
        label(text(attr, '.soul-detail-attribute-value'), x + gearWidth - (intrinsic ? 12 : 36), ay, 11, main ? theme.main : intrinsic ? theme.intrinsic : theme.accent, true, 'right');
        if (roll) {
          const cx = x + gearWidth - 20, cy = ay - 4;
          ctx.fillStyle = theme.rollBackground; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
          label(roll, cx, cy + 3.5, 10, theme.rollText, true, 'center');
        }
      });
      let py = y + (attributeOffsets[i].at(-1) ?? 108) + 32;
      for (const pending of all(slot, '.soul-detail-pending')) for (const line of lines(pending.textContent ?? '', gearWidth - 24)) { label(line, x + 12, py, 10, theme.muted); py += 16; }
    });
    box(panelX, gearY, panelWidth, 282); label('属性', panelX + 12, gearY + 22, 11, theme.muted);
    label('御魂加成', panelX + 175, gearY + 22, 11, theme.muted, false, 'right'); label('总属性', panelX + panelWidth - 12, gearY + 22, 11, theme.muted, false, 'right');
    all(source, '[data-panel-key]').forEach((row, i) => {
      const y = gearY + 54 + i * 29; label(text(row, 'th'), panelX + 12, y, 12, theme.muted);
      label(text(row, '.shikigami-owned-addition'), panelX + 175, y, 12, theme.accent, true, 'right');
      label(text(row, '.shikigami-owned-total'), panelX + panelWidth - 12, y, 12, theme.total, true, 'right');
    });
    let sy = gearY + 305;
    ctx.font = `12px ${font}`; for (const line of lines(note, panelWidth)) { label(line, panelX, sy, 12, theme.muted); sy += 20; }
    if (effects.length) { sy += 18; label('套装效果', panelX, sy, 12, theme.muted); sy += 14; }
    effectRows.forEach(values => { box(panelX, sy, panelWidth, 24 + values.length * 21); values.forEach((line, i) => label(line, panelX + 12, sy + 22 + i * 21, 12, i ? theme.muted : theme.text, i === 0)); sy += 24 + values.length * 21 + gap; });
    return output;
  };
  return {
    show(article, heading, name, origin): void {
      preview.show(active => render(article, heading, name, active), `${name}-${text(article, 'h3')}-${new Date().toISOString().slice(0, 10)}.png`, origin);
    }, close: preview.close, dispose: preview.dispose,
  };
}
