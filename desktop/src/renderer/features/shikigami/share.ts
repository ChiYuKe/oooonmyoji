import type { HeroProfile } from '../../../shared/soul-optimizer';
import type { HeroOwnershipSnapshot } from '../../../shared/hero-ownership';
import type { OnmyojiDesktopApi } from '../../../shared/contracts';
import { HERO_RARITIES } from '../souls/optimizer/picker';

/** Render one complete, exportable image; preview and saved PNG use the same pixels. */
export function installShikigamiShare(root: HTMLElement, heroes: HeroProfile[], saveImage?: OnmyojiDesktopApi['saveCanvas'], loadArtwork?: OnmyojiDesktopApi['readAssetData'], copyImage?: OnmyojiDesktopApi['copyImageToClipboard']): {
  show(snapshot: HeroOwnershipSnapshot | null, instanceName: string, origin: HTMLElement): void;
  close(): void; dispose(): void;
} {
  const doc = root.ownerDocument, win = doc.defaultView!;
  const dialog = doc.createElement('dialog'); dialog.className = 'soul-optimizer shikigami-share';
  dialog.setAttribute('aria-label', '分享式神图鉴');
  dialog.innerHTML = `<header class="soul-optimizer-header"><div><h2>分享式神图鉴</h2><p>完整卡片长图，保留拥有数量与稀有度</p></div><button type="button" data-share="close" aria-label="关闭分享" autofocus>×</button></header>
    <div class="shikigami-share-toolbar"><label>分享范围 <select data-share="scope"><option value="all">全部式神</option><option value="owned">已拥有式神</option></select></label><label>每行 <select data-share="columns"><option value="8">8 张</option><option value="10" selected>10 张</option><option value="12">12 张</option></select></label><button type="button" data-share="zoom" aria-pressed="false">原尺寸</button><button type="button" data-share="save">保存图片</button><button type="button" data-share="copy">复制</button><span data-share="status" role="status" aria-live="polite"></span></div>
    <div class="shikigami-share-preview" data-share="preview" aria-label="完整式神卡片预览"></div>`;
  root.append(dialog);
  const el = <T extends HTMLElement>(name: string): T => dialog.querySelector<T>(`[data-share="${name}"]`)!;
  const scope = el<HTMLSelectElement>('scope'), columns = el<HTMLSelectElement>('columns'), save = el<HTMLButtonElement>('save');
  const copy = el<HTMLButtonElement>('copy');
  const bitmaps = new Map<number, ImageBitmap>();
  let snapshot: HeroOwnershipSnapshot | null = null, name = '', origin: HTMLElement | null = null;
  let generation = 0, disposed = false, saving = false, copying = false, fullSize = false, image: HTMLCanvasElement | null = null, abort: AbortController | null = null;
  const close = (): void => {
    ++generation; abort?.abort(); abort = null;
    const anchor = origin; origin = null;
    if (dialog.open) { dialog.close(); if (anchor?.isConnected && !root.closest('[hidden]')) anchor.focus({ preventScroll: true }); }
    image = null; el('preview').replaceChildren();
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  el('close').addEventListener('click', close);
  const applyZoom = (): void => {
    if (image) image.style.width = fullSize ? `${image.width / 2}px` : '100%';
    el('zoom').textContent = fullSize ? '适应窗口' : '原尺寸'; el('zoom').setAttribute('aria-pressed', String(fullSize));
  };
  el('zoom').addEventListener('click', () => { fullSize = !fullSize; applyZoom(); });

  // Resolve theme colors through the same classes as the atlas cards.
  const palette = (): { background: string; card: string; text: string; muted: string; badge: string; owned: string; border: string; rarities: Record<number, string>; font: string } => {
    const probe = doc.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    probe.innerHTML = '<div class="shikigami-atlas-card"><span class="shikigami-atlas-card-meta"><small></small></span><span class="shikigami-atlas-card-ownership is-owned"></span></div>';
    root.append(probe);
    const card = probe.firstElementChild!, badge = card.querySelector('small')!, owned = card.lastElementChild!;
    const color = (css: string): string => { probe.style.color = css; return win.getComputedStyle(probe).color; };
    const rarities: Record<number, string> = {};
    for (const rarity of [1, 2, 3, 4, 5, 6]) {
      const label = doc.createElement('span'); label.className = 'hero-rarity'; label.dataset.rarity = String(rarity); probe.append(label);
      rarities[rarity] = win.getComputedStyle(label).color;
    }
    const result = { background: color('var(--surface)'), card: win.getComputedStyle(card).backgroundColor,
      text: color('var(--text)'), muted: win.getComputedStyle(badge).color, badge: win.getComputedStyle(badge).backgroundColor,
      owned: win.getComputedStyle(owned).color, border: color('var(--border-soft)'), rarities, font: win.getComputedStyle(root).fontFamily };
    probe.remove(); return result;
  };
  const wrap = (ctx: CanvasRenderingContext2D, text: string, width: number): string[] => {
    const lines: string[] = []; let line = '';
    for (const letter of text) {
      if (line && ctx.measureText(line + letter).width > width) { lines.push(line); line = ''; }
      line += letter;
    }
    if (line) lines.push(line);
    if (lines.length > 2) {
      let last = lines[1]; while (last && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
      return [lines[0], last + '…'];
    }
    return lines;
  };
  const render = async (): Promise<void> => {
    abort?.abort(); abort = new AbortController(); const controller = abort, version = ++generation;
    image = null; save.disabled = true; copy.disabled = true; scope.disabled = true; columns.disabled = true;
    el('preview').replaceChildren(); el('status').textContent = '正在渲染完整卡片…';
    const selected = scope.value === 'owned' ? heroes.filter(hero => Boolean(snapshot?.counts[hero.id])) : heroes;
    try {
      await doc.fonts.ready;
      const artwork = new Map<string, string>();
      if (loadArtwork) {
        const paths = selected.filter(hero => !bitmaps.has(hero.id)).map(hero => `assets/hero-icons/${hero.id}.png`);
        // The existing asset API accepts at most 64 paths per call.
        for (let start = 0; start < paths.length && !controller.signal.aborted; start += 64) {
          for (const item of await loadArtwork(paths.slice(start, start + 64))) artwork.set(item.path, item.dataUrl);
        }
      }
      let cursor = 0;
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (cursor < selected.length && !controller.signal.aborted) {
          const hero = selected[cursor++]; if (bitmaps.has(hero.id)) continue;
          try {
            const url = loadArtwork ? artwork.get(`assets/hero-icons/${hero.id}.png`) : `onmyoji-resource://project/assets/hero-icons/${hero.id}.png`;
            if (!url) continue;
            // data: is allowed by img-src, but intentionally not by connect-src.
            // Decode as an image without fetch, which otherwise fails under the app CSP.
            const decoded = doc.createElement('img'); decoded.src = url; await decoded.decode();
            const bitmap = await win.createImageBitmap(decoded);
            if (controller.signal.aborted || disposed) bitmap.close(); else bitmaps.set(hero.id, bitmap);
          } catch { /* Missing local artwork uses the same initial-letter fallback. */ }
        }
      }));
      if (disposed || version !== generation || !dialog.open) return;
      const theme = palette(), count = Number(columns.value), pad = 24, gap = 8, cardWidth = 112, cardHeight = 156;
      const width = pad * 2 + count * cardWidth + (count - 1) * gap;
      const rows = Math.ceil(selected.length / count), height = 154 + Math.max(1, rows) * (cardHeight + gap) + 40;
      const canvas = doc.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${name || '式神图鉴'}，${selected.length} 张完整式神卡片`);
      canvas.dataset.cardCount = String(selected.length); canvas.dataset.columns = String(count);
      canvas.dataset.loadedPortraits = String(selected.filter(hero => bitmaps.has(hero.id)).length);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法生成分享图片');
      ctx.scale(2, 2); ctx.fillStyle = theme.background; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = theme.text; ctx.font = `600 24px ${theme.font}`; ctx.fillText('式神图鉴', pad, 48);
      ctx.font = `14px ${theme.font}`; ctx.fillText(name || '式神收藏', pad, 76);
      ctx.fillStyle = theme.muted; ctx.font = `12px ${theme.font}`;
      const ownedCount = heroes.filter(hero => Boolean(snapshot?.counts[hero.id])).length;
      const meta = snapshot ? `已拥有 ${ownedCount} / ${heroes.length} 位 · 仓库共 ${snapshot.total.toLocaleString()} 只 · 同步于 ${new Date(snapshot.fetchedAt).toLocaleString()}` : '尚未检测仓库 · 拥有情况未知';
      ctx.fillText(meta, pad, 100);
      ctx.fillText(`${scope.value === 'owned' ? '已拥有式神' : '全部式神'} · ${selected.length} 张卡片`, pad, 126);
      const rounded = (x: number, y: number, w: number, h: number, radius = 4): void => { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); };
      for (const [index, hero] of selected.entries()) {
        const x = pad + index % count * (cardWidth + gap), y = 154 + Math.floor(index / count) * (cardHeight + gap);
        ctx.fillStyle = theme.card; ctx.shadowColor = '#0002'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
        rounded(x, y, cardWidth, cardHeight); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        const owned = snapshot?.counts[hero.id] ?? 0;
        const label = snapshot ? owned ? `已拥有 × ${owned}` : '未拥有' : '未检测';
        ctx.font = `9px ${theme.font}`; ctx.fillStyle = theme.badge; rounded(x + 7, y + 7, Math.min(75, ctx.measureText(label).width + 6), 14, 2);
        ctx.fillStyle = owned ? theme.owned : theme.muted; ctx.textAlign = 'left'; ctx.fillText(label, x + 10, y + 17, 69);
        ctx.fillStyle = theme.badge; rounded(x + 82, y + 7, 24, 19, 2);
        ctx.fillStyle = theme.rarities[hero.rarity] ?? theme.muted; ctx.font = `600 10px ${theme.font}`; ctx.textAlign = 'center';
        ctx.fillText(HERO_RARITIES[hero.rarity] ?? '', x + 94, y + 20);
        const bitmap = bitmaps.get(hero.id);
        ctx.save(); ctx.beginPath(); ctx.arc(x + 56, y + 57, 24, 0, Math.PI * 2); ctx.clip();
        if (bitmap) {
          const side = Math.min(bitmap.width, bitmap.height);
          ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, x + 32, y + 33, 48, 48);
        } else { ctx.fillStyle = theme.badge; ctx.fillRect(x + 32, y + 33, 48, 48); ctx.fillStyle = theme.text; ctx.font = `20px ${theme.font}`; ctx.fillText(hero.name.slice(0, 1), x + 56, y + 64); }
        ctx.restore(); ctx.fillStyle = theme.text; ctx.font = `500 12px ${theme.font}`;
        for (const [line, text] of wrap(ctx, hero.name, cardWidth - 14).entries()) ctx.fillText(text, x + 56, y + 100 + line * 16);
        ctx.strokeStyle = theme.border; ctx.beginPath(); ctx.moveTo(x + 9, y + 130); ctx.lineTo(x + 103, y + 130); ctx.stroke();
        ctx.fillStyle = theme.muted; ctx.font = `10px ${theme.font}`;
        ctx.fillText(hero.base ? `速度${hero.base.speed}  暴击${(hero.base.crit * 100).toFixed(0)}%` : '基础面板暂缺', x + 56, y + 147);
      }
      if (!selected.length) { ctx.textAlign = 'left'; ctx.fillStyle = theme.muted; ctx.font = `14px ${theme.font}`; ctx.fillText('本次仓库检测中未拥有图鉴内的式神。', pad, 202); }
      ctx.textAlign = 'right'; ctx.fillStyle = theme.muted; ctx.font = `11px ${theme.font}`; ctx.fillText('阴阳师 · 式神图鉴', width - pad, height - 18);
      image = canvas; applyZoom(); el('preview').replaceChildren(canvas);
      const missing = selected.filter(hero => !bitmaps.has(hero.id)).length;
      el('status').textContent = `已渲染 ${selected.length} 张卡片 · ${canvas.width} × ${canvas.height}${missing ? ` · ${missing} 张头像暂缺` : ''}`;
      save.disabled = !saveImage || saving; save.title = saveImage ? '保存完整 PNG 长图' : '当前窗口不支持保存图片';
      copy.disabled = !copyImage || copying; copy.title = copyImage ? '复制完整长图到剪贴板' : '当前窗口不支持复制图片';
    } catch (error) {
      if (version === generation && !disposed) el('status').textContent = error instanceof Error ? error.message : '图片生成失败，请重试';
    } finally {
      if (version === generation && !disposed) { scope.disabled = !snapshot; columns.disabled = false; }
    }
  };
  scope.addEventListener('change', () => { void render(); }); columns.addEventListener('change', () => { void render(); });
  save.addEventListener('click', async () => {
    if (!image || !saveImage || saving) return;
    const canvas = image, version = generation; saving = true; save.disabled = true;
    try {
      const saved = await saveImage({ filename: `式神图鉴-${snapshot?.instanceId ?? '全部'}-${new Date().toISOString().slice(0, 10)}.png`, dataUrl: canvas.toDataURL('image/png'), purpose: 'share' });
      if (!disposed && version === generation) el('status').textContent = saved ? '图片已保存，可以发送给好友。' : '已取消保存。';
    } catch (error) {
      if (!disposed && version === generation) el('status').textContent = error instanceof Error ? error.message : '保存失败，请重试';
    } finally { saving = false; if (!disposed && dialog.open) save.disabled = !image || !saveImage; }
  });
  copy.addEventListener('click', async () => {
    if (!image || !copyImage || copying) return;
    const canvas = image, version = generation; copying = true; copy.disabled = true;
    el('status').textContent = '正在复制完整图片…';
    try {
      await copyImage(canvas.toDataURL('image/png'));
      if (!disposed && version === generation) el('status').textContent = '图片已复制到剪贴板，可直接粘贴发送。';
    } catch (error) {
      if (!disposed && version === generation) el('status').textContent = error instanceof Error ? error.message : '复制失败，请重试';
    } finally { copying = false; if (!disposed && dialog.open) copy.disabled = !image || !copyImage; }
  });
  return {
    show(value, instanceName, anchor): void {
      snapshot = value; name = instanceName; origin = anchor; scope.value = 'all'; columns.value = '10'; fullSize = false; applyZoom();
      if (!dialog.open) dialog.showModal(); void render(); el('preview').scrollTop = 0;
    }, close,
    dispose(): void { disposed = true; close(); for (const bitmap of bitmaps.values()) bitmap.close(); bitmaps.clear(); image = null; dialog.remove(); },
  };
}
