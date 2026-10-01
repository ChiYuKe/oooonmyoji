import { nextNodeId } from '../../shared/workflow/node-identifiers';

/**
 * 创建最小可运行的节点图模板。
 * 节点直接携带画布坐标，入口通过 `then.0` 连到第一个截图任务。
 */
export function workflowTemplate(id: string): Record<string, unknown> {
  const rootId = nextNodeId('root', []);
  const taskId = nextNodeId('task', [rootId]);
  return {
    schema_version: 6,
    id,
    version: '5.0.0',
    description: '',
    resolution: [1920, 1080],
    root: rootId,
    inputs: {},
    variables: {},
    nodes: [
      { id: rootId, type: 'root', name: '入口', at: { x: 480, y: 0 } },
      { id: taskId, type: 'task', action: 'core.capture', params: {}, at: { x: 480, y: 208 } },
    ],
    edges: [
      { from: { node: rootId, pin: 'then.0' }, to: { node: taskId, pin: 'in' } },
    ],
  };
}
