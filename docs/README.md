# 文档索引

本目录存放项目文档。当前可用的文档入口：

- [根 README](../README.md)：安装、配置、CLI、工作流与 Action 开发总览。
- [工作流目录说明](../workflows/README.md)：`workflows/` 的组织方式与入口约定。
- [桌面端说明](../desktop/README.md)：独立桌面工作台的使用与开发。
- [桌面端设计规则](../desktop/DESIGN_RULES.md)：桌面端代码与交互约定。
- [桌面端 UI 组件库](../desktop/public/legacy/UI_LIBRARY.md)：遗留画布页面使用的组件。
- [MCP 客户端配置示例](./mcp-client-config.example.json)：将 MCP 模板工厂接入 AI 客户端。

工作流的权威契约由 `src/oooonmyoji/workflows/validator.py` 中的 JSON Schema 强制，
Action 清单格式见 `src/oooonmyoji/actions/manifest.py`。

> 说明：早期的工作流规范与设计研究文档已在整合中移除；新的设计与实现记录请放在本目录。
