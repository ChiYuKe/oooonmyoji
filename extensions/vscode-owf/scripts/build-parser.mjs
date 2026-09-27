/**
 * 把桌面端那份权威 TS 解析器（`desktop/src/shared/workflow/graph-dsl.ts` 及其
 * `dsl/` 依赖）打包成扩展内的一个 CommonJS 文件，供扩展直接 `require`。
 *
 * 解析器是**唯一真相**：`.owf` 的语法与报错口径由 `docs/workflow-dsl-v6.md` 规定，
 * Python 与桌面端 TS 两份实现已逐语义对齐。插件不重写解析器，只把这份实现搬过来，
 * 于是插件报的错与桌面端、CLI 完全同源。
 *
 * 入口只取 `graph-dsl.ts`：它的依赖闭包里没有任何第三方包（`ajv` 只被
 * `parameters.ts` / `validate.ts` 用到，而那两个不在 `.owf` 文本解析链上），
 * 所以产物零运行时依赖，`--external:ajv*` 只是把这条不变量钉死。
 *
 * esbuild 是本工具的 devDependency，不是插件的运行时依赖——产物提交进仓库，
 * 用户装扩展时不需要 Node、不需要 npm。
 * 用法：node scripts/build-parser.mjs [--check]
 *   --check  只校验已生成的 bundle 与源码一致，不写盘（CI 用）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
// 扩展住在 `extensions/vscode-owf/`：仓库根是「扩展目录」的上一级。
const repoRoot = resolve(extensionRoot, '..', '..');
const shared = join(repoRoot, 'desktop', 'src', 'shared', 'workflow');
const entry = join(shared, 'graph-dsl.ts');
const outFile = join(extensionRoot, 'lib', 'graph-dsl.cjs');

/** 入口模块；其余模块都由它可达。 */
const ENTRY_RELATIVE = 'desktop/src/shared/workflow/graph-dsl.ts';

/** 打包配置：CJS、Node 环境、不压压缩，保证产物可读可 diff。 */
async function build() {
  const result = await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: outFile,
    write: false,
    minify: false,
    sourcemap: false,
    legalComments: 'inline',
    charset: 'utf8',
    logLevel: 'warning',
    // 解析链上不该出现第三方包；显式标外部，越界时立刻报错而不是悄悄打进来。
    external: ['ajv', 'ajv/*'],
    banner: {
      js: [
        '// 本文件由 extensions/vscode-owf/scripts/build-parser.mjs 生成，请勿手工编辑。',
        `// 入口：${ENTRY_RELATIVE}`,
        '// 权威语法：docs/workflow-dsl-v6.md',
      ].join('\n'),
    },
  });

  const text = result.outputFiles[0].text;
  // 语法自检：产物必须能被 Node 解析；失败时写盘便于定位。
  try {
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', 'module', text);
  } catch (error) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, text, 'utf8');
    console.error(`生成的代码语法有误，已写盘用于排查：${outFile}`);
    throw error;
  }
  // 零外部依赖的自检：产物里不该出现 require("...")。
  const externalRequire = text.match(/require\(["'][^"']+["']\)/);
  if (externalRequire) {
    throw new Error(`产物里出现了外部 require：${externalRequire[0]}（解析链不应依赖第三方包）`);
  }
  return text;
}

const checkOnly = process.argv.includes('--check');
const generated = await build();

if (checkOnly) {
  let existing = '';
  try {
    existing = readFileSync(outFile, 'utf8');
  } catch {
    console.error('lib/graph-dsl.cjs 不存在，请先运行 node scripts/build-parser.mjs');
    process.exit(1);
  }
  if (existing !== generated) {
    console.error('lib/graph-dsl.cjs 与 desktop/src/shared/workflow 源码不一致，请重新生成。');
    process.exit(1);
  }
  console.log('lib/graph-dsl.cjs 与源码一致。');
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  const existing = readFileSync(outFile, 'utf8').replace(/^.*\n/, '');
  writeFileSync(outFile, generated, 'utf8');
  console.log(
    `已生成 ${relative(repoRoot, outFile).replace(/\\/g, '/')}（入口 ${ENTRY_RELATIVE}，${generated.length} 字节）`,
  );
  void existing;
}

