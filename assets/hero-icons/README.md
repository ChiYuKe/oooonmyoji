# 式神头像

本地式神选择器使用网易式神录的官方头像：
`https://yys.res.netease.com/pc/zt/20161108171335/data/shishen/<式神编号>.png?v6`。
路径来自式神录的 `shishen.js`；版权归网易所有。图片只在本地展示，计算和选择无需联网。

运行 `python -m src.oooonmyoji.tools.fetch_hero_icons` 可按本地式神目录补充头像；
`manifest.json` 记录来源、大小、校验和与缺失项。现有目录 280 项中有 278 张头像，
大吉达摩和招福达摩的官方头像暂缺，选择器显示名称占位，不影响基础面板和计算。
