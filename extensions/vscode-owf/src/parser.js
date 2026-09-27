/**
 * 打包进来的权威解析器（`desktop/src/shared/workflow/graph-dsl.ts` 的产物）。
 *
 * 这里只做一层薄包装，把「拿文本换结果」与「拿结果换 VSCode 定位」分开：
 * - `parse` 出错时抛的是解析器自己的 `DslError`，带 `line` / `column` / `source` / `hint`；
 * - `tryParse` 把成功/失败包成一个结果对象，供诊断与大纲共用，避免每处都写 try/catch。
 *
 * 产物由 `scripts/build-parser.mjs` 生成并提交进仓库，所以插件安装后**不需要 Node、
 * 不需要 npm install**；`tests/parser.test.cjs` 负责证明它与桌面端逐字一致。
 */
'use strict';

const dsl = require('../lib/graph-dsl.cjs');

/** `.owf` 的磁盘后缀。 */
const WORKFLOW_SUFFIX = dsl.WORKFLOW_SUFFIX;

/**
 * @typedef {object} ParseFailure
 * @property {false} ok
 * @property {string} message 人话版错误信息（不含文件名前缀）。
 * @property {number} line 1 基行号；解析器给不出时落在第 1 行。
 * @property {number} column 1 基列号；解析器给不出时落在第 1 列。
 * @property {string|null} source 出错的原文行。
 * @property {string|null} hint 解析器给的提示。
 * @property {string} rendered 与 CLI 同形的多行错误（含定位头、原文行、插入符）。
 */

/**
 * @typedef {object} ParseSuccess
 * @property {true} ok
 * @property {any} document 图文档（`schema_version` 为 6）。
 * @property {string} text 解析用的原文。
 */

/**
 * 解析 `.owf` 文本；失败时把 `DslError` 归一化成普通对象，调用方不必再判断错误类型。
 * @param {string} text 文件全文。
 * @param {string} [path] 用于错误信息里的文件名。
 * @returns {ParseSuccess|ParseFailure} 解析结果。
 */
function tryParse(text, path) {
  try {
    return { ok: true, document: dsl.parseDocument(text, path), text };
  } catch (error) {
    // 解析器只抛 DslError；真出了别的错也要能让用户看到，所以不做类型分支。
    const line = Number.isInteger(error && error.line) ? error.line : 1;
    const column = Number.isInteger(error && error.column) ? error.column : 1;
    return {
      ok: false,
      message: (error && error.message) || String(error),
      line,
      column,
      source: (error && error.source) || null,
      hint: (error && error.hint) || null,
      rendered: typeof (error && error.render) === 'function' ? error.render() : String(error),
    };
  }
}

/** 只读文档头行的 id；解析失败时返回 null（与桌面端 `readDocumentId` 同义）。 */
function readDocumentId(text) {
  return dsl.readDocumentId(text);
}

module.exports = {
  WORKFLOW_SUFFIX,
  DOCUMENT_SCHEMA_VERSION: dsl.DOCUMENT_SCHEMA_VERSION,
  emitDocument: dsl.emitDocument,
  normalizeDocument: dsl.normalizeDocument,
  parseDocument: dsl.parseDocument,
  readDocumentId,
  tryParse,
};
