/**
 * 统一确认弹窗：改名影响范围、保存被拦下、崩溃恢复、外部文件变化都用它。
 *
 * 契约：
 * - 一次只回答一次（Promise 只 settle 一次），返回 `true` 表示确认；
 * - `Esc` / 点遮罩 / 关闭按钮 = 取消，`Enter` = 确认；
 * - 打开时聚焦主操作；**Tab 在按钮之间循环**（键盘导航不跑出弹窗）；
 * - 关闭后把焦点还给打开它之前的那个元素。
 */
export interface ImpactConfirmItem {
  /** 主文字，例如「节点「等待结算」 · 参数「秒数」」。 */
  label: string;
  /** 次要说明，例如引用原文 `inputs.等待`。 */
  detail?: string;
}

/** 第三个选择（例如外部文件变化的「对比」）。 */
export interface ImpactConfirmExtra {
  label: string;
  /** 选中它时解析成这个结果；缺省为 `'extra'`。 */
  value?: string;
}

export interface ImpactConfirmRequest {
  /** 标题，例如「确认改名为「新名字」」。 */
  title: string;
  /** 副标题/摘要，一句话说清影响范围。 */
  summary: string;
  /** 影响清单；为空时只显示摘要。 */
  items?: ImpactConfirmItem[];
  /** 确认按钮文案，默认「确认」。 */
  confirmLabel?: string;
  /** 取消按钮文案，默认「取消」；「保存被拦下」这类场景用「返回修改」更准确。 */
  cancelLabel?: string;
  /** 危险操作（删除类）时确认按钮用红色。 */
  danger?: boolean;
  /** 可选的第三个动作；给出后 `open` 返回它的 `value`（取消仍返回 `false`）。 */
  extra?: ImpactConfirmExtra;
  /** 需要多行正文时（例如文件对比）直接给一段等宽文本。 */
  preview?: string;
}

/** `open` 的返回值：`true` = 确认，`false` = 取消，字符串 = 选了第三个动作。 */
export type ImpactConfirmAnswer = boolean | string;

export interface ImpactConfirm {
  open(request: ImpactConfirmRequest): Promise<ImpactConfirmAnswer>;
  isOpen(): boolean;
}

export function createImpactConfirm(
  modal: HTMLElement,
  titleEl: HTMLElement,
  subtitleEl: HTMLElement,
  bodyEl: HTMLElement,
  okButton: HTMLButtonElement,
  cancelButton: HTMLButtonElement,
  closeButton: HTMLButtonElement,
  extraButton?: HTMLButtonElement,
): ImpactConfirm {
  let settle: ((value: ImpactConfirmAnswer) => void) | undefined;
  /** 关闭后要还回去的焦点（打开弹窗时抢走了它）。 */
  let restoreFocus: HTMLElement | null = null;

  function isOpen(): boolean {
    return settle !== undefined;
  }

  function focusables(): HTMLButtonElement[] {
    const list: HTMLButtonElement[] = [];
    // 隐藏（这次没有第三个动作）与禁用的按钮不参与循环，否则 Tab 会停在看不见的按钮上。
    for (const button of [extraButton, cancelButton, okButton]) {
      if (!button || button.disabled === true) continue;
      if (typeof button.classList?.contains === 'function' && button.classList.contains('hidden')) continue;
      list.push(button);
    }
    return list;
  }

  function finish(value: ImpactConfirmAnswer): void {
    if (!settle) return;
    const resolve = settle;
    settle = undefined;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeyDown, true);
    const target = restoreFocus;
    restoreFocus = null;
    // 焦点还给打开前的元素；它已经不在了就落到 body，别留在隐藏的弹窗里。
    if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    resolve(value);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
      return;
    }
    if (event.key === 'Tab') {
      // 焦点陷阱：Tab / Shift+Tab 只在弹窗里的按钮之间循环。
      const list = focusables();
      if (list.length < 2) { event.preventDefault(); return; }
      const active = document.activeElement as HTMLElement | null;
      const index = list.indexOf(active as HTMLButtonElement);
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      const next = index < 0 ? 0 : (index + step + list.length) % list.length;
      list[next].focus();
    }
  }

  function open(request: ImpactConfirmRequest): Promise<ImpactConfirmAnswer> {
    if (settle) finish(false); // 上一个还没答：先按取消关掉，避免两个弹窗叠着。
    const active = document.activeElement as HTMLElement | null;
    restoreFocus = active && active !== document.body ? active : null;
    titleEl.textContent = request.title;
    subtitleEl.textContent = request.summary;
    okButton.textContent = request.confirmLabel || '确认';
    okButton.classList.toggle('danger', Boolean(request.danger));
    if (cancelButton) cancelButton.textContent = request.cancelLabel || '取消';
    if (extraButton) {
      const extra = request.extra;
      extraButton.classList.toggle('hidden', !extra);
      extraButton.textContent = extra ? extra.label : '';
    }
    bodyEl.replaceChildren();
    const items = Array.isArray(request.items) ? request.items : [];
    if (items.length) {
      const list = document.createElement('ul');
      list.className = 'impact-confirm-list';
      for (const item of items) {
        const row = document.createElement('li');
        row.className = 'impact-confirm-item';
        const label = document.createElement('strong');
        label.textContent = item.label || '';
        row.appendChild(label);
        if (item.detail) {
          const detail = document.createElement('code');
          detail.textContent = item.detail;
          row.appendChild(detail);
        }
        list.appendChild(row);
      }
      bodyEl.appendChild(list);
    }
    if (request.preview) {
      const pre = document.createElement('pre');
      pre.className = 'impact-confirm-preview';
      pre.textContent = request.preview;
      bodyEl.appendChild(pre);
    }
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    // 打开即聚焦到主操作，键盘导航一步到位；Esc/Tab 全局捕获。
    okButton.focus();
    document.addEventListener('keydown', onKeyDown, true);
    return new Promise<ImpactConfirmAnswer>((resolve) => {
      settle = resolve;
    });
  }

  okButton.addEventListener('click', () => finish(true));
  cancelButton.addEventListener('click', () => finish(false));
  closeButton.addEventListener('click', () => finish(false));
  extraButton?.addEventListener('click', () => finish(extraButton.dataset.value || 'extra'));
  modal.addEventListener('pointerdown', (event) => {
    if (event.target === modal) finish(false);
  });

  return { open, isOpen };
}
