import type { SoulRecord } from '../../../../shared/souls';

// Positions follow the equipment ring: upper left, left, lower left,
// lower right, right, upper right. The portrait itself is never rotated.
const SLOT_OUTLINES: Readonly<Record<number, string>> = {
  1: 'M7 7H32A25 25 0 1 1 7 32Z',
  2: 'M14.322 14.322A25 25 0 1 1 14.322 49.678L1 32Z',
  3: 'M7 32A25 25 0 1 1 32 57H7Z',
  4: 'M32 57A25 25 0 1 1 57 32V57Z',
  5: 'M49.678 49.678A25 25 0 1 1 49.678 14.322L63 32Z',
  6: 'M32 7H57V32A25 25 0 1 1 32 7Z',
};

/** One lightweight vector outline, shared by inventory and equipment-plan cards. */
export function createSoulPositionPortrait(doc: Document, soul: SoulRecord, lazy = false): HTMLElement {
  const portrait = doc.createElement('span'); portrait.className = 'soul-position-portrait';
  portrait.dataset.position = String(soul.position ?? 'unknown'); portrait.dataset.stars = String(soul.stars ?? 0);
  portrait.setAttribute('aria-hidden', 'true');
  const outline = SLOT_OUTLINES[soul.position ?? 0];
  if (outline) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', outline);
    svg.append(path); portrait.append(svg);
  }
  const bundledIconUrl = Number.isSafeInteger(soul.suitId) && (soul.suitId ?? 0) > 0
    ? `onmyoji-resource://project/assets/soul-icons/${soul.suitId}.png` : undefined;
  const iconUrl = soul.iconUrl || bundledIconUrl;
  if (iconUrl) {
    const image = doc.createElement('img'); image.className = 'soul-icon'; image.src = iconUrl; image.alt = '';
    image.loading = lazy ? 'lazy' : 'eager'; image.decoding = 'async';
    let retriedBundledIcon = false;
    image.addEventListener('error', () => {
      if (!retriedBundledIcon && bundledIconUrl && image.src !== bundledIconUrl) {
        retriedBundledIcon = true; image.src = bundledIconUrl; return;
      }
      image.remove();
      if (!portrait.querySelector('.soul-icon-placeholder')) {
        const placeholder = doc.createElement('span'); placeholder.className = 'soul-icon-placeholder';
        placeholder.textContent = (soul.name ?? '御魂').slice(0, 1); portrait.append(placeholder);
      }
    });
    portrait.append(image);
  } else {
    const placeholder = doc.createElement('span'); placeholder.className = 'soul-icon-placeholder';
    placeholder.textContent = (soul.name ?? '御魂').slice(0, 1); portrait.append(placeholder);
  }
  return portrait;
}
