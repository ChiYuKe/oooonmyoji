# Studio UI

面向密集桌面属性编辑器的纯 DOM 组件库，无框架依赖。

## 文件职责

- `ui.js`：组件工厂、事件与浮层生命周期。
- `ui.css`：`--ui-*` 设计变量及通用组件样式，单独引用即可使用。
- `inspector.css`：详情面板的栅格、间距、窄栏布局，禁止在这里另起一套控件颜色。
- `workflow-editor.css`：旧画布和布局样式，放在 `legacy` 层，优先级低于组件库。
- `editor-frame.css`：桌面嵌入页专用尺寸规则，最后加载。画布始终单行占满剩余空间（保留 30px 面包屑），独立详情占满宿主高度；不继承旧版窄屏上下分栏，也不为隐藏顶栏预留高度。
- `ui-showcase.html`：真实组件的交互展示、禁用状态与 240–520px 详情栏预览；字体与桌面端一致，支持深浅主题切换。
- `node-cards.js` / `node-cards.css`：SVG 节点卡片的文本宽度预算与双主题样式。普通节点、实例子卡、变量卡共用，布局和端口仍由编辑器管理；`node-cards-showcase.html` 使用真实画布示例，不保存项目。
- `../runtime-log/`：使用同一套样式的运行日志组合组件；`showcase.html` 提供常规、窄栏与底部停靠示例，不连接实际工作流。
- `../settings/`：左侧分类与右侧内容、主题预览选项，以及真实设置布局的独立展示页。
- `../workbench/`：紧凑横排工具栏、低频命令菜单，以及按文件夹、工作流和图片分类的内容浏览器。普通文件项使用图标与两行文字，只有图片保留缩略图。主窗口与内容浏览器独立窗口共用样式。
- 变量面板也使用 `../workbench/workbench.css`：28px 列表行，14px 图标、弹性名称和 42px 类型列。分组显示数量与读写语义，不在每行重复 INPUT / STATE。类型显示中文，完整名称和原始类型保留在提示中；添加输入与变量入口带文字。保留点击编辑、拖拽引用与滚动位置。
- `../theme/`：跨窗口主题同步与深浅语义色。Electron 通过应用配置持久化；浏览器展示页只保存本地偏好。旧 CSS 的浅色适配由构建脚本生成，保持原有深色样式不变。

## 使用

引入 `ui.css`、`ui.js`，容器添加 `studio-ui`。所有工厂返回 DOM 元素。

```js
panel.appendChild(UI.input({ value: 6, type: 'number', label: '超时秒数', onChange: text => save(Number(text)) }));
panel.appendChild(UI.button({ label: '截取', onClick: capture }));
panel.appendChild(UI.checkField({ label: '启用', checked: true, onChange: save }));
panel.appendChild(UI.segmented({
  value: 'literal',
  options: [{ value: 'literal', label: '固定值' }, { value: 'binding', label: '变量' }],
  onChange: changeSource,
}));
panel.appendChild(UI.rect({ value: [0, 0, 100, 100], onChange: save, onPick: pick }));
```

`UI.checkbox` 返回原生 input；`UI.checkField` 返回可点击标签。`UI.input` 的 onChange 返回字符串，数值解析由业务层完成。`UI.rect` 返回整数数组并拷贝数组，避免直接修改调用方数据；`disabled` 同时禁用坐标和框选按钮，不提供 `onPick` 时不预留按钮列。

`UI.segmented` 重复点击当前项不触发回调，回调返回 false 可拒绝切换；`.set(value)` 可无事件地同步选中项。业务层负责保存固定值与引用，组件不重置业务数据。

子工作流输入采用“名称 + 默认 / 固定值 / 引用”同排，下面单独显示值；说明按需展开。当前编辑会话按输入对象缓存固定值和引用，来回切换保留 `0`、`false`、数组等原值。缓存不写入工作流文件，替换子工作流、重新载入文档或撤销恢复后使用恢复的数据，不复用旧缓存。必填且无默认值的输入始终显示缺失提示；不兼容的引用不能新选。

`UI.dropdown` 支持 `label`、`disabled`、`searchable`、选项 `detail` / `disabled`、`.set(value)`。方向键浏览时跳过禁用项；搜索框按方向键进入结果，Enter 选择，中文输入法确认不会误选，Esc 收起。重复选择当前值不触发 onChange。`.set(value)` 不触发回调，并关闭旧弹层以避免显示过期选中态；焦点离开整个组件也会收起。调用 `UI.closeDropdowns()` 可在重建页面前清理浮层。

`UI.sectionHeader({title, action})` 只生成分区头；折叠状态由页面管理。`UI.iconButton(className, tip, icon, onClick)` 保持原接口。

## 设计约束

输入框 26px、工具按钮 22px、文字 11px、说明 10px。输入框有低对比度暗线，按钮无描边、无渐变、无发光；只有键盘焦点显示细线。破坏性操作使用 `variant: 'danger'`。保持原生表单语义、标签及 disabled 状态。长文本允许省略或换行，但不能用 overflow 隐藏可操作按钮。

结构化对象字段固定使用 82px 标题列（标签 + 30px 引用按钮），与值列间隔 6px；窄面板不单独缩小标题列。标题与引用按钮对齐值区第一行，模板操作放在路径下一行，400px 以下面板的嵌套矩形坐标使用两行布局。组件展示页包含这四类字段，可从 240px 宽度查看。

变量详情使用 52px 基本信息标签列，必填与引用数量同排。默认值（运行变量显示为初始值）使用完整内容宽度，启用控件位于标题右侧；数值、长度和元素数量上下限并排。枚举与对象字段保留完整编辑入口，删除变量入口位于底部。布局在 `inspector.css` 维护，不改变定义和引用的数据格式。

修改组件时同步展示页；不要向旧样式文件末尾追加一轮覆盖。先改 `--ui-*`，必要时改组件规则，布局适配只放在 `inspector.css`。

运行日志布局放在 `../runtime-log/run-log.css`。步骤用原生 details / summary，默认显示名称、结果、耗时及操作摘要；参数、输出、调用路径、开始时间与截图在展开区。错误原因不得隐藏。展开状态和阅读位置按实例保存，统计不受 300 条显示上限影响。运行日志工具栏复用 `ui-button`、`ui-segmented`、`ui-checkbox`，不能另写亮色选中样式。

运行 `node --test desktop/tests/ui-library.test.cjs` 验证组件交互，运行桌面端 `npm run build` 验证构建。

## 回归检查

在 `desktop` 目录运行 `node --test tests/*.test.cjs`，覆盖基础控件、变量编辑、工作台、节点卡片、日志、设置及主题。验证使用 DOM 替身、样式解析和构建，不代替实际视觉验收，也不操控桌面窗口。

2026-09-12 检查已修复：搜索下拉键盘导航、禁用选项、焦点退出清理、外部值同步、无框选坐标的多余列；补充禁用坐标、键盘提示、双主题展示与字体资源路径检查。后续新增组件应同时补展示样例和回归用例，避免只在单张截图宽度下调整。
