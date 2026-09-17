/**
 * 按文档的自动保存队列：同一文档只保留最新待写内容，每次修改递增版本。
 * 旧版本的写盘结果不会清除新修改的未保存标记（版本不匹配时忽略回调）。
 * 计时器与写盘函数由调用方注入，便于在非窗口环境验证。
 */

export interface AutoSaveDeps {
  save(uri: string, text: string): Promise<void>;
  /** 写盘成功且期间没有更新的修改。 */
  onSaved(uri: string, text: string): void;
  /** 写盘失败且期间没有更新的修改。 */
  onFailed(uri: string, error: unknown): void;
  delayMs: number;
  setTimer(handler: () => void, delay: number): number;
  clearTimer(id: number): void;
}

export interface AutoSaveQueue {
  schedule(uri: string, text: string): void;
  /** 取消待写内容并作废在途保存的回调；在途保存本身不中断。 */
  cancel(uri: string): void;
  hasPending(uri: string): boolean;
  flush(uri: string): Promise<void>;
  /** 等待所有在途保存结束。 */
  wait(): Promise<void>;
  dispose(): void;
}

interface AutoSaveEntry {
  revision: number;
  pending?: { text: string; revision: number };
  timer?: number;
  inFlight?: Promise<void>;
}

export function createAutoSaveQueue(deps: AutoSaveDeps): AutoSaveQueue {
  const entries = new Map<string, AutoSaveEntry>();

  function entryFor(uri: string): AutoSaveEntry {
    let entry = entries.get(uri);
    if (!entry) {
      entry = { revision: 0 };
      entries.set(uri, entry);
    }
    return entry;
  }

  function clearEntryTimer(entry: AutoSaveEntry): void {
    if (entry.timer !== undefined) {
      deps.clearTimer(entry.timer);
      entry.timer = undefined;
    }
  }

  function flush(uri: string): Promise<void> {
    const entry = entries.get(uri);
    if (!entry || entry.inFlight || !entry.pending) return Promise.resolve();
    const pending = entry.pending;
    entry.pending = undefined;
    const run = (async (): Promise<void> => {
      try {
        await deps.save(uri, pending.text);
        if (pending.revision === entry.revision) deps.onSaved(uri, pending.text);
      } catch (error) {
        if (pending.revision === entry.revision) deps.onFailed(uri, error);
      } finally {
        entry.inFlight = undefined;
        if (entry.pending && entry.timer === undefined) {
          entry.timer = deps.setTimer(() => {
            entry.timer = undefined;
            void flush(uri);
          }, deps.delayMs);
        }
      }
    })();
    entry.inFlight = run;
    return run;
  }

  return {
    schedule(uri, text) {
      if (!uri || !text) return;
      const entry = entryFor(uri);
      entry.revision += 1;
      entry.pending = { text, revision: entry.revision };
      clearEntryTimer(entry);
      entry.timer = deps.setTimer(() => {
        entry.timer = undefined;
        void flush(uri);
      }, deps.delayMs);
    },
    cancel(uri) {
      const entry = entries.get(uri);
      if (!entry) return;
      clearEntryTimer(entry);
      entry.pending = undefined;
      entry.revision += 1;
    },
    hasPending(uri) {
      const entry = entries.get(uri);
      return Boolean(entry?.pending || entry?.inFlight);
    },
    flush,
    async wait() {
      for (;;) {
        const running = [...entries.values()].flatMap((entry) => (entry.inFlight ? [entry.inFlight] : []));
        if (running.length === 0) return;
        await Promise.all(running);
      }
    },
    dispose() {
      for (const entry of entries.values()) clearEntryTimer(entry);
      entries.clear();
    },
  };
}
