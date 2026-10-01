import { randomUUID } from 'node:crypto';
import type { TestNodeDraft, TestNodeTransfer, TestNodeAdded } from '../shared/workflow-testing';

/** Resolve only after the owning canvas has committed the insertion. */
export class TestNodeTransfers {
  private pending = new Map<string, { uri: string; resolve: (id: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  add(uri: string, node: TestNodeDraft, send: (request: TestNodeTransfer) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('画布没有响应，请打开目标工作流后重试')); }, 10000);
      this.pending.set(requestId, { uri, resolve, reject, timer });
      try { send({ requestId, uri, node: structuredClone(node) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  complete(result: TestNodeAdded): void {
    const item = this.pending.get(result.requestId);
    if (!item || item.uri !== result.uri) return;
    clearTimeout(item.timer); this.pending.delete(result.requestId);
    if (result.error || !result.nodeId) item.reject(new Error(result.error || '画布未能添加节点'));
    else item.resolve(result.nodeId);
  }
}
