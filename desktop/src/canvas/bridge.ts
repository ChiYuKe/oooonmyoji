/**
 * 画布 iframe 与桌面壳层的显式桥接。
 *
 * 取代旧 `public/legacy/bridge.js`：负责运行模式检测、消息信封收发与桌面控制命令。
 * `editorApi()` 提供编辑器侧（VSCode 风格）的消息通道，供 `editor.ts` 组装入口使用。
 */

export type CanvasMode = 'canvas' | 'details';

/** 壳层消息（已解包 payload 前的信封）。 */
interface ShellEnvelope {
  source?: string;
  payload?: Record<string, unknown>;
}

/** 旧脚本仍在使用的 VS Code 风格 API 形状。 */
export interface LegacyVsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(value: unknown): unknown;
}

export interface CanvasBridge {
  mode: CanvasMode;
  /** 发送编辑器消息给壳层。 */
  post(message: unknown): void;
  /** 发送持久化状态给壳层（旧 setState 语义）。 */
  postState(state: unknown): void;
  /** 订阅已解包的壳层消息，返回取消订阅函数。 */
  subscribe(listener: (payload: Record<string, unknown>) => void): () => void;
  /** 编辑器消息通道（VSCode 风格 postMessage/onMessage）。 */
  editorApi(): LegacyVsCodeApi;
}

export interface CanvasBridgeDeps {
  win?: Window;
  doc?: Document;
}

const CONTROL_BUTTONS: Record<string, string> = {
  back: 'btn-back',
  run: 'btn-run',
  stop: 'btn-stop',
  save: 'btn-save',
  more: 'btn-more',
};

export function createCanvasBridge(deps: CanvasBridgeDeps = {}): CanvasBridge {
  const win = deps.win ?? window;
  const doc = deps.doc ?? document;
  const mode: CanvasMode = new URLSearchParams(win.location.search).get('mode') === 'details' ? 'details' : 'canvas';
  doc.body.classList.add(`desktop-${mode}-mode`);

  let persistedState: unknown = {};
  const listeners = new Set<(payload: Record<string, unknown>) => void>();

  function post(message: unknown): void {
    win.parent.postMessage({ source: 'legacy-editor', message }, '*');
  }

  function postState(state: unknown): void {
    win.parent.postMessage({ source: 'legacy-editor-state', state }, '*');
  }

  function handleShellMessage(payload: Record<string, unknown>): void {
    if (payload.type === 'desktopPing') {
      post({ type: 'ready' });
      return;
    }
    if (payload.type === 'desktopControl') {
      const command = String(payload.command ?? '');
      const buttonId = CONTROL_BUTTONS[command];
      if (buttonId) {
        doc.getElementById(buttonId)?.click();
      } else if (command === 'switchWorkflow') {
        win.__topbar?.setWorkflow(String(payload.value ?? ''));
      } else if (command === 'selectInstance') {
        win.__topbar?.setInstance(String(payload.value ?? ''));
      }
      return;
    }
    for (const listener of listeners) listener(payload);
    win.dispatchEvent(new MessageEvent('message', { data: payload }));
  }

  win.addEventListener('message', (event: MessageEvent) => {
    const envelope = event.data as ShellEnvelope | undefined;
    if (!envelope || envelope.source !== 'desktop-shell') return;
    handleShellMessage(envelope.payload ?? {});
  });

  return {
    mode,
    post,
    postState,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    editorApi: () => ({
      postMessage: (message) => post(message),
      getState: () => persistedState,
      setState: (value) => {
        persistedState = value || {};
        postState(persistedState);
        return persistedState;
      },
    }),
  };
}
