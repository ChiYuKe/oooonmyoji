import type { ActionSpec } from '../../shared/contracts';
import type { TestNodeDraft, TestNodeTransfer, TestNodeAdded } from '../../shared/workflow-testing';
import { validateTestNode } from '../../shared/node-test';

export function createTestNodeInserter(deps: {
  catalog(): Pick<ActionSpec, 'name' | 'parameters'>[];
  buildNode(type: string): any;
  nodes(): any[];
  layout(): Record<string, { x: number; y: number }>;
  point(): { x: number; y: number };
  mutate(action: () => void): void;
  created(id: string): void;
  focus(id: string): void;
  reply(result: TestNodeAdded): void;
}) {
  const inserted = new Map<string, string>();
  return (request: TestNodeTransfer): void => {
    const reply = (result: Partial<TestNodeAdded>) => deps.reply({ requestId: request.requestId, uri: request.uri, ...result });
    if (inserted.has(request.requestId)) { reply({ nodeId: inserted.get(request.requestId) }); return; }
    try {
      const draft: TestNodeDraft = validateTestNode(request.node, deps.catalog());
      const node = deps.buildNode('task'); node.action = draft.action; node.params = draft.params;
      if (draft.name) node.name = draft.name;
      const point = deps.point();
      const position = { x: Math.round(point.x - 130), y: Math.round(point.y - 70) };
      // Place beside existing cards, keeping repeated additions separately selectable.
      for (let attempt = 0; attempt < 100 && Object.values(deps.layout()).some(other => Math.abs(other.x - position.x) < 280 && Math.abs(other.y - position.y) < 200); attempt++) position.x += 300;
      deps.mutate(() => { deps.nodes().push(node); deps.layout()[node.id] = position; deps.created(node.id); });
      inserted.set(request.requestId, node.id);
      if (inserted.size > 100) inserted.delete(inserted.keys().next().value!);
      deps.focus(node.id); reply({ nodeId: node.id });
    } catch (error) { reply({ error: error instanceof Error ? error.message : String(error) }); }
  };
}
