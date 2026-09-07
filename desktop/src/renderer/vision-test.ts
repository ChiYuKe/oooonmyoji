/**
 * 模拟器画面测试工具窗口：实时显示目标模拟器画面，并提供模板匹配、
 * ROI 框选和点击位置测试。画面帧与命令回执由后端长驻 Python 推流服务
 * 通过主进程 IPC（vision:event / vision:command）转发。
 */
import { createIcons, ImageDown, Minus, Pause, Play, Scan, Square, X } from 'lucide';
import type { VisionCommand, VisionStreamEvent } from '../shared/contracts';
import './styles.css';

interface VisionFrame {
  dataUrl: string;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  token: number;
}

interface VisionMatch {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  center: [number, number];
  reference: [number, number, number, number];
}

interface FitState {
  scale: number;
  ox: number;
  oy: number;
  dWidth: number;
  dHeight: number;
}

const api = window.onmyoji;
const canvas = document.querySelector<HTMLCanvasElement>('#vision-canvas')!;
const stage = document.querySelector<HTMLElement>('#vision-stage')!;
const stageMask = document.querySelector<HTMLElement>('#vision-stage-mask')!;
const maskText = document.querySelector<HTMLElement>('#vision-mask-text')!;
const statusEl = document.querySelector<HTMLElement>('#vision-status')!;
const instanceLabel = document.querySelector<HTMLElement>('#vision-instance-label')!;
const connectionDot = document.querySelector<HTMLElement>('#vision-connection-dot')!;
const connectionText = document.querySelector<HTMLElement>('#vision-connection-text')!;
const frameMeta = document.querySelector<HTMLElement>('#vision-frame-meta')!;
const toastEl = document.querySelector<HTMLElement>('#vision-toast')!;
const templateInput = document.querySelector<HTMLInputElement>('#vision-template-input')!;
const templateOptions = document.querySelector<HTMLDataListElement>('#vision-template-options')!;
const templateImage = document.querySelector<HTMLImageElement>('#vision-template-image')!;
const templateEmpty = document.querySelector<HTMLElement>('#vision-template-empty')!;
const thresholdInput = document.querySelector<HTMLInputElement>('#vision-threshold')!;
const maxResultsInput = document.querySelector<HTMLInputElement>('#vision-max-results')!;
const scaleSearchInput = document.querySelector<HTMLInputElement>('#vision-scale-search')!;
const autoMatchInput = document.querySelector<HTMLInputElement>('#vision-auto-match')!;
const roiOnlyInput = document.querySelector<HTMLInputElement>('#vision-roi-only')!;
const roiOnlyCardInput = document.querySelector<HTMLInputElement>('#vision-roi-only-card')!;
const intervalSelect = document.querySelector<HTMLSelectElement>('#vision-interval')!;
const liveToggle = document.querySelector<HTMLButtonElement>('#vision-live-toggle')!;
const matchOnce = document.querySelector<HTMLButtonElement>('#vision-match-once')!;
const clearMatches = document.querySelector<HTMLButtonElement>('#vision-clear-matches')!;
const matchList = document.querySelector<HTMLUListElement>('#vision-match-list')!;
const matchEmpty = document.querySelector<HTMLElement>('#vision-match-empty')!;
const roiInfo = document.querySelector<HTMLElement>('#vision-roi-info')!;
const clearRoi = document.querySelector<HTMLButtonElement>('#vision-clear-roi')!;
const tapInfo = document.querySelector<HTMLElement>('#vision-tap-info')!;
const tapSend = document.querySelector<HTMLButtonElement>('#vision-tap-send')!;
const holdInput = document.querySelector<HTMLInputElement>('#vision-hold')!;
const saveButton = document.querySelector<HTMLButtonElement>('#vision-save')!;
const modeRoi = document.querySelector<HTMLButtonElement>('#vision-mode-roi')!;
const modeTap = document.querySelector<HTMLButtonElement>('#vision-mode-tap')!;

const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;

let mode: 'roi' | 'tap' = 'roi';
let live = true;
let connected = false;
let mapperOk = false;
let frame: VisionFrame | null = null;
let imageEl: HTMLImageElement | null = null;
let roiOrig: [number, number, number, number] | null = null;
let tapOrig: [number, number] | null = null;
let matches: VisionMatch[] = [];
let selectedMatch: number | null = null;
let matchPending = false;
let commandSeq = 1;
let templatePath = '';
let fit: FitState = { scale: 1, ox: 0, oy: 0, dWidth: 0, dHeight: 0 };
let dpr = window.devicePixelRatio || 1;
let dragStartOrig: [number, number] | null = null;
let dragCurrentOrig: [number, number] | null = null;
let frameToken = 0;
let toastTimer: number | undefined;

function instanceParam(): string {
  try {
    return new URL(window.location.href).searchParams.get('instance') ?? '';
  } catch {
    return '';
  }
}

function nextCommandId(): number {
  commandSeq += 1;
  return commandSeq;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

// ------------------------------------------------------------------ 坐标换算

function computeFit(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (!frame) {
    fit = { scale: 1, ox: 0, oy: 0, dWidth: 0, dHeight: 0 };
    return;
  }
  const scale = Math.min((width - 8) / frame.width, (height - 8) / frame.height, 1);
  const dWidth = Math.max(1, frame.width * scale);
  const dHeight = Math.max(1, frame.height * scale);
  fit = {
    scale,
    ox: (width - dWidth) / 2,
    oy: (height - dHeight) / 2,
    dWidth,
    dHeight,
  };
}

function origToCanvas(x: number, y: number): [number, number] {
  if (!frame) return [0, 0];
  const frameX = (x * frame.width) / frame.origWidth;
  const frameY = (y * frame.height) / frame.origHeight;
  return [fit.ox + frameX * fit.scale, fit.oy + frameY * fit.scale];
}

function origRectToCanvas(rect: [number, number, number, number]): { x: number; y: number; w: number; h: number } {
  const [x1, y1] = origToCanvas(rect[0], rect[1]);
  const [x2, y2] = origToCanvas(rect[0] + rect[2], rect[1] + rect[3]);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function canvasToOrig(clientX: number, clientY: number): [number, number] | null {
  if (!frame || fit.scale <= 0) return null;
  const rect = canvas.getBoundingClientRect();
  const frameX = (clientX - rect.left - fit.ox) / fit.scale;
  const frameY = (clientY - rect.top - fit.oy) / fit.scale;
  if (frameX < 0 || frameY < 0 || frameX > frame.width || frameY > frame.height) return null;
  const origX = (frameX * frame.origWidth) / frame.width;
  const origY = (frameY * frame.origHeight) / frame.height;
  return [
    clamp(Math.round(origX), 0, frame.origWidth),
    clamp(Math.round(origY), 0, frame.origHeight),
  ];
}

function referenceLabel(x: number, y: number): string {
  if (!mapperOk || !frame) return '参考不可用';
  const refX = (x * REFERENCE_WIDTH) / frame.origWidth;
  const refY = (y * REFERENCE_HEIGHT) / frame.origHeight;
  return `参考 ${Math.round(refX)},${Math.round(refY)}`;
}

// ------------------------------------------------------------------ 渲染

function drawCrosshair(x: number, y: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = '#ff5c5c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y);
  ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ff5c5c';
  ctx.font = '11px "HarmonyOS Sans SC", "Segoe UI", sans-serif';
  ctx.fillText(`点击 ${Math.round(x)},${Math.round(y)}`, x + 12, y - 12);
}

function drawRect(rect: { x: number; y: number; w: number; h: number }, color: string, label: string, width: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = color;
  ctx.font = '11px "HarmonyOS Sans SC", "Segoe UI", sans-serif';
  ctx.fillText(label, rect.x + 4, Math.max(12, rect.y + 12));
}

function redraw(): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  computeFit();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = '#202020';
  ctx.fillRect(0, 0, rect.width, rect.height);
  if (!frame || !imageEl || imageEl.naturalWidth === 0) return;
  ctx.drawImage(imageEl, fit.ox, fit.oy, fit.dWidth, fit.dHeight);

  if (roiOrig) {
    const r = origRectToCanvas(roiOrig);
    drawRect(r, '#ffd166', `ROI ${roiOrig[2]}×${roiOrig[3]}`, 2);
  }
  if (dragStartOrig && dragCurrentOrig) {
    const x1 = Math.min(dragStartOrig[0], dragCurrentOrig[0]);
    const y1 = Math.min(dragStartOrig[1], dragCurrentOrig[1]);
    const x2 = Math.max(dragStartOrig[0], dragCurrentOrig[0]);
    const y2 = Math.max(dragStartOrig[1], dragCurrentOrig[1]);
    const r = origRectToCanvas([x1, y1, x2 - x1, y2 - y1]);
    drawRect(r, '#ffd166', 'ROI', 1);
  }
  matches.forEach((match, index) => {
    // 普通匹配用绿色；选中项用更亮的绿色（不用白色，保证在画面上清晰可辨）。
    const color = index === selectedMatch ? '#5eea6a' : '#33d17a';
    const r = origRectToCanvas([match.x, match.y, match.width, match.height]);
    drawRect(r, color, `${(match.confidence * 100).toFixed(1)}%`, index === selectedMatch ? 3 : 2);
    const [cx, cy] = origToCanvas(match.x + match.width / 2, match.y + match.height / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  if (tapOrig) {
    const [cx, cy] = origToCanvas(tapOrig[0], tapOrig[1]);
    drawCrosshair(cx, cy);
  }
}

function refreshMatchList(): void {
  matchList.replaceChildren();
  matchEmpty.classList.toggle('hidden', matches.length > 0);
  matches.forEach((match, index) => {
    const li = document.createElement('li');
    li.className = index === selectedMatch ? 'selected' : '';
    li.textContent = `${index + 1}. ${(match.confidence * 100).toFixed(1)}% @ ${match.center[0]},${match.center[1]}`;
    if (mapperOk) {
      const refCenter = [match.reference[0] + match.reference[2] / 2, match.reference[1] + match.reference[3] / 2];
      li.textContent += `  参考 ${Math.round(refCenter[0])},${Math.round(refCenter[1])}`;
    }
    li.addEventListener('click', () => {
      selectedMatch = index;
      refreshMatchList();
      redraw();
    });
    matchList.appendChild(li);
  });
}

function updateRoiInfo(): void {
  if (!roiOrig) {
    roiInfo.textContent = '未框选区域';
    return;
  }
  const [x, y, w, h] = roiOrig;
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);
  const ref = mapperOk
    ? `${Math.round((x * REFERENCE_WIDTH) / (frame?.origWidth ?? 1))},${Math.round((y * REFERENCE_HEIGHT) / (frame?.origHeight ?? 1))} ${Math.round((w * REFERENCE_WIDTH) / (frame?.origWidth ?? 1))}×${Math.round((h * REFERENCE_HEIGHT) / (frame?.origHeight ?? 1))}`
    : '比例不一致，参考坐标不可用';
  roiInfo.textContent = `图片 ${x},${y} ${w}×${h}\n参考 ${ref}\n中心 ${cx},${cy} → ${referenceLabel(cx, cy)}`;
}

function updateTapInfo(): void {
  if (!tapOrig) {
    tapInfo.textContent = '未选择位置（点击测试模式下单击画面）';
    return;
  }
  tapInfo.textContent = `图片 ${tapOrig[0]},${tapOrig[1]}\n${referenceLabel(tapOrig[0], tapOrig[1])}`;
}

// ------------------------------------------------------------------ 交互

function setMode(next: 'roi' | 'tap'): void {
  mode = next;
  modeRoi.classList.toggle('active', mode === 'roi');
  modeTap.classList.toggle('active', mode === 'tap');
  setStatus(mode === 'roi' ? 'ROI 框选模式：拖动鼠标框选测试区域。' : '点击测试模式：单击画面选择点击位置。');
}

canvas.addEventListener('pointerdown', (event) => {
  if (!frame) return;
  const point = canvasToOrig(event.clientX, event.clientY);
  if (!point) return;
  if (mode === 'tap') {
    tapOrig = point;
    updateTapInfo();
    redraw();
    return;
  }
  dragStartOrig = point;
  dragCurrentOrig = point;
  canvas.setPointerCapture(event.pointerId);
  redraw();
});

canvas.addEventListener('pointermove', (event) => {
  if (mode !== 'roi' || !dragStartOrig) return;
  const point = canvasToOrig(event.clientX, event.clientY);
  if (point) dragCurrentOrig = point;
  redraw();
});

canvas.addEventListener('pointerup', (event) => {
  if (mode === 'tap' || !dragStartOrig) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const end = canvasToOrig(event.clientX, event.clientY) ?? dragCurrentOrig ?? dragStartOrig;
  const x = Math.min(dragStartOrig[0], end[0]);
  const y = Math.min(dragStartOrig[1], end[1]);
  const w = Math.abs(end[0] - dragStartOrig[0]);
  const h = Math.abs(end[1] - dragStartOrig[1]);
  dragStartOrig = null;
  dragCurrentOrig = null;
  if (w < 2 || h < 2 || !frame) {
    redraw();
    setStatus('框选区域太小，已忽略。');
    return;
  }
  roiOrig = [x, y, w, h];
  updateRoiInfo();
  setStatus(`已框选 ROI：${x},${y} ${w}×${h}`);
  redraw();
  if (roiOnlyInput.checked && autoMatchInput.checked) sendMatch();
});

function currentMatchCommand(): VisionCommand | null {
  if (!templatePath.trim()) return null;
  return {
    type: 'match',
    id: nextCommandId(),
    template: templatePath.trim(),
    threshold: clamp(Number(thresholdInput.value) || 0.85, 0, 1),
    maxResults: clamp(Math.round(Number(maxResultsInput.value) || 20), 1, 100),
    scaleSearch: scaleSearchInput.checked,
    ...(roiOnlyInput.checked && roiOrig ? { roi: [...roiOrig] } : {}),
  };
}

function sendMatch(): void {
  if (matchPending || !connected) return;
  const command = currentMatchCommand();
  if (!command) {
    showToast('请先选择模板图片', true);
    return;
  }
  if (roiOnlyInput.checked && !roiOrig) {
    showToast('已开启“匹配限 ROI”，请先在画面里框选 ROI 区域', true);
    setStatus('ROI 开关已开启，但还没有框选 ROI。', true);
    return;
  }
  matchPending = true;
  matchOnce.disabled = true;
  void api.visionCommand(command).catch((error) => {
    matchPending = false;
    matchOnce.disabled = false;
    showToast(`匹配失败：${errorMessage(error)}`, true);
  });
}

function loadTemplate(path: string): void {
  templatePath = path;
  templateImage.hidden = true;
  if (!path.trim()) {
    templateEmpty.hidden = false;
    return;
  }
  void api.readAssetData([path]).then((items) => {
    const item = items.find((candidate) => candidate.path === path);
    if (item) {
      templateImage.src = item.dataUrl;
      templateImage.hidden = false;
      templateEmpty.hidden = true;
      setStatus(`已载入模板：${path}`);
    } else {
      templateImage.hidden = true;
      templateEmpty.hidden = false;
      showToast(`模板不存在或不可读：${path}`, true);
    }
  }).catch(() => undefined);
  if (connected && autoMatchInput.checked) sendMatch();
}

let cachedTemplatePaths: string[] | null = null;

async function listTemplatePaths(): Promise<string[]> {
  if (cachedTemplatePaths) return cachedTemplatePaths;
  const assets = await api.listAssets();
  const templates = assets
    .map((asset) => asset.path)
    .filter((assetPath) => assetPath.startsWith('assets/templates/'))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .slice(0, 400);
  cachedTemplatePaths = templates;
  return templates;
}

async function populateTemplateOptions(): Promise<void> {
  try {
    const templates = await listTemplatePaths();
    templateOptions.replaceChildren();
    templates.forEach((assetPath) => {
      const option = document.createElement('option');
      option.value = assetPath;
      option.textContent = assetPath;
      templateOptions.appendChild(option);
    });
  } catch {
    // 模板列表只是辅助输入；失败时仍可手填路径。
  }
}

// ------------------------------------------------------------- 模板浏览器

const templateBrowser = document.querySelector<HTMLElement>('#vision-template-browser')!;
const templateBrowserGroups = document.querySelector<HTMLElement>('#vision-browser-groups')!;

function openTemplateBrowser(): void {
  templateBrowser.classList.remove('hidden');
  void renderTemplateBrowser();
}

function closeTemplateBrowser(): void {
  templateBrowser.classList.add('hidden');
}

async function renderTemplateBrowser(): Promise<void> {
  let templates: string[];
  try {
    templates = await listTemplatePaths();
  } catch {
    templateBrowserGroups.textContent = '模板列表加载失败。';
    return;
  }
  if (templates.length === 0) {
    templateBrowserGroups.textContent = 'assets/templates 下还没有模板图片。';
    return;
  }
  const groups = new Map<string, string[]>();
  for (const assetPath of templates) {
    const parts = assetPath.split('/');
    const folder = parts.length > 2 ? parts[2] : '未分类';
    const list = groups.get(folder);
    if (list) list.push(assetPath);
    else groups.set(folder, [assetPath]);
  }
  const ordered = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
  templateBrowserGroups.replaceChildren();
  const pendingImages = new Map<string, HTMLImageElement>();
  for (const [folder, assetPaths] of ordered) {
    const section = document.createElement('section');
    section.className = 'vision-browser-group';
    const heading = document.createElement('h4');
    heading.textContent = folder;
    heading.className = 'vision-browser-group-title';
    section.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'vision-browser-grid';
    for (const assetPath of assetPaths) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vision-browser-item';
      item.title = assetPath;
      const preview = document.createElement('img');
      preview.alt = '';
      preview.loading = 'lazy';
      const name = document.createElement('span');
      name.textContent = assetPath.split('/').pop() ?? assetPath;
      name.className = 'vision-browser-item-name';
      item.append(preview, name);
      pendingImages.set(assetPath, preview);
      item.addEventListener('click', () => {
        templateInput.value = assetPath;
        loadTemplate(assetPath);
        closeTemplateBrowser();
      });
      grid.appendChild(item);
    }
    section.appendChild(grid);
    templateBrowserGroups.appendChild(section);
  }
  // 分批加载缩略图，避免一次 IPC 读太多文件。
  const paths = [...pendingImages.keys()];
  for (let offset = 0; offset < paths.length; offset += 16) {
    const batch = paths.slice(offset, offset + 16);
    try {
      const items = await api.readAssetData(batch);
      for (const item of items) {
        const image = pendingImages.get(item.path);
        if (image) image.src = item.dataUrl;
      }
    } catch {
      // 缩略图缺失只影响预览，不阻断选择。
    }
  }
}

function refreshFrameMeta(): void {
  if (!frame) {
    frameMeta.textContent = '—';
    return;
  }
  frameMeta.textContent = `${frame.origWidth}×${frame.origHeight}`;
}

// ------------------------------------------------------------------ 事件

function applyStreamExit(event: VisionStreamEvent): void {
  connected = false;
  matchPending = false;
  matchOnce.disabled = false;
  setConnection('offline', '未连接');
  const message = typeof event.message === 'string' ? event.message : '画面推流已停止';
  maskText.textContent = message;
  stageMask.classList.remove('hidden');
  setStatus(message, Boolean(event.error));
}

function handleEvent(event: VisionStreamEvent): void {
  switch (event.type) {
    case 'ready':
      connected = true;
      mapperOk = event.mapper === true;
      setConnection('online', '已连接');
      stageMask.classList.add('hidden');
      setStatus('已连接模拟器，实时画面运行中。');
      break;
    case 'frame':
      if (typeof event.data === 'string' && typeof event.width === 'number' && typeof event.height === 'number') {
        frameToken += 1;
        const token = frameToken;
        frame = {
          dataUrl: `data:image/png;base64,${event.data}`,
          width: event.width,
          height: event.height,
          origWidth: typeof event.orig_width === 'number' ? event.orig_width : event.width,
          origHeight: typeof event.orig_height === 'number' ? event.orig_height : event.height,
          token,
        };
        const image = new Image();
        image.onload = () => {
          if (frame && frame.token === token) {
            imageEl = image;
            stageMask.classList.add('hidden');
            refreshFrameMeta();
            updateRoiInfo();
            updateTapInfo();
            redraw();
          }
        };
        image.src = frame.dataUrl;
        if (autoMatchInput.checked && templatePath.trim() && !matchPending) sendMatch();
      }
      break;
    case 'match_result': {
      matchPending = false;
      matchOnce.disabled = false;
      matches = Array.isArray(event.matches)
        ? (event.matches as VisionMatch[])
        : [];
      selectedMatch = matches.length > 0 ? 0 : null;
      refreshMatchList();
      redraw();
      if (matches.length === 0) setStatus(`未找到匹配（阈值 ${String(event.threshold ?? 0.85)}）。`);
      else setStatus(`找到 ${matches.length} 处匹配。`);
      break;
    }
    case 'tap_result':
      if (event.ok === true) setStatus(typeof event.message === 'string' ? event.message : '已发送点击。');
      else showToast(typeof event.message === 'string' ? event.message : '点击失败', true);
      break;
    case 'status':
      if (typeof event.message === 'string') {
        setStatus(event.message, event.error === true);
        if (!connected) {
          setConnection('connecting', event.error === true ? '连接失败' : '连接中');
          maskText.textContent = event.message;
        }
      }
      break;
    case 'error':
      showToast(typeof event.message === 'string' ? event.message : '命令失败', true);
      if (typeof event.id === 'number') {
        matchPending = false;
        matchOnce.disabled = false;
      }
      break;
    case 'stream_exit':
      applyStreamExit(event);
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ 界面绑定

function bindUi(): void {
  createIcons({ icons: { Minus, Square, X, Pause, Play, Scan, ImageDown } });

  document.querySelector('#vision-minimize')?.addEventListener('click', () => void api.minimizeWindow());
  document.querySelector('#vision-maximize')?.addEventListener('click', () => void api.toggleMaximizeWindow());
  document.querySelector('#vision-close')?.addEventListener('click', () => void api.closeWindow());

  modeRoi.addEventListener('click', () => setMode('roi'));
  modeTap.addEventListener('click', () => setMode('tap'));

  liveToggle.addEventListener('click', () => {
    live = !live;
    liveToggle.querySelector('i')?.setAttribute('data-lucide', live ? 'pause' : 'play');
    liveToggle.querySelector('span')!.textContent = live ? '实时捕获' : '已暂停';
    createIcons({ icons: { Pause, Play }, root: liveToggle });
    void api.visionCommand({ type: 'pause', id: nextCommandId(), paused: !live }).catch((error) => {
      showToast(`暂停控制失败：${errorMessage(error)}`, true);
    });
    setStatus(live ? '实时捕获运行中。' : '实时捕获已暂停，画面保持当前帧。');
  });

  intervalSelect.addEventListener('change', () => {
    void api.visionCommand({ type: 'interval', id: nextCommandId(), ms: Number(intervalSelect.value) })
      .catch((error) => showToast(`调整刷新失败：${errorMessage(error)}`, true));
  });

  matchOnce.addEventListener('click', () => sendMatch());
  clearMatches.addEventListener('click', () => {
    matches = [];
    selectedMatch = null;
    refreshMatchList();
    redraw();
  });

  templateInput.addEventListener('change', () => loadTemplate(templateInput.value.trim()));
  templateInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadTemplate(templateInput.value.trim());
    }
  });
  document.querySelector('#vision-template-browse')?.addEventListener('click', () => openTemplateBrowser());
  document.querySelector('#vision-browser-close')?.addEventListener('click', () => closeTemplateBrowser());
  document.querySelectorAll<HTMLElement>('[data-vision-browser-close]').forEach((element) => {
    element.addEventListener('click', () => closeTemplateBrowser());
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !templateBrowser.classList.contains('hidden')) closeTemplateBrowser();
  });
  [thresholdInput, maxResultsInput].forEach((input) => {
    input.addEventListener('change', () => {
      if (connected && autoMatchInput.checked && templatePath.trim()) sendMatch();
    });
  });
  scaleSearchInput.addEventListener('change', () => {
    if (connected && autoMatchInput.checked && templatePath.trim()) sendMatch();
  });
  roiOnlyInput.addEventListener('change', () => {
    roiOnlyCardInput.checked = roiOnlyInput.checked;
    if (connected && autoMatchInput.checked && templatePath.trim()) sendMatch();
  });
  roiOnlyCardInput.addEventListener('change', () => {
    roiOnlyInput.checked = roiOnlyCardInput.checked;
    if (connected && autoMatchInput.checked && templatePath.trim()) sendMatch();
  });

  clearRoi.addEventListener('click', () => {
    roiOrig = null;
    updateRoiInfo();
    redraw();
  });

  tapSend.addEventListener('click', () => {
    if (!tapOrig) {
      showToast('请先在“点击测试”模式下单击画面选择位置。', true);
      return;
    }
    const hold = clamp(Math.round(Number(holdInput.value) || 0), 0, 2000);
    void api.visionCommand({
      type: 'tap',
      id: nextCommandId(),
      x: tapOrig[0],
      y: tapOrig[1],
      holdMs: hold,
    }).catch((error) => showToast(`发送点击失败：${errorMessage(error)}`, true));
  });

  saveButton.addEventListener('click', () => {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      void api.saveCanvas({ filename: 'vision-test-annotated.png', dataUrl }).then((saved) => {
        showToast(saved ? `标注画面已保存：${saved}` : '已取消保存');
      }).catch((error) => showToast(`保存失败：${errorMessage(error)}`, true));
    } catch {
      showToast('当前没有可保存的画面', true);
    }
  });

  const resizeObserver = new ResizeObserver(() => redraw());
  resizeObserver.observe(stage);
  window.addEventListener('resize', () => {
    dpr = window.devicePixelRatio || 1;
    redraw();
  });
}

// ------------------------------------------------------------------ 启动

async function start(): Promise<void> {
  bindUi();
  instanceLabel.textContent = instanceParam() ? `目标实例：${instanceParam()}` : '未选择实例';
  setConnection('connecting', '连接中');
  maskText.textContent = '正在连接模拟器…';
  await populateTemplateOptions();
  api.onVisionEvent(handleEvent);
  window.addEventListener('pagehide', () => {
    void api.visionStop().catch(() => undefined);
  });
  try {
    await api.visionStart();
  } catch (error) {
    maskText.textContent = `启动画面推流失败：${errorMessage(error)}`;
    stageMask.classList.remove('hidden');
    setStatus(maskText.textContent, true);
    setConnection('offline', '未连接');
  }
}

void start();
