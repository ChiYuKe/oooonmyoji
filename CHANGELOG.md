# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。
当前尚无正式发布标签；以下记录从最近的整合工作开始。

## [Unreleased]

### 新增
- **F2 = 重命名当前选中项**（可在「设置 → 快捷键」改键，默认 `f2`）：不用打开任何对话框，
  直接在**选中的那一行原地**编辑——内容浏览器的文件/文件夹、结构树的节点、变量列表的变量都是
  这一套（Enter/失焦提交、Esc 取消，输入框里打字不触发快捷键）。画布里的选区（没有对应的面板行）
  则让详细信息镜像聚焦它的名称输入框；移到独立窗口的面板按 F2 同样转回主窗口处理。
  节点改名只改显示名（`node.name`），`id` 保持稳定；变量改名与详情栏改「变量命名」同一条路径
  （公开镜像输入一并同步）。子流程入口：`global.rename` / `editor.rename`、`renderer/rename-shortcuts.ts`、
  `panels/sidebar.ts` 的行内草稿。
- 画布支持 **500 节点 / 120 FPS** 量级的工作流：把「每次操作重建整张画布」换成
  **持久图层 + 按帧局部更新 + 视口裁剪 + 缩放分级**。
  - 图层（`.graph-world` / `.wires` / `.cards` / `.variable-cards` …）只创建一次；
    平移、缩放、单节点拖拽不再 `innerHTML = ''`，整层重建只在首次载入、撤销恢复与
    文档整体替换时发生（`canvas/render/render-entry.ts`、`render-controller.ts`）。
  - 平移/缩放只改根图层 `transform` 与缩放分级 class；拖拽只改被拖节点的 `transform`
    与相邻连线路径；选中/悬停/运行状态只就地增删 class，不重建卡片
    （`canvas/render/render-controller.ts`、`canvas/canvas/edges.ts`、`canvas/interactions/pointer.ts`）。
  - 视口外扩 300 CSS 像素内的节点/卡片才挂载，连线两端都已挂载才画（不会出现悬空连线）；
    缩小画布导致可见集合骤增时，超出每帧建卡预算的部分先挂壳、由后续帧分批补齐
    （`canvas/render/spatial-index.ts`、`zoom-level.ts`）。
  - 缩放分级：`≥0.75` 完整卡片、`0.45–0.75` 紧凑卡片（收掉图片预览与装饰器，保留标题、
    类型、参数行与端口）、`<0.45` 概览卡片（只留标题与运行状态，参数行、端口、装饰器全部收起）。
    **分级只决定「还显示什么」，不改变卡片尺寸**：卡片框、标题带与连线锚点一律按真实布局几何
    绘制，缩小画布时整块卡片跟着 zoom 一起缩，跨档不会突然变矮或换尺寸；
    分级切换只改 class，带迟滞避免在阈值上反复切换；双击节点自动聚焦并放大到 0.8。
    概览的隐藏清单必须覆盖**每个值行变体**：区域（识别区域）四格用的是
    `.param-row-rect-axis` / `.param-row-rect-value` / `.param-row-rect-cell`，
    只收 `.param-row-value` / `.param-row-field` 会漏掉它们，缩略图上就剩那一行四个小框。
  - 小地图结构与视口框解耦：布局/结构变化才重建缩略图，拖拽期间最多每 100 ms 更新一次；
    详情栏、侧栏、校验徽标不再随视口移动重绘。
  - 校验错误标记改为「文档级指纹 + 首帧后补算」，节点内容签名按帧缓存，
    避免每次改动都为整份文档重跑校验与序列化
    （`canvas/editor.ts`、`canvas/render/render-controller.ts`）。
  - 视口尺寸改为缓存读（`canvas/canvas/wrap-measurement.ts`）：读取 `getBoundingClientRect()`
    会强制刷新布局，而画布每帧都在写 DOM，实测这一项占了缩放帧时间的一半以上。
  - 框选矩形改为**同步重绘**（`canvas/interactions/pointer.ts`）：平移/缩放/拖拽按帧合并，
    但框选是「正在画」的反馈，延后一帧会明显落后于指针，快速拖拽时几乎只在抬起时闪一下；
    框选帧只带视口与交互标记，不会因此触发连线整体重建。
- 画布性能基准：`npm run benchmark:canvas`（隐藏窗口 + 调试端口，量帧时间/输入延迟/DOM 数量/
  完整重绘次数与分段耗时），`npm run fixture:canvas` 生成 500 节点确定性样例
  （500 节点 / 499 结构边 / 250 数据边 / 100 变量卡）；`--enforce` 在 P95 超预算时以非 0 退出
  （`scripts/canvas-benchmark.cjs`、`scripts/canvas-fixture.cjs`、`src/canvas/benchmark-host.ts`、
  `src/renderer/canvas-benchmark.html`）。
- 回归测试：`tests/canvas-render-controller.test.cjs`（视口裁剪、按帧合并、局部更新、
  整层重建次数、缩放分级迟滞、空间索引）、`tests/canvas-render-entry.test.cjs`
  （框选矩形出现/更新/消失、浮层层序、框选不重建卡片）与 `tests/canvas-perf-500.test.cjs`
  （500 节点契约级基准 + 1000 节点稳定性 + 导出全量挂载）。
- 画布卡片支持**跨画布复制粘贴**：剪贴板改由壳层保管（一台窗口一份），画布复制/剪切后交给壳层，
  再广播给所有持有文档的画布，新画布握手时补发一次——所以在工作流 A 里 Ctrl+C、切到工作流 B
  Ctrl+V 就能粘，把面板弹成独立窗口后同样有效（详情栏镜像没有写权，不下发剪贴板）。
  粘贴到**别的**工作流时，卡片引用到的输入/变量定义与变量卡片会一起带过去（目标已有同名变量
  或卡片就以目标为准、不覆盖不重复），连线按新节点 id 自动补上；同文档粘贴行为不变
  （`desktop/src/canvas/state/commands.ts`、`canvas/state/canvas-state.ts`、`canvas/shell/messages.ts`、
  `renderer/editor-host.ts`、`renderer/workspace.ts`、`renderer/document-lifecycle.ts`、
  `shared/editor-messages.ts`）。
- 重命名 / 移动内容后的**引用改写明细**：以前只有一条 toast 说「已重定向 N 处引用」，说不清
  改了哪些文件；现在主进程连每个被改写文件的路径与处数一起返回（`MoveContentResult.rewritten`），
  有改写时弹出可滚动列表（按处数降序，点「知道了」或 Esc 关闭），没有改写时仍只弹 toast；
  浅色主题由适配器生成（`desktop/src/main/projectService.ts`、`src/shared/contracts.ts`、
  `src/renderer/content-browser.ts`、`content-browser/rewrite-report.ts`、`src/renderer/index.html`、
  `src/renderer/styles.css`）。
- 内容浏览器条目区支持 **Ctrl + 滚轮缩放**（相当于文件大小）：向上滚放大、向下滚缩小，
  范围 70%–180%，只改 `--cb-zoom` 变量、不重排 DOM，网格与列表两种视图的条目高度、
  预览框、图标与文件名一起缩放；缩放值记在
  `onmyoji-studio.content-browser.zoom`，下次打开沿用；非 Ctrl 的滚轮仍是正常滚动
  （`desktop/src/renderer/content-browser.ts`、`content-browser/items.ts`、`styles.css`）。
- GitHub Actions CI：Python 侧 ruff / mypy / pytest，桌面端侧 typecheck / node:test。
- `LICENSE`（MIT）、`pyproject.toml`（ruff + pytest 配置）、`.pre-commit-config.yaml`、`requirements-dev.txt`。
- `docs/` 文档索引与 MCP 客户端配置示例。
- Action 清单可选 `card.rows`：为每个 task 动作声明固定的卡片端点（顺序、显示名、
  控件、布尔状态名），画布任务卡片按声明用双行行样式逐行显示，每个端点下行是
  卡片上可见的输入框/控件（点一下就在原位输入），内置 Action 已全部声明，
  例如「等待模板」固定为 模板 / 超时 / 存在性 / 识别区域 / 匹配阈值 / 多尺度搜索。
- 卡片内直接编辑模板图（素材浏览器 / 从当前画面截取）与识别区域（框选 / 手输四坐标）。
- 节点输出引用：任务卡右侧新增输出口，拖到别的节点的参数端点即写入只读引用
  `nodes.<id>.output.<字段>`（金色虚线引用边，参数行显示 `← 节点名.字段`）；输出口右键
  可复制字段引用 / 从这里开始连线 / 断开全部引用，引用边 Alt 点击或参数行右键可解绑。
- 引用落点按**行带**判定（光标在哪一行就绑哪一行），拖拽中目标卡片与落点行实时亮起，
  不再吸到隔壁行或「第一个兼容端点」。
- 校验错误直接标在卡片上：画布按文档版本缓存本地校验结果，出错的参数那一行标红
  （标签/引脚/值框，悬停给校验原文），节点级错误点红卡片描边并在标题旁加红点，
  问题徽标同时纳入本地校验的错误数；参数问题带上了参数名，节点路径改用节点 id。
- 绑定说明统一：详情栏只按参数里的引用说明「已连接变量/引用 + 显示名」，不再显示卡片 id；
  `_variableLinks` 连线项在任何绑定入口都会写入，并在载入与粘贴时按参数引用对账补写，
  于是同一个绑定不会再出现两种描述。
- 框选/截取结果落到**持有文档**的那份画布：详情栏是镜像画布（没有写权），在那里点「截取」
  之前只改到镜像，真画布的卡片会停在旧参数上；现在结果按 nodeId/key 直接落值到文档画布，
  镜像再靠 replaceDocument 同步，素材浏览器的返回流程照旧。
- 数组输出给到「第 N 项」候选（`nodes.<id>.output.0`、`...output.0.confidence`，最多 4 项），
  于是「等待模板的匹配数组 → 点击匹配项的 match（单个对象）」这类绑定也能从画布连上；
  类型确实不兼容时提示「某参数不接受某节点的输出类型」，不再静默失败。
- 固定长度数组（`min_items == max_items`，如 `random_interval`）在卡片上拆成并排的小输入格，
  逐格编辑、回车一次提交整行；小格在**自己那一格里**再均分，整行不超过一个值框；
  也可用 `"control": "tuple"` 显式声明。
- 值区改成统一网格：所有值框同宽（半行），数组小格在一格内再分，右边缘对齐；
  区域值改用紧凑写法 `x,y 宽×高`，半格内也能完整显示；区域的四坐标浮层横跨整行值区。
- 实时视觉监视（“工具”菜单）：实时显示正在运行的工作流看到的画面，并叠加该步的
  模板匹配框与置信度、ROI、OCR 文字框、点击轨迹，以及当前工作流路径 / 节点 / 状态 /
  耗时。画面取自运行时自己的截图，不需要另开采集连接；观看请求过期即自动停止写盘
  （`src/oooonmyoji/runtime/live_view.py`、`desktop/src/renderer/live-view.ts`）。
- 实时视觉监视可调刷新率（100–2000 ms，选择会记住）：间隔随观看请求实时下发给正在
  运行的预览通道，步骤收尾帧不受节流影响。
- 引用查看器的关系图支持鼠标滚轮缩放：向上放大、向下缩小，缩放**锚定在指针位置**
  （指针下的资源卡片保持不动），范围 20%–160%，与「适应全部关系」和拖拽平移共用同一套
  平移/缩放模型；底部百分比随滚轮实时更新（`desktop/src/renderer/reference-viewer.ts`）。
- 画布连线支持 **Alt + 左键**快速断开：点在连线上（或连线中点的序号徽标上）即断开父子关系，
  与变量边 / 引用边的 Alt 快速断开一致；记入历史可 Ctrl+Z 撤销，且不会再顺手选中该连线或
  触发 Alt 拖拽平移。拖拽重连的旋钮优先于断开，不会被抢走
  （`desktop/src/canvas/canvas/edges.ts`）。

### 变更
- 变量默认值里的数组元素挤在一起分不清：每个元素现在是一张独立卡片（边框 + 底色 + 元素间距），
  标题行可**单独折叠**（「▾ 元素 1」，折叠状态在重渲染后保留），删除按钮固定在标题行右侧；
  标题行在 DOM 里排在元素控件之后、用 grid 区域放到上面，所以控件仍是第一个子节点
  （`desktop/public/legacy/inspector.css`、`desktop/src/canvas/inspector/variable-inspectors.ts`）。
- 数据端点（变量线/引用线的两端）缩小：变量卡输出口 7→4.5、参数行变量引脚 5.5→4、
  节点输出引用口 6→4.5、变量卡类型圆点 4.5→3.5、实例输入引脚 5→4（半径都从 `portRadius`
  派生，改一处即可整体缩放）；每个端点本来就有 r=10 的透明命中圈（`.variable-port-hit`），
  所以拖拽/右键的命中范围不变。执行流的上下端口尺寸未动
  （`desktop/src/canvas/render/node-card.ts`、`render/cards.ts`）。
- 节点输出引用线与**变量线**统一成一套「数据线」样式：实线（变量线不再用点线）、比执行连线细
  （1.8px vs 2px）。数据端点与连线共用一套**按身份取色**的稳定色调（10 色，
  `canvas/data-tones.ts` 的 `dataTone`）：变量按「作用域.变量名」、参数引用按引用文本取色，
  于是同一个变量/引用的引脚、变量卡圆点与连线在深浅两种主题下都是同一种颜色，不同来源颜色不同
  （`.data-tone-N` → `--data-tone` / `--edge-tone`）；悬停命中范围时提亮加粗，拖拽预览同样用色调
  （`desktop/public/legacy/workflow-editor.css`、`desktop/src/canvas/canvas/edges.ts`、
  `desktop/src/canvas/render/node-card.ts`、`render/cards.ts`）。
- 细线更好点：变量线与引用线各叠一条**透明的加粗命中线**（14px，屏幕空间恒定宽度，
  缩放到 50% 也不变细），可见细线本身不再接收指针事件，命中线画在卡片下层所以不挡卡片与引脚；
  指针进入命中范围时细线会**提亮 + 略加粗**（悬停反馈，明确「这条线可以点」；浅色主题由
  适配器生成加深版本，不用 filter）；断开判定改为「按下→抬起位移 ≤4px 才算点击」，
  避免 Alt + 拖拽平移从线附近起始时误删连线
  （`desktop/src/canvas/canvas/edges.ts`、`desktop/public/legacy/workflow-editor.css`）。
- 画布卡片配色：卡面底色改为**跟随当前界面主题**（取 `--ui-panel` / `--ui-surface` / `--ui-line`
  等语义变量，默认、石墨、暖色、对比与浅色主题都自动一致），分类色只落在**标题带**、
  左侧色条、图标与描边上——卡身保持中性，一屏几十张卡不会各自整块跳色；12 个分类色
  居中取值（比霓虹版收敛、比灰调版明显），运行状态色改用主题的 `--green/--red/--yellow`，
  浅色主题下也够对比度（`desktop/public/legacy/node-cards.css`、
  `desktop/src/canvas/render/node-card.ts`、`render/cards.ts`）。回归断言：分类规则只准声明
  `--card-tint`，卡面/标题带必须来自主题变量（`desktop/tests/node-cards.test.cjs`）。
- 参数行：`rect` 从「只能在详情栏编辑」改为卡片内控件；资源参数由菜单接管；
  声明了固定卡片的节点用自己的行高（40px），端点、连线与命中测试共用同一套公式；
  固定卡片的值行改成可见输入框，行内浮层的矩形与文字对齐跟值行框完全一致。
- 卡片视觉对齐：表头说明行（类型 / 动作 / 参数摘要）与端点标签、值行输入框统一到
  同一条左基准线（x=22，标题跟在 20px 图标后单独一列）；标签在自己的行带内居中，
  勾选框按文字光学中心对齐，不再压在基线上。
- 详情栏不再提供参数的「固定值 / 变量」模式切换与「绑定 ▾」下拉：选兼容引用与
  「提升为变量」都在画布上做（卡片参数端点拖线、节点输出引用口、变量卡片拖线、
  端口右键菜单）。已连接的参数只留一行说明「已连接变量 / 引用 …（在画布上管理）」，
  不再把人引到详情栏里改；断线后原来的固定值仍从字面量缓存恢复。
- 删除被引用的变量：不再只弹一句「正在被 N 处引用，不能删除」。改为打开可停靠的
  「变量引用」面板（与结构 / 变量 / 运行日志同级，可拖到任意位置或叠成标签），列出
  每个引用者：节点名、参数名，并标出哪条是画布连线、哪条是变量的初始化输入；点一行
  直接跳到那张卡片，或用「直接删除变量」把变量删掉并让这些引用回落动作默认值。
  详细信息是镜像画布，面板里的指令因此发给文档的真画布，改完再把详情栏同步回来。
  「变量引用」是共享停靠面板，默认就叠在**内容浏览器**旁边（和运行日志同一套路），
  内容浏览器被拖到内层或外层，它都跟着开在同一层、同一个标签组里。
- 「变量引用」面板改成**按节点分组的引用清单**：原来是一串看不出上下文的行（只有节点名、
  参数名和一枚类型徽标），引用一多就分不清谁是谁、也不好定位。现在
  - 组头给出节点在**工作流里的序号**（与「结构」面板顺序一致）、节点名与动作显示名，
    引用落在别的分支里时还标出「在「X」内」，能直接和画布上的位置对上号；
  - 每行给出参数显示名与引用原文（`inputs.等待`，等宽字体），右侧是「画布连线 / 参数引用 /
    初始化输入」徽标与悬停才出现的「定位」提示，点一行仍跳到那张卡片；
  - 顶部新增搜索（节点名、动作、参数、引用原文都能搜，回车跳第一条）与类型筛选
    （计数跟着搜索词实时变，计数为 0 的类型点不动），方向键在行间移动焦点，
    Esc 先清筛选、再按一次才关面板；
  - 头部标出变量作用域与类型，并加「刷新」按钮：请来源画布重算清单（同一变量的筛选状态保留）；
    删除提示带上变量默认值；空结果分成「本来就没有引用」与「筛选没命中」两种，后者给「清除筛选」。
  - 面板里的节点序号 / 动作 / 父节点、变量的类型与默认值都由画布侧随清单一起送来
    （`variableReferenceEntries`），面板仍不读写工作流；行的悬停也顺手从「亮边框」改成纯背景变化，
    符合「禁止卡片亮边」的设计规则。
  （`desktop/src/renderer/variable-references.ts`、`renderer/styles.css`、
  `canvas/inspector/variable-inspectors.ts`、`renderer/editor-host.ts`、`shared/editor-messages.ts`、
  `tests/variable-references-panel.test.cjs`；浅色适配器断言顺带收紧为只认「声明位置」的
  `filter:`，否则类名里的 `.variable-references-filter:hover` 会被 `/filter\s*:/` 误判，
  `tests/theme-settings.test.cjs`）
- **变量引用面板补全「定位 / 断开」闭环**（阶段 4）：
  - **变量行显示引用数量**：左侧变量列表每行右侧出现「N 引用」徽标（未引用不显示），
    悬浮提示带上处数；引用数由画布侧 `VariableSystem.references` 实时算出随列表推送
    （`canvas/model/sidebar-state.ts`、`shared/editor-messages.ts`、`panels/sidebar.ts`）。
  - **组接口筛选**：引用清单新增「组接口」类型——引用所在参数被显式暴露到节点组边界时
    归入这一档，筛选按钮、行徽标与计数同步生效；画布侧按 `_nodeGroups[*].pins` 打标
    （`canvas/inspector/variable-inspectors.ts` 的 `groupInterface`、`renderer/variable-references.ts`）。
  - **每条引用独立的「断开」按钮**：行尾的断开图标把这一条引用解除（参数回落到字面量 /
    初始化绑定解除），画布按一次历史记录、Ctrl+Z 可撤销；底部新增「断开全部引用（N 处）」，
    一次合并成一条历史，整体撤销。断开后面板自动请来源画布重算清单
    （`variable-inspectors.disconnectVariableReference / disconnectAllVariableReferences`、
    `editor-command-dispatch` 新命令、`renderer/main.ts` 接线）。
  - **定位后闪烁**：面板「定位」把视野移过去时，节点卡片与**参数端点**一起短暂高亮
    （1.4 秒后消退）；搜索与结构树定位共用同一条 `focusNode(id, param?)` 路径，同样闪烁
    （`canvas/render/render-entry.ts` 的 `flashNode`、`public/legacy/workflow-editor.css` 的
    `.node-flash` / `.param-row-flash`）。
  - **改名、删除前显示影响范围**：删除仍走「变量引用」面板（影响一目了然）；**改名**改为
    先弹出影响范围确认框——列出将被影响的 N 处引用（节点 · 参数 + 引用原文），确认后才真正
    改名，取消则保持原名。确认框是新的通用「影响范围确认」弹窗（`renderer/impact-confirm.ts`、
    `index.html` 的 `#impact-confirm-modal`），后续外部文件变化三选、旧格式迁移也复用它，保证
    全套确认界面一致（`canvas/inspector/variable-inspectors.ts` 的暂存改名、
    `editor-command-dispatch` 的 `confirmRenameVariable` / `cancelRenameVariable`、
    `renderer/editor-host.ts` 的 `variableRenameImpactRequested` 分支、
    `shared/editor-messages.ts` 新消息类型）。
  - 回归测试：面板的组接口筛选 / 单条断开 / 批量断开（含计数与刷新）、定位带参数、
    侧栏引用徽标、断开的参数与连线映射清理、改名影响范围（确认 / 取消 / 无引用直改）、
    新命令分派（`tests/variable-references-panel.test.cjs`、`variable-references-delete.test.cjs`、
    `variables-panel.test.cjs`、`sidebar-variable-list.test.cjs`、`rename-shortcuts.test.cjs`）。
- **画布布局与导航补全**（阶段 5）：
  - **自动排列可选范围**：右键菜单与视口工具条的「⤢」都提供**全部 / 选中 / 当前组**三种范围，
    局部排列以选区（或当前组）现有包围盒左上角为基准，范围外的卡片一个都不动；
    「当前组」优先取已经进入的组，没进组时取选中的那张组卡
    （`canvas/canvas/viewport.ts` 的 `computeLayout(scope)`、`canvas/editor.ts` 的 `previewAutoLayout`）。
  - **排列前先生成预览**：选范围后画布上出现**虚线虚影**（只画不写文档、不进历史），
    顶部出现「排列预览 · 范围 · N 张卡片（尚未应用）」确认条，「应用」才把位置写进文档
    （**一次排列 = 一条历史记录**）、「取消」直接丢弃
    （`render-entry.ts` 的 `renderArrangePreview`、`canvas.html` 的 `#arrange-preview-bar`、
    `public/legacy/workflow-editor.css` 的 `.arrange-preview-box`）。
  - **支持锁定节点位置**：右键「锁定位置 / 解锁位置」（多选可整批）把节点 id 记进文档元数据
    `_layoutLocks`——锁定的卡片显示一枚小锁角标、**拖不动**（多选拖动自动跳过并提示）、
    **自动排列保持原位**（只作为父级居中的锚点）；锁跟着文档保存、重开仍在，解锁即整体撤销
    （`canvas/model/layout-locks.ts`、`canvas/render/node-card.ts`、`canvas/interactions/pointer.ts`、
    `canvas/canvas/viewport.ts` 的 `isLocked`）。
  - **搜索结果定位后闪烁**：面板定位、搜索命中与结构树定位共用同一条
    `focusNode(id, param)`——节点卡片与参数端点高亮 1.4 秒后自动消退（阶段 4 的闪烁机制）。
  - **小地图标记运行中 / 失败 / 搜索目标**：缩略矩形按运行状态着色（运行中金色、失败红色、
    已完成绿色、已取消灰色），当前定位/搜索目标额外描一圈强调色；被「临时隐藏」筛掉的卡片
    在小地图上也不画；状态与目标都进小地图结构签名，变了才重建
    （`canvas/canvas/minimap.ts`、`workflow-editor.css` 的 `.mini-node.run-*` / `.mini-search-target`）。
  - **画布位置前进 / 后退**：视口工具条新增 ↩ / ↪（到头自动置灰），右键菜单同样可点；
    平移、缩放、定位停手 350 ms 后记一个位置快照，最多 60 个，后退之后再操作会丢弃「前进」分支；
    只有视口真的变了才请求记录，不会给每一帧重绘都排一个定时器
    （`canvas/canvas/viewport.ts` 的 `recordViewportSoon / viewportBack / viewportForward`）。
  - **大画布可按状态或类型临时隐藏**：视口工具条「☰」列出当前画布上真实存在的运行状态与节点
    类型（打勾即隐藏、可多选，另有「清除全部隐藏」）；命中的卡片与经过它的结构连线**只切
    class**（`node-filtered` / `edge-filtered`）就地隐藏，不重建图层、不写文档、不进历史——
    是**临时**视图状态，重开后自然恢复；打开菜单时自动清掉已经不在画布上的状态/类型
    （`canvas/editor.ts` 的 `isNodeFiltered / toggleNodeFilterValue / clearNodeFilter`、
    `render-entry.ts` 的 `applyNodeFilter`）。
  - 回归测试：自动排列三种范围（局部基准、组外不动、孤立节点不参与）、锁定位置保持原位、
    预览只算不写、`applyLayoutPositions` 一次写入、位置历史前进/后退与分支丢弃、锁定读写的
    脏数据退化与「保存→重开仍在」、小地图状态色 / 搜索目标 / 隐藏跳过、隐藏只切 class、
    预览虚影的出现与消失、定位闪烁（高亮后 1.4 秒消退）、新命令分派与工具条接线
    （`tests/canvas-viewport.test.cjs`、`canvas-layout-locks.test.cjs`、`canvas-minimap.test.cjs`、
    `canvas-render-entry.test.cjs`、`canvas-navigation.test.cjs`）。
- **校验与错误就地可见、可导航**（阶段 6）：
  - **错误直接标在连线、节点、参数端点上**：节点级错误照旧点红点，参数级错误落到具体那一行；
    新增**连线标红**——`children` 路径的问题落到父节点到那个子节点的那条边上，成环 / 父节点数量
    不对 / 不可达这类结构问题则把该节点相邻的每条边都标红，悬停给出问题原文；点不到的
    「未知子节点」仍然只落在父卡上（那条边根本不存在）
    （`canvas/model/card-issues.ts` 的 `issuesByEdge`、`canvas/canvas/edges.ts` 的 `edgeIssues` dep、
    `workflow-editor.css` 的 `.edge-invalid`）。
  - **折叠组汇总内部错误数量**：组卡右上角出现 `⚠N` 徽标（有错误红色、只有提醒琥珀色，
    只写最严重那一类），悬停说明「组内有 N 个错误、M 个提醒」；组内没有问题时整块不出现。
    统计只数组员自己的问题——组是扁平模型，成员互不重叠
    （`canvas/model/issue-navigation.ts` 的 `groupIssueSummary`、`render/node-card.ts`）。
  - **点组错误直接进入并定位**：点组卡上的问题徽标会**进入该组并选中、聚焦、闪烁第一个出问题的
    节点**（优先错误，同一类里按文档顺序），徽标自身吞掉 mousedown/pointerdown，不会顺带触发
    卡片拖动或选中（`enterNodeGroup(groupId, firstProblemNode)`）。
  - **上一个/下一个问题**：新增 `previousIssue` / `nextIssue` 命令，默认键 **F8 / Shift+F8**，
    「更多」菜单里也有；问题按文档顺序排列、同一节点先错误后提醒，走到头绕回另一端。定位到节点时
    带上**参数端点**（那一行一起闪），结构问题则选中对应的连线；工作流级问题只提示不改选区。
    （`canvas/model/issue-navigation.ts` 的 `issueTargets`、`editor.ts` 的 `gotoIssue`、
    `interactions/input-bridge.ts`、`public/shortcuts/shortcuts.js`）
  - **保存只拦真正跑不起来的错误**：`severity` 分成两档——`error` 是运行时会拒绝的硬错误
    （Python `validator.py` 同样拒绝），`warning` 是编辑器侧提醒。保存时**只有 `error` 会被拦**，
    提醒直接放行并在 toast/徽标里说明；被拦时走统一的「影响范围确认」弹窗（默认动作是
    「返回修改」，明确点「仍然保存（N 个错误）」才写盘），确认框的取消按钮文案支持自定义。
    - 新增编辑器侧提醒模块（不进共享校验契约，两端规则仍然对得上）：
      没写 `description`、变量/输入**没有被任何地方引用**（自动生成的公开镜像输入除外）；
    - `unsafe-retry`（对不可安全重试的 Action 挂了 retry）从错误降为提醒：Python 不检查它，
      工作流照常能跑，只是值得提醒；
    - 顶部问题徽标改成分别报数（`N 个错误 · M 个提醒` / 只有提醒时用琥珀态），
      卡片上提醒用琥珀色小点，与红色错误点区分
      （`shared/workflow/validate.ts`、`canvas/model/card-issues.ts` 的 `splitBySeverity`/`warningsByNode`、
      `canvas/model/advisories.ts`、`editor.ts` 的 `requestSave`/`commitSave`、
      `renderer/editor-host.ts` 的 `saveBlockedRequested`、`shared/editor-messages.ts` 新消息类型、
      `ui/canvas-helpers.ts` 徽标计数）。
  - 回归测试：`children` 路径与结构问题各自落到哪些边、严重度拆分、按节点收集提醒、
    `unsafe-retry` 确为 warning 且不阻止保存、编辑器提醒（缺说明 / 未引用 / 坏输入）、
    保存策略（无错误直接保存、有错误请宿主确认、forceSave 回写、工具栏走同一入口）、
    问题导航排序与 F8 接线、折叠组汇总与徽标两种状态、提醒点与错误点互斥、连线标红与悬停说明
    （`tests/canvas-card-issues.test.cjs`、`canvas-issue-navigation.test.cjs`、
    `canvas-validation-policy.test.cjs`、`node-cards.test.cjs`、`canvas-edges.test.cjs`）。
- 卡片值行的编辑态：行内浮层静止时与卡片值框同色（`card-head` / `card-line`），
  聚焦只在值框内侧描一圈同色系高亮，不再换成亮青色的 `card-port` 边框；数组行只
  提亮正在编辑的那一格，不再整行都跟着亮。
- 删除变量卡片时收敛「孤儿引用」：参数里的 `{ref}` 与 `_variableLinks` 是两份记录，
  映射里已经丢了这一项时（旧文档、手工改过的 JSON、映射与引用不同步），原来只会按
  映射解绑，那份引用就留了下来、继续指向已删除的变量。现在按被删卡片自己算：该变量
  没有存活卡片后，普通参数、嵌套 `inputs.*` 与实例子输入里的引用一并清掉，参数回到
  动作默认值。
- mypy 收紧：启用 `disallow_untyped_defs` 与 `disallow_incomplete_defs`。
- 工作流整合为 `workflows/活动副本.json` 与 `workflows/entrypoints/new_workflow.json`，
  旧入口与共享子流程已移除（过时测试同步清理）。

### 修复
- **组变量卡出来的线几乎是直斜线**（不好看）：映射线是贝塞尔，但头段控制点一直按「接口卡端口在
  左边缘」往左推，而组变量卡的端口在**右边缘**、线是往右走的——长距离时曲线被压成一条直斜线。
  现在头段控制点跟着出线口那一侧走（变量卡 `x1 + bend`、接口卡 `x1 - bend`），末端仍从左侧切入
  成员卡引脚，形状与普通变量线一致。回归用例直接断言两条映射线的 `d`（含控制点方向与数值）
  （`desktop/src/canvas/canvas/edges.ts`、`desktop/tests/canvas-edges.test.cjs`）。
- **组内视图里同一个变量被画了两遍**：组边界行（组变量卡上的 `成员 · 参数 ← 变量名`）已经代表了
  那个变量，画布上却还照画一张同名变量卡片，两者并排出现、还连着一条线。现在组内视图会把
  **已被组边界端点代表的变量**从画布的变量卡列表里剔除（`boundaryVariableRefs()`），
  渲染、命中测试、连线、包围盒与画布签名共用这一份过滤后的列表：重复的卡片不画，
  指向它的那条连线也不会留半截（边界行到真实成员参数的映射线照旧）。文档里的卡片本身不动——
  退出组后照旧显示，只是**组内**不重复表达同一件事。回归用例：边界代表的变量集合（进组生效、
  退出组失效、从组接口移除后失效）、变量卡被隐藏时不出现悬空连线、以及画布入口确实把过滤后的
  列表交给所有画布消费者
  （`desktop/src/canvas/model/node-groups.ts`、`canvas/editor.ts`、
  `desktop/tests/canvas-node-groups.test.cjs`、`desktop/tests/canvas-edges.test.cjs`）。
- **组边界的数据线不再自成一派**：组接口 / 组变量卡映射到真实成员参数的那条线以前单独用
  `.group-interface-edge`（1.4px 虚线、固定灰色、`pointer-events: none`）——既不是变量线的标准
  样式，也点不到、断不开。现在它就是**变量线**：实线、按身份取色（`--data-tone` → `--edge-tone`）、
  1.8px、悬停提亮，并带 14px 透明命中线，可以 Alt + 左键直接断开（作用到真实成员参数，与在组接口
  端口上断线同一条路径）；`group-interface-edge` 只保留为语义标记，不再声明任何样式。
  `editor-light.css` 由 `build-light-palette.cjs` 重新生成，浅色主题里的灰色映射线一并消失
  （`desktop/src/canvas/canvas/edges.ts`、`desktop/public/legacy/workflow-editor.css`、
  `desktop/tests/canvas-edges.test.cjs`）。
- 浅色适配器测试的误报：`/filter\s*:/` 会把类名里带 filter 的选择器
  （`.variable-references-filter:hover`）当成滤镜声明，改为只匹配声明位置
  （`(?:^|[;{])\s*filter\s*:`，`desktop/tests/theme-settings.test.cjs`）。
- **自动排列「排得更好看」**（组内尤其明显）：
  - **组内也按树排**：自动排列以前只从 `state.raw.root` 开始递归，而进组后文档 root 不在投影里，
    递归一次都没跑起来——成员被当成一堆孤立节点平铺成一行。现在从**当前视图的根**开始：
    外层是文档 root（外加没连上的孤立节点），组内是那张组接口卡（它的 children 就是组的入口），
    于是组内也是「接口卡 → 入口节点 → 子节点」的正常树形。
  - **绑定卡片贴到所属节点旁边**：以前所有跑远的卡片都统一丢到图最左侧一列；
    现在优先按创建卡片时的位置贴到所属节点左侧、纵向对齐它绑定的那一行（连线是一条水平短线），
    该位置被节点或别的卡片占了就上下错开一格，实在放不下才退回左侧列——只有**没有绑定**的
    卡片会进左侧列。
  - **卡片归属识别更全**：`_variableLinks`（含实例子输入）→ 节点端点 → 节点里任意位置的
    `{ref:'作用域.变量名'}`（`params`、`decorators`、`runs[].inputs`）；序列等没有端点列表的
    节点上的引用也能找到（真实文档里那张卡片正是被 `repeat_rounds` 的 `repeat` 装饰器引用的）。
  - **组内包围盒只算本组内容**：`bounds()`（fitView / 小地图用）在组内视图里只计挂在本组成员上的
    卡片，组外卡片不再把进组后的视图拉远（否则一进组就缩成一小团）。
  回归用例覆盖：组内树形深度、绑定卡片贴边（含被占位时的错开）、没有绑定的卡片才进左侧列、
  组内包围盒排除组外卡片（`desktop/src/canvas/canvas/viewport.ts`、`canvas/card-follow-layout.ts`、
  `canvas/editor.ts`、`desktop/tests/canvas-viewport.test.cjs`）。
- **组内自动排列不再影响组外**：进到节点组里点「自动排列」时，归位逻辑以前会按**组内成员**的
  包围盒去判定「卡片跑远了」，于是组外（含外层节点引用的）变量卡片被当成跑远而搬走，
  组卡在外层的位置也会被按成员重新居中——把外层的布局一起改了。现在组内视图完全隔离：
  只有本组成员的位移会作用到**挂在本组成员上的**卡片（本组成员上的卡片跑远也仍然收回组内范围），
  组卡坐标、组外节点与组外卡片一律不动；组外排列时依旧是「折叠组的成员跟着组卡整组平移」
  （否则进组时成员又会出现在别处）。回归用例：组内排列后组卡与组外卡片的坐标必须逐字不变，
  只允许挂在成员上的卡片跟着成员走
  （`desktop/src/canvas/canvas/card-follow-layout.ts`、`canvas/viewport.ts`、
  `desktop/tests/canvas-viewport.test.cjs`）。
  **组内根本不画的卡片也不碰**：被组左侧边界行代表的变量在组内视图里没有画布卡片
  （`editor.variableCardList()` 按 `boundaryVariableRefs()` 把它过滤掉了），但归位逻辑以前只问
  「卡片绑的节点是不是本组成员」，于是照搬——用户在组内看不到任何变化，出组才发现外层那张卡片
  跳了位（`workflows/活动副本.json` 的 `重新校验` 卡正是这种：绑在 `tap_exit_after_battle:revalidate`
  上，进「节点组 2」后由边界行代表）。现在「组内画不画」与「组内排不排」用同一条规则：组内排列
  跳过被边界行代表的卡片，外层排列照旧（两条规则都不生效）。回归用例覆盖「被边界行代表的卡片
  坐标逐字不变 / 未被代表的照旧贴着成员走 / 外层排列照旧贴边」
  （`desktop/src/canvas/canvas/card-follow-layout.ts`、`canvas/viewport.ts`、`canvas/editor.ts`、
  `desktop/tests/canvas-viewport.test.cjs`）。
- **拖动卡片时连线不跟着走**（卡片动了、线留在原地，端点悬在空白处）：上一条「元素位置同步」
  会先把 `transform` 写成最新值，于是 `applyPatches` 里 `nodeTransform` 恒返回 false（DOM 没变），
  而「要不要重算相邻连线」以前正是拿这个返回值判断的——连线一次都不补。现在按**上一次补过的
  坐标**判断节点有没有真的移动，位置变了就重算相邻连线（结构线 + 挂在节点上的变量线/引用线），
  位置没变的帧仍不重复写 DOM；回归用例覆盖「补丁返回 false 时相邻连线也必须跟着走」
  （`desktop/src/canvas/render/render-controller.ts`、
  `desktop/tests/canvas-render-controller.test.cjs`）。
- **「点了自动排列没反应，滚一下画布才刷新」**：元素位置被刻意排除在内容签名之外
  （这样拖拽只改 `transform`、不重建卡片），而「自动排列」这类**不走拖拽补丁**的移动只改了文档
  坐标，已经挂载的元素就一直停在旧位置——直到视口把它裁掉又重新挂载，才「跳」到新位置，
  看起来就是「排列没生效，滚一下才动」。现在渲染控制器在复用元素前比一次**挂载时记下的坐标**，
  对不上就地补一次 `transform`（节点、变量卡片、实例运行卡三条路径都覆盖）；坐标没变的帧一次
  DOM 都不写，拖拽帧由补丁写并回填挂载表，因此不会重复写，500 节点基准帧时间不变
  （`desktop/src/canvas/render/render-controller.ts`、
  `desktop/tests/canvas-render-controller.test.cjs`）。
- **从端口拖不出连线**（节点连线、变量卡端口、引脚起线、输出引用四种都看不见那条预览线）：
  渲染改成持久图层后，`renderConnection` / `renderVariableConnection` / `renderReferenceConnection`
  丢掉了调用点——函数还定义在 `edges.ts` 里，`render-entry.ts` 只剩依赖声明与解构，
  于是拖动时连接状态照常建立（悬停能吸附、松手能落线），但那条橡皮筋没人画。
  现在控制器新增独立的 `previews` 图层（排在卡片之上、框选矩形之下），每帧先把它清空，
  再由渲染入口用当前拖拽状态画那一条：拖动中始终只有一条、松手或 Esc 取消后立刻清掉、
  不会逐帧累积；预览不参与连线层对账，因此拖线帧不会整层重建；导出时整层剔除，
  以后再加预览类型不必回来补 class 选择器。契约用例守住「拖出即出现 / 每帧一条 / 抬起消失」
  （`desktop/src/canvas/render/render-controller.ts`、`render/render-entry.ts`、`canvas/export.ts`、
  `desktop/tests/canvas-render-entry.test.cjs`、`desktop/tests/canvas-render-controller.test.cjs`）。
- **「自动排列」之后画布上的东西还留在原地**（变量卡片、折叠节点组的成员、组内排列后的组卡）：
  自动排列只重排当前投影里的节点，而变量卡片存的是自己的绝对坐标、折叠组的成员坐标不会更新
  （反过来在组内排列时组卡不在投影里、也不会跟着成员走）。于是排列完它们停在旧位置，
  而 `fitView` 的包围盒又把这些还留在原地的对象一起算进去——整张图被缩得很小、
  卡片孤零零飘在空白处，看起来就是「没显示，要滚动才找到」。现在自动排列会把它们一起搬：
  变量卡片按**绑定节点**的位移跟随（同一节点上的卡片保持相对位置，实例子输入连线也算），
  没有绑定的卡片按整张图的包围盒位移跟随；折叠的组按组卡位移**整组平移**（组内相对关系不变）；
  在组内排列时组卡按成员的新包围盒重新居中（与打组时同一个公式，`groupCardPosition`）。
  **只跟着位移走还不够**：卡片绑定的节点自己没挪窝时位移是 0，卡片就留在原地——实际文档里
  一张卡片停在 `(-128, 2832)`，而排列后的图只到 `y=1344`，`fitView` 于是把整张图缩到 39%、
  卡片孤零零飘在空白处（「视觉上断开」）。所以凡是跑到图外一个叶子间距以外的卡片，
  一律收回图的左侧一列（一列放不下就往左再起一列），保证排列完「所有东西都在图上」。
  只有用户主动「自动排列」才动这些坐标——载入时的兜底布局（`autoLayout(false)`）不碰用户存下来的位置，
  一次自动排列仍然只有一条历史
  （`desktop/src/canvas/canvas/card-follow-layout.ts`、`canvas/viewport.ts`、`canvas/editor.ts`、
  `model/node-groups.ts`、`desktop/tests/canvas-viewport.test.cjs`）。
- 从变量面板**拖进画布的变量卡片不显示**，要滚一下（平移/缩放到某个位置）才出现：
  画布入口把 `CanvasWorkflowModel.variableCardPosition(node, index)`——「把卡片放到某个节点
  某一行旁边」的**节点侧**算法——当成「卡片位置」传给了渲染入口，而它内部走 `position(node)`
  （读 `_layout`），对卡片恒为 `(0,0)`，于是**所有变量卡片的裁剪矩形都塌到同一个固定点上**：
  视口（含 300px 外扩）没有盖住那个点，卡片就一张都不挂载；滚动到那个点，全部卡片又一起冒出来。
  现在变量卡片的裁剪矩形只读卡片自己的 `x`/`y`（与 `cards.ts` 的绘制 transform、`edges.ts` /
  `hit-test.ts` / `minimap.ts` 完全同一对坐标），并去掉这个可注入的位置函数——卡片位置只有一个
  真值来源。500 节点基准里可以直接看到差别：修复前打开画布 `variableCards: 0`（视口内 46 张
  卡片全被裁掉），修复后 `variableCards: 46`，帧时间不变。
  顺带修掉同一段裁剪代码里的第二个问题：数据边档位（zoom ≥ 0.45）下变量卡片的挂载集合只由
  「被可见节点引脚引用」决定，刚拖进来、还没接到端点的卡片同样是未绑定的、会被整张裁掉。
  现在挂载集合是**视口内的卡片 ∪ 被引脚引用的卡片**：可见性只由视口决定，绑定关系只用来
  额外保留画外卡片、避免变量连线悬空；同时把「连线是否需要重建」单独交给「被引脚引用的卡片
  集合」（不含视口因素，并将数据边档位计入判定），平移缩放不会因为多挂一张未绑定卡片而重建
  连线图层
  （`desktop/src/canvas/render/render-entry.ts`、`canvas/render/render-controller.ts`、
  `canvas/editor.ts`、`desktop/tests/canvas-render-entry.test.cjs`、
  `desktop/tests/canvas-render-controller.test.cjs`）。
- 画布上框选多张变量卡片后，一拖只有被按住的那一张动：变量卡片的按下处理**无条件**把选择收窄成
  按下的那一张，拖拽状态里也只记了单张卡片的起点（节点卡片一直有整组拖拽）。现在单击已在多选里的
  卡片保留整组选择、Shift 点击在多选里增减，拖拽按每张卡片自己的起点加同一位移，整组一起移动；
  回归用例覆盖「单击已选中的卡片不收窄选择」与「按 origins 移动整组」
  （`desktop/src/canvas/render/cards.ts`、`canvas/interactions/pointer.ts`、`desktop/tests/canvas-pointer.test.cjs`、
  `desktop/tests/node-cards.test.cjs`）。
- 卡片渲染器没把**自己创建的元素**返回给渲染控制器：控制器据此把卡片记进挂载表，拿到 `undefined`
  时拖拽补丁既改不动卡片（拖动期间画面不动），重建时又删不掉旧元素（每帧留下一张重复卡片）。
  节点卡片、变量卡片、实例运行卡片三个渲染器都补上返回组元素；同时把卡片位置移出内容签名
  （与节点一致），于是拖动只改 `transform`、不重建卡片，变量连线也跟着卡片一起重画
  （`desktop/src/canvas/render/cards.ts`、`canvas/render/node-card.ts`、`canvas/render/render-entry.ts`、
  `canvas/render/render-controller.ts`、`desktop/tests/canvas-perf-500.test.cjs`、
  `desktop/tests/canvas-render-controller.test.cjs`）。
- 画布上「端点同色的太多」：参数引脚一旦有值（`configured`）就被改填成卡片色
  `--card-port`，而一张卡上绝大多数参数都有默认值，于是整张卡的引脚都变成同一种颜色、把类型色
  完全盖掉。现在 `configured` 只用描边区分，引脚始终保留**类型色**（`bound` 同样用更亮的描边），
  `invalid` 仍标红；新增回归断言：`.configured` 不得改 `fill`（`desktop/public/legacy/node-cards.css`、
  `desktop/tests/node-cards.test.cjs`）。
- 子工作流输入在画布上显示成自动生成的键（`v_e9e2ee…`）而不是子工作流声明的名字：卡片参数行的
  标签以前直接用输入的键，现在和详情栏、变量列表一样优先用 `display_name`（子工作流没声明才回落到键）。
  另外「提升为变量」把子工作流输入行提升为变量时，键与显示名都取子工作流声明的显示名，
  不再产出 `inputs_v_<uuid>` 这种没人看得懂的名字；`活动副本.json` 里那条既有绑定的输入
  补上了 `display_name: 运行轮数`（键与 `default` 一起更新，`initial_from`、绑定与变量卡片/
  连线记录同步改到新键）
  （`desktop/src/canvas/model/canvas-workflow-model.ts`、`canvas/interactions/port-menu.ts`）。
- 重命名/移动内容后「有些地方还是旧值」：重定向确实写进了磁盘，但编辑器**内存里的旧正文**被
  继续沿用——`loadWorkflow` 优先用 `tab.text`，于是画布、详情栏又拿旧正文重新初始化，下一次
  自动保存还把旧引用写回磁盘、把刚做的重定向覆盖掉。现在被改写的文档会**强制重新读盘**
  （先取消该文档排队中的写盘、丢掉内存副本再载入；有未保存修改的文档保持不动，并在改写明细
  弹窗里点名提示「保存它们会覆盖本次重定向」）。另外**文件夹改名**会带走内部所有工作流，
  以前打开中的标签会停在已经不存在的旧路径上，现在按新旧前缀一起搬到新位置
  （`desktop/src/renderer/document-lifecycle.ts`、`workspace.ts`、`content-browser.ts`、
  `renderer/main.ts`）。
- 工作流目录收敛到根目录 `活动副本.json`（工作流 ID `activity_loop`）：`周年庆活动副本.json`
  改名为 `活动副本.json`，提交进仓库的入口样板 `workflows/entrypoints/new_workflow.json`
  已删除（`entrypoints/` 仍是「新建工作流」的默认目录，由应用在保存时按需生成），
  `README.md` 与 `workflows/README.md` 的说明同步到新布局。同时补上仓库级防护
  `tests/test_workflows.py::test_all_workflow_references_resolve_to_existing_files`：
  项目里任何 `workflow.run` / `instance_parallel` 的字面引用解析不到文件都会在 CI 里报出来
  （同名文件后来被改名就会红）。顺带把 `instance_parallel` 用例里硬编码的子工作流输入名
  改成按子工作流实际声明的输入键取，编辑器自动生成的输入 id 再变也不会误红。
- 子工作流选择器漏掉「子文件夹里的脚本」：当前文档以前被整个从列表里剔掉，于是当某个子目录
  脚本正是当前文档时，那个文件夹连同它的脚本一起消失（看起来像目录扫描漏了）。现在当前文档
  保留在列表里、标「当前脚本」（选它会提示「当前工作流不能作为自己的子工作流」），子目录脚本
  始终按文件夹分组可见。另外打开选择器时会向壳层要一次**最新脚本目录**并推送给所有画布，
  别处新建工作流或外部改动后列表不再过期（`desktop/src/canvas/interactions/workflow-browser.ts`、
  `canvas/shell/messages.ts`、`renderer/editor-host.ts`、`shared/editor-messages.ts`）。
- 在详情栏点「浏览」选子工作流时，弹层被挤在详情栏那个窄 iframe 里、文字互相重叠：
  现在和素材浏览器一样，把弹层移植到**顶层文档的 `<dialog>` + shadow root**，
  铺满窗口居中显示，基础样式与弹层专用样式一起 link 过去；Esc / 关闭按钮 / 点遮罩都能关掉，
  选完写回节点参数并收掉弹层（独立画布页没有顶层文档时自动回退到本文档）。
  弹层样式从 `workflow-editor.css` 拆到 `public/legacy/workflow-browser.css`
  （`desktop/src/canvas/interactions/workflow-browser.ts`）。
- 每次启动时工作流画布空白、要手动切一次标签才显示：恢复会话时 `activeUri` 已经被设成
  上次的活动文档，`activateWorkflowTab` 于是走「已经是活动文档」的提前返回，**根本没去
  加载它**（状态栏停在「桌面端已连接」而不是「工作流已载入」），画布拿不到初始化数据。
  现在只有「已经加载过」的活动文档才只同步标签，未加载的活动文档照常加载；同时初始化
  下发不再死等页内 `ready` 消息——只要画布 iframe 已加载完成就补发一次（重复下发幂等），
  避免 ready 消息先于运行时登记到达被丢弃时同样空白
  （`desktop/src/renderer/document-lifecycle.ts`）。
- 活动副本工作流（`workflows/活动副本.json`，4.4.0）首轮就失败：`vision.detect_state`
  只声明了一个名为 `1` 的状态，而两条条件分支判定的是 `challenge` / `settlement`，两个
  分支都不命中，选择器与整轮直接以 `condition decorator rejected branch` 结束。现在
  状态列表按分支命名（`challenge` / `settlement`）。
- 同一条工作流里「挑战页」的判定与复核各认一份模板：状态识别用
  `assets/templates/souls/souls-challenge.png`，四处复核（两处 `disappeared_states`、
  两处「确认已返回挑战页」）却仍指向 `assets/templates/task_1-template.png` 与旧 ROI，
  而该文件已被新截图取代、在挑战页上匹配不到。现在四处统一到 `souls-challenge.png` +
  `[1621, 791, 299, 289]`（实测失败帧置信度 0.99），结算提示继续用
  `task_3-template.png` + `[700, 950, 520, 130]`，与 `wait_battle_end` 保持一致。
- 「点击挑战按钮」补上 `disappeared_states`（结算页），使已经写在那里的
  `disappeared_state_timeout_seconds: 3` 真正生效：复核时挑战按钮已消失而结算提示已
  出现时跳过点击、直接进入结算处理，不再直接报「模板已不存在」结束整轮。
- 「变量引用」不再落成右侧的独立分组：它原先只登记在外层工作台（`#workbench-frame`），
  而内容浏览器默认停在内层（`#dock-workspace`），两套 Dockview 之间并不成标签组，
  声明里的 `reference: contentBrowser` 永远解析不到、只能退到工作流编辑器那一组。
  现在它和运行日志一样是共享停靠面板：默认开在内层与内容浏览器同组，内容浏览器被拖到
  外层时它也跟着到外层同组；参照面板不在时落进当前活动分组，不再凭空多出一个分组。
- 详情栏（镜像画布）里的编辑现在真的落到文档上：在详情栏换动作、改参数、改名字只改了那一份
  镜像，持有文档的画布没收到，卡片因此停在旧值上，真画布下一次上报还会把这份改动覆盖掉。
  现在镜像上报文档变更时，壳层会把同一份文档推给持有文档的那份画布（并记入画布历史），
  镜像与画布渲染保持一致；来源本来就是文档画布时不会回推给自己。
- 清理无引用的死代码与未使用导入（Python 与桌面端）。
- 抽取 `src/oooonmyoji/naming.py`，统一 4 处重复的文件名清洗实现。
- 拆分 `workflows/validator.py` 的 `validate_workflow`，并补齐公共入口中文文档字符串。
- 桌面端统一通过 `StudioShortcuts.matchesById` 判断快捷键。

### 移除
- 移除已失效的 `run-party-souls` 命令、`PARTY_SOULS_*` 常量、相关测试与 README 段落
  （对应工作流已在整合中删除，逻辑可从 Git 历史恢复）。
