/**
 * 落盘文本的唯一出口。
 *
 * 画布内部一直是编辑形态（`children` / `_layout`），磁盘上只有一种格式：`.owf` 文本
 * （语法见 `docs/workflow-dsl-v6.md`）。所有保存路径都必须经过这里，否则会出现
 * 「同一个文件被两种写法交替覆盖」。
 */
import { emitRuntimeDocument } from '../../shared/workflow/graph-dsl';

/** 调用方只需要交出内存里的编辑形态文档（画布的 `state.raw`）。 */
export interface DocumentTextSource {
  raw: unknown;
}

export function documentText(state: DocumentTextSource): string {
  return emitRuntimeDocument(state.raw as Record<string, unknown>);
}
