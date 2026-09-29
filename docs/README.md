# 文档索引

本目录存放项目文档。当前可用的文档入口：

- [根 README](../README.md)：安装、配置、CLI、工作流与 Action 开发总览。
- [工作流目录说明](../workflows/README.md)：`workflows/` 的组织方式与入口约定。
- [节点图文档 v5](./graph-document-v5.md)：**图语义的权威说明**（节点、引脚、边与
  图文档 → v4 的编译规则）；**v5 的 JSON 落盘已退役**，磁盘格式换成 v6 文本。
- [工作流文本格式 v6（`.owf`）](./workflow-dsl-v6.md)：磁盘上唯一的工作流格式——
  缩进块 + 中缀表达式 + 顶层 `edges` 连线表，及其规范化规则与往返保证。
- [桌面端说明](../desktop/README.md)：独立桌面工作台的使用与开发。
- [桌面端设计规则](../desktop/DESIGN_RULES.md)：桌面端代码与交互约定。
- [桌面端 UI 组件库](../desktop/public/legacy/UI_LIBRARY.md)：遗留画布页面使用的组件。
- [MCP 客户端配置示例](./mcp-client-config.example.json)：将 MCP 模板工厂接入 AI 客户端。

工作流的结构由 `src/oooonmyoji/workflows/graph_schema.py` 中的 JSON Schema 强制，
图语义（引脚、成环、switch 空分支等）由 `workflows/graph_compile.py` 报错，编译出的
运行时文档再交给 `src/oooonmyoji/workflows/validator.py` 做执行语义校验；
Action 清单格式见 `src/oooonmyoji/actions/manifest.py`。

> 说明：早期的工作流规范与设计研究文档已在整合中移除；新的设计与实现记录请放在本目录。
