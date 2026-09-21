/**
 * 编辑器侧提醒（warning）：Python 校验器不会拒绝、文件照常能跑的「值得看一眼」。
 *
 * 为什么不塞进 `shared/workflow/validate.ts`：那份实现与 Python `validator.py`
 * 是同一套规则的镜像（见 `tests/workflow-rules-contract.test.cjs` 的共享样例），
 * 往里面加 Python 没有的检查会让两端规则对不上。这里只服务于编辑器体验：
 * 计入徽标与「上一个/下一个问题」，**不阻止保存**。
 */
import type { ValidationIssue } from '../../shared/workflow/types';

export interface AdvisoryDeps {
  /** 工作流作用域（inputs / variables）里某个变量被引用了多少处。 */
  referenceCount?(scope: 'inputs' | 'variables', name: string): number;
}

function warning(path: (string | number)[], message: string, code: string): ValidationIssue {
  return { path, message, severity: 'warning', code };
}

/**
 * 当前文档的提醒清单：
 * - 没写 `description`：子工作流选择器里只能看到文件名，别人不知道该不该用；
 * - 变量没有任何引用：占着变量列表，容易误以为它在生效。
 */
export function editorAdvisories(raw: any, deps: AdvisoryDeps = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return issues;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!description) {
    issues.push(warning(['description'], '工作流没有写说明（description）：子工作流选择器里只看得到文件名。', 'missing-description'));
  }
  if (deps.referenceCount) {
    for (const scope of ['inputs', 'variables'] as const) {
      const definitions = raw[scope];
      if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) continue;
      for (const name of Object.keys(definitions)) {
        // 自动生成的公开镜像输入（`_autoPublished`）不单独提醒：它由工作流变量驱动。
        if (scope === 'inputs' && definitions[name] && definitions[name]._autoPublished === true) continue;
        if (deps.referenceCount(scope, name) > 0) continue;
        issues.push(warning([scope, name], `${scope === 'inputs' ? '输入' : '变量'}「${name}」没有被任何地方引用。`, 'unused-variable'));
      }
    }
  }
  return issues;
}
