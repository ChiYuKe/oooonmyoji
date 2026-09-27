import type { McpApprovalDecision, OnmyojiDesktopApi } from '../shared/contracts';
import type { ImpactConfirm } from './impact-confirm';

/**
 * 把 MCP 门控操作的确认请求接到应用**自己的**确认弹窗上。
 *
 * 审批窗口不再是 Python 另画的界面：请求内容由 `mcp/approval.py` 成形，这里只把它
 * 交给已有的 `impact-confirm`（标题、影响清单、等宽预览、危险样式都复用它），
 * 再把用户的答案原样交给主进程写回文件信箱。
 */
export function registerMcpApproval(api: OnmyojiDesktopApi, confirm: ImpactConfirm): () => void {
  return api.onMcpApprovalRequest((request) => {
    void (async () => {
      const dialog = request.dialog;
      let decision: McpApprovalDecision = 'deny';
      try {
        const answer = await confirm.open({
          title: dialog.title,
          summary: dialog.summary,
          items: dialog.items,
          preview: dialog.preview,
          confirmLabel: dialog.confirmLabel,
          cancelLabel: dialog.cancelLabel,
          danger: dialog.danger,
          extra: dialog.extraLabel ? { label: dialog.extraLabel, value: 'allow_session' } : undefined,
        });
        decision = decisionOf(answer);
      } catch (error) {
        // 弹窗出问题也必须给 Python 侧一个答复，否则工具会一直等到超时。
        decision = 'deny';
      }
      api.answerMcpApproval(request.id, decision);
    })();
  });
}

/** `impact-confirm` 的三种回答 → 审批通道的决定。 */
export function decisionOf(answer: boolean | string): McpApprovalDecision {
  if (answer === true) return 'allow';
  if (answer === 'allow_session') return 'allow_session';
  return 'deny';
}
