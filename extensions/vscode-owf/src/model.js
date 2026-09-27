/**
 * 文档模型缓存：把「解析器结果」与「行级扫描结果」绑在同一个文档版本上，按需重算。
 *
 * 为什么不直接每处各自 parse 一次：大纲、悬停、跳转、补全都要模型，而解析一份 400 行的
 * 工作流要跑完整套表达式/块语法。缓存以 `(uri, version)` 为键，编辑器每次改动都会提升
 * version，于是模型天然与文本一致，不会出现「诊断是新的、大纲是旧的」这种错配。
 */
'use strict';

const path = require('node:path');
const parser = require('./parser');
const scanner = require('./scanner');
const symbols = require('./symbols');

/** 缓存上限；正常同时打开的 `.owf` 远小于这个数，超过就整表清空。 */
const MAX_ENTRIES = 64;

/** @type {Map<string, Model>} */
const cache = new Map();

/**
 * @typedef {object} Model
 * @property {string} uri 文档 URI 字符串。
 * @property {number} version 文档版本号。
 * @property {string} text 全文。
 * @property {string} fileName 文件名（用于错误信息）。
 * @property {boolean} ok 解析是否成功。
 * @property {any} [document] 解析成功时的图文档。
 * @property {object} [failure] 解析失败时的错误信息（`tryParse` 的失败分支）。
 * @property {ReturnType<typeof scanner.scan>} scan 行级扫描结果。
 * @property {Map<string, {targets: object[], sources: object[]}>} pinsByNode 节点 id → 引脚。
 */

/**
 * 取一个文档的模型（命中缓存则直接返回）。
 * @param {import('vscode').TextDocument} document 目标文档。
 * @returns {Model} 文档模型。
 */
function modelFor(document) {
  const key = `${document.uri.toString()}@${document.version}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const text = document.getText();
  const fileName = document.fileName || path.basename(document.uri.fsPath || '工作流.owf');
  const result = parser.tryParse(text, fileName);
  /** @type {Model} */
  const model = {
    uri: document.uri.toString(),
    version: document.version,
    text,
    fileName,
    ok: result.ok,
    scan: scanner.scan(text),
    pinsByNode: new Map(),
  };
  if (result.ok) model.document = result.document;
  else model.failure = result;
  model.pinsByNode = symbols.buildPinIndex(model);

  const prefix = `${document.uri.toString()}@`;
  for (const existing of cache.keys()) {
    // 同一个文档只保留最新版本，其余历史版本立即淘汰。
    if (existing.startsWith(prefix)) cache.delete(existing);
  }
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, model);
  return model;
}

/** 清空缓存（配置变化或需要强制重算时使用）。 */
function clear() {
  cache.clear();
}

module.exports = { modelFor, clear };
