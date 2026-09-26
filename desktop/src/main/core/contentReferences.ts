import type { ContentKind } from './contentPaths';

/** 一条需要从旧路径改写为新路径的内容引用。 */
export interface ContentReferenceMapping {
  oldRelative: string;
  newRelative: string;
  kind: ContentKind;
}

/** 单个文件的引用改写计划；写盘前保留原文，便于统一提交。 */
export interface RewritePlan {
  absolute: string;
  original: string;
  updated: string;
  references: number;
}

function preservePathStyle(original: string, target: string): string {
  const replacement = target.replace(/\//g, original.includes('\\') ? '\\' : '/');
  return original.trim().startsWith('./') ? `./${replacement}` : replacement;
}

/**
 * 引用可能带 `workflows/` 前缀，也可能省略前缀；工作流还可能省略后缀或使用旧 `.json` 后缀。
 * 这里集中生成兼容写法，让改名和移动操作沿用解析阶段的匹配口径。
 */
function referenceCandidates(oldRelative: string, kind: ContentKind): Set<string> {
  const rootless = oldRelative.replace(/^(?:workflows|assets)\//i, '');
  const candidates = new Set<string>([oldRelative, rootless]);
  if (kind === 'workflow') {
    for (const base of [oldRelative, rootless]) {
      const stem = base.replace(/\.(?:owf|json)$/i, '');
      candidates.add(stem);
      candidates.add(`${stem}.owf`);
      candidates.add(`${stem}.json`);
    }
  }
  return candidates;
}

/** 仅在整个字符串确实表示目标引用时替换，避免误改说明文字或相似路径。 */
export function replaceExactReference(value: string, oldRelative: string, newRelative: string, kind: ContentKind): string {
  const normalized = value.replace(/\\/g, '/').trim();
  const stripped = normalized.replace(/^\.\//, '');
  const candidates = referenceCandidates(oldRelative, kind);
  const matched = [...candidates].find((candidate) => candidate.toLowerCase() === stripped.toLowerCase());
  if (matched === undefined) return value;

  // 原引用省略 workflows/assets 前缀时，改写后继续保持这种写法。
  const rootlessStem = oldRelative.replace(/^(?:workflows|assets)\//i, '').replace(/\.(?:owf|json)$/i, '').toLowerCase();
  const matchedStem = matched.replace(/\.(?:owf|json)$/i, '').toLowerCase();
  const target = kind === 'workflow' && matchedStem === rootlessStem
    ? newRelative.replace(/^workflows\//i, '')
    : newRelative;
  return preservePathStyle(value, target);
}

/**
 * 在解析后的文档对象上递归改写引用。
 * 结构级改写只处理完整字符串值，不会误伤键名或包含路径的普通文本。
 */
export function rewriteDocumentReferences(
  value: unknown,
  oldRelative: string,
  newRelative: string,
  kind: ContentKind,
): { value: unknown; references: number } {
  if (typeof value === 'string') {
    const replaced = replaceExactReference(value, oldRelative, newRelative, kind);
    return { value: replaced, references: replaced === value ? 0 : 1 };
  }
  if (Array.isArray(value)) {
    let references = 0;
    const rewritten = value.map((item) => {
      const result = rewriteDocumentReferences(item, oldRelative, newRelative, kind);
      references += result.references;
      return result.value;
    });
    return { value: rewritten, references };
  }
  if (!value || typeof value !== 'object') return { value, references: 0 };

  let references = 0;
  const rewritten: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const result = rewriteDocumentReferences(item, oldRelative, newRelative, kind);
    references += result.references;
    rewritten[key] = result.value;
  }
  return { value: rewritten, references };
}

/**
 * 改写 JSON 旁表中的精确字符串值。
 * 这里保留原序列化格式，只替换 JSON 值位置，避免无意义地重排整个文件。
 */
export function rewriteSerializedReferences(original: string, oldRelative: string, newRelative: string, kind: ContentKind): string {
  const oldRoot = kind === 'workflow' ? 'workflows/' : 'assets/';
  const oldWithoutRoot = oldRelative.replace(new RegExp(`^${oldRoot}`, 'i'), '');
  const newWithoutRoot = newRelative.replace(new RegExp(`^${oldRoot}`, 'i'), '');
  const variants = new Set<string>();
  for (const relative of [oldRelative, oldWithoutRoot]) {
    for (const prefix of ['', './']) {
      for (const separator of ['/', '\\']) {
        variants.add(`${prefix}${relative.replace(/\//g, separator)}`);
      }
    }
  }

  let updated = original;
  for (const variant of variants) {
    const normalized = variant.replace(/\\/g, '/');
    const isRootless = normalized.replace(/^\.\//, '').toLowerCase() === oldWithoutRoot.toLowerCase();
    const replacementPath = kind === 'workflow' && isRootless ? newWithoutRoot : newRelative;
    const replacement = replacementPath.replace(/\//g, variant.includes('\\') ? '\\' : '/');
    const encodedOld = JSON.stringify(variant);
    const encodedNew = JSON.stringify(variant.trim().startsWith('./') ? `./${replacement}` : replacement);
    // JSON 字符串后跟逗号或闭合符时才是值，不能把对象键名也一起改掉。
    updated = updated.replace(new RegExp(`${escapeRegExp(encodedOld)}(?=\\s*[,}\\]])`, 'g'), encodedNew);
  }
  return updated;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
