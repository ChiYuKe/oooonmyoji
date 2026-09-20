/**
 * 画布基准宿主：在 iframe 里加载真实工作流画布，并暴露 `window.__canvasBenchmark`。
 *
 * 为什么需要这一层：画布自身按设计运行在 iframe 里，`window.__btEditor` 也在 iframe 的
 * 文档里；Electron 的调试端口只能看到顶层页面，所以由这个宿主页把测量动作转发进去。
 *
 * 这个模块只在基准运行时被加载（主进程带 `ONMYOJI_BENCHMARK=1` 才创建这个窗口）。
 */
export {};

interface CanvasEditorLike {
  benchmark: {
    stats(): any;
    domCounts(): { nodes: number; edges: number; variableEdges: number; variableCards: number; total: number };
    panBy(dx: number, dy: number): void;
    zoomBy(factor: number): void;
    selectNode(id?: string): string | null;
    dragSelected(dx: number, dy: number): void;
    endDrag(): void;
    activeNodeCount(): number;
    detailLevel(): string | null;
  };
  state: any;
}

declare global {
  interface Window {
    __canvasBenchmark?: {
      ready(): boolean;
      load(fixture: { document: any; catalog: any[] }): Promise<boolean>;
      stats(): any;
      domCounts(): any;
      activeNodeCount(): number;
      detailLevel(): string | null;
      panBy(dx: number, dy: number): void;
      zoomBy(factor: number): void;
      selectNode(id?: string): string | null;
      dragSelected(dx: number, dy: number): void;
      endDrag(): void;
      /** 最近一次 load() 的加载耗时（毫秒），含画布处理 init 与首帧渲染。 */
      lastLoadSyncMs(): number | null;
    };
  }
}

const frame = document.getElementById('frame') as HTMLIFrameElement | null;
/** 最近一次 load() 的同步耗时（毫秒）。 */
let lastLoadSyncMs: number | null = null;

function canvasWindow(): (Window & { __btEditor?: CanvasEditorLike }) | null {
  const win = frame?.contentWindow as (Window & { __btEditor?: CanvasEditorLike }) | null;
  return win ?? null;
}

function editor(): CanvasEditorLike | null {
  const win = canvasWindow();
  if (!win || !win.__btEditor || !win.__btEditor.benchmark) return null;
  return win.__btEditor;
}

/** 等画布 iframe 报 ready（它启动后会 postMessage `{source:'legacy-editor'}`）。 */
function waitForReady(timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    if (editor()) { resolve(true); return; }
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent): void => {
      const envelope = event.data as { source?: string } | undefined;
      if (!envelope || envelope.source !== 'legacy-editor') return;
      // ready 之后再等一拍，确保 startCanvasEditor 已经把句柄挂到 window 上。
      if (editor()) finish(true);
      else window.setTimeout(() => { if (editor()) finish(true); }, 0);
    };
    const timer = window.setInterval(() => {
      if (editor()) { finish(true); return; }
      if (Date.now() > deadline) finish(false);
    }, 50);
    window.addEventListener('message', onMessage);
  });
}

/**
 * 把 500 节点样例装进画布：走与壳层完全相同的 init 消息路径，
 * 因此基准量到的是真实载入流程，而不是某个基准专用旁路。
 */
function postInit(fixture: { document: any; catalog: any[] }): boolean {
  const win = canvasWindow();
  if (!win) return false;
  const payload = {
    type: 'init',
    document: {
      uri: 'benchmark://canvas-500.json',
      name: 'canvas-500.json',
      text: JSON.stringify(fixture.document),
    },
    catalog: Array.isArray(fixture.catalog) ? fixture.catalog : [],
    refs: { inputs: [], variables: [], nodes: [] },
    issues: [],
    workflows: [],
    instances: [],
    selectedInstance: '',
    workflowTrail: [],
    canGoBack: false,
    assetsBaseUri: '',
  };
  // 画布桥接收壳层信封并解包后重新派发；这里直接派发解包后的载荷。
  win.postMessage({ source: 'desktop-shell', payload }, '*');
  return true;
}

window.__canvasBenchmark = {
  ready: () => Boolean(editor()),
  load: async (fixture) => {
    const ready = await waitForReady();
    if (!ready) return false;
    // 逐帧推进，直到画布把 init 处理完（弹层、自动布局与首帧都在这一段里）。
    // 用 rAF 数帧而不是固定等两帧：隐藏窗口的帧可能被节流，固定等待会量到无关的等待时间。
    const startedAt = performance.now();
    postInit(fixture);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    lastLoadSyncMs = performance.now() - startedAt;
    return Boolean(editor());
  },
  stats: () => editor()?.benchmark.stats() ?? null,
  domCounts: () => editor()?.benchmark.domCounts() ?? null,
  activeNodeCount: () => editor()?.benchmark.activeNodeCount() ?? 0,
  detailLevel: () => editor()?.benchmark.detailLevel() ?? null,
  panBy: (dx, dy) => editor()?.benchmark.panBy(dx, dy),
  zoomBy: (factor) => editor()?.benchmark.zoomBy(factor),
  selectNode: (id) => editor()?.benchmark.selectNode(id) ?? null,
  dragSelected: (dx, dy) => editor()?.benchmark.dragSelected(dx, dy),
  endDrag: () => editor()?.benchmark.endDrag(),
  lastLoadSyncMs: () => lastLoadSyncMs,
};
