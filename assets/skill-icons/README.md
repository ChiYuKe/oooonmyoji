# 式神技能图标

来自网易公开式神录：
`https://yys.res.netease.com/pc/zt/20161108171335/data/skill/<图标编号>.png?v11`。
路径与技能接口来自官方式神录的 `page_35066d6.js`，版权归网易所有。

运行 `python -m src.oooonmyoji.tools.fetch_hero_skills` 更新离线技能文字及图片。
`manifest.json` 记录图片来源、校验和及官方缺失项。当前 914 个图标中缓存了
835 张，覆盖全部 799 个主技能；其余 79 个均是官方图片返回 404 的附加技能，
界面使用名称首字占位，其文字描述仍保留。
