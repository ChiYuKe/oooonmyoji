# 社区测试配置

已在现有 Cloudflare 社区中加入 `soul-community-synthetic-v1`：16 个测试分享者、176 套六星 +15 御魂配置。署名统一为“测试用户01·山风”等，全部是合成数据，测试分享者不对应 GitHub 账号，也没有登录会话。

数据覆盖 9 个式神、9 个评分指标，以及不同四件套、两件套、2/4/6 号位主属性、副属性强度、首领固有属性和约 20 天的上传日期。各御魂副属性合计九次分配，数值符合项目中采用的属性标准；方案名称仍根据式神和御魂套装生成。

- 大天狗：96 套伤害输出配置，可测试接口分页、列表翻页和多条件筛选；其中针女＋鬼灵歌伎包含达到与未达到 22000 分的配置。
- 阿修罗：24 套伤害输出配置。
- 玉藻前、须佐之男：各 8 套伤害输出配置。
- 山兔、镰鼬、不见岳、缘结神、帝释天：各 8 套，覆盖其余评分指标。

打开“社区方案比对”，点击“刷新”绕过本机缓存。选择式神与评分指标后，只会展示对应的配置；按署名“测试用户”搜索即可找到这批数据。当前条件筛选使用当前式神面板重新计算，部分方案会因暴击、主属性或套装条件不符而被排除。

## 生成与核对

先在 `desktop` 目录运行 `npm run build:renderer-tests`，再从项目根目录运行：

```powershell
node cloudflare/soul-community/scripts/seed-test-builds.cjs
node cloudflare/soul-community/scripts/verify-test-builds.cjs
```

生成脚本只写入本机 `artifacts/soul-community-test-data`。生成时会用真实 SQLite 检查标准属性、重复导入不会新增重复记录，以及清理不会删除其他用户的数据。验证脚本只读取线上公开接口，核对全部配置、多页加载、搜索、套装和主属性筛选、目标评分比对。数据清单为 `manifest.json`，线上验证结果为 `verification.json`。

## 导入或清理这一批数据

在 `cloudflare/soul-community` 目录使用现有 Wrangler 身份执行：

```powershell
node node_modules/wrangler/bin/wrangler.js d1 execute DB --remote --file ../../artifacts/soul-community-test-data/seed.sql
```

重复导入会保留已有记录。需要撤掉测试数据时，执行同目录命令，文件换成 `../../artifacts/soul-community-test-data/cleanup.sql`。清理只针对清单中的配置 ID 和测试所有者哈希，不删除真实方案或账号；生成记录后应保留其清单和清理文件。
