/**
 * 运行日志面板桥接。
 *
 * 缓存运行事件、引擎输出与进程结果，并在日志 iframe 就绪后推送给它。
 * 状态由本模块持有；主窗口只在窗口消息与运行时事件里调用对应方法。
 */
import type { RuntimeOutputEvent, RuntimeStateEvent } from '../shared/contracts';

export interface RuntimeLogDescriptor {
  workflow: string;
  instance: string;
  startedAt: number;
  status: string;
  sources?: RuntimeStateEvent['sources'];
}

export interface RuntimeProcessResult {
  code: number | null;
  signal: string | null;
  stopped: boolean;
}

export interface RuntimeLogDeps {
  frame: HTMLIFrameElement;
}

export interface RuntimeLog {
  /** 就绪后向日志 iframe 发送一条消息。 */
  post(payload: Record<string, unknown>): void;
  /** 发送初始化快照（描述符、事件、引擎输出、进程结果）。 */
  sendInit(): void;
  /** 清空日志并通知面板。 */
  clear(): void;
  /** 标记面板就绪并补发初始化快照。 */
  markReady(): void;
  /** 追加引擎输出（上限 300k 字符）。 */
  appendOutput(event: RuntimeOutputEvent): void;
  /** 追加一条运行事件（上限 5000 条）。 */
  appendRunEvent(event: Record<string, unknown>): void;
  /** 开始一次运行：重置并广播新的描述符。 */
  beginRun(descriptor: RuntimeLogDescriptor): void;
  /** 结束一次运行：广播进程结果。 */
  finishRun(result: RuntimeProcessResult): void;
}

const MAX_ENGINE_OUTPUT = 300_000;
const MAX_RUN_EVENTS = 5000;

export function createRuntimeLog({ frame }: RuntimeLogDeps): RuntimeLog {
  let ready = false;
  let descriptor: RuntimeLogDescriptor | undefined;
  let events: Record<string, unknown>[] = [];
  let engineOutput = '';
  let processResult: RuntimeProcessResult | undefined;

  function post(payload: Record<string, unknown>): void {
    if (ready) frame.contentWindow?.postMessage(payload, '*');
  }

  function sendInit(): void {
    post({
      type: 'init',
      descriptor: descriptor ?? null,
      events,
      engineOutput,
      processResult,
    });
  }

  function clear(): void {
    descriptor = undefined;
    events = [];
    engineOutput = '';
    processResult = undefined;
    post({ type: 'cleared' });
  }

  function markReady(): void {
    ready = true;
    sendInit();
  }

  function appendOutput(event: RuntimeOutputEvent): void {
    engineOutput += event.text;
    if (engineOutput.length > MAX_ENGINE_OUTPUT) engineOutput = engineOutput.slice(-MAX_ENGINE_OUTPUT);
    post({ type: 'engineOutput', chunk: event.text, stream: event.stream });
  }

  function appendRunEvent(event: Record<string, unknown>): void {
    events.push(event);
    if (events.length > MAX_RUN_EVENTS) events = events.slice(-MAX_RUN_EVENTS);
    post({ type: 'runEvent', event });
  }

  function beginRun(next: RuntimeLogDescriptor): void {
    descriptor = next;
    events = [];
    engineOutput = '';
    processResult = undefined;
    sendInit();
  }

  function finishRun(result: RuntimeProcessResult): void {
    processResult = { ...result };
    post({ type: 'processFinished', ...processResult });
  }

  return { post, sendInit, clear, markReady, appendOutput, appendRunEvent, beginRun, finishRun };
}
