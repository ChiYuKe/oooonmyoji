/**
 * 把 `vscode` 替身装进 require 缓存，使被测模块能像在宿主里一样 `require('vscode')`。
 *
 * 做法是拦 `Module._load`：只截获 `require('vscode')`，其余请求原样交回 Node。
 * 这样扩展源码里**不需要任何测试专用的分支**（不引入 `if (process.env.TEST)` 之类的脏东西）。
 */
'use strict';

const Module = require('node:module');
const path = require('node:path');

/** 是否已经装好，避免重复 patch。 */
let installed = false;

/**
 * 安装替身。
 * @returns {object} 替身模块本身，方便测试直接断言。
 */
function installVscodeStub() {
  const stub = require('./vscode-stub.cjs');
  if (installed) return stub;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return stub;
    return originalLoad.call(this, request, parent, isMain);
  };
  installed = true;
  return stub;
}

/**
 * 文档 URI 的替身：只需 `toString()` 与 `fsPath`。
 * @param {string} filePath 磁盘路径。
 * @returns {{fsPath: string, toString: () => string}} URI 替身。
 */
function uriOf(filePath) {
  return {
    fsPath: filePath,
    toString: () => `file://${filePath.replace(/\\/g, '/')}`,
  };
}

/**
 * `TextDocument` 替身：实现被测代码用到的那几个方法。
 * @param {string} text 全文。
 * @param {string} [filePath] 磁盘路径。
 * @param {number} [version] 版本号。
 * @returns {object} 文档替身。
 */
function documentOf(text, filePath = 'test.owf', version = 1) {
  const lines = text.split(/\r\n|\n|\r/);
  return {
    languageId: 'owf',
    uri: uriOf(filePath),
    fileName: filePath,
    version,
    lineCount: lines.length,
    getText: () => text,
    lineAt: (line) => ({ text: lines[line] ?? '' }),
  };
}

module.exports = { installVscodeStub, documentOf, uriOf, path };
