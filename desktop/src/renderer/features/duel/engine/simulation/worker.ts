import type { DuelState } from '../types';
import { simulateBattleProgressive, simulateBattleSampleDetails } from '../battle-engine';

interface StartMessage { type: 'start'; taskId: number; state: DuelState; runs: number }
interface SampleMessage { type: 'sample'; taskId: number; index: number }
type WorkerRequest = StartMessage | SampleMessage;

let activeTask = 0;
let cancelled = false;
let activeState: DuelState | undefined;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'sample') {
    if (message.taskId !== activeTask || !activeState) return;
    try { self.postMessage({ type: 'sample', taskId: message.taskId, index: message.index,
      ...simulateBattleSampleDetails(activeState, message.index) }); }
    catch (error) { self.postMessage({ type: 'error', taskId: message.taskId, message: error instanceof Error ? error.message : String(error) }); }
    return;
  }

  activeTask = message.taskId;
  activeState = message.state;
  cancelled = false;
  void simulateBattleProgressive(message.state, message.runs, 0,
    (completed, total, engine) => self.postMessage({ type: 'progress', taskId: message.taskId, completed, total, engine }),
    () => cancelled)
    .then(result => { if (result && !cancelled && activeTask === message.taskId) self.postMessage({ type: 'result', taskId: message.taskId, result }); })
    .catch((error: unknown) => { if (!cancelled) self.postMessage({ type: 'error', taskId: message.taskId,
      message: error instanceof Error ? error.message : String(error) }); });
};

export {};
