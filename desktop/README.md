# Onmyoji Studio

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
