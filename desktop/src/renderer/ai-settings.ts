import type { OnmyojiDesktopApi } from '../shared/contracts';
import type { AiSettings, AiSettingsUpdate } from '../shared/ai-assistant';

export function createAiSettings(api: Pick<OnmyojiDesktopApi, 'getAiSettings' | 'saveAiSettings' | 'testAiConnection'>) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const enabled = get<HTMLInputElement>('settings-ai-enabled'), url = get<HTMLInputElement>('settings-ai-url');
  const model = get<HTMLInputElement>('settings-ai-model'), key = get<HTMLInputElement>('settings-ai-key');
  const status = get<HTMLElement>('settings-ai-status');
  const test = get<HTMLButtonElement>('settings-ai-test'), clear = get<HTMLButtonElement>('settings-ai-clear');
  const fields = [enabled, url, model, key];
  let saved: AiSettings | undefined;
  let revision = 0, savedRevision = 0;
  let keyRevision = 0, savedKeyRevision = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<boolean> | undefined;
  let refreshing: Promise<void> | undefined;
  let actionBusy = false, composing = false;
  const show = (text: string, error = false) => { status.textContent = text; status.classList.toggle('settings-footnote-error', error); };
  const cancelTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const dirty = () => !saved || enabled.checked !== saved.enabled || url.value.trim() !== saved.baseUrl || model.value.trim() !== saved.model || (Boolean(key.value.trim()) && keyRevision !== savedKeyRevision);
  function updateKeyHint() { key.placeholder = saved?.hasApiKey ? '已保存密钥；留空保持不变' : '输入 API Key'; }
  function savedStatus() {
    const ready = saved?.baseUrl && saved.model && saved.hasApiKey;
    show(ready ? `已自动保存 · AI 建议${saved?.enabled ? '已启用' : '未启用'}` : '已自动保存 · 请补全接口地址、模型和 API Key');
  }
  function fill(value: AiSettings) {
    saved = value; enabled.checked = value.enabled; url.value = value.baseUrl; model.value = value.model; key.value = '';
    savedRevision = revision; updateKeyHint(); savedStatus();
  }
  function flush(): Promise<boolean> {
    cancelTimer();
    if (saving) return saving;
    if (composing) return Promise.resolve(false);
    if (savedRevision === revision) return Promise.resolve(true);
    saving = (async () => {
      while (savedRevision < revision) {
        const targetRevision = revision;
        const targetKeyRevision = keyRevision;
        const request: AiSettingsUpdate = { enabled: enabled.checked, baseUrl: url.value, model: model.value, ...(key.value.trim() ? { apiKey: key.value.trim() } : {}) };
        show('正在自动保存…');
        try {
          saved = await api.saveAiSettings(request);
          savedRevision = targetRevision;
          // An older reply must not erase a newer key or overwrite an in-progress edit.
          if (request.apiKey !== undefined) {
            savedKeyRevision = targetKeyRevision;
            if (keyRevision === targetKeyRevision && key.value.trim() === request.apiKey && key.ownerDocument.activeElement !== key) key.value = '';
          }
          updateKeyHint();
          if (revision === targetRevision) savedStatus();
        } catch (error) {
          if (revision !== targetRevision) continue;
          show(`自动保存失败：${String(error).replace(/^Error:\s*/, '')}；修改后会自动重试。`, true);
          return false;
        }
      }
      return true;
    })().finally(() => { saving = undefined; });
    return saving;
  }
  function changed(immediate = false) {
    revision++; cancelTimer(); show('编辑待自动保存…');
    if (composing) return;
    if (immediate) void flush();
    else timer = setTimeout(() => { timer = undefined; void flush(); }, 600);
  }
  enabled.addEventListener('change', () => changed(true));
  for (const field of [url, model, key]) {
    field.addEventListener('input', () => { if (field === key) keyRevision++; changed(); });
    field.addEventListener('change', () => {
      if (dirty() && revision === savedRevision) { if (field === key && key.value.trim()) keyRevision++; revision++; }
      void flush();
    });
    field.addEventListener('blur', () => {
      if (field === key && savedKeyRevision === keyRevision) key.value = '';
      if (!composing) void flush();
    });
    field.addEventListener('compositionstart', () => { composing = true; cancelTimer(); });
    field.addEventListener('compositionend', () => { composing = false; changed(); });
  }
  window.addEventListener('blur', () => { if (!composing) void flush(); });
  async function runAction(action: () => Promise<void>) {
    if (actionBusy) return;
    actionBusy = true; [...fields, test, clear].forEach(item => { item.disabled = true; });
    try { await action(); }
    catch (error) { show(String(error).replace(/^Error:\s*/, ''), true); }
    finally { actionBusy = false; [...fields, test, clear].forEach(item => { item.disabled = false; }); }
  }
  const refresh = (): Promise<void> => {
    if (refreshing) return refreshing;
    if (actionBusy) return Promise.resolve();
    refreshing = (async () => {
      if (savedRevision < revision && !await flush()) return;
      const targetRevision = revision;
      try {
        const value = await api.getAiSettings();
        if (revision === targetRevision && !actionBusy) fill(value);
      } catch (error) { if (revision === targetRevision) show(`读取 AI 设置失败：${String(error)}`, true); }
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  };
  test.addEventListener('click', () => void runAction(async () => {
    if (!await flush()) return;
    show('正在测试当前接口与模型…'); await api.testAiConnection(); show('连接成功 · 当前设置已自动保存');
  }));
  clear.addEventListener('click', () => void runAction(async () => {
    await flush(); // Complete any older key write before removing it.
    const current = await api.getAiSettings();
    saved = await api.saveAiSettings({ enabled: false, baseUrl: current.baseUrl, model: current.model, apiKey: '' });
    enabled.checked = false; key.value = ''; revision++; updateKeyHint();
    if (!dirty()) savedRevision = revision;
    else timer = setTimeout(() => { timer = undefined; void flush(); }, 600);
    show('已移除密钥并关闭 AI 建议');
  }));
  return { refresh, flush };
}
