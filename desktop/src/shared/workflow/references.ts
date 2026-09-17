/** 子工作流引用匹配：workflow.run / instance_parallel 引用与工作流文件的对应关系。 */
import { isObject } from './guards';
import type { WorkflowFileDescriptor, WorkflowRunReference } from './types';

export type { WorkflowFileDescriptor, WorkflowRunReference };

/**
 * 把 workflow.run 的子工作流引用（工作流 ID、JSON 文件名或 workflows/ 下的路径）
 * 匹配到具体工作流文件。ID 匹配需要读取文件内容，由调用方在找不到时逐文件比对 id。
 */
export function matchWorkflowReference(reference: string, files: WorkflowFileDescriptor[]): string | undefined {
  const ref = String(reference ?? '').trim();
  if (!ref) return undefined;
  const norm = ref.replace(/\\/g, '/');
  const withExt = norm.toLowerCase().endsWith('.json') ? norm : `${norm}.json`;
  for (const file of files) {
    if (file.name === norm || file.name === withExt) return file.uri;
    const rel = file.rel.replace(/\\/g, '/');
    if (rel === norm || rel === withExt || rel.endsWith(`/${norm}`) || rel.endsWith(`/${withExt}`)) return file.uri;
  }
  return undefined;
}

/**
 * 收集一个工作流 JSON 里全部 `workflow.run` 节点引用。
 * @param raw - 已解析的工作流对象。
 * @returns 按节点出现顺序排列的引用条目。
 */
export function collectWorkflowRunReferences(raw: unknown): WorkflowRunReference[] {
  const out: WorkflowRunReference[] = [];
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return out;
  for (const item of raw.nodes) {
    if (!isObject(item)) continue;
    if (String(item.type) !== 'task' || String(item.action) !== 'workflow.run') continue;
    const params = isObject(item.params) ? item.params : {};
    const reference = typeof params.workflow === 'string' ? params.workflow.trim() : '';
    if (!reference) continue;
    out.push({
      nodeId: typeof item.id === 'string' ? item.id : '',
      nodeName: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
      reference,
    });
  }
  return out;
}

/**
 * 把 workflow.run 的子工作流引用（工作流 ID、JSON 文件名或 workflows/ 下的路径）
 * 解析到具体工作流文件 URI。先按文件名/路径匹配；未命中时把引用当作工作流 ID，
 * 通过 `readText` 读取各文件内容逐文件比对 `id`。
 * @param reference - 引用原文（节点 `params.workflow`）。
 * @param files - 项目内全部工作流文件描述。
 * @param readText - 读取指定 URI 文件文本的异步回调。
 * @returns 命中文件的 URI，找不到时返回 undefined。
 */
export async function resolveWorkflowReference(
  reference: string,
  files: WorkflowFileDescriptor[],
  readText: (uri: string) => Promise<string>,
): Promise<string | undefined> {
  const byPath = matchWorkflowReference(reference, files);
  if (byPath) return byPath;
  const ref = String(reference ?? '').trim();
  if (!ref) return undefined;
  for (const file of files) {
    try {
      const raw = JSON.parse(await readText(file.uri)) as { id?: unknown };
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.id === ref) return file.uri;
    } catch {
      // 忽略读取/解析失败的文件；下一个候选仍可继续匹配。
    }
  }
  return undefined;
}
