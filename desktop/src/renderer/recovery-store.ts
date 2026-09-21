/**
 * 崩溃恢复副本：把画布的每次改动按文档留档到 localStorage，刷新/崩溃后还能捡回来。
 *
 * 与「自动保存」的区别：
 * - 自动保存把正文写**磁盘**（700 ms 防抖，失败会提示）；
 * - 这里额外留一份**恢复历史**（默认每份文档最近 5 份），用于崩溃/强退后恢复未保存内容。
 *
 * 只在浏览器里有意义：localStorage 不可用（隐私模式、配额满）时所有操作安全退化成空实现，
 * 绝不因为留档失败而影响编辑。
 */
export interface RecoverySnapshot {
  text: string;
  /** 留档时间（毫秒时间戳）。 */
  at: number;
  /** 留档时是否还带着未保存修改。 */
  dirty: boolean;
}

export interface RecoveryStore {
  /** 记一份恢复副本（内容与上一份相同则跳过，避免刷屏占配额）。 */
  record(uri: string, text: string, dirty: boolean, at?: number): void;
  /** 该文档最近的恢复副本（没有时 null）。 */
  latest(uri: string): RecoverySnapshot | null;
  /** 该文档的恢复历史（新的在前）。 */
  history(uri: string): RecoverySnapshot[];
  /** 文档已经写盘/用户明确丢弃：清掉恢复副本。 */
  clear(uri: string): void;
  /** 所有留过档的文档。 */
  uris(): string[];
}

export const RECOVERY_STORAGE_KEY = 'onmyoji-studio.recovery.v1';
/** 每份文档保留的恢复副本数。 */
export const RECOVERY_HISTORY_LIMIT = 5;
/** 单份正文超过这个大小就不再留档（localStorage 配额有限，宁可不留也不要把库写坏）。 */
export const RECOVERY_TEXT_LIMIT = 1_500_000;

interface RecoveryBucket {
  entries: RecoverySnapshot[];
}

type RecoveryRecord = Record<string, RecoveryBucket>;

export interface RecoveryStoreDeps {
  /** 读写存储；缺省用 window.localStorage。 */
  read?(): string | null;
  write?(value: string): void;
}

function defaultRead(): string | null {
  try {
    return window.localStorage.getItem(RECOVERY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function defaultWrite(value: string): void {
  try {
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, value);
  } catch {
    // 配额满/隐私模式：留档是可选的，失败就算了。
  }
}

export function createRecoveryStore(deps: RecoveryStoreDeps = {}): RecoveryStore {
  const read = deps.read ?? defaultRead;
  const write = deps.write ?? defaultWrite;

  function load(): RecoveryRecord {
    // 存储本身可能抛（隐私模式、配额、注入的包装）：留档是可选功能，读不出来就当没有。
    let raw: string | null = null;
    try {
      raw = read();
    } catch {
      return {};
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const record: RecoveryRecord = {};
      for (const [uri, bucket] of Object.entries(parsed as Record<string, unknown>)) {
        const entries = (bucket as RecoveryBucket | undefined)?.entries;
        if (!Array.isArray(entries)) continue;
        const cleaned = entries
          .filter((entry): entry is RecoverySnapshot => Boolean(entry)
            && typeof (entry as RecoverySnapshot).text === 'string'
            && Number.isFinite((entry as RecoverySnapshot).at))
          .map((entry) => ({ text: entry.text, at: Number(entry.at), dirty: entry.dirty !== false }));
        if (cleaned.length) record[uri] = { entries: cleaned };
      }
      return record;
    } catch {
      return {};
    }
  }

  function save(record: RecoveryRecord): void {
    try {
      write(JSON.stringify(record));
    } catch {
      // 写不进去（配额满/隐私模式）就放弃这一份留档，绝不打断编辑。
    }
  }

  function bucketOf(record: RecoveryRecord, uri: string): RecoveryBucket | undefined {
    const bucket = record[uri];
    return bucket && Array.isArray(bucket.entries) ? bucket : undefined;
  }

  return {
    record(uri, text, dirty, at = Date.now()) {
      const key = String(uri || '');
      if (!key || typeof text !== 'string' || !text) return;
      if (text.length > RECOVERY_TEXT_LIMIT) return;
      const record = load();
      const bucket = bucketOf(record, key) ?? { entries: [] };
      const entries = bucket.entries.filter((entry) => entry.text !== text);
      // 同一份正文只留最新的一条（时间戳跟着更新），避免「没改内容也堆历史」。
      entries.unshift({ text, at, dirty: Boolean(dirty) });
      record[key] = { entries: entries.slice(0, RECOVERY_HISTORY_LIMIT) };
      save(record);
    },
    latest(uri) {
      const key = String(uri || '');
      if (!key) return null;
      const bucket = bucketOf(load(), key);
      return bucket && bucket.entries.length ? bucket.entries[0] : null;
    },
    history(uri) {
      const key = String(uri || '');
      if (!key) return [];
      const bucket = bucketOf(load(), key);
      return bucket ? bucket.entries.slice() : [];
    },
    clear(uri) {
      const key = String(uri || '');
      if (!key) return;
      const record = load();
      if (!bucketOf(record, key)) return;
      delete record[key];
      save(record);
    },
    uris() {
      return Object.keys(load());
    },
  };
}
