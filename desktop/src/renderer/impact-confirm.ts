/**
 * 影响范围确认弹窗：在改动会波及其它内容时，先把影响清单亮出来再让用户决定。
 *
 * 阶段 4 的「变量改名影响范围」用它；阶段 7—8 的「外部文件变化三选」与
 * 「旧格式迁移」也复用同一个确认界面，保证整套桌面的确认体验一致。
 *
 * 弹窗是模态：确认 / 取消 / 右上角关闭 / Esc / 点背景都算一次回答，
 * 只回答一次（Promise 只 settle 一次），返回 `true` 表示确认继续。
 */
export interface ImpactConfirmItem {
  /** 主文字，例如「节点「等待结算」 · 参数「秒数」」。 */
  label: string;
  /** 次要说明，例如引用原文 `inputs.等待`。 */
  detail?: string;
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
  /** 危险操作（删除类）时确认按钮用红色。 */
  danger?: boolean;
}

export interface ImpactConfirm {
  open(request: ImpactConfirmRequest): Promise<boolean>;
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
): ImpactConfirm {
  let settle: ((value: boolean) => void) | undefined;

  function isOpen(): boolean {
    return settle !== undefined;
  }

  function finish(value: boolean): void {
    if (!settle) return;
    const resolve = settle;
    settle = undefined;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeyDown, true);
    resolve(value);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(false);
  }

  function open(request: ImpactConfirmRequest): Promise<boolean> {
    if (settle) finish(false); // 上一个还没答：先按取消关掉，避免两个弹窗叠着。
    titleEl.textContent = request.title;
    subtitleEl.textContent = request.summary;
    okButton.textContent = request.confirmLabel || '确认';
    okButton.classList.toggle('danger', Boolean(request.danger));
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
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    // 打开即聚焦到主操作，键盘导航一步到位；Esc 全局捕获。
    okButton.focus();
    document.addEventListener('keydown', onKeyDown, true);
    return new Promise<boolean>((resolve) => {
      settle = resolve;
    });
  }

  okButton.addEventListener('click', () => finish(true));
  cancelButton.addEventListener('click', () => finish(false));
  closeButton.addEventListener('click', () => finish(false));
  modal.addEventListener('pointerdown', (event) => {
    if (event.target === modal) finish(false);
  });

  return { open, isOpen };
}
