# OWF 工作流（VS Code 扩展）

给 oooonmyoji 的工作流文本格式 `.owf`（v6）做**文本侧**的语言支持：语义着色、解析诊断、
结构大纲、引用跳转与悬停、引脚补全，外加一个把边表摊开成执行顺序的结构树命令。

它**不做图形画布**——画布在桌面端（仓库根下的 `desktop/`）。这里的目标是让 `.owf`
在 VS Code 里读起来、改起来顺手：格式的权威说明见 `docs/workflow-dsl-v6.md`。

## 装上就能用

```powershell
cd extensions/vscode-owf
npx vsce package --allow-missing-repository --skip-license
code --install-extension owf-workflow-0.1.0.vsix
```

装完打开任意 `.owf` 即生效（扩展安装后**不需要 Node、不需要 npm install**，见下文
「为什么产物是自带的」）。

## 它做了什么

| 能力 | 说明 |
| --- | --- |
| 语义着色 | `node` / `var` / `group` / `comment` / `edges` 各自成色；引用（`nodes.x` / `inputs.键` / `variables.键`）、中缀运算符（`==` `and` `exists`…）、坐标、字面量、`#` 注释、`\|` 文本块分别区分 |
| 解析诊断 | 用**与桌面端/CLI 同一份解析器**校验，把语法错误标在出错处，文案与行列号跟 `cli validate` 一致 |
| 结构大纲 | `Ctrl+Shift+O` 或侧栏大纲：按「节点 / 变量 / 文档块 / 分组 / 连线」分组，组内保持文件顺序 |
| 跳转定义 | 边表里的节点 id、`nodes.<id>` / `variables.<id>` / `inputs.<键>` 引用，`F12` 跳到声明行 |
| 悬停 | 节点给类型、显示名、出入度、可用目标引脚；变量给作用域与派生 id；引脚给它是哪种口 |
| 补全 | 边表里 `节点:` 之后补该节点的引脚（`true/false`、参数名、`case.<i>`…）、`->` 之后补节点 id、行首补结构关键字与常见字段 |
| 结构树 | `OWF: 显示工作流结构树` 把图按执行关系展开成缩进文本（按 `then.<下标>` 排序，与编译器同序），可一键复制 |
| 画布布局 | `OWF: 复制画布布局` 导出 `{节点: {x, y}}`，便于做外部布局比对 |

配置项三个：`owf.diagnostics.enabled`、`owf.diagnostics.debounceMs`、`owf.outline.showVariables`。

## 为什么产物是自带的

解析器**没有重写**：`lib/graph-dsl.cjs` 是把桌面端那份权威实现
（`desktop/src/shared/workflow/graph-dsl.ts` 及其 `dsl/` 依赖）用 esbuild 打成一个
零依赖的 CommonJS 文件，并提交进仓库。

这么做的收益很直接：

- 插件报的错、算出的规范文本与桌面端、CLI **逐字一致**——不存在「插件说合法、运行时说非法」；
- 安装扩展不需要 Node、不需要 `npm install`，`lib/` 里没有第三方代码
  （`ajv` 只被 `parameters.ts` / `validate.ts` 用到，而它们不在 `.owf` 文本解析链上，
  构建脚本把这条不变量写成了断言）。

改了 `desktop/src/shared/workflow/` 之后要重新生成产物：

```powershell
npm install            # 首次：装 esbuild（构建期依赖）
npm run build:parser   # 重新生成 lib/graph-dsl.cjs
```

## 验收

```powershell
npm test        # node --test：解析器 / 扫描器 / 符号 / 编辑器行为，共 30 项
npm run verify  # 先检查产物是否与源码同步，再跑测试
```

测试的重点不是「函数被调用过」，而是三条能证明正确性的不变量：

1. **产物与源码同步**：`--check` 比对生成结果，改了 TS 没重建就红；
2. **与桌面端逐字一致**：仓库里所有 `.owf` 的 `emit(parse(text))`、契约夹具
   `tests/fixtures/graph-rules/cases.json` 的 41 个用例的产出与**报错文案**（含行列号），
   都与 `desktop/dist-electron` 的预编译产物逐字相同（该目录不存在时自动跳过并说明）；
3. **扫描结果与解析结果互证**：对每个 `.owf`，行级扫描出的节点 id 与连线，
   必须与解析器给出的完全一致——大纲/跳转/悬停因此不会指到不存在的符号上。

## 目录结构

```
src/parser.js              打包产物的薄包装：解析失败归一化成「行/列/原文行/提示」
src/scanner.js             `.owf` 行级符号扫描（节点、变量、分组、边、引用、通用块）
src/model.js               按 (uri, version) 缓存「解析 + 扫描」结果
src/symbols.js             引脚推导、大纲树
src/features/diagnostics.js  解析诊断（防抖、保存即复查）
src/features/navigation.js   跳转定义与悬停
src/features/completions.js  引脚 / 节点 id / 结构关键字补全
src/features/structureTree.js 结构树命令与画布布局复制
syntaxes/owf.tmLanguage.json TextMate 语法
lib/graph-dsl.cjs          生成的解析器产物（勿手改）
scripts/build-parser.mjs   产物生成与 --check 校验
tests/                     node --test 验收用例（含 vscode 替身）
```

## 已知边界

- **只做解析期诊断**：引脚合法性、一父多子、成环这些是图语义错误，由运行时/编译器负责，
  插件刻意不重复实现（否则就是第二套会漂的口径）。
- **引脚补全只给推得出来的**：参数名与该节点类型的特殊口。拿不准的一律不列。
- **`.owf` 的引号内不算引用**：`"nodes.x"` 是字符串，不会被当成引用跳转。
- 结构树里的数据边（`out.*`、变量口）不参与执行顺序，单独以 `⤳ 数据：` 列出。
