# GitHub 社区账号

登录仅使用 GitHub 基本身份信息，不申请仓库、邮箱或组织权限。账号与上传记录保存到现有 Cloudflare Workers + D1，不需要额外服务器或邮件服务。

## 用户操作

点击主窗口右上角“用户登录”，或“上传方案”窗口的“登录与账号管理…”，打开账号窗口，再点击“使用 GitHub 登录”。程序显示短码并打开 `https://github.com/login/device`。在 GitHub 输入短码并确认授权后，程序自动登录，右上角显示账号署名。关闭账号窗口不会取消正在进行的授权，可再次打开查看授权码；“取消登录”会终止授权。账号署名与上传管理权限跟随账号，“同步我的上传”及“继续加载我的上传”可读取其他设备的上传。

首次登录会凭本机原有管理凭据绑定旧方案；已有绑定不能转给另一个 GitHub 账号。绑定后原匿名凭据不能继续管理这些方案。已有账号在另一设备登录时，可把该设备尚未绑定的旧方案归入同一账号，已经绑定其他账号的方案不会转移。

登录后可在账号窗口修改“社区署名”，点击“保存署名”。署名为 1 至 30 个字符，不能与其他用户重名（全角、大小写统一检查）；已有上传通过账号署名显示新名称，方案 ID 和归属不变。改名无需上传新方案，不会修改 GitHub 用户名。

浏览与比对保持无需登录，公共列表继续使用本地缓存。配置了 GitHub 登录的云端服务要求登录后上传；旧客户端仍可凭未绑定的管理凭据撤回自己的旧方案。

## 数据与凭据

- GitHub 不变的用户 ID 用于识别账号；改 GitHub 用户名不会改变归属。
- Workers 临时保存设备授权流程，轮询间隔在服务端强制执行，取消或过期后不可继续登录。
- GitHub access token / refresh token 不保存到数据库，也不返回桌面程序。
- 社区登录会话有效期 30 天，D1 只保存凭据哈希；退出登录撤销该会话。
- 桌面登录凭据只在主进程内使用。Windows 使用 Electron `safeStorage` 的系统加密保存，不进入页面、本地布局或公共缓存。系统加密或磁盘不可用时，只保留当前进程内会话。
- 退出时本机凭据立即清除。离线退出无法即时撤销远端会话，但原会话会自动过期。

## 部署

1. 在服务维护者的 GitHub 账号注册 OAuth App，启用 Device Flow，保留短期 GitHub access token 设置。不生成或分发 Client Secret。
2. 主页使用 Worker 地址。GitHub 要求的 Redirect URI 可以填 `https://<Worker域名>/v1/auth/github/callback`；本方案使用设备授权，不调用此回调。
3. 在 `cloudflare/soul-community/wrangler.jsonc` 的 `vars.GITHUB_CLIENT_ID` 填入公开 Client ID。
4. 应用 `0003_github_accounts.sql` 数据库迁移，再部署 Worker。应用注册和用户登录授权由账号持有人确认。

官方依据：[GitHub OAuth 设备授权](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)、[OAuth 权限范围](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)。

`desktop/tests/soul-community.test.cjs` 验证真实 SQLite 中的迁移、账号归属、跨设备管理、取消、过期、轮询并发、退出撤销、加密存储和主进程凭据隔离。上线验证需使用真实 GitHub 应用和用户授权完成。
