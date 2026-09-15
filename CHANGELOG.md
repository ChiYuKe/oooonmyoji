# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。
当前尚无正式发布标签；以下记录从最近的整合工作开始。

## [Unreleased]

### 新增
- GitHub Actions CI：Python 侧 ruff / mypy / pytest，桌面端侧 typecheck / node:test。
- `LICENSE`（MIT）、`pyproject.toml`（ruff + pytest 配置）、`.pre-commit-config.yaml`、`requirements-dev.txt`。
- `docs/` 文档索引与 MCP 客户端配置示例。

### 变更
- mypy 收紧：启用 `disallow_untyped_defs` 与 `disallow_incomplete_defs`。
- 工作流整合为 `workflows/活动副本.json` 与 `workflows/entrypoints/new_workflow.json`，
  旧入口与共享子流程已移除（过时测试同步清理）。

### 修复
- 清理无引用的死代码与未使用导入（Python 与桌面端）。
- 抽取 `src/oooonmyoji/naming.py`，统一 4 处重复的文件名清洗实现。
- 拆分 `workflows/validator.py` 的 `validate_workflow`，并补齐公共入口中文文档字符串。
- 桌面端统一通过 `StudioShortcuts.matchesById` 判断快捷键。

### 移除
- 移除已失效的 `run-party-souls` 命令、`PARTY_SOULS_*` 常量、相关测试与 README 段落
  （对应工作流已在整合中删除，逻辑可从 Git 历史恢复）。
