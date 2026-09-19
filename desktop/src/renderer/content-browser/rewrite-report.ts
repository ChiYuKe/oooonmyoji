/**
 * 内容移动/重命名后的引用改写报告：纯逻辑，便于 Node 冒烟测试。
 * 明细由主进程给出（被改写的文件 + 该文件内的替换处数），这里只负责归并、排序与文案。
 */
import type { ContentRewriteDetail, MoveContentResult } from '../../shared/contracts';

export type ContentRewriteVerb = '重命名' | '移动';

export interface ContentRewriteReport {
  /** 弹窗标题，例如「已重命名为 assets/templates/b.png」。 */
  title: string;
  /** 副标题，例如「2 个文件、5 处引用已重定向」；没有明细时为空串。 */
  subtitle: string;
  /** 明细行：引用处数降序，同数按路径排。 */
  rows: ContentRewriteDetail[];
  /** 明细里的引用处数合计，供 toast 使用。 */
  references: number;
}

function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').trim();
}

/**
 * 汇总一次移动/重命名的引用改写结果。
 * 同一路径合并计数（正常 IPC 不会重复，合并只是让跨版本/跨后端的结果也稳定），
 * `rewritten` 缺失或非法时按空列表处理，此时调用方只弹 toast。
 */
export function contentRewriteReport(result: MoveContentResult, verb: ContentRewriteVerb): ContentRewriteReport {
  const merged = new Map<string, number>();
  for (const detail of result.rewritten ?? []) {
    const path = normalizePath(detail?.path);
    if (!path) continue;
    const references = Number.isFinite(detail?.references) && detail.references > 0 ? Math.trunc(detail.references) : 1;
    merged.set(path, (merged.get(path) ?? 0) + references);
  }
  const rows = [...merged.entries()]
    .map(([path, references]) => ({ path, references }))
    .sort((left, right) => right.references - left.references || left.path.localeCompare(right.path, 'zh-CN'));
  const references = rows.reduce((total, row) => total + row.references, 0);
  return {
    title: `已${verb}为 ${normalizePath(result.targetPath)}`,
    subtitle: rows.length > 0 ? `${rows.length} 个文件、${references} 处引用已重定向` : '',
    rows,
    references,
  };
}
