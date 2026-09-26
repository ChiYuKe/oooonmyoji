/**
 * 内容移动/重命名后的引用改写结果展示。
 *
 * 业务汇总由 `rewrite-report.ts` 完成；本模块只把汇总结果映射到 toast 和弹窗 DOM。
 * 所有外部对象都由调用方传入，因此无需加载整个工作台就能验证真实展示逻辑。
 */
import type { MoveContentResult } from '../../shared/contracts';
import { contentRewriteReport, type ContentRewriteVerb } from './rewrite-report';

export interface ContentRewriteDialogElements {
  modal: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  hint: HTMLElement;
  list: HTMLElement;
  confirm: HTMLButtonElement;
}

export interface ContentRewriteDialogDeps {
  document: Pick<Document, 'createElement'>;
  showToast(message: string, error?: boolean): void;
  schedule(callback: () => void): void;
}

/** 显示引用改写结果；没有改写明细时保持轻量，只发送一条 toast。 */
export function showContentRewriteResult(
  result: MoveContentResult,
  verb: ContentRewriteVerb,
  skipped: readonly string[],
  elements: ContentRewriteDialogElements,
  deps: ContentRewriteDialogDeps,
): void {
  const report = contentRewriteReport(result, verb);
  if (report.rows.length === 0) {
    deps.showToast(report.title);
    return;
  }

  deps.showToast(`${report.title}，已重定向 ${report.references} 处引用`);
  elements.title.textContent = report.title;
  elements.subtitle.textContent = report.subtitle;
  elements.hint.textContent = skipped.length > 0
    ? `另有 ${skipped.length} 个文件有未保存修改，未自动重载：保存它们会覆盖本次重定向（${skipped.join('、')}）`
    : '改动已写入磁盘，可用右键菜单的「引用查看器」复核';
  elements.list.replaceChildren(...report.rows.map((detail) => {
    const row = deps.document.createElement('div');
    row.className = 'content-rewrite-item';
    const path = deps.document.createElement('span');
    path.className = 'content-rewrite-path';
    path.textContent = detail.path;
    path.title = detail.path;
    const count = deps.document.createElement('span');
    count.className = 'content-rewrite-count';
    count.textContent = `${detail.references} 处`;
    row.append(path, count);
    return row;
  }));
  elements.modal.classList.remove('hidden');
  elements.modal.setAttribute('aria-hidden', 'false');
  deps.schedule(() => elements.confirm.focus());
}
