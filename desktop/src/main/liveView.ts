import fs from 'node:fs';
import path from 'node:path';
import type { LiveViewFrame, LiveViewPollResult } from '../shared/contracts';

/** 与 Python ``runtime/live_view.py`` 约定的目录名与文件名。 */
export const LIVE_VIEW_DIRNAME = 'live';
export const LIVE_VIEW_REQUEST_FILE = 'request.json';
export const LIVE_VIEW_INDEX_FILE = 'index.json';
/**
 * 观看请求的时间戳有效期，必须大于 Python 侧的 REQUEST_STALE_SECONDS（6 秒），
 * 否则心跳抖动会让运行时的预览通道误判“没人看”而停写。
 */
export const LIVE_VIEW_REQUEST_MAX_AGE_MS = 12_000;
export const LIVE_VIEW_REQUEST_HEARTBEAT_MS = 2_000;
/** 刷新率与 Python ``runtime/live_view.py`` 的 MIN/MAX_INTERVAL_MS 对应。 */
export const LIVE_VIEW_MIN_INTERVAL_MS = 50;
export const LIVE_VIEW_MAX_INTERVAL_MS = 5_000;
export const LIVE_VIEW_DEFAULT_INTERVAL_MS = 250;

export function clampLiveViewInterval(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return LIVE_VIEW_DEFAULT_INTERVAL_MS;
  return Math.round(Math.min(LIVE_VIEW_MAX_INTERVAL_MS, Math.max(LIVE_VIEW_MIN_INTERVAL_MS, numeric)));
}

export interface LiveViewRequestState {
  instanceId: string;
  updatedAt: number;
}

function atomicWriteJson(filename: string, payload: Record<string, unknown>): void {
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, 'utf8');
  fs.renameSync(temporary, filename);
}

/**
 * 实时视觉监视的观看请求。
 *
 * Python 运行时只有在 ``artifacts/live/request.json`` 存在且时间戳新鲜时才会写
 * 预览帧，因此“有人看”这件事由桌面端显式声明：工作流启动前登记，进程存续期间
 * 心跳，运行结束后撤销。这样即使实时视觉窗口开着，没有运行时也不会有任何额外
 * 的文件写入。
 */
export class LiveViewRequest {
  private active: LiveViewRequestState | undefined;
  private timer: NodeJS.Timeout | undefined;
  private intervalMs = LIVE_VIEW_DEFAULT_INTERVAL_MS;

  constructor(readonly directory: string) {}

  /** 观看端选的刷新间隔（毫秒），会随观看请求一起下发给运行时。 */
  get interval(): number {
    return this.intervalMs;
  }

  /** 改刷新率：立即写进观看请求，正在运行的预览通道下一个抓图周期就会跟上。 */
  setInterval(value: unknown): number {
    this.intervalMs = clampLiveViewInterval(value);
    if (this.active) this.write();
    return this.intervalMs;
  }

  private get filename(): string {
    return path.join(this.directory, LIVE_VIEW_REQUEST_FILE);
  }

  get instanceId(): string {
    return this.active?.instanceId ?? '';
  }

  /** 登记观看请求并开始心跳。 */
  begin(instanceId: string): void {
    this.active = { instanceId: instanceId || '', updatedAt: Date.now() };
    this.write();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), LIVE_VIEW_REQUEST_HEARTBEAT_MS);
  }

  /** 撤销观看请求并删除标记文件。 */
  stop(): void {
    this.active = undefined;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    try {
      fs.rmSync(this.filename, { force: true });
    } catch {
      // 撤销是尽力而为：文件残留也会在 6 秒后自然过期。
    }
  }

  /**
   * 观看窗口仍然开着时续一次心跳。
   *
   * 心跳定时器会在观看停止时被清掉，而观看窗口可以在一次运行结束后继续开着，
   * 因此每次取到新帧都顺手续期，下一次运行不必等 ``begin`` 才恢复写盘。
   */
  touch(): void {
    if (!this.active) return;
    this.write();
    if (!this.timer) this.timer = setInterval(() => this.tick(), LIVE_VIEW_REQUEST_HEARTBEAT_MS);
  }

  /** 当前登记的观看请求是否仍然新鲜。 */
  isFresh(): boolean {
    if (!this.active) return false;
    return Date.now() - this.active.updatedAt <= LIVE_VIEW_REQUEST_MAX_AGE_MS;
  }

  private tick(): void {
    if (!this.active) return;
    if (Date.now() - this.active.updatedAt > LIVE_VIEW_REQUEST_MAX_AGE_MS) {
      // 心跳停了（例如渲染进程卡死）：让请求自己过期，而不是永久打开预览通道。
      this.stop();
      return;
    }
    this.write();
  }

  private write(): void {
    const active = this.active;
    if (!active) return;
    const updatedAt = Date.now();
    active.updatedAt = updatedAt;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      atomicWriteJson(this.filename, {
        ts: updatedAt / 1000,
        instance_id: active.instanceId,
        interval_ms: this.intervalMs,
      });
    } catch {
      // 预览帧是可选能力，落盘失败不应影响工作流。
    }
  }
}

interface SnapshotFiles {
  meta: string;
  frame: string;
}

/** 读取运行时发布的实例 → 快照文件名索引。 */
function readIndex(directory: string): Record<string, { meta?: unknown; frame?: unknown }> {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(directory, LIVE_VIEW_INDEX_FILE), 'utf8')) as unknown;
    if (!payload || typeof payload !== 'object') return {};
    const instances = (payload as Record<string, unknown>).instances;
    return instances && typeof instances === 'object' ? instances as Record<string, { meta?: unknown; frame?: unknown }> : {};
  } catch {
    return {};
  }
}

/**
 * 定位某个实例的快照文件。
 *
 * 优先用运行时发布的索引，两端因此不必各自实现一遍文件名清洗；没有索引时退回
 * 与 Python ``naming.safe_name`` 等价的最简情形（mumu-0 这类纯 ASCII 实例 ID）。
 */
function snapshotFiles(directory: string, instanceId: string): SnapshotFiles | undefined {
  const entry = readIndex(directory)[instanceId];
  if (entry && typeof entry.meta === 'string' && typeof entry.frame === 'string') {
    return { meta: path.join(directory, entry.meta), frame: path.join(directory, entry.frame) };
  }
  const name = (instanceId || '').replace(/[^A-Za-z0-9_.-]+/g, '_') || 'unknown';
  if (!name) return undefined;
  return {
    meta: path.join(directory, `live-${name}.json`),
    frame: path.join(directory, `live-${name}.jpg`),
  };
}

function readSnapshot(files: SnapshotFiles): { frame: LiveViewFrame; seq: number } | undefined {
  let meta: unknown;
  try {
    meta = JSON.parse(fs.readFileSync(files.meta, 'utf8')) as unknown;
  } catch {
    // 半写状态或文件还没生成：等下一次轮询。
    return undefined;
  }
  if (!meta || typeof meta !== 'object') return undefined;
  const record = meta as Record<string, unknown>;
  const seq = record.seq;
  if (typeof seq !== 'number') return undefined;
  let image: string;
  try {
    image = fs.readFileSync(files.frame).toString('base64');
  } catch {
    return undefined;
  }
  const frame: LiveViewFrame = {
    seq,
    ts: typeof record.ts === 'number' ? record.ts : 0,
    instance_id: typeof record.instance_id === 'string' ? record.instance_id : '',
    step: (record.step && typeof record.step === 'object' ? record.step : {}) as LiveViewFrame['step'],
    overlay: (record.overlay && typeof record.overlay === 'object' ? record.overlay : {
      rois: [], matches: [], ocr: [], clicks: [],
    }) as LiveViewFrame['overlay'],
    frame_width: typeof record.frame_width === 'number' ? record.frame_width : 0,
    frame_height: typeof record.frame_height === 'number' ? record.frame_height : 0,
    reference_width: typeof record.reference_width === 'number' ? record.reference_width : 1920,
    reference_height: typeof record.reference_height === 'number' ? record.reference_height : 1080,
    image,
  };
  return { frame, seq };
}

export const LIVE_VIEW_IDLE_MESSAGE = '还没有画面。实时视觉监视需要真正跑一次工作流：运行时抓到的帧才会写到这里。';

/**
 * 下发给 Python 运行时的预览通道参数。
 *
 * 运行时只在收到这些环境变量时才装配预览通道；真正写不写盘由 ``request.json``
 * 的观看请求决定，刷新率也会随观看请求实时更新。
 */
export function createLiveViewEnvironment(directory: string, intervalMs?: number): Record<string, string> {
  return {
    OOONMYOJI_LIVE_VIEW_DIR: directory,
    OOONMYOJI_LIVE_VIEW_INTERVAL_MS: String(clampLiveViewInterval(intervalMs ?? LIVE_VIEW_DEFAULT_INTERVAL_MS)),
    OOONMYOJI_LIVE_VIEW_MAX_WIDTH: '960',
  };
}

/**
 * 读取运行时写下的最新预览帧。
 *
 * 同一个实例的帧可能来自已完成的上一次运行（文件残留），因此调用方拿到后仍应
 * 依据工作流状态决定是否显示。
 */
export function readLiveViewFrame(directory: string, instanceId: string, afterSeq = -1): LiveViewPollResult {
  const files = snapshotFiles(directory, instanceId);
  const snapshot = files ? readSnapshot(files) : undefined;
  if (!snapshot) return { status: 'idle', message: LIVE_VIEW_IDLE_MESSAGE };
  if (snapshot.seq <= afterSeq) return { status: 'unchanged', seq: snapshot.seq };
  return { status: 'frame', frame: snapshot.frame };
}
