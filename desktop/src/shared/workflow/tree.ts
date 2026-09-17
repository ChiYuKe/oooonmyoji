/** 工作流结构树：把 JSON 递归构建为前端逐层渲染的节点负载。 */
import { isObject } from './guards';
import type { TreeNodePayload } from './types';

/**
 * 把工作流 JSON 递归构建为结构树；根取 `raw.root` 指定或第一个 `type==='root'` 的节点。
 * 纯解析函数（不依赖 vscode），供独立结构树窗口与测试使用。
 * @param raw - 已解析的工作流对象。
 * @returns 单根数组（无根时为空数组）。
 */
export function buildTreeNode(raw: unknown): TreeNodePayload[] {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of raw.nodes) {
    if (isObject(item) && typeof item.id === 'string') byId.set(item.id, item);
  }
  const rootId = typeof raw.root === 'string' ? raw.root : '';
  const root = byId.get(rootId) || [...byId.values()].find((item) => item.type === 'root');
  if (!root) return [];
  const out: TreeNodePayload[] = [];
  buildNode(root, out);
  return out;

  function buildNode(node: Record<string, unknown>, target: TreeNodePayload[]): void {
    const type = typeof node.type === 'string' ? node.type : 'task';
    const id = typeof node.id === 'string' ? node.id : '';
    const params = isObject(node.params) ? node.params : {};
    const subRef = type === 'task' && node.action === 'workflow.run' && typeof params.workflow === 'string'
      ? String(params.workflow).split(/[\\/]/).pop()
      : '';
    const meta = type === 'task'
      ? (subRef ? `⇢ ${subRef}` : typeof node.action === 'string' ? node.action : 'task')
      : type === 'instance_parallel' && Array.isArray(node.runs)
        ? `${node.runs.length} 个实例`
        : type;
    const entry: TreeNodePayload = {
      id,
      name: typeof node.name === 'string' && node.name.trim() ? node.name.trim() : id,
      type,
      meta,
      children: [],
    };
    if (Array.isArray(node.children)) {
      for (const childId of node.children) {
        const child = byId.get(String(childId));
        if (child) buildNode(child, entry.children);
      }
    }
    target.push(entry);
  }
}
