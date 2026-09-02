# HarmonyOS Sans SC（鸿蒙字体）

桌面端界面中文字体，按字重拆分为 cn-font-split 子集（woff2）。

- 字体：HarmonyOS Sans SC Version 2.400，版权归 Huawei Device Co., Ltd. 所有，
  依《HarmonyOS Sans 字体许可协议》分发。
- 来源：npm 包 `harmonyos-sans-sc-webfont-splitted@1.1.0`（cn-font-split 拆分产物）。
- 包含字重：Regular 400 / Semibold 600 / Bold 700（界面 650 字重由浏览器就近匹配）。
- 引用方式：各 HTML 入口（`index.html`、`popout.html`、`legacy/editor-frame.html`、
  `runtime-log/index.html`）通过 `<link>` 引入对应字重 CSS；字体族名为
  `"HarmonyOS Sans SC"`，各样式表中置于回退字体（Segoe UI / 微软雅黑）之前。
