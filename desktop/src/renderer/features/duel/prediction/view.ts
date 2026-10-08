/// <reference path="../worker-imports.d.ts" />
import { soulCatalog } from '../../../../shared/soul-catalog-data';
import type { HeroProfile, Panel, PanelKey, SuitProfile } from '../../../../shared/soul-optimizer';
import type { DuelScreenCapture, DuelScreenRecognition, DuelScreenRoi } from '../../../../shared/contracts';
import { PANEL_LABELS } from '../../../../shared/soul-optimizer';
import { installCommunityPicker } from '../../souls/community/picker';
import { appendPickerPortrait } from '../../souls/optimizer/picker';
import { predictionCoverageWarning } from './coverage-warning';
import { simulateBattle, type BattleFighterInput, type DuelBattleInput } from '../engine/battle-engine';
import DuelSimulationWorker from '../engine/simulation/worker?worker';
import { renderBattleLog } from '../engine/battle-log';
import { createElement, ChevronLeft, ChevronRight } from 'lucide';

type SideId = 'blue' | 'red';
type FighterInput = BattleFighterInput;
type DuelState = DuelBattleInput;

const STORAGE_KEY = 'onmyoji-studio.duel-prediction.v1';
const TEAM_SIZE = 5;
const FIELD_ORDER: PanelKey[] = ['hp', 'attack', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist'];
const ROSTER_FIELD_ORDER: PanelKey[] = ['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist'];
const PERCENT_FIELDS = new Set<PanelKey>(['crit', 'critDamage', 'hit', 'resist']);
const panelInputValue = (field: PanelKey, value: number): string =>
  String(Number((PERCENT_FIELDS.has(field) ? value * 100 : value).toFixed(2)));
const heroes = [...soulCatalog.heroes] as HeroProfile[];
const suits = (soulCatalog.suits as SuitProfile[]).filter(suit => !suit.boss);
const blankPanel = (): Panel => ({ hp: 0, attack: 0, defense: 0, speed: 0, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
const blankFighter = (): FighterInput => ({ heroId: null, fourSuit: '', skillLevel: 5, panel: null });
const blankState = (): DuelState => ({ blue: Array.from({ length: TEAM_SIZE }, blankFighter), red: Array.from({ length: TEAM_SIZE }, blankFighter) });

function readPersistedState(): string | null {
  try {
    const saved = window.onmyoji?.readLayout(STORAGE_KEY);
    if (saved != null) return saved;
  } catch { /* Fall back to the browser copy in preview or recovery mode. */ }
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writePersistedState(value: string): void {
  try { window.onmyoji?.writeLayout(STORAGE_KEY, value); } catch { /* Keep the browser copy as a fallback. */ }
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Storage may be disabled. */ }
}

function loadState(): DuelState {
  try {
    const value = JSON.parse(readPersistedState() ?? 'null') as Partial<DuelState> | null;
    const side = (items: FighterInput[] | undefined): FighterInput[] => Array.from({ length: TEAM_SIZE }, (_, index) => {
      const item = items?.[index];
      if (!item || typeof item !== 'object') return blankFighter();
      const heroId = Number.isInteger(item.heroId) && heroes.some(hero => hero.id === item.heroId) ? item.heroId : null;
      const panel = item.panel && FIELD_ORDER.every(key => Number.isFinite(item.panel?.[key])) ? item.panel : null;
      return {
        heroId,
        fourSuit: suits.some(suit => String(suit.id) === item.fourSuit) ? item.fourSuit : '',
        skillLevel: 5,
        panel,
      };
    });
    return { blue: side(value?.blue), red: side(value?.red) };
  } catch {
    return blankState();
  }
}

function make<T extends HTMLElement>(doc: Document, tag: string, className = '', text = ''): T {
  const element = doc.createElement(tag) as T;
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createSelect(doc: Document, label: string, values: Array<[string, string]>, selected: string): HTMLSelectElement {
  const field = make<HTMLLabelElement>(doc, 'label', 'duel-select-field');
  field.append(make(doc, 'span', 'duel-field-label', label));
  const select = make<HTMLSelectElement>(doc, 'select');
  select.setAttribute('aria-label', label);
  for (const [value, name] of values) {
    const option = make<HTMLOptionElement>(doc, 'option', '', name);
    option.value = value;
    option.selected = value === selected;
    select.append(option);
  }
  field.append(select);
  return select;
}

export function installDuelPredictionPanel(root: HTMLElement): () => void {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.duel-prediction-categories [role="tab"]'));
  const title = root.querySelector<HTMLElement>('[data-duel-title]');
  if (!tabs.length) return () => undefined;
  let closePicker = (): void => {};
  let teams: HTMLElement | null = null;

  const selectPage = (selected: HTMLButtonElement): void => {
    closePicker();
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const pageId = tab.getAttribute('aria-controls');
      const page = pageId ? root.querySelector<HTMLElement>(`#${pageId}`) : null;
      if (page) page.hidden = !active;
    }
    if (title) title.textContent = selected.textContent?.trim() ?? '';
  };
  const tabClick = (event: Event): void => selectPage(event.currentTarget as HTMLButtonElement);
  const tabKeydown = (event: KeyboardEvent): void => {
    const index = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : -1;
    if (next < 0) return;
    event.preventDefault(); selectPage(tabs[next]); tabs[next].focus();
  };
  for (const tab of tabs) { tab.addEventListener('click', tabClick); tab.addEventListener('keydown', tabKeydown); }
  selectPage(tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]);

  const simulator = root.querySelector<HTMLElement>('[data-duel-simulator]');
  const doc = root.ownerDocument;
  if (!simulator) return () => { for (const tab of tabs) { tab.removeEventListener('click', tabClick); tab.removeEventListener('keydown', tabKeydown); } };
  let state = loadState();
  const slotInputs = new Map<string, FighterInput>();
  let pickerSlot = '';
  const refreshChoices = (card: HTMLElement): void => {
    const [side, index] = card.dataset.slot!.split('-');
    const slotName = `${side === 'blue' ? '蓝方' : '红方'}式神 ${Number(index) + 1}`;
    for (const field of ['heroId', 'fourSuit'] as const) {
      const value = card.querySelector<HTMLSelectElement>(`[data-field="${field}"]`)!.value;
      const choice = field === 'heroId' ? heroes.find(hero => String(hero.id) === value) : suits.find(suit => String(suit.id) === value);
      const button = card.querySelector<HTMLButtonElement>(`[data-duel-choice="${field}"]`)!;
      const label = choice?.name ?? (field === 'heroId' ? '选择式神' : '选择御魂效果');
      button.replaceChildren();
      if (choice) appendPickerPortrait(button, field === 'heroId' ? 'hero' : 'soul', choice.id, choice.name);
      else if (field === 'heroId') button.append(make(doc, 'span', 'duel-empty-portrait', '+'));
      if (field === 'heroId') {
        const info = make(doc, 'span', 'duel-choice-info');
        info.append(make(doc, 'span', 'duel-choice-name', label), make(doc, 'small', '', `${Number(index) + 1} 号位 · ${choice ? '更换式神' : '点击选择'}`));
        button.append(info);
      } else button.append(make(doc, 'span', 'duel-choice-name', label));
      button.append(make(doc, 'span', 'duel-choice-search', '⌕'));
      button.setAttribute('aria-label', `${slotName} ${field === 'heroId' ? '式神' : '御魂效果'}，当前${label}`);
      if (field === 'heroId') card.querySelector('.duel-fighter-name')!.textContent = `${slotName}${choice ? ` · ${choice.name}` : ''}`;
    }
  };
  const result = make<HTMLDivElement>(doc, 'div', 'duel-simulation-result');
  const output = make<HTMLElement>(doc, 'aside', 'duel-simulation-output');
  output.setAttribute('aria-label', '模拟结果与对局过程');
  output.append(make(doc, 'h2', 'duel-output-title', '对局过程'));
  const empty = make(doc, 'div', 'duel-simulation-empty');
  empty.append(make(doc, 'strong', '', '等待模拟'), make(doc, 'p', '', '配置双方阵容并选择模拟次数，点击“开始模拟”后，这里会展示胜率和各场样例对局过程。'));
  output.append(result, empty);
  const captureInstances = make<HTMLSelectElement>(doc, 'select', 'duel-capture-instance');
  captureInstances.setAttribute('aria-label', '识别画面使用的模拟器实例');
  const instancePlaceholder = (): HTMLOptionElement => {
    const option = make<HTMLOptionElement>(doc, 'option', '', '选择模拟器实例');
    option.value = '';
    return option;
  };
  captureInstances.append(instancePlaceholder());
  const recognitionStatus = make<HTMLSpanElement>(doc, 'span', 'duel-recognition-status');
  const simulationStatus = make<HTMLSpanElement>(doc, 'span', 'duel-simulation-status');
  let simulationWorker: Worker | undefined;
  let simulationGeneration = 0;
  let currentSimulation: { outcome: ReturnType<typeof simulateBattle>; runs: number; state: DuelState } | undefined;
  const sampleCache = new Map<number, { sampleLog: string[]; sampleReason?: 'elimination' | 'action-limit' | 'trigger-budget' }>();
  const pendingSamples = new Set<number>();
  const cacheSample = (index: number, sample: { sampleLog: string[]; sampleReason?: 'elimination' | 'action-limit' | 'trigger-budget' }): void => {
    sampleCache.delete(index);
    sampleCache.set(index, sample);
    while (sampleCache.size > 20) sampleCache.delete(sampleCache.keys().next().value!);
  };
  const stopSimulationWorker = (): void => {
    simulationWorker?.terminate();
    simulationWorker = undefined;
  };

  captureInstances.addEventListener('change', () => {
    try { localStorage.setItem(`${STORAGE_KEY}.instance`, captureInstances.value); } catch { /* Optional preference. */ }
  });
  let closeCaptureDialog: (() => void) | null = null;
  let activeRecognitionCount = 0;
  const beginRecognition = (button: HTMLButtonElement): void => {
    activeRecognitionCount++;
    button.disabled = true;
    run.disabled = true;
    reset.disabled = true;
  };
  const finishRecognition = (button: HTMLButtonElement): void => {
    button.disabled = false;
    activeRecognitionCount = Math.max(0, activeRecognitionCount - 1);
    if (activeRecognitionCount === 0) {
      run.disabled = false;
      reset.disabled = false;
    }
  };
  const showRecognitionLoading = (target: HTMLElement): (() => void) => {
    const loading = make(doc, 'div', 'duel-recognition-loading');
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', '正在识别，请稍候');
    const ring = make(doc, 'span', 'duel-loading-ring');
    ring.setAttribute('aria-hidden', 'true');
    loading.append(ring);
    const controls = Array.from(target.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button'));
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    target.setAttribute('aria-busy', 'true');
    target.append(loading);
    return () => {
      loading.remove(); target.removeAttribute('aria-busy');
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
    };
  };

  const selectScreenRoi = (label: string): Promise<{ capture: DuelScreenCapture; roi: DuelScreenRoi } | null> => new Promise(resolve => {
    const dialog = make<HTMLDialogElement>(doc, 'dialog', 'duel-roi-dialog');
    const closeDialog = (): void => dialog.close();
    closeCaptureDialog = closeDialog;
    dialog.setAttribute('aria-labelledby', 'duel-roi-title');
    dialog.setAttribute('aria-describedby', 'duel-roi-help');
    const heading = make(doc, 'header', 'duel-roi-heading');
    const identity = make(doc, 'div', 'duel-roi-heading-info');
    const title = make(doc, 'h2', '', '框选识别区域'); title.id = 'duel-roi-title';
    const help = make(doc, 'p', 'duel-roi-help', `选择模拟器画面，或点击“选择图片”后拖入/点选截图；拖动框选${label}，也可以识别整张图片。`); help.id = 'duel-roi-help';
    identity.append(title, help);
    const close = make<HTMLButtonElement>(doc, 'button', 'duel-roi-close', '×'); close.type = 'button';
    close.setAttribute('aria-label', '关闭框选窗口');
    heading.append(identity, close);
    const controls = make(doc, 'div', 'duel-roi-controls');
    const instanceField = make<HTMLLabelElement>(doc, 'label', 'duel-roi-instance-field');
    instanceField.append(make(doc, 'span', '', '模拟器实例'), captureInstances);
    const refresh = make<HTMLButtonElement>(doc, 'button', 'duel-roi-refresh', '刷新画面'); refresh.type = 'button';
    const importImage = make<HTMLButtonElement>(doc, 'button', 'duel-roi-import', '选择图片'); importImage.type = 'button';
    const imageInput = make<HTMLInputElement>(doc, 'input', 'duel-roi-file');
    imageInput.type = 'file'; imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'; imageInput.hidden = true;
    controls.append(instanceField, refresh, importImage, imageInput);
    const viewport = make(doc, 'div', 'duel-roi-viewport');
    const stage = make(doc, 'div', 'duel-roi-stage');
    stage.hidden = true;
    const image = make<HTMLImageElement>(doc, 'img', 'duel-roi-image');
    image.alt = '当前模拟器画面'; image.draggable = false;
    const placeholder = make(doc, 'p', 'duel-roi-placeholder', '正在读取在线实例…');
    const selection = make(doc, 'div', 'duel-roi-selection'); selection.hidden = true;
    stage.append(image, selection); viewport.append(stage, placeholder);
    const footer = make(doc, 'footer', 'duel-roi-footer');
    const hint = make(doc, 'span', 'duel-roi-size', '松开鼠标后自动识别');
    const recognizeWholeImage = make<HTMLButtonElement>(doc, 'button', 'duel-roi-recognize-image', '识别整张图片'); recognizeWholeImage.type = 'button'; recognizeWholeImage.disabled = true;
    const cancel = make<HTMLButtonElement>(doc, 'button', 'duel-roi-cancel', '取消'); cancel.type = 'button';
    footer.append(hint, recognizeWholeImage, cancel);
    dialog.append(heading, controls, viewport, footer);
    doc.body.append(dialog);

    let start: { x: number; y: number } | null = null;
    let bounds: { left: number; top: number; width: number; height: number } | null = null;
    let roi: DuelScreenRoi | null = null;
    let capture: DuelScreenCapture | null = null;
    let settled = false;
    let captureRequest = 0;
    let imageMode = false;
    const showImageDropzone = (): void => {
      imageMode = true;
      captureRequest++;
      capture = null; roi = null; start = null; bounds = null;
      stage.hidden = true; selection.hidden = true; placeholder.hidden = false;
      placeholder.textContent = '将图片拖到这里，或点击此区域选择文件';
      placeholder.title = '点击选择图片，或将图片文件拖到此区域';
      viewport.classList.add('is-image-mode');
      instanceField.hidden = true; refresh.hidden = true;
      importImage.textContent = '返回模拟器';
      recognizeWholeImage.disabled = true;
      hint.textContent = '支持 PNG、JPG、WebP、GIF、BMP，单张不超过32MB';
    };
    const showSimulator = (): void => {
      imageMode = false;
      viewport.classList.remove('is-image-mode');
      placeholder.removeAttribute('title');
      instanceField.hidden = false; refresh.hidden = false;
      importImage.textContent = '选择图片';
      void loadCapture();
    };
    const setLoadedImage = (loaded: DuelScreenCapture, sourceHint: string): void => {
      capture = loaded; roi = null; start = null; bounds = null;
      image.src = loaded.dataUrl;
      stage.hidden = false; placeholder.hidden = true;
      recognizeWholeImage.disabled = false;
      hint.textContent = sourceHint;
    };
    const loadCapture = async (): Promise<void> => {
      const request = ++captureRequest;
      capture = null; roi = null; start = null; bounds = null;
      recognizeWholeImage.disabled = true;
      stage.hidden = true; selection.hidden = true; placeholder.hidden = false;
      hint.textContent = '松开鼠标后自动识别';
      if (!captureInstances.value) {
        placeholder.textContent = captureInstances.options.length > 1 ? '请先选择模拟器实例' : '未发现在线实例，请启动模拟器后刷新';
        return;
      }
      placeholder.textContent = '正在加载游戏画面…';
      try {
        const loaded = await window.onmyoji.captureDuelScreen(captureInstances.value);
        if (settled || request !== captureRequest) return;
        setLoadedImage(loaded, '拖动框选后松开鼠标识别局部，也可直接识别整张图片');
      } catch (error) {
        if (settled || request !== captureRequest) return;
        placeholder.textContent = error instanceof Error ? error.message : '画面加载失败，请刷新重试';
      }
    };
    const reloadInstances = async (): Promise<void> => {
      refresh.disabled = true;
      try {
        const instances = await window.onmyoji.listInstances();
        if (settled) return;
        const remembered = captureInstances.value || localStorage.getItem(`${STORAGE_KEY}.instance`) || '';
        captureInstances.replaceChildren(instancePlaceholder());
        for (const instance of instances) {
          const name = instance.displayName || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
          const option = make<HTMLOptionElement>(doc, 'option', '', name);
          option.value = instance.id; option.selected = instance.id === remembered;
          captureInstances.append(option);
        }
        captureInstances.disabled = instances.length === 0;
        await loadCapture();
      } catch {
        if (!settled) { placeholder.hidden = false; placeholder.textContent = '无法读取实例，请刷新重试'; }
      } finally { refresh.disabled = false; }
    };
    const instanceChanged = (): void => { void loadCapture(); };
    captureInstances.addEventListener('change', instanceChanged);
    refresh.addEventListener('click', () => { void reloadInstances(); });
    importImage.addEventListener('click', () => {
      if (imageMode) showSimulator();
      else showImageDropzone();
    });
    viewport.addEventListener('click', event => {
      if (!imageMode || capture || event.target !== viewport && event.target !== placeholder) return;
      imageInput.click();
    });
    const importImageFile = async (file: File | undefined): Promise<void> => {
      if (!file) return;
      const supported = /^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
      if (!supported) { hint.textContent = '请选择 PNG、JPG、WebP、GIF 或 BMP 图片'; return; }
      if (file.size > 32 * 1024 * 1024) { hint.textContent = '图片过大，请选择小于32MB的图片'; return; }
      const request = ++captureRequest;
      recognizeWholeImage.disabled = true;
      hint.textContent = '正在载入图片…';
      const objectUrl = URL.createObjectURL(file);
      try {
        const source = doc.createElement('img');
        await new Promise<void>((loaded, failed) => {
          source.onload = () => loaded();
          source.onerror = () => failed(new Error('图片无法读取，请换一张图片'));
          source.src = objectUrl;
        });
        if (settled || request !== captureRequest) return;
        if (!source.naturalWidth || !source.naturalHeight || source.naturalWidth > 12000 || source.naturalHeight > 12000 || source.naturalWidth * source.naturalHeight > 60_000_000) {
          throw new Error('图片尺寸过大，请缩小后再识别');
        }
        const canvas = doc.createElement('canvas');
        canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('图片转换失败，请重试');
        context.drawImage(source, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > 22_000_000) throw new Error('转换后的图片过大，请缩小后再识别');
        setLoadedImage({ width: canvas.width, height: canvas.height, dataUrl }, '图片已载入；拖动框选识别局部，或点击“识别整张图片”');
      } catch (error) {
        if (!settled && request === captureRequest) {
          recognizeWholeImage.disabled = !capture;
          hint.textContent = error instanceof Error ? error.message : '图片载入失败';
        }
      } finally { URL.revokeObjectURL(objectUrl); }
    };
    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      void importImageFile(file);
      imageInput.value = '';
    });
    for (const eventName of ['dragenter', 'dragover'] as const) viewport.addEventListener(eventName, event => {
      event.preventDefault(); viewport.classList.add('is-image-dragging');
    });
    viewport.addEventListener('dragleave', event => {
      if (!viewport.contains(event.relatedTarget as Node | null)) viewport.classList.remove('is-image-dragging');
    });
    viewport.addEventListener('drop', event => {
      event.preventDefault(); viewport.classList.remove('is-image-dragging');
      if (!imageMode) showImageDropzone();
      void importImageFile((event as DragEvent).dataTransfer?.files?.[0]);
    });
    recognizeWholeImage.addEventListener('click', () => {
      if (!capture) return;
      submitted = { capture, roi: { x: 0, y: 0, width: capture.width, height: capture.height } };
      dialog.close();
    });
    const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
    const imagePoint = (event: PointerEvent): { x: number; y: number } | null => {
      if (!capture || stage.hidden || !image.complete || !image.naturalWidth) return null;
      const rect = image.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: clamp(event.clientX - rect.left, 0, rect.width), y: clamp(event.clientY - rect.top, 0, rect.height) };
    };
    const updateSelection = (end: { x: number; y: number }): void => {
      if (!start || !bounds || !capture) return;
      const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
      Object.assign(selection.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      selection.hidden = false;
      if (width < 12 || height < 12) {
        roi = null; hint.textContent = '拖动以框选识别区域'; return;
      }
      const scaleX = capture.width / bounds.width, scaleY = capture.height / bounds.height;
      roi = {
        x: Math.floor(left * scaleX), y: Math.floor(top * scaleY),
        width: Math.ceil(width * scaleX), height: Math.ceil(height * scaleY),
      };
      hint.textContent = `已选区域 ${roi.width} × ${roi.height}，松开鼠标后自动识别`;
    };
    const pointerDown = (event: PointerEvent): void => {
      const point = imagePoint(event);
      if (!point) return;
      event.preventDefault();
      const rect = image.getBoundingClientRect();
      bounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      start = point; roi = null;
      selection.hidden = false;
      Object.assign(selection.style, { left: `${point.x}px`, top: `${point.y}px`, width: '0', height: '0' });
      stage.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent): void => { const point = imagePoint(event); if (point) updateSelection(point); };
    const pointerUp = (event: PointerEvent): void => {
      const point = imagePoint(event);
      if (point) updateSelection(point);
      start = null;
      if (roi && capture) { submitted = { capture, roi }; dialog.close(); }
    };
    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerUp);
    stage.addEventListener('pointercancel', pointerUp);
    image.addEventListener('load', () => { bounds = null; roi = null; });
    let submitted: { capture: DuelScreenCapture; roi: DuelScreenRoi } | null = null;
    const finish = (value: typeof submitted): void => {
      if (settled) return;
      settled = true;
      if (closeCaptureDialog === closeDialog) closeCaptureDialog = null;
      captureInstances.removeEventListener('change', instanceChanged);
      captureInstances.remove();
      resolve(value);
      dialog.remove();
    };
    dialog.addEventListener('close', () => finish(submitted));
    close.addEventListener('click', () => dialog.close());
    cancel.addEventListener('click', () => dialog.close());
    dialog.showModal();
    void reloadInstances();
  });

  const captureAndSelectRegion = async (label: string, target: HTMLElement): Promise<DuelScreenRecognition | null> => {
    recognitionStatus.textContent = '';
    const selected = await selectScreenRoi(label);
    if (!selected) {
      recognitionStatus.textContent = '已取消画面识别';
      return null;
    }
    const { capture, roi } = selected;
    const finishLoading = showRecognitionLoading(target);
    try { return await window.onmyoji.recognizeDuelScreen(capture.dataUrl, roi); }
    finally { finishLoading(); }
  };

  const writeState = (): void => {
    writePersistedState(JSON.stringify(state));
  };
  const renderResult = (outcome: ReturnType<typeof simulateBattle>, runs: number, matchIndex: number, simulationState: DuelState): void => {
    result.replaceChildren();
    const blue = make(doc, 'div', `duel-result-side${outcome.blueRate >= outcome.redRate ? ' is-leading' : ''}`);
    blue.append(make(doc, 'span', '', '蓝方模拟胜率'), make(doc, 'strong', '', `${(outcome.blueRate * 100).toFixed(1)}%`));
    const red = make(doc, 'div', `duel-result-side${outcome.redRate >= outcome.blueRate ? ' is-leading' : ''}`);
    red.append(make(doc, 'span', '', '红方模拟胜率'), make(doc, 'strong', '', `${(outcome.redRate * 100).toFixed(1)}%`));
    const invalidRuns = outcome.invalidRuns ?? 0;
    const validRuns = Math.max(0, runs - invalidRuns);
    const runCountLabel = `${invalidRuns > 0 ? `${validRuns} / ${runs} 场有效模拟 · ${invalidRuns} 场触发预算超限未计入胜率` : `${runs} 场模拟`}`
      + (outcome.terminationCounts.actionLimit > 0 ? ` · ${outcome.terminationCounts.actionLimit} 场达到行动上限` : '');
    const engineName = outcome.engine === 'modular' ? '新内核' : '兼容引擎';
    const draws = make(doc, 'p', 'duel-result-draws', `平局 ${(outcome.drawRate * 100).toFixed(1)}% · ${runCountLabel} · ${engineName}`);
    const endReason = outcome.sampleResult?.reason ?? outcome.sampleReason;
    const endNote = endReason === 'action-limit' ? make(doc, 'p', 'duel-result-draws', '样例结束：达到 600 次行动上限，按双方剩余生命比例判定')
      : endReason === 'elimination' ? make(doc, 'p', 'duel-result-draws', '样例结束：一方全灭')
        : endReason === 'trigger-budget' ? make(doc, 'p', 'duel-result-draws', '样例结束：触发预算超限，该场不计入胜率') : undefined;
    const winner = outcome.blueRate === outcome.redRate ? '模拟结果：双方持平' : outcome.blueRate > outcome.redRate ? '模拟结果：蓝方更占优' : '模拟结果：红方更占优';
    result.append(make(doc, 'h3', '', winner));
    const warningText = predictionCoverageWarning(outcome.diagnostics);
    if (warningText) result.append(make(doc, 'p', 'duel-result-warning', warningText));
    const rates = make(doc, 'div', 'duel-result-rates'); rates.append(blue, red);
    const log = make<HTMLDetailsElement>(doc, 'details', 'duel-battle-log');
    log.open = true;
    log.append(make(doc, 'summary', '', `样例对局过程（第 ${matchIndex + 1} / ${runs} 场，共 ${outcome.sampleLog.length} 条记录）`));
    const matchNav = make(doc, 'div', 'duel-match-nav');
    matchNav.setAttribute('role', 'group'); matchNav.setAttribute('aria-label', '切换样例对局场次');
    const previous = make<HTMLButtonElement>(doc, 'button', '', '上一场');
    previous.prepend(createElement(ChevronLeft, { width: 13, height: 13, 'aria-hidden': 'true' }));
    previous.type = 'button'; previous.disabled = matchIndex <= 0;
    previous.addEventListener('click', () => {
      const nextIndex = matchIndex - 1;
      showSample(nextIndex);
    });
    const matchNumber = make<HTMLInputElement>(doc, 'input', 'duel-match-number');
    matchNumber.type = 'number'; matchNumber.min = '1'; matchNumber.max = String(runs); matchNumber.step = '1';
    matchNumber.value = String(matchIndex + 1); matchNumber.setAttribute('aria-label', '查看第几场模拟');
    const matchTotal = make(doc, 'span', 'duel-match-total', `/ ${runs} 场`);
    const position = make(doc, 'div', 'duel-match-position');
    position.append(matchNumber, matchTotal);
    const showMatch = (): void => {
      const requested = Number(matchNumber.value);
      if (!Number.isInteger(requested) || requested < 1 || requested > runs) {
        matchNumber.value = String(matchIndex + 1);
        return;
      }
      const nextIndex = requested - 1;
      if (nextIndex === matchIndex) return;
      showSample(nextIndex);
    };
    matchNumber.addEventListener('change', showMatch);
    matchNumber.addEventListener('keydown', event => { if (event.key === 'Enter') showMatch(); });
    const next = make<HTMLButtonElement>(doc, 'button', '', '下一场');
    next.append(createElement(ChevronRight, { width: 13, height: 13, 'aria-hidden': 'true' }));
    next.type = 'button'; next.disabled = matchIndex >= runs - 1;
    next.addEventListener('click', () => {
      const nextIndex = matchIndex + 1;
      showSample(nextIndex);
    });
    matchNav.append(previous, position, next);
    log.append(matchNav);
    const entries = renderBattleLog(doc, outcome.sampleLog);
    const filters = make(doc, 'div', 'duel-log-filters');
    filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', '筛选行动方');
    for (const [side, label] of [['all', '全部'], ['blue', '蓝方行动'], ['red', '红方行动']] as const) {
      const button = make<HTMLButtonElement>(doc, 'button', '', label);
      button.type = 'button'; button.dataset.logFilter = side; button.setAttribute('aria-pressed', String(side === 'all'));
      button.addEventListener('click', () => {
        for (const item of filters.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
        for (const card of entries.querySelectorAll<HTMLElement>('[data-log-side]')) card.hidden = side !== 'all' && card.dataset.logSide !== 'neutral' && card.dataset.logSide !== side;
        entries.scrollTop = 0;
      });
      filters.append(button);
    }
    log.append(filters);
    log.append(entries);
    result.append(rates, draws);
    if (endNote) result.append(endNote);
    const uncovered = outcome.diagnostics.filter(item => item.status !== 'verified');
    if (uncovered.length > 0) {
      const coverage = make<HTMLDetailsElement>(doc, 'details', 'duel-coverage-diagnostics');
      coverage.append(make(doc, 'summary', '', `新内核覆盖诊断 · ${uncovered.length} 项部分覆盖或未迁移`));
      coverage.append(make(doc, 'p', '', '以下未验证项目可能影响结果；本阵容仍在模块化引擎中运行。'));
      const list = make(doc, 'ul', '');
      for (const item of uncovered) {
        const hero = item.contentType === 'hero' ? heroes.find(candidate => String(candidate.id) === item.contentId) : undefined;
        const soulId = item.contentType === 'soul' ? Number(item.contentId.replace(/^soul:/, '')) : undefined;
        const soul = soulId === undefined ? undefined : suits.find(candidate => candidate.id === soulId);
        const contentName = hero?.name ?? soul?.name ?? item.contentId;
        const typeName = item.contentType === 'hero' ? '式神' : item.contentType === 'soul' ? '御魂' : item.contentType === 'status' ? '状态' : '运行时';
        const aspect = item.aspect === 'ai' ? 'AI' : item.aspect === 'mechanics' ? '技能／被动机制' : '';
        const coverageName = item.status === 'partial' ? '部分覆盖' : '未迁移';
        list.append(make(doc, 'li', '', `${typeName}·${contentName}${aspect ? ` · ${aspect}` : ''}：${coverageName}${item.message ? `（${item.message}）` : ''}`));
      }
      coverage.append(list);
      result.append(coverage);
    }
    result.append(log);
  };
  const showSample = (index: number): void => {
    const current = currentSimulation;
    if (!current) return;
    const cached = sampleCache.get(index);
    if (cached) {
      renderResult({ ...current.outcome, sampleLog: cached.sampleLog, sampleReason: cached.sampleReason, sampleResult: undefined }, current.runs, index, current.state);
      return;
    }
    if (!simulationWorker || pendingSamples.has(index)) return;
    pendingSamples.add(index);
    simulationStatus.textContent = `正在生成第 ${index + 1} 场样例…`;
    simulationWorker.postMessage({ type: 'sample', taskId: simulationGeneration, index });
  };
  const attachWorkerMessages = (worker: Worker, taskId: number, runs: number, stateSnapshot: DuelState): void => {
    worker.onmessage = (event: MessageEvent<{ type: string; taskId: number; completed: number; total: number; engine: string;
      result: ReturnType<typeof simulateBattle>; index: number; sampleLog: string[]; sampleReason?: 'elimination' | 'action-limit' | 'trigger-budget'; message: string }>) => {
      const data = event.data;
      if (data.taskId !== simulationGeneration || taskId !== simulationGeneration) return;
      if (data.type === 'progress') {
        simulationStatus.textContent = data.engine === 'modular'
          ? `正在模拟 · ${data.completed.toLocaleString()} / ${data.total.toLocaleString()} 场`
          : data.completed === 0 ? '正在模拟兼容规则…' : '';
      } else if (data.type === 'result') {
        cacheSample(0, { sampleLog: data.result.sampleLog, sampleReason: data.result.sampleReason });
        pendingSamples.delete(0);
        currentSimulation = { outcome: data.result, runs, state: stateSnapshot };
        simulationStatus.textContent = '';
        run.disabled = false; cancelRun.hidden = true;
        renderResult(data.result, runs, 0, stateSnapshot);
      } else if (data.type === 'sample') {
        pendingSamples.delete(data.index);
        cacheSample(data.index, { sampleLog: data.sampleLog, sampleReason: data.sampleReason });
        simulationStatus.textContent = '';
        const current = currentSimulation;
        if (current) renderResult({ ...current.outcome, sampleLog: data.sampleLog, sampleReason: data.sampleReason, sampleResult: undefined }, current.runs, data.index, current.state);
      } else if (data.type === 'error') {
        pendingSamples.clear();
        run.disabled = false; cancelRun.hidden = true;
        simulationStatus.textContent = `模拟失败：${data.message}`;
      }
    };
    worker.onerror = event => {
      if (taskId !== simulationGeneration) return;
      run.disabled = false; cancelRun.hidden = true;
      simulationStatus.textContent = `模拟失败：${event.message || 'Worker 执行错误'}`;
      stopSimulationWorker();
    };
  };
  const countField = make<HTMLLabelElement>(doc, 'label', 'duel-run-count-field');
  const runCount = make<HTMLInputElement>(doc, 'input', 'duel-run-count');
  runCount.type = 'number'; runCount.min = '1'; runCount.max = '10000'; runCount.step = '1'; runCount.inputMode = 'numeric';
  runCount.setAttribute('aria-label', '模拟次数');
  let rememberedRuns = 256;
  try {
    const value = Number(localStorage.getItem(`${STORAGE_KEY}.runs`));
    if (Number.isInteger(value) && value >= 1 && value <= 10000) rememberedRuns = value;
  } catch { /* Optional preference. */ }
  runCount.value = String(rememberedRuns);
  const saveRuns = (): void => {
    if (!runCount.checkValidity()) return;
    try { localStorage.setItem(`${STORAGE_KEY}.runs`, runCount.value); } catch { /* Optional preference. */ }
  };
  runCount.addEventListener('change', saveRuns);
  countField.append(make(doc, 'span', '', '模拟次数'), runCount, make(doc, 'span', '', '场'));
  const run = make<HTMLButtonElement>(doc, 'button', 'duel-run-button', '开始模拟');
  run.type = 'button';
  const cancelRun = make<HTMLButtonElement>(doc, 'button', 'duel-run-cancel', '取消模拟');
  cancelRun.type = 'button'; cancelRun.hidden = true;
  cancelRun.addEventListener('click', () => {
    simulationGeneration++;
    stopSimulationWorker();
    pendingSamples.clear();
    cancelRun.hidden = true; run.disabled = false;
    simulationStatus.textContent = '模拟已取消';
  });
  run.addEventListener('click', () => {
    if (activeRecognitionCount > 0) return;
    if (!runCount.value || !runCount.reportValidity()) { runCount.focus(); return; }
    const runs = Number(runCount.value);
    saveRuns();
    const errors: string[] = [];
    for (const side of ['blue', 'red'] as const) {
      state[side].forEach((slot, index) => {
        const prefix = `${side === 'blue' ? '蓝方' : '红方'} ${index + 1}`;
        if (!slot.heroId) errors.push(`${prefix}未选择式神`);
        if (!slot.fourSuit) errors.push(`${prefix}未选择御魂效果`);
        const card = teams!.querySelector<HTMLElement>(`[data-slot="${side}-${index}"]`)!;
        const missingStat = FIELD_ORDER.some(key => {
          const input = card.querySelector<HTMLInputElement>(`[data-field="${key}"]`)!;
          const value = Number(input.value);
          return !input.value.trim() || !Number.isFinite(value) || value < 0 || ((key === 'hp' || key === 'attack' || key === 'speed') && value <= 0) || (key === 'critDamage' && value < 100);
        });
        if (!slot.panel || missingStat) errors.push(`${prefix}总属性不完整`);
      });
    }
    if (errors.length) {
      result.replaceChildren(make(doc, 'p', 'duel-result-error', `请补全阵容信息：${errors.slice(0, 4).join('、')}${errors.length > 4 ? '…' : ''}`));
      return;
    }
    const simulationState = JSON.parse(JSON.stringify(state)) as DuelState;
    simulationGeneration++;
    const taskId = simulationGeneration;
    stopSimulationWorker();
    sampleCache.clear(); pendingSamples.clear(); currentSimulation = undefined;
    result.replaceChildren();
    simulationStatus.textContent = '正在启动模拟…';
    run.disabled = true; cancelRun.hidden = false;
    const worker = new DuelSimulationWorker();
    simulationWorker = worker;
    attachWorkerMessages(worker, taskId, runs, simulationState);
    worker.postMessage({ type: 'start', taskId, state: simulationState, runs });
  });

  const recognizeRoster = async (side: SideId, button: HTMLButtonElement): Promise<void> => {
    const label = side === 'blue' ? '蓝方阵容' : '红方阵容';
    beginRecognition(button);
    recognitionStatus.textContent = `正在识别${label}…`;
    result.replaceChildren();
    try {
      const target = teams!.querySelector<HTMLElement>(`.duel-team-${side}`)!;
      const recognition = await captureAndSelectRegion(side === 'blue' ? '蓝方阵容' : '红方阵容', target);
      if (!recognition) return;
      const items = recognition.items.filter(item => item.confidence >= .4 && item.text.trim());
      const expectedSide = side === 'blue' ? '蓝方' : '红方';
      const oppositeSide = side === 'blue' ? '红方' : '蓝方';
      const screenText = items.map(item => item.text).join('');
      const sideMismatch = recognition.screenSide !== 'unknown' && recognition.screenSide !== side;
      if (sideMismatch || (screenText.includes(oppositeSide) && !screenText.includes(expectedSide))) {
        recognitionStatus.textContent = `当前画面识别为${oppositeSide}，请点击${oppositeSide}的“识别整方阵容”按钮`;
        return;
      }
      const center = (box: number[][]): [number, number] => {
        const points = box.filter(point => Array.isArray(point) && point.length >= 2);
        if (!points.length) return [0, 0];
        return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
      };
      const profileFor = (text: string): HeroProfile | undefined => {
        // PaddleOCR may emit traditional forms even though the hero catalog uses simplified names.
        const comparableText = text.replaceAll('閻', '阎');
        const exact = [...heroes].sort((a, b) => b.name.length - a.name.length).find(hero => comparableText.includes(hero.name));
        if (exact) return exact;
        const glyphs = [...comparableText.replace(/[^\u4e00-\u9fff]/g, '')];
        if (glyphs.length < 2 || glyphs.length > 8) return undefined;
        const distance = (left: string[], right: string[]): number => {
          const row = Array.from({ length: right.length + 1 }, (_, index) => index);
          for (let i = 1; i <= left.length; i++) {
            let diagonal = row[0]; row[0] = i;
            for (let j = 1; j <= right.length; j++) {
              const above = row[j];
              row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
              diagonal = above;
            }
          }
          return row[right.length];
        };
        const candidates = heroes.map(profile => {
          let edits = Number.POSITIVE_INFINITY;
          for (const length of [profile.name.length - 1, profile.name.length, profile.name.length + 1]) {
            if (length < 2 || length > glyphs.length) continue;
            for (let start = 0; start + length <= glyphs.length; start++) {
              edits = Math.min(edits, distance(glyphs.slice(start, start + length), [...profile.name]));
            }
          }
          return { profile, score: 1 - edits / Math.max(profile.name.length, glyphs.length) };
        }).sort((a, b) => b.score - a.score);
        return candidates[0]?.score >= .68 && candidates[0].score - (candidates[1]?.score ?? 0) >= .1
          ? candidates[0].profile
          : undefined;
      };
      const textColumns = items.flatMap(item => {
        const profile = profileFor(item.text);
        const [x, y] = center(item.box);
        return profile && y < recognition.height * .4 ? [{ profile, x }] : [];
      }).sort((a, b) => a.x - b.x);
      const aliases: Array<[PanelKey, string[]]> = [
        ['hp', ['生命值', '生命']], ['attack', ['攻击力', '攻击']], ['defense', ['防御力', '防御']],
        ['speed', ['速度']], ['critDamage', ['暴击伤害', '暴伤']], ['crit', ['暴击']],
        ['hit', ['效果命中', '命中']], ['resist', ['效果抵抗', '抵抗']],
      ];
      const numberIn = (text: string): number | null => {
        const match = text.replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
      };
      const normalized = (text: string): string => text.replace(/[\s:：]/g, '');
      const labelRows = aliases.map(([field, labels]) => {
        const label = items.flatMap(item => {
          const text = normalized(item.text);
          if (field === 'crit' && text.includes('暴击伤害')) return [];
          const matched = labels.find(value => text.includes(value));
          const [x, y] = center(item.box);
          return matched && x < recognition.width * .22 ? [{ item, x, y, value: matched }] : [];
        }).sort((a, b) => a.x - b.x)[0];
        return { field, label };
      });
      const numericItems = items.flatMap(item => {
        if (aliases.some(([, labels]) => labels.some(label => normalized(item.text).includes(label)))) return [];
        const value = numberIn(item.text);
        if (value == null || !Number.isFinite(value)) return [];
        const [x, y] = center(item.box);
        return [{ item, value, x, y }];
      });
      const numericColumns: Array<{ x: number; count: number }> = [];
      for (const item of [...numericItems].sort((a, b) => a.x - b.x)) {
        const group = numericColumns.find(candidate => Math.abs(candidate.x - item.x) <= recognition.width * .035);
        if (group) {
          group.x = (group.x * group.count + item.x) / (group.count + 1);
          group.count++;
        } else numericColumns.push({ x: item.x, count: 1 });
      }
      const statColumns = numericColumns.filter(column => column.count >= 2)
        .sort((a, b) => b.count - a.count).slice(0, TEAM_SIZE).sort((a, b) => a.x - b.x);
      const columns = [...textColumns];
      for (const match of recognition.heroMatches) {
        if (!match || match.score < .42 || match.confidenceGap < .025) continue;
        const profile = heroes.find(hero => hero.id === match.heroId);
        if (!profile || columns.some(column => Math.abs(column.x - match.x) < recognition.width * .05)) continue;
        columns.push({ profile, x: match.x });
      }
      columns.sort((a, b) => a.x - b.x);
      let filled = 0;
      let detectedSuits = 0;
      const mapped = columns.map((column, rank) => ({
        ...column,
        index: statColumns.length >= 3
          ? statColumns.reduce((closest, candidate, index) => Math.abs(candidate.x - column.x) < Math.abs(statColumns[closest].x - column.x) ? index : closest, 0)
          : rank,
      })).filter((column, index, all) => column.index < TEAM_SIZE && all.findIndex(item => item.index === column.index) === index)
        .sort((a, b) => a.index - b.index);
      if (mapped.length) {
        state[side] = Array.from({ length: TEAM_SIZE }, blankFighter);
        for (let index = 0; index < TEAM_SIZE; index++) {
          const key = `${side}-${index}`;
          const fighter = state[side][index];
          slotInputs.set(key, fighter);
          const card = teams!.querySelector<HTMLElement>(`[data-slot="${key}"]`)!;
          card.querySelector('.duel-fighter-name')!.textContent = `${side === 'blue' ? '蓝方' : '红方'}式神 ${index + 1}`;
          card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(input => { input.value = ''; });
          refreshChoices(card);
        }
      }
      const team = state[side];
      mapped.forEach(column => {
        const index = column.index;
        const key = `${side}-${index}`;
        const fighter = team[index];
        const card = teams!.querySelector<HTMLElement>(`[data-slot="${key}"]`)!;
        fighter.heroId = column.profile.id;
        fighter.panel = column.profile.base ? { ...column.profile.base } : blankPanel();
        const suitMatch = recognition.soulMatches
          .filter((match): match is NonNullable<typeof match> => Boolean(match && suits.some(suit => suit.id === match.suitId)))
          .sort((a, b) => Math.abs(a.x - column.x) - Math.abs(b.x - column.x))[0];
        if (suitMatch && suitMatch.score >= .42 && suitMatch.confidenceGap >= .025) {
          fighter.fourSuit = String(suitMatch.suitId);
          card.querySelector<HTMLSelectElement>('[data-field="fourSuit"]')!.value = fighter.fourSuit;
          detectedSuits++;
        }
        card.querySelector<HTMLSelectElement>('[data-field="heroId"]')!.value = String(column.profile.id);
        card.querySelector('.duel-fighter-name')!.textContent = `${side === 'blue' ? '蓝方' : '红方'}式神 ${index + 1} · ${column.profile.name}`;
        for (const { field, label } of labelRows) {
          if (!label) continue;
          const closest = numericItems.filter(item => Math.abs(item.y - label.y) <= Math.max(22, recognition.height * .045))
            .sort((a, b) => Math.abs(a.x - column.x) - Math.abs(b.x - column.x))[0];
          if (!closest) continue;
          fighter.panel[field] = PERCENT_FIELDS.has(field) ? closest.value / 100 : closest.value;
        }
        for (const field of FIELD_ORDER) {
          const input = card.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
          const value = fighter.panel[field];
          input.value = panelInputValue(field, value);
        }
        refreshChoices(card);
        filled++;
      });
      if (filled) writeState();
      const sideName = side === 'blue' ? '蓝方' : '红方';
      recognitionStatus.textContent = filled
        ? `已将 ${filled} 名式神及属性填入${sideName}对应卡位，图片匹配到 ${detectedSuits} 个御魂效果。`
        : `没有匹配到${sideName}式神；OCR 文字：${items.filter(item => center(item.box)[1] < recognition.height * .4).map(item => item.text).slice(0, 10).join('、') || '无'}。请确认当前是${sideName}阵容总览画面。`;
    } catch (error) {
      recognitionStatus.textContent = error instanceof Error ? error.message : '画面识别失败';
    } finally {
      finishRecognition(button);
    }
  };

  const makeRoster = (side: SideId): HTMLElement => {
    const panel = make<HTMLElement>(doc, 'section', `duel-team duel-team-${side}`);
    const titleText = side === 'blue' ? '蓝方' : '红方';
    const heading = make(doc, 'header', 'duel-team-heading');
    heading.append(make(doc, 'h2', 'duel-team-title', titleText));
    const headingActions = make(doc, 'div', 'duel-team-heading-actions');
    const transfer = make<HTMLButtonElement>(doc, 'button', 'duel-recognize-button duel-transfer-roster', '投送到游戏实机');
    transfer.type = 'button'; transfer.setAttribute('aria-label', `将模拟预测的${titleText}阵容复制到游戏实机${titleText}`);
    transfer.addEventListener('click', () => {
      const fighters = JSON.parse(JSON.stringify(state[side])) as FighterInput[];
      root.dispatchEvent(new CustomEvent('duel-roster-transfer', { detail: { side, fighters } }));
    });
    headingActions.append(transfer);
    const recognize = make<HTMLButtonElement>(doc, 'button', 'duel-recognize-button duel-recognize-roster', '识别整方阵容');
    recognize.type = 'button'; recognize.addEventListener('click', () => { void recognizeRoster(side, recognize); });
    headingActions.append(recognize); heading.append(headingActions);
    panel.append(heading);
    const scroll = make(doc, 'div', 'duel-roster-scroll');
    scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', `${titleText}阵容属性表，可横向滚动`);
    const cards = make(doc, 'div', 'duel-fighter-grid');
    const labels = make(doc, 'div', 'duel-roster-labels'); labels.setAttribute('aria-hidden', 'true');
    for (const label of ['式神', ...ROSTER_FIELD_ORDER.map(stat => `${PANEL_LABELS[stat]}${PERCENT_FIELDS.has(stat) ? ' (%)' : ''}`), '御魂效果', '面板识别']) {
      labels.append(make(doc, 'span', '', label));
    }
    cards.append(labels);
    state[side].forEach((fighter, index) => {
      const key = `${side}-${index}`;
      const card = make<HTMLElement>(doc, 'article', 'duel-fighter-card');
      card.dataset.slot = key;
      card.style.gridColumn = String(index + 2);
      card.append(make(doc, 'h3', 'duel-fighter-name', `${titleText}式神 ${index + 1}`));
      const heroOptions: Array<[string, string]> = [['', '选择式神'], ...heroes.map(hero => [String(hero.id), hero.name] as [string, string])];
      const hero = createSelect(doc, `${titleText}式神 ${index + 1}`, heroOptions, fighter.heroId ? String(fighter.heroId) : '');
      hero.dataset.field = 'heroId';
      const choiceButton = (select: HTMLSelectElement, kind: 'hero' | 'four'): void => {
        select.hidden = true;
        const button = make<HTMLButtonElement>(doc, 'button', 'duel-choice-trigger'); button.type = 'button'; button.dataset.duelChoice = select.dataset.field!;
        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('click', () => {
          pickerSlot = key;
          if (kind === 'hero') picker.openHero(button); else picker.openSuit(kind, button);
        });
        select.closest('label')!.append(button);
      };
      choiceButton(hero, 'hero');
      hero.closest('label')!.classList.add('duel-roster-hero');
      card.append(hero.closest('label')!);
      const suitsFields = make(doc, 'div', 'duel-suit-fields');
      const suitOptions: Array<[string, string]> = [['', '选择御魂效果'], ...suits.map(suit => [String(suit.id), suit.name] as [string, string])];
      const soul = createSelect(doc, `${titleText} ${index + 1} 御魂效果`, suitOptions, fighter.fourSuit); soul.dataset.field = 'fourSuit';
      choiceButton(soul, 'four');
      suitsFields.append(soul.closest('label')!); card.append(suitsFields);
      const stats = make(doc, 'div', 'duel-stat-grid');
      for (const [row, stat] of ROSTER_FIELD_ORDER.entries()) {
        const field = make<HTMLLabelElement>(doc, 'label', 'duel-stat-field');
        field.style.gridRow = String(row + 2); field.dataset.stat = stat;
        field.append(make(doc, 'span', '', PANEL_LABELS[stat]));
        const input = make<HTMLInputElement>(doc, 'input');
        input.type = 'number'; input.min = '0'; input.step = PERCENT_FIELDS.has(stat) ? '.01' : 'any';
        input.inputMode = 'decimal'; input.dataset.field = stat;
        input.setAttribute('aria-label', `${titleText} ${index + 1} ${PANEL_LABELS[stat]}`);
        const value = fighter.panel?.[stat];
        input.value = value == null ? '' : panelInputValue(stat, value);
        input.placeholder = stat === 'critDamage' ? '150' : '—';
        field.append(input, make(doc, 'small', '', PERCENT_FIELDS.has(stat) ? '%' : ''));
        stats.append(field);
      }
      card.append(stats);
      const recognize = make<HTMLButtonElement>(doc, 'button', 'duel-recognize-button', '识别当前面板');
      recognize.setAttribute('aria-label', `识别当前画面并填入${titleText}式神 ${index + 1}`);
      recognize.type = 'button';
      recognize.addEventListener('click', async () => {
        const label = `${titleText}式神 ${index + 1}`;
        beginRecognition(recognize);
        recognitionStatus.textContent = `正在识别${label}…`;
        const fighter = slotInputs.get(key)!;
        try {
          const recognition = await captureAndSelectRegion(`${titleText}式神 ${index + 1}`, card);
          if (!recognition) return;
          if (recognition.screenSide !== 'unknown' && recognition.screenSide !== side) {
            recognitionStatus.textContent = `当前画面属于${recognition.screenSide === 'blue' ? '蓝方' : '红方'}，无法填入${titleText}`;
            return;
          }
          const recognized = recognition.items.filter(item => item.confidence >= .4 && item.text.trim());
          const text = recognized.map(item => item.text).join(' ');
          const profile = [...heroes].sort((a, b) => b.name.length - a.name.length)
            .find(hero => text.includes(hero.name));
          if (profile) {
            fighter.heroId = profile.id;
            fighter.panel = profile.base ? { ...profile.base } : blankPanel();
            hero.value = String(profile.id);
            card.querySelector('.duel-fighter-name')!.textContent = `${titleText}式神 ${index + 1} · ${profile.name}`;
          }
          const aliases: Array<[PanelKey, string[]]> = [
            ['hp', ['生命', '生命值', 'HP']], ['attack', ['攻击', '攻击力']], ['defense', ['防御', '防御力']],
            ['speed', ['速度']], ['critDamage', ['暴击伤害', '暴伤']], ['crit', ['暴击']],
            ['hit', ['效果命中', '命中']], ['resist', ['效果抵抗', '抵抗']],
          ];
          const centers = (box: number[][]): [number, number] => {
            const points = box.filter(point => Array.isArray(point) && point.length >= 2);
            if (!points.length) return [0, 0];
            return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
          };
          const readNumber = (value: string): number | null => {
            const match = value.replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/);
            return match ? Number(match[0]) : null;
          };
          const foundStats: PanelKey[] = [];
          for (const [field, labels] of aliases) {
            for (const item of recognized) {
              const compact = item.text.replace(/[\s:：]/g, '');
              if (field === 'crit' && compact.includes('暴击伤害')) continue;
              const label = labels.find(candidate => compact.includes(candidate));
              if (!label) continue;
              let value = readNumber(item.text.slice(item.text.indexOf(label) + label.length));
              if (value == null) {
                const [x, y] = centers(item.box);
                const neighbor = recognized.map(candidate => ({ candidate, point: centers(candidate.box) }))
                  .filter(({ candidate, point }) => candidate !== item && point[0] >= x && Math.abs(point[1] - y) <= Math.max(18, Math.abs(y) * .025))
                  .sort((a, b) => (a.point[0] - x) - (b.point[0] - x))[0];
                if (neighbor) value = readNumber(neighbor.candidate.text);
              }
              if (value == null || !Number.isFinite(value)) continue;
              fighter.panel ??= profile?.base ? { ...profile.base } : blankPanel();
              fighter.panel[field] = PERCENT_FIELDS.has(field) ? value / 100 : value;
              foundStats.push(field);
              break;
            }
          }
          for (const field of FIELD_ORDER) {
            const input = card.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
            const value = fighter.panel?.[field];
            input.value = value == null ? '' : panelInputValue(field, value);
          }
          refreshChoices(card);
          writeState();
          const filled = [profile ? `式神：${profile.name}` : '', ...new Set(foundStats).values()].filter(Boolean);
          recognitionStatus.textContent = filled.length
            ? `已识别并填入 ${filled.join('、')}（${titleText}式神 ${index + 1}）`
            : '已读取画面，但没有识别到可填入的式神或属性';
        } catch (error) {
          recognitionStatus.textContent = error instanceof Error ? error.message : '画面识别失败';
        } finally {
          finishRecognition(recognize);
        }
      });
      card.append(recognize);
      cards.append(card);
      slotInputs.set(key, fighter);
      refreshChoices(card);
    });
    scroll.append(cards); panel.append(scroll);
    return panel;
  };

  teams = make(doc, 'div', 'duel-teams');
  teams.append(makeRoster('red'), makeRoster('blue'));
  const actions = make(doc, 'div', 'duel-simulation-actions');
  actions.append(countField, run, cancelRun, simulationStatus);
  const reset = make<HTMLButtonElement>(doc, 'button', 'duel-reset-button', '清空阵容'); reset.type = 'button';
  reset.addEventListener('click', () => {
    closePicker();
    state.blue = Array.from({ length: TEAM_SIZE }, blankFighter);
    state.red = Array.from({ length: TEAM_SIZE }, blankFighter);
    for (const side of ['blue', 'red'] as const) for (let index = 0; index < TEAM_SIZE; index++) {
      const key = `${side}-${index}`;
      slotInputs.set(key, state[side][index]);
    const card = teams!.querySelector<HTMLElement>(`[data-slot="${key}"]`)!;
      card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(input => { input.value = ''; });
      refreshChoices(card);
    }
    result.replaceChildren(); writeState();
  });
  actions.append(reset);
  actions.append(recognitionStatus);
  const rosterWorkspace = make(doc, 'div', 'duel-roster-workspace');
  rosterWorkspace.append(teams, actions);
  simulator.replaceChildren(rosterWorkspace, output);
  const simulationPage = simulator.closest<HTMLElement>('[role="tabpanel"]')!;
  const view = doc.defaultView!;
  let resizeFrame = 0;
  const fitOutput = (): void => {
    resizeFrame = 0;
    if (!simulationPage.clientHeight) return;
    if (view.getComputedStyle(output).position !== 'sticky') {
      output.style.removeProperty('--duel-output-height');
      return;
    }
    const pageBounds = simulationPage.getBoundingClientRect();
    const outputTop = Math.max(pageBounds.top, output.getBoundingClientRect().top);
    const bottomPadding = parseFloat(view.getComputedStyle(simulationPage).paddingBottom) || 0;
    const height = `${Math.max(0, Math.floor(pageBounds.bottom - outputTop - bottomPadding))}px`;
    if (output.style.getPropertyValue('--duel-output-height') !== height) output.style.setProperty('--duel-output-height', height);
  };
  const queueOutputFit = (): void => {
    if (!resizeFrame) resizeFrame = view.requestAnimationFrame(fitOutput);
  };
  const outputResize = new ResizeObserver(queueOutputFit);
  outputResize.observe(simulationPage);
  simulationPage.addEventListener('scroll', queueOutputFit, { passive: true });
  view.addEventListener('resize', queueOutputFit);
  queueOutputFit();
  const choose = (field: 'heroId' | 'fourSuit', value: string): void => {
    const select = teams!.querySelector<HTMLSelectElement>(`[data-slot="${pickerSlot}"] [data-field="${field}"]`);
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const picker = installCommunityPicker(root, {
    heroes, suits, hero: () => slotInputs.get(pickerSlot)?.heroId ?? 0,
    suit: () => slotInputs.get(pickerSlot)?.fourSuit ?? '',
    chooseHero: id => choose('heroId', String(id)), chooseSuit: (_kind, value) => choose('fourSuit', value),
    clearHero: () => choose('heroId', ''), clearLabel: '清除选择', ariaLabel: '选择对弈阵容式神或御魂', suitTitle: '选择御魂效果', showSuitEffect: true,
    contextLabel: () => { const [side, index] = pickerSlot.split('-'); return `${side === 'blue' ? '蓝方' : '红方'} ${Number(index) + 1} 号位`; },
  });
  closePicker = picker.close;
  const visibility = new IntersectionObserver(entries => { if (!entries.some(entry => entry.isIntersecting)) picker.close(); });
  visibility.observe(root);

  const updateSlot = (target: HTMLInputElement | HTMLSelectElement): void => {
    const card = target.closest<HTMLElement>('[data-slot]');
    if (!card) return;
    result.replaceChildren();
    const key = card.dataset.slot!;
    const fighter = slotInputs.get(key)!;
    const [side, indexText] = key.split('-');
    const sideTitle = side === 'blue' ? '蓝方' : '红方';
    if (target.dataset.field === 'heroId') {
      fighter.heroId = Number(target.value) || null;
      const profile = heroes.find(hero => hero.id === fighter.heroId);
      fighter.panel = profile?.base ? { ...profile.base } : null;
      for (const stat of FIELD_ORDER) {
        const field = card.querySelector<HTMLInputElement>(`[data-field="${stat}"]`)!;
        const value = fighter.panel?.[stat];
        field.value = value == null ? '' : panelInputValue(stat, value);
      }
      card.querySelector('.duel-fighter-name')!.textContent = `${sideTitle}式神 ${Number(indexText) + 1}${profile ? ` · ${profile.name}` : ''}`;
    } else if (target.dataset.field === 'fourSuit') fighter.fourSuit = target.value;
    else if (target.dataset.field === 'skillLevel') fighter.skillLevel = Math.max(1, Math.min(5, Number(target.value) || 5));
    else if (FIELD_ORDER.includes(target.dataset.field as PanelKey)) {
      const stat = target.dataset.field as PanelKey;
      fighter.panel ??= blankPanel();
      const value = Number(target.value);
      fighter.panel[stat] = PERCENT_FIELDS.has(stat) ? value / 100 : value;
    }
    if (['heroId', 'fourSuit'].includes(target.dataset.field ?? '')) refreshChoices(card);
    writeState();
  };
  const change = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) updateSlot(target);
  };
  teams.addEventListener('change', change);
  teams.addEventListener('input', change);

  return () => {
    simulationGeneration++;
    stopSimulationWorker();
    outputResize.disconnect();
    if (resizeFrame) view.cancelAnimationFrame(resizeFrame);
    simulationPage.removeEventListener('scroll', queueOutputFit);
    view.removeEventListener('resize', queueOutputFit);
    closeCaptureDialog?.();
    visibility.disconnect(); picker.dispose();
    for (const tab of tabs) { tab.removeEventListener('click', tabClick); tab.removeEventListener('keydown', tabKeydown); }
    teams?.removeEventListener('change', change);
    teams?.removeEventListener('input', change);
  };
}
