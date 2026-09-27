import fs from 'node:fs';
import path from 'node:path';
import type { McpApprovalDecision, McpApprovalRequest } from '../shared/contracts';

/**
 * MCP 审批通道：与 Python ``src/oooonmyoji/mcp/approval.py`` 的文件信箱约定。
 *
 * 审批弹窗必须用应用自己的界面，而不是让 Python 另画一个窗口，所以这里沿用
 * ``liveView.ts`` 已经确立的惯例——目录 + 心跳 + 轮询：
 *
 * - 桌面端每 2 秒续一次 ``desktop.json``；Python 只在心跳新鲜时才把问题交给应用，
 *   否则退回自带的独立窗口（应用没开时 MCP 仍然可用）。
 * - Python 把请求写进 ``pending/<request_id>.request.json``；应用读出来后用
 *   ``createImpactConfirm`` 询问用户，再把 ``pending/<request_id>.result.json`` 写回。
 * - ``pending/`` 位于 ``artifacts/mcp-approvals/``，Python 侧把它列进了
 *   ``files.PROTECTED_DIRS``：**没有任何 MCP 工具能写这个目录**，因此模型无法伪造答复，
 *   答复只能来自这个弹窗（或用户本人）。
 */
export const MCP_APPROVAL_DIRNAME = 'mcp-approvals';
export const MCP_APPROVAL_PENDING_DIRNAME = 'pending';
export const MCP_APPROVAL_HEARTBEAT_FILE = 'desktop.json';
/** 心跳间隔必须小于 Python 侧 HEARTBEAT_STALE_SECONDS（10 秒）。 */
export const MCP_APPROVAL_HEARTBEAT_MS = 2_000;
/** 与 ``runtimeService`` 的日志轮询保持同一节奏。 */
export const MCP_APPROVAL_POLL_MS = 350;
/** 超过这个年龄的请求不再打扰用户；写回拒绝，让 Python 侧立刻得到结果。 */
export const MCP_APPROVAL_STALE_REQUEST_MS = 5 * 60_000;

function atomicWriteJson(filename: string, payload: Record<string, unknown>): void {
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filename);
}

function readJsonFile(filename: string): Record<string, unknown> | undefined {
  try {
    const payload = JSON.parse(fs.readFileSync(filename, 'utf8')) as unknown;
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
  } catch {
    // 半写状态或文件已被清理：下一次轮询再看。
    return undefined;
  }
}

/** 把磁盘上的请求文档收敛成渲染层需要的形状；字段不全就丢弃。 */
export function parseApprovalRequest(requestId: string, document: Record<string, unknown>): McpApprovalRequest | undefined {
  const dialog = document.dialog;
  if (!dialog || typeof dialog !== 'object') return undefined;
  const source = dialog as Record<string, unknown>;
  const title = typeof source.title === 'string' ? source.title : '';
  const summary = typeof source.summary === 'string' ? source.summary : '';
  if (!title && !summary) return undefined;
  const items = Array.isArray(source.items)
    ? source.items
        .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined))
        .filter((item): item is Record<string, unknown> => item !== undefined)
        .map((item) => ({
          label: typeof item.label === 'string' ? item.label : '',
          detail: typeof item.detail === 'string' ? item.detail : undefined,
        }))
    : undefined;
  return {
    id: requestId,
    dialog: {
      title,
      summary,
      items,
      preview: typeof source.preview === 'string' ? source.preview : undefined,
      confirmLabel: typeof source.confirmLabel === 'string' ? source.confirmLabel : undefined,
      cancelLabel: typeof source.cancelLabel === 'string' ? source.cancelLabel : undefined,
      extraLabel: typeof source.extraLabel === 'string' ? source.extraLabel : null,
      danger: source.danger === true,
    },
  };
}

export interface McpApprovalBridgeOptions {
  /** ``artifacts/mcp-approvals`` 的绝对路径。 */
  directory: string;
  /** 询问用户；应用没窗口等情况下应返回 ``deny``。 */
  ask: (request: McpApprovalRequest) => Promise<McpApprovalDecision>;
}

/**
 * 轮询审批请求并回写答复。
 *
 * 单线程串行处理：确认弹窗一次只显示一个，同时到达的请求排队等候。
 */
export class McpApprovalBridge {
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private readonly handled = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: McpApprovalBridgeOptions) {}

  get pendingDirectory(): string {
    return path.join(this.options.directory, MCP_APPROVAL_PENDING_DIRNAME);
  }

  get heartbeatFile(): string {
    return path.join(this.options.directory, MCP_APPROVAL_HEARTBEAT_FILE);
  }

  start(): void {
    this.writeHeartbeat();
    if (!this.heartbeat) this.heartbeat = setInterval(() => this.writeHeartbeat(), MCP_APPROVAL_HEARTBEAT_MS);
    if (!this.timer) this.timer = setInterval(() => this.tick(), MCP_APPROVAL_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = undefined;
    this.heartbeat = undefined;
    try {
      fs.rmSync(this.heartbeatFile, { force: true });
    } catch {
      // 撤销是尽力而为：残留的心跳会在 10 秒后自然过期。
    }
  }

  /** 声明"应用在跑"，Python 侧据此选择审批通道。 */
  private writeHeartbeat(): void {
    try {
      fs.mkdirSync(this.options.directory, { recursive: true });
      atomicWriteJson(this.heartbeatFile, { ts: Date.now() / 1000, pid: process.pid });
    } catch {
      // 心跳写不进去时 Python 会退回独立窗口，不影响审批本身。
    }
  }

  private tick(): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.pendingDirectory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.request.json')) continue;
      const requestId = entry.slice(0, -'.request.json'.length);
      if (!requestId || this.handled.has(requestId)) continue;
      const requestFile = path.join(this.pendingDirectory, entry);
      let age = 0;
      try {
        age = Date.now() - fs.statSync(requestFile).mtimeMs;
      } catch {
        continue;
      }
      if (age > MCP_APPROVAL_STALE_REQUEST_MS) {
        // 过期请求不要再弹窗：直接拒绝，并让 Python 侧马上拿到结论。
        this.handled.add(requestId);
        this.writeResult(requestId, 'deny', '请求在桌面端响应前已过期');
        this.removeRequestFile(requestFile);
        continue;
      }
      const document = readJsonFile(requestFile);
      const request = document ? parseApprovalRequest(requestId, document) : undefined;
      if (!request) {
        // 文档不可读（半写或旧版本）：交给 Python 侧超时处理，别反复读。
        this.handled.add(requestId);
        continue;
      }
      this.handled.add(requestId);
      this.removeRequestFile(requestFile);
      this.queue = this.queue.then(() => this.askAndAnswer(request));
    }
  }

  private async askAndAnswer(request: McpApprovalRequest): Promise<void> {
    let decision: McpApprovalDecision = 'deny';
    let reason = '';
    try {
      decision = await this.options.ask(request);
    } catch (error) {
      decision = 'deny';
      reason = error instanceof Error ? error.message : String(error);
    }
    this.writeResult(request.id, decision, reason);
  }

  private writeResult(requestId: string, decision: McpApprovalDecision, reason: string): void {
    try {
      fs.mkdirSync(this.pendingDirectory, { recursive: true });
      atomicWriteJson(path.join(this.pendingDirectory, `${requestId}.result.json`), {
        decision,
        reason,
        decided_at: new Date().toISOString(),
        decided_by_pid: process.pid,
      });
    } catch {
      // 写不进去等于没答复，Python 侧会按超时拒绝。
    }
  }

  private removeRequestFile(filename: string): void {
    try {
      fs.rmSync(filename, { force: true });
    } catch {
      // 清理失败无妨：handled 集合已经保证不会重复提问。
    }
  }
}
