/**
 * 旧文档规范化：补齐缺失的顶层结构并做变量连线对账。
 * 载入/外部变更（replaceDocument）与运行事件共用同一份规则；
 * 作为纯模块导出，画布历史不再需要向运行事件模块借用。
 *
 * 注：`condition` 装饰器 → 判断节点的升级不在这里做，而在 `model/document-health`
 * 的 `migrateDocument`：那条通道包在 `mutate` 里、会给出人话说明，可 Ctrl+Z 撤销。
 */
import { reconcileVariableLinks } from '../model/variable-links';

export function normalizeRaw(raw: any): any {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {
    schema_version: 4, id: 'new_behavior_tree', version: '4.0.0', description: '', resolution: [1920, 1080], root: 'root', inputs: {}, variables: {},
    nodes: [{ id: 'root', type: 'root', children: ['main'] }, { id: 'main', type: 'sequence', children: ['task_1'] }, { id: 'task_1', type: 'task', action: 'core.capture', params: {} }],
  };
  if (!raw.inputs || typeof raw.inputs !== 'object' || Array.isArray(raw.inputs)) raw.inputs = {};
  if (!raw.variables || typeof raw.variables !== 'object' || Array.isArray(raw.variables)) raw.variables = {};
  if (!raw._layout || typeof raw._layout !== 'object') raw._layout = {};
  // bool_judge / break 是 UE 风格纯数据节点，不属于执行树。旧文档可能曾把它们
  // 放进 children；载入时清掉这些历史执行边，避免只隐藏端口却继续画执行连线。
  if (Array.isArray(raw.nodes)) {
    const pureIds = new Set(raw.nodes.filter((node: any) => node && (node.type === 'bool_judge' || node.type === 'break')).map((node: any) => node.id));
    if (pureIds.size) {
      for (const node of raw.nodes) {
        if (!node || !Array.isArray(node.children)) continue;
        const kept = node.children.map((child: string, index: number) => ({ child, index })).filter(({ child }: { child: string }) => !pureIds.has(child));
        if (node.type === 'condition' && Array.isArray(node.ports)) {
          node.ports = kept.map(({ index }: { index: number }) => node.ports[index]);
        }
        node.children = kept.map(({ child }: { child: string }) => child);
      }
    }
  }
  // 变量连线对账：参数里连着的变量一定要有对应的连线项，否则同一处绑定
  // 会在「谁连着谁」的说明/断开/清理之间出现两种说法。
  reconcileVariableLinks(raw);
  return raw;
}
