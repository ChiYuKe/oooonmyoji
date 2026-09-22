import type {
  RuntimeResourceProgress,
  RuntimeResourceStatus,
  RuntimeResourceVariantId,
  RuntimeResourceVariantStatus,
} from '../shared/contracts';

const bar = document.querySelector<HTMLElement>('#bar')!;
const status = document.querySelector<HTMLElement>('#status')!;
const detail = document.querySelector<HTMLElement>('#detail')!;
const options = document.querySelector<HTMLElement>('#runtime-options')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const installButton = document.querySelector<HTMLButtonElement>('#install')!;
let selected: RuntimeResourceVariantId = 'cpu';
let current: RuntimeResourceStatus | undefined;
let busy = false;

document.querySelector('#setup-minimize')?.addEventListener('click', () => void window.onmyoji.minimizeWindow());
document.querySelector('#setup-maximize')?.addEventListener('click', () => void window.onmyoji.toggleMaximizeWindow());
document.querySelector('#setup-close')?.addEventListener('click', () => void window.onmyoji.closeWindow());

function size(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function selectedVariant(): RuntimeResourceVariantStatus | undefined {
  return current?.variants.find((item) => item.id === selected);
}

function renderOptions(): void {
  options.textContent = '';
  for (const item of current?.variants ?? []) {
    const label = document.createElement('label');
    label.className = `setup-runtime-option${item.id === selected ? ' selected' : ''}${item.supported ? '' : ' disabled'}`;
    label.innerHTML = `<input type="radio" name="runtime-variant" value="${item.id}">
      <span class="setup-runtime-badge">${item.id === 'gpu' ? 'GPU' : 'CPU'}</span>
      <span class="setup-runtime-copy"><strong></strong><span class="setup-runtime-description"></span><span class="setup-runtime-meta"></span></span>`;
    label.querySelector('strong')!.textContent = item.label;
    label.querySelector<HTMLElement>('.setup-runtime-description')!.textContent = item.description;
    label.querySelector<HTMLElement>('.setup-runtime-meta')!.textContent = item.supported
      ? `${size(item.downloadBytes)} · ${item.id === 'cpu' ? '推荐' : item.supportMessage ?? '可用'}`
      : item.supportMessage ?? '当前设备不可用';
    const input = label.querySelector<HTMLInputElement>('input')!;
    input.checked = item.id === selected;
    input.disabled = !item.supported || busy;
    input.addEventListener('change', () => {
      if (!input.checked || busy) return;
      selected = item.id;
      status.textContent = `已选择${item.label}`;
      detail.textContent = size(item.downloadBytes);
      renderOptions();
    });
    options.appendChild(label);
  }
  installButton.disabled = busy || !selectedVariant()?.supported;
}

function renderProgress(event: RuntimeResourceProgress): void {
  if (event.variant !== selected) return;
  status.textContent = event.message;
  const ratio = event.totalBytes > 0 ? Math.min(1, event.receivedBytes / event.totalBytes) : 0;
  bar.style.width = event.phase === 'extracting' ? '96%' : event.phase === 'ready' ? '100%' : `${ratio * 92}%`;
  detail.textContent = event.phase === 'downloading'
    ? `${size(event.receivedBytes)} / ${size(event.totalBytes)}`
    : event.phase === 'failed' ? '请检查网络连接后重试。' : '';
  retry.style.display = event.phase === 'failed' ? 'block' : 'none';
}

async function install(): Promise<void> {
  const item = selectedVariant();
  if (!item || !item.supported || busy) return;
  busy = true;
  retry.style.display = 'none';
  installButton.textContent = '正在安装…';
  renderOptions();
  try {
    renderProgress({ variant: selected, phase: 'downloading', receivedBytes: 0, totalBytes: item.downloadBytes, message: '正在连接资源服务器…' });
    if (!item.ready) await window.onmyoji.installRuntimeResources(selected);
    await window.onmyoji.activateRuntimeResources(selected);
  } catch (error) {
    renderProgress({
      variant: selected, phase: 'failed', receivedBytes: 0, totalBytes: item.downloadBytes,
      message: error instanceof Error ? error.message : String(error),
    });
    busy = false;
    installButton.textContent = '安装并继续';
    renderOptions();
  }
}

async function initialize(): Promise<void> {
  current = await window.onmyoji.getRuntimeResourceStatus();
  const preferred = current.variants.find((item) => item.id === current?.activeVariant && item.supported)
    ?? current.variants.find((item) => item.id === 'cpu' && item.supported)
    ?? current.variants.find((item) => item.supported);
  if (preferred) selected = preferred.id;
  renderOptions();
  const item = selectedVariant();
  status.textContent = item ? `请选择运行环境后继续` : '没有可用的运行环境';
  detail.textContent = item ? size(item.downloadBytes) : '';
}

window.onmyoji.onRuntimeResourceProgress(renderProgress);
retry.addEventListener('click', () => void install());
installButton.addEventListener('click', () => void install());
void initialize().catch((error) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  installButton.disabled = true;
});
