/**
 * 实时视觉监视窗口：实时显示运行时“眼中的画面”，并把这一步的判断依据画出来
 * ——模板匹配框与置信度、ROI、OCR 文字框、点击轨迹，以及当前节点/步骤状态。
 *
 * 与“模拟器画面测试工具”的分工：那个工具自己开一路采集、手动选模板做实验；
 * 本窗口不采集、不发送任何点击，只显示**正在运行的工作流**每一步的实际判断，
 * 因此它可以解释“这一步为什么这么走”。
 *
 * 画面帧由 Python 运行时挂在 TaskContext.capture 上写出（artifacts/live/*.json
 * + *.jpg），主进程负责轮询与门控心跳，这里只负责绘制。
 */
import { createIcons, ImageDown, Minus, Pause, Play, Square, X } from 'lucide';
import type {
  LiveViewClick,
  LiveViewFrame,
  LiveViewMatch,
  LiveViewOcr,
  LiveViewPollResult,
  LiveViewRoi,
} from '../shared/contracts';
import './styles.css';

const api = window.onmyoji;

const canvas = document.querySelector<HTMLCanvasElement>('#live-canvas')!;
const stage = document.querySelector<HTMLElement>('#live-stage')!;
const stageMask = document.querySelector<HTMLElement>('#live-stage-mask')!;
const maskText = document.querySelector<HTMLElement>('#live-mask-text')!;
const statusEl = document.querySelector<HTMLElement>('#live-status')!;
const instanceLabel = document.querySelector<HTMLElement>('#live-instance-label')!;
const connectionDot = document.querySelector<HTMLElement>('#live-connection-dot')!;
const connectionText = document.querySelector<HTMLElement>('#live-connection-text')!;
const frameMeta = document.querySelector<HTMLElement>('#live-frame-meta')!;
const workflowEl = document.querySelector<HTMLElement>('#live-workflow')!;
const stepNameEl = document.querySelector<HTMLElement>('#live-step-name')!;
const stepActionEl = document.querySelector<HTMLElement>('#live-step-action')!;
const stepStatusEl = document.querySelector<HTMLElement>('#live-step-status')!;
const stepDurationEl = document.querySelector<HTMLElement>('#live-step-duration')!;
const summaryEl = document.querySelector<HTMLElement>('#live-summary')!;
const matchList = document.querySelector<HTMLUListElement>('#live-match-list')!;
const matchEmpty = document.querySelector<HTMLElement>('#live-match-empty')!;
const matchCount = document.querySelector<HTMLElement>('#live-match-count')!;
const ocrList = document.querySelector<HTMLUListElement>('#live-ocr-list')!;
const ocrEmpty = document.querySelector<HTMLElement>('#live-ocr-empty')!;
const ocrCount = document.querySelector<HTMLElement>('#live-ocr-count')!;
const roiList = document.querySelector<HTMLUListElement>('#live-roi-list')!;
const roiEmpty = document.querySelector<HTMLElement>('#live-roi-empty')!;
const clickList = document.querySelector<HTMLUListElement>('#live-click-list')!;
const clickEmpty = document.querySelector<HTMLElement>('#live-click-empty')!;
const freezeButton = document.querySelector<HTMLButtonElement>('#live-freeze')!;
const saveButton = document.querySelector<HTMLButtonElement>('#live-save')!;
const clearButton = document.querySelector<HTMLButtonElement>('#live-clear')!;
const intervalSelect = document.querySelector<HTMLSelectElement>('#live-interval')!;
const toastEl = document.querySelector<HTMLElement>('#live-toast')!;

/** 超过这个时间没有新帧就认为这一次运行已经结束。 */
const STALE_FRAME_MS = 2500;
/** 刷新率偏好键：与主进程 layout 存储共用，换窗口后仍然记住。 */
const INTERVAL_STORE_KEY = 'onmyoji-studio.live-view.interval-ms';
const DEFAULT_INTERVAL_MS = 250;
const MIN_INTERVAL_MS = 50;
const MAX_INTERVAL_MS = 5000;
/** 界面轮询的下限：再快也不会比运行时写帧更快。 */
const MIN_POLL_INTERVAL_MS = 80;

const COLORS = {
  roi: '#ffd166',
  match: '#33d17a',
  matchTop: '#5eea6a',
  matchMiss: '#e0a53c',
  ocr: '#5cc2ed',
  clickOrigin: '#00d7ff',
  clickActual: '#ff5c5c',
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FitState {
  scale: number;
  ox: number;
  oy: number;
  dWidth: number;
  dHeight: number;
}

let frame: LiveViewFrame | null = null;
let imageEl: HTMLImageElement | null = null;
let fit: FitState = { scale: 1, ox: 0, oy: 0, dWidth: 0, dHeight: 0 };
let dpr = window.devicePixelRatio || 1;
let frozen = false;
let pollTimer: number | undefined;
let pollBusy = false;
let toastTimer: number | undefined;
let lastFrameAt = 0;
let lastFrameSeq = -1;
/** 当前刷新间隔（毫秒）：界面轮询节奏与运行时写帧节奏都由它推导。 */
let intervalMs = DEFAULT_INTERVAL_MS;
/** 侧栏里被选中的匹配项（画面上会加亮）。 */
let selectedMatch: number | null = null;
let frameRate = 0;
let rateWindowStart = 0;
let rateWindowFrames = 0;

function instanceParam(): string {
  try {
    return new URL(window.location.href).searchParams.get('instance') ?? '';
  } catch {
    return '';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 旧的主进程不认识新渲染层调用的 IPC 通道（构建后没重启就会出现这种情况）。
 * 这种情况降级处理即可，不该把英文的 "No handler registered" 甩给用户。
 */
function isMissingHandler(error: unknown): boolean {
  return /No handler registered|not a function/i.test(errorMessage(error));
}

function showToast(message: string, error = false): void {
  toastEl.textContent = message;
  toastEl.classList.toggle('error', error);
  toastEl.classList.remove('hidden');
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 3200);
}

function setConnection(state: 'offline' | 'connecting' | 'online', text: string): void {
  connectionDot.className = `vision-dot ${state}`;
  connectionText.textContent = text;
}

function setStatus(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', error);
}

function setMask(message: string | null): void {
  if (message === null) {
    stageMask.classList.add('hidden');
    return;
  }
  maskText.textContent = message;
  stageMask.classList.remove('hidden');
}

// ------------------------------------------------------------------ 坐标换算

/** 标注框来自参考分辨率，先换算到预览帧像素，再换算到画布像素。 */
function referenceRectToCanvas(box: number[]): Box | null {
  if (!frame || frame.reference_width <= 0 || frame.reference_height <= 0) return null;
  const [x, y, width, height] = box;
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const toFrameX = (value: number): number => (value * frame!.frame_width) / frame!.reference_width;
  const toFrameY = (value: number): number => (value * frame!.frame_height) / frame!.reference_height;
  const left = toFrameX(x);
  const top = toFrameY(y);
  const right = toFrameX(x + Math.max(1, width));
  const bottom = toFrameY(y + Math.max(1, height));
  return {
    x: fit.ox + left * fit.scale,
    y: fit.oy + top * fit.scale,
    w: Math.max(1, (right - left) * fit.scale),
    h: Math.max(1, (bottom - top) * fit.scale),
  };
}

function referencePointToCanvas(point: number[]): [number, number] | null {
  if (!frame || point.length < 2) return null;
  const [x, y] = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const frameX = (x * frame.frame_width) / frame.reference_width;
  const frameY = (y * frame.frame_height) / frame.reference_height;
  return [fit.ox + frameX * fit.scale, fit.oy + frameY * fit.scale];
}

// ------------------------------------------------------------------ 绘制

function computeFit(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (!frame || frame.frame_width <= 0 || frame.frame_height <= 0) {
    fit = { scale: 1, ox: 0, oy: 0, dWidth: 0, dHeight: 0 };
    return;
  }
  const scale = Math.min((width - 8) / frame.frame_width, (height - 8) / frame.frame_height, 1);
  const dWidth = Math.max(1, frame.frame_width * scale);
  const dHeight = Math.max(1, frame.frame_height * scale);
  fit = { scale, ox: (width - dWidth) / 2, oy: (height - dHeight) / 2, dWidth, dHeight };
}

function context(): CanvasRenderingContext2D | null {
  return canvas.getContext('2d');
}

function label(text: string, x: number, y: number, color: string): void {
  const ctx = context();
  if (!ctx) return;
  ctx.font = '11px "HarmonyOS Sans SC", "Segoe UI", sans-serif';
  const width = ctx.measureText(text).width + 8;
  const top = Math.max(0, y - 14);
  ctx.fillStyle = 'rgba(16, 18, 22, .78)';
  ctx.fillRect(x, top, width, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 4, top + 11);
}

function drawRect(box: Box, color: string, text: string, width = 2, dashed = false): void {
  const ctx = context();
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([5, 3]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();
  if (text) label(text, box.x, box.y, color);
}

function drawFrame(): void {
  const ctx = context();
  if (!ctx) return;
  computeFit();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Transparent margins reveal the themed stage, even while the frame is paused.
  if (!frame) return;
  if (imageEl && imageEl.naturalWidth > 0) {
    ctx.drawImage(imageEl, fit.ox, fit.oy, fit.dWidth, fit.dHeight);
  }

  // 叠加顺序：ROI（虚线）→ 匹配框 → OCR → 点击轨迹在最上层。
  frame.overlay.rois.forEach((roi: LiveViewRoi) => {
    const box = referenceRectToCanvas(roi.box);
    if (box) drawRect(box, COLORS.roi, `${roi.label} ${roi.box[2]}×${roi.box[3]}`, 1.5, true);
  });

  frame.overlay.matches.forEach((match: LiveViewMatch, index: number) => {
    const box = referenceRectToCanvas(match.box);
    if (!box) return;
    const selected = index === selectedMatch;
    const belowThreshold = match.threshold !== null && match.confidence < match.threshold;
    const color = belowThreshold ? COLORS.matchMiss : selected ? COLORS.matchTop : COLORS.match;
    drawRect(box, color, `${(match.confidence * 100).toFixed(1)}%`, selected ? 3 : 2);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  frame.overlay.ocr.forEach((item: LiveViewOcr) => {
    const box = referenceRectToCanvas(item.box);
    if (box) drawRect(box, COLORS.ocr, `${item.text} ${(item.confidence * 100).toFixed(0)}%`, 1.5);
  });

  frame.overlay.clicks.forEach((click: LiveViewClick) => {
    const origin = referencePointToCanvas(click.reference);
    const actual = referencePointToCanvas(click.actual);
    if (!origin) return;
    if (actual && (actual[0] !== origin[0] || actual[1] !== origin[1])) {
      ctx.strokeStyle = COLORS.clickActual;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(actual[0], actual[1]);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.clickOrigin;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(origin[0] - 8, origin[1]);
    ctx.lineTo(origin[0] + 8, origin[1]);
    ctx.moveTo(origin[0], origin[1] - 8);
    ctx.lineTo(origin[0], origin[1] + 8);
    ctx.stroke();
    if (actual) {
      ctx.strokeStyle = COLORS.clickActual;
      ctx.beginPath();
      ctx.arc(actual[0], actual[1], 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    label(
      `点击 ${click.reference[0]},${click.reference[1]}${click.hold_ms ? ` 按住 ${click.hold_ms}ms` : ''}`,
      origin[0] + 9,
      origin[1] + 18,
      COLORS.clickOrigin,
    );
  });
}

// ------------------------------------------------------------------ 侧栏

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function renderSidebar(): void {
  if (!frame) return;
  const overlay = frame.overlay;

  matchCount.textContent = String(overlay.matches.length);
  matchEmpty.classList.toggle('hidden', overlay.matches.length > 0);
  matchList.replaceChildren();
  overlay.matches.forEach((match, index) => {
    const li = document.createElement('li');
    li.className = index === selectedMatch ? 'selected' : '';
    const belowThreshold = match.threshold !== null && match.confidence < match.threshold;
    const name = match.template ? match.template.slice(match.template.lastIndexOf('/') + 1) : '模板';
    li.textContent = `${(match.confidence * 100).toFixed(1)}%  ${name}  ${match.box[0]},${match.box[1]} ${match.box[2]}×${match.box[3]}`
      + (belowThreshold ? `  <阈值 ${((match.threshold ?? 0) * 100).toFixed(0)}%>` : '');
    if (belowThreshold) li.classList.add('miss');
    li.title = match.template ?? '';
    li.addEventListener('click', () => {
      selectedMatch = selectedMatch === index ? null : index;
      renderSidebar();
      drawFrame();
    });
    matchList.appendChild(li);
  });

  ocrCount.textContent = String(overlay.ocr.length);
  ocrEmpty.classList.toggle('hidden', overlay.ocr.length > 0);
  ocrList.replaceChildren();
  overlay.ocr.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.text}  ${(item.confidence * 100).toFixed(0)}%  ${item.box[0]},${item.box[1]} ${item.box[2]}×${item.box[3]}`;
    ocrList.appendChild(li);
  });

  roiEmpty.classList.toggle('hidden', overlay.rois.length > 0);
  roiList.replaceChildren();
  overlay.rois.forEach((roi) => {
    const li = document.createElement('li');
    li.textContent = `${roi.label}  ${roi.box[0]},${roi.box[1]} ${roi.box[2]}×${roi.box[3]}`;
    roiList.appendChild(li);
  });

  clickEmpty.classList.toggle('hidden', overlay.clicks.length > 0);
  clickList.replaceChildren();
  overlay.clicks.forEach((click) => {
    const li = document.createElement('li');
    const moved = click.reference[0] !== click.actual[0] || click.reference[1] !== click.actual[1];
    li.textContent = `参考 ${click.reference[0]},${click.reference[1]}`
      + (moved ? ` → 实际 ${click.actual[0]},${click.actual[1]}` : '')
      + (click.hold_ms ? `  按住 ${click.hold_ms}ms` : '');
    clickList.appendChild(li);
  });
}

function renderStepBar(): void {
  if (!frame) return;
  const step = frame.step;
  const path = Array.isArray(step.workflow_path) && step.workflow_path.length > 0
    ? step.workflow_path.join(' / ')
    : step.workflow_id ?? '未知工作流';
  workflowEl.textContent = path;
  const name = step.name || step.action || step.step_id || '—';
  stepNameEl.textContent = name === step.action ? name : `${name}${step.step_id ? ` (${step.step_id})` : ''}`;
  stepNameEl.title = step.step_id ?? '';
  stepActionEl.textContent = step.action ?? '';
  const status = step.status ?? '';
  stepStatusEl.textContent = status;
  stepStatusEl.className = `live-pill ${status}`;
  const duration = numeric(step.duration_ms, -1);
  stepDurationEl.textContent = duration >= 0 ? `${duration.toFixed(0)} ms` : '';
}

// ------------------------------------------------------------------ 刷新率

function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.round(Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, value)));
}

/** 刷新率是观看偏好：放在主进程 layout 存储里，换窗口、换运行都还记得。 */
function loadStoredInterval(): number {
  try {
    const stored = api.readLayout(INTERVAL_STORE_KEY);
    if (stored) return clampInterval(Number(stored));
  } catch {
    // 读取失败就退回默认档。
  }
  return DEFAULT_INTERVAL_MS;
}

/**
 * 改刷新率。两件事一起做：界面轮询节奏跟着变，同时把间隔下发给运行时的预览
 * 通道——只调界面是没有用的，写帧节奏在运行时那边。
 */
async function applyInterval(next: number, announce: boolean): Promise<void> {
  intervalMs = clampInterval(next);
  intervalSelect.value = String(intervalMs);
  schedulePoll();
  try {
    const bridge = api.liveViewSetInterval;
    // 主进程是旧版本时这里没有通道：界面照常调，但写帧节奏得等重启才会跟着变。
    if (typeof bridge !== 'function') throw new Error('No handler registered');
    const applied = await api.liveViewSetInterval(intervalMs);
    if (typeof applied === 'number' && Number.isFinite(applied)) intervalMs = clampInterval(applied);
  } catch (error) {
    if (!isMissingHandler(error)) {
      if (announce) showToast(`设置刷新率失败：${errorMessage(error)}`, true);
      return;
    }
    showToast('桌面端主进程还是旧版本，刷新率要重启应用后才会真正下发给运行时。', true);
    setStatus(`刷新率已设为 ${intervalMs} ms，但主进程未重启，运行时仍在用上一次的节奏。`);
    try {
      api.writeLayout(INTERVAL_STORE_KEY, String(intervalMs));
    } catch {
      // 偏好写不进去只影响下次打开的默认档。
    }
    return;
  }
  try {
    api.writeLayout(INTERVAL_STORE_KEY, String(intervalMs));
  } catch {
    // 偏好写不进去只影响下次打开的默认档。
  }
  if (announce) {
    const fps = intervalMs > 0 ? (1000 / intervalMs).toFixed(1) : '—';
    setStatus(`刷新率已改为 ${intervalMs} ms（约 ${fps} fps）。实际帧率还受运行时抓图节奏限制。`);
  }
}

function renderSummary(): void {
  if (!frame) {
    summaryEl.textContent = '';
    return;
  }
  const step = frame.step;
  const lines = [
    `动作：${step.action ?? '—'}`,
    `节点类型：${step.node_kind ?? '—'}`,
    `步骤：${step.step_id ?? '—'}`,
    `状态：${step.status ?? '—'}`,
    step.error ? `错误：${step.error}` : '',
    step.error_category ? `错误分类：${step.error_category}` : '',
    `运行：${frame.instance_id || '—'}`,
    `画面：${frame.frame_width}×${frame.frame_height}（参考 ${frame.reference_width}×${frame.reference_height}）`,
    `更新时间：${frame.ts ? new Date(frame.ts * 1000).toLocaleTimeString('zh-CN') : '—'}`,
  ].filter(Boolean);
  summaryEl.textContent = lines.join('\n');
}

// ------------------------------------------------------------------ 轮询

function applyFrame(next: LiveViewFrame): void {
  frame = next;
  if (selectedMatch !== null && selectedMatch >= next.overlay.matches.length) selectedMatch = null;
  const token = next.seq;
  const image = new Image();
  image.onload = () => {
    if (!frame || frame.seq !== token) return;
    imageEl = image;
    setMask(null);
    renderStepBar();
    renderSidebar();
    renderSummary();
    drawFrame();
  };
  image.src = `data:image/jpeg;base64,${next.image}`;
  frameMeta.textContent = `${next.frame_width}×${next.frame_height}`
    + (frameRate > 0 ? `  ·  ${frameRate.toFixed(1)} fps` : '');
}

function markRunning(): void {
  const first = lastFrameAt === 0;
  lastFrameAt = Date.now();
  setConnection('online', '运行中');
  if (first) setStatus('实时接收运行时的画面与判断依据。');
}

function markStale(): void {
  setConnection('offline', '运行已结束');
  if (rateWindowFrames > 0) frameRate = 0;
  setStatus('这次运行已结束。画面停在最后一帧，重新运行即可继续监视。');
}

function schedulePoll(): void {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  // 轮询要比运行时写帧更快，否则界面本身会成为帧率瓶颈。
  pollTimer = window.setInterval(() => {
    void poll();
  }, Math.max(MIN_POLL_INTERVAL_MS, Math.round(intervalMs / 3)));
}

async function poll(): Promise<void> {
  // 冻结时仍继续拉取新帧，只是不更新画面；恢复后立刻是最新状态。
  if (pollBusy) return;
  pollBusy = true;
  try {
    if (typeof api.liveViewPoll !== 'function') {
      // 旧主进程：没有预览帧通道，也别每 150 ms 刷一次错误。
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
        pollTimer = undefined;
      }
      setConnection('offline', '需要重启');
      setMask('桌面端主进程还是旧版本，请重启应用后再打开本窗口。');
      setStatus('主进程未重启：这个窗口需要新的主进程才能读取运行时的预览帧。', true);
      return;
    }
    const result: LiveViewPollResult = await api.liveViewPoll();
    if (result.status === 'frame') {
      const now = Date.now();
      if (rateWindowStart === 0) rateWindowStart = now;
      rateWindowFrames += 1;
      if (now - rateWindowStart >= 1000) {
        frameRate = (rateWindowFrames * 1000) / (now - rateWindowStart);
        rateWindowStart = now;
        rateWindowFrames = 0;
      }
      markRunning();
      lastFrameSeq = result.frame.seq;
      if (!frozen) applyFrame(result.frame);
      return;
    }
    if (result.status === 'unchanged') {
      if (Date.now() - lastFrameAt > STALE_FRAME_MS && lastFrameAt > 0 && connectionText.textContent !== '运行已结束') {
        markStale();
      }
      return;
    }
    // idle：还没有任何快照。
    if (lastFrameSeq < 0) {
      setConnection('connecting', '等待运行');
      setMask(result.message || '等待工作流运行…');
      setStatus(result.message || '等待工作流运行…');
    }
  } catch (error) {
    setStatus(`读取预览帧失败：${errorMessage(error)}`, true);
  } finally {
    pollBusy = false;
  }
}

// ------------------------------------------------------------------ 交互

function toggleFreeze(): void {
  frozen = !frozen;
  freezeButton.classList.toggle('active', frozen);
  freezeButton.querySelector('span')!.textContent = frozen ? '画面已冻结' : '冻结画面';
  freezeButton.querySelector('i')?.setAttribute('data-lucide', frozen ? 'play' : 'pause');
  createIcons({ icons: { Pause, Play }, root: freezeButton });
  setStatus(frozen ? '画面已冻结，仍在后台接收新帧。' : '已恢复实时刷新。');
}

function bindUi(): void {
  createIcons({ icons: { Minus, Square, X, Pause, Play, ImageDown } });

  document.querySelector('#live-minimize')?.addEventListener('click', () => void api.minimizeWindow());
  document.querySelector('#live-maximize')?.addEventListener('click', () => void api.toggleMaximizeWindow());
  document.querySelector('#live-close')?.addEventListener('click', () => void api.closeWindow());

  freezeButton.addEventListener('click', toggleFreeze);

  intervalSelect.addEventListener('change', () => {
    void applyInterval(Number(intervalSelect.value), true);
  });

  saveButton.addEventListener('click', () => {
    if (!frame) {
      showToast('当前还没有画面', true);
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      void api.saveCanvas({ filename: 'live-vision-annotated.png', dataUrl }).then((saved) => {
        showToast(saved ? `标注画面已保存：${saved}` : '已取消保存');
      }).catch((error) => showToast(`保存失败：${errorMessage(error)}`, true));
    } catch {
      showToast('当前没有可保存的画面', true);
    }
  });

  clearButton.addEventListener('click', () => {
    if (!frame) return;
    frame = { ...frame, overlay: { rois: [], matches: [], ocr: [], clicks: [] } };
    selectedMatch = null;
    renderSidebar();
    renderSummary();
    drawFrame();
    setStatus('已清空当前叠加信息（下一帧会重新写入）。');
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'a' || event.key === 'A') {
      if (event.target instanceof HTMLInputElement) return;
      toggleFreeze();
    }
  });

  const resizeObserver = new ResizeObserver(() => drawFrame());
  resizeObserver.observe(stage);
  window.addEventListener('resize', () => {
    dpr = window.devicePixelRatio || 1;
    drawFrame();
  });
}

async function start(): Promise<void> {
  bindUi();
  const instance = instanceParam();
  instanceLabel.textContent = instance ? `目标实例：${instance}` : '未选择实例';
  setConnection('connecting', '等待运行');
  setMask('等待工作流运行…');
  setStatus('等待工作流运行。运行一次工作流后，这里会实时显示它眼中的画面。');
  intervalMs = loadStoredInterval();
  intervalSelect.value = String(intervalMs);
  try {
    await api.liveViewWatch(true);
  } catch (error) {
    if (!isMissingHandler(error)) setStatus(`启动观看失败：${errorMessage(error)}`, true);
  }
  // 刷新率单独下发：这一步失败不该影响观看本身（旧主进程就是这种情况）。
  await applyInterval(intervalMs, false);
  schedulePoll();
  window.addEventListener('pagehide', () => {
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    void api.liveViewWatch?.(false)?.catch?.(() => undefined);
  });
}

void start();
