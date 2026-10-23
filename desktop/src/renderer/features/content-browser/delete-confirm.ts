import type { ReferenceGraph, ReferenceItem } from '../../../shared/contracts';
import type { ImpactConfirmItem, ImpactConfirmRequest, ImpactConfirmSection } from '../../ui/impact-confirm';

function referenceItem(item: ReferenceItem): ImpactConfirmItem {
  const locations = [...new Set(item.contexts.map((context) => context.label).filter(Boolean))];
  return {
    label: `${item.target.name}${item.target.exists ? '' : '（文件不存在）'}`,
    detail: [item.target.path, locations.length ? `引用位置：${locations.join('、')}` : ''].filter(Boolean).join('\n'),
  };
}

/** 删除前按文件列出双向引用；只删除所选文件，不连带删除其依赖。 */
export function contentDeleteConfirmRequest(
  items: readonly { name: string; path: string }[],
  graphs: readonly ReferenceGraph[],
): ImpactConfirmRequest {
  const sections: ImpactConfirmSection[] = [];
  for (const graph of graphs) {
    const prefix = graphs.length > 1 ? `${graph.target.name} · ` : '';
    sections.push({
      title: `${prefix}引用的内容（${graph.references.length}）`,
      items: graph.references.map(referenceItem),
      emptyText: '未引用其他内容',
    }, {
      title: `${prefix}被以下内容引用（${graph.referencedBy.length}）`,
      items: graph.referencedBy.map(referenceItem),
      emptyText: '未被其他内容引用',
    });
  }
  const referenced = graphs.filter((graph) => graph.referencedBy.length > 0).length;
  return {
    title: items.length === 1 ? '删除内容' : `删除 ${items.length} 项内容`,
    summary: referenced
      ? `其中 ${referenced} 项内容仍被引用，暂不能删除。请先解除下方引用。`
      : '确认删除以下内容？所引用的文件会保留。',
    items: items.map((item) => ({ label: item.name, detail: item.path })),
    sections,
    confirmLabel: '删除',
    cancelLabel: '取消',
    danger: true,
  };
}
