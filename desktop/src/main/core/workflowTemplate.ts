/**
 * 创建最小可运行的节点图模板。
 * 节点直接携带画布坐标，入口通过 `then.0` 连到第一个截图任务。
 */
export function workflowTemplate(id: string): Record<string, unknown> {
  return {
    schema_version: 6,
    id,
    version: '5.0.0',
    description: '',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', name: '入口', at: { x: 480, y: 0 } },
      { id: 'capture', type: 'task', action: 'core.capture', params: {}, at: { x: 480, y: 208 } },
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'capture', pin: 'in' } },
    ],
  };
}
