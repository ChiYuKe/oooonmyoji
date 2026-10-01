# AutoFlow Studio

独立的 Electron 工作流桌面端。它直接读取项目根目录中的 `workflows/`、`assets/`、`config/` 和 Python 引擎，不依赖 VS Code 或旧插件。

## 启动

双击 `start-desktop.bat`，或在本目录执行：

```powershell
npm install
npm start
```

开发模式：

```powershell
npm run dev
```

## 目录

- `src/main/`：工作流文件、素材、Python/MuMu 进程和安全资源协议
- `src/preload/`：渲染层可调用的白名单 API
- `src/renderer/`：UE 式桌面界面
- `src/shared/`：主进程与界面的类型契约
- `public/legacy/`：复用的节点画布和 Electron 兼容桥

执行工作流时，桌面端会先保存画布当前内容，再由 Python 引擎运行。`Instance Parallel` 的每个运行项由引擎并行调度到对应 MuMu 实例。

## 编辑工作流

- 行内参数输入遇到滚轮或窗口切换时，会提交合法值；非法值保留在输入框中。暂时关闭后重新打开同一参数会恢复草稿，Esc 明确取消。
- 更换任务动作会保留符合新动作要求的参数。不兼容的参数会先列出并确认，取消后保持原动作和参数。
- 多选任务节点后，详细信息显示共同参数。不同取值显示“多个值”，填写后点“应用到 N 个节点”；所有节点都满足取值要求才会提交，Ctrl+Z 可一次撤销。也可让各节点分别恢复自己的默认值。
- 按 Ctrl+F，或在“更多”中选择“搜索节点和参数”，可按名称、动作、参数值、素材路径、变量和输出引用搜索。点击结果定位节点和参数，折叠组内部的节点会自动展开定位。
