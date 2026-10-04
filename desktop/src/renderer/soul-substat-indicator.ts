import { SUBSTAT_STATUS } from '../shared/soul-substat-standard';
import type { SubstatStatus } from '../shared/soul-substat-standard';

const icons: Record<SubstatStatus, string> = {
  core: 'M5 12l4 4L19 6',
  conditional: 'M12 3l9 9-9 9-9-9z',
  low: 'M7 7l10 10M7 17h10V7',
  overflow: 'M5 12h14M15 8l4 4-4 4M5 5v14',
  invalid: 'M5 12h14',
  pending: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01',
};
const meanings: Record<SubstatStatus, string> = {
  core: '直接提升当前评分。', conditional: '用于满足指定条件。',
  low: '能提升评分，但收益较低。', overflow: '超过当前方案的有效需求。',
  invalid: '不计入当前评分，也未承担指定条件。', pending: '需要确定用途后再判断。',
};

/** Keep the assessment accessible while showing a compact, shape-distinct marker. */
export function appendSubstatIndicator(parent: HTMLElement, status: SubstatStatus, reason = meanings[status], count?: number): HTMLElement {
  const doc = parent.ownerDocument, marker = doc.createElement('span');
  marker.className = count == null ? 'soul-substat-indicator' : 'soul-substat-indicator soul-substat-count';
  marker.dataset.substatStatus = status;
  marker.tabIndex = 0;
  const description = `${SUBSTAT_STATUS[status]}${count == null ? '' : ` · ${count} 条`}：${reason}`;
  marker.dataset.tooltip = description;
  marker.setAttribute('aria-label', description);
  marker.setAttribute('role', 'img');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', icons[status]);
  svg.append(path); marker.append(svg);
  if (count != null) { const numeral = doc.createElement('span'); numeral.textContent = String(count); numeral.setAttribute('aria-hidden', 'true'); marker.append(numeral); }
  parent.append(marker); return marker;
}

export function appendSubstatSummary(parent: HTMLElement, counts: Record<SubstatStatus, number>): HTMLElement {
  const summary = parent.ownerDocument.createElement('span'); summary.className = 'soul-substat-summary';
  for (const status of Object.keys(SUBSTAT_STATUS) as SubstatStatus[]) {
    if (counts[status]) appendSubstatIndicator(summary, status, meanings[status], counts[status]);
  }
  parent.append(summary); return summary;
}
