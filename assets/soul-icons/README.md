# 御魂套装图标（assets/soul-icons）

`<套装编号>.png`，共 78 个（编号 300002–300107，与客户端 `EQUIP_SUIT` 表一一对应；
中间缺少的编号在官方配置里本来就不存在）。

## 来源

网易藏宝阁阴阳师分区的官方静态资源：

```
https://cbg-yys.res.netease.com/game_res/suit/<套装编号>.png
```

该路径来自藏宝阁「御魂搭配」页（`yuhun-collocation` chunk）里的
`g_res_url + "/game_res/suit/" + this.data.suitid + ".png"`，`g_res_url` 即站点配置的
`resUrl = https://cbg-yys.res.netease.com`（见站点 HTML 中的 `CBG_CONFIG`）。

- 直接请求 CDN 会返回 WebP；带 `Accept: image/png` 时返回真 PNG（当前仓库里全部为 PNG，80×80）。
- 版权归网易所有，此处仅作本地工具展示用途，请勿再分发。

## 刷新

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.tools.fetch_soul_icons
```

只依赖网络：先读藏宝阁的 `game_auto_config.js`，把官方 `yuhun_list` 里清单还没有的套装编号
自动补进来（名称也以官方配置为准），再按 `manifest.json` 里的套装编号重新下载并按 sha256
重写清单。游戏上新后直接重跑即可，不用手填编号。

- `--offline`：不读官方目录，只刷新清单里已有的编号。
- `--ids 300100 300101`：额外追加指定编号（官方目录暂时没有、但客户端已存在的套装）。
- 藏宝阁没有图标的编号会保留 `"missing": true`，前端回落首字占位；重新下载成功后才去掉该字段。

脚本不读取设备或游戏客户端。

## 使用

`souls/details.py` 会把套装编号解析成
`onmyoji-resource://project/assets/soul-icons/<套装编号>.png` 写进 `iconUrl`，
桌面端用已有的 `onmyoji-resource://` 协议直接渲染；没有本地文件时不写 `iconUrl`，前端回落到首字占位。

注意：图标按编号取，不依赖 `manifest.json` 的名称和图标键，所以官方配置里两件套、四件套文本
还没写全的新套装（如 300100–300107）也能先显示图标。
