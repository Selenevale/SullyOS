# 私有版 SullyOS · Cloudflare 试玩版部署前清单

> 对象：`Selenevale/SullyOS` 的 **`hardening-v1`** 分支。记录于 2026-10-13，最近更新 2026-10-14。
> 这是一张**部署前验收清单**，不是 Cloudflare 部署成功证明。Work 隔离环境已针对固定提交 `ba366a7` 运行：锁定依赖、完整构建、AMSG 双成品安全检查均通过；Vitest 使用 `--maxWorkers=2 --minWorkers=1` 时 7,575 通过、0 失败、1 跳过，而未限制并发的完整运行有 3 项偶发失败。原版遗留 656 条 TypeScript 诊断，与冻结 `master` 完全一致，仍导致 `tsc --noEmit` 退出失败。**本分支后续提交（包括新的默认 Vitest 并发配置）尚须重新实测；尚无真实 Cloudflare 部署或端到端验收。**
> 不要照上游的“一键部署/自动更新 Cloudflare Token/Sync fork”教程来配置私有版。

## 先确认来源与隔离

- [ ] 始终从我们审过的 `hardening-v1` 分支工作。冻结分支 `baseline-candidate-2026-10-11` 和 `master` 保持不动。
- [ ] 在上传任何真实角色卡、聊天记录、私人世界书前，先用假数据完成所有测试。
- [ ] GitHub Actions 当前关闭。不要在未复核权限前开启；如果之后连接 Cloudflare Pages 的 Git 集成，也要注意它**可以独立于 GitHub Actions 自动部署**。
- [ ] Cloudflare 上分别创建 Pages 网页、**主代理 Worker**、**AMSG 主动消息 Worker**、D1 数据库；它们不是同一个 Worker。

## 本地构建与测试（必须实际运行）

- [ ] 使用锁定版本安装依赖（项目根目录 `pnpm install --frozen-lockfile`），记录所用 Node/pnpm 版本。
- [ ] 可先执行无需项目依赖的 `node --test scripts/verify-private-amsg-bundle.test.mjs`（也可运行 `pnpm run test:private-artifact`）检查安全产物验证器本身；**这不能取代**全项目测试。
- [ ] `scripts/build-workers.mjs` 现在会自动对 **两个** AMSG 构建产物做 fail-closed 保护校验：缺少 AMSG_ALLOWED_ORIGIN / API 令牌验证 / 禁止自更新等代码就会让构建报错。禁止通过跳过此步骤部署仓库已跟踪的旧 `worker/amsg/worker.bundle.js`。
- [ ] 当前默认 Vitest 配置已限制为 `maxWorkers: 2, minWorkers: 1`，依据 Work 上通过的等效 CLI 设置；避免十万条 IndexedDB 测试与美化投稿的异步测试在并行运行时抢占过多资源。改变 worker 数或测试硬件时仍要重新全量复测；**未删掉压力数据，也未放宽测试超时**。
- [ ] 执行 `pnpm run test:run`，尤其核查 `worker/proxyHardening.test.ts`、`worker/proxyNetworkBoundary.test.ts`、`worker/proxyCredentialBoundary.test.ts`、`worker/amsg/src/index.test.ts`、`utils/amsgToolPack.test.ts`、`utils/activeMsgSettingsModal.test.ts`。
- [ ] 执行 `pnpm exec tsc --noEmit` 并留存错误与冻结 master 对比；截至 `ba366a7` 的实测 656 条为上游历史类型诊断，**并不等于 tsc 通过**。上线验收必须明确决定如何处理既有诊断，任何新增诊断应作为回归阻塞。
- [ ] 运行 `pnpm run build` 并检查 `dist/`，不能复用旧 bundle。
- [ ] **特别注意旧 Worker bundle**：源码 `worker/amsg/src/index.ts` 和 `worker/amsg/worker.bundle.js` 是两个文件。提交源码不会自动重打包已经跟踪的 `worker.bundle.js`。必须先运行 `pnpm run build:workers`（`pnpm run build` 也会运行），确认重新生成的 `worker/amsg/worker.bundle.js` 及 `public/amsg-worker.bundle.js` 确实包含私有版的访问控制，再发布。**严禁直接上传仓库中未重新构建的旧 bundle。**

## 网页：Cloudflare Pages

- [ ] 使用本分支构建发布 `dist`；首次发布后记下准确的正式来源 `https://<your-project>.pages.dev`（不带路径和尾部斜线）。
- [ ] 先在普通浏览器打开空白/假数据测试站，验证页面、IndexedDB、3D 家园基本操作。
- [ ] `VITE_UMAMI_SCRIPT_URL` 与 `VITE_UMAMI_WEBSITE_ID` 不设置（第一版不启用分析）；Supabase 远程向量和云端即时聊天也先保持关闭。
- [ ] 如启用 Pages Git 集成，确认 **preview 域名不会自动被纳入 AMSG 允许列表**，避免误用“预览地址在生产上传私人数据”。

## 主代理 Worker（联网搜索 / 网页 / WebDAV / 第三方代理）

- [ ] 部署 `worker/index.js` 的私有源码，而非作者公共代理。
- [ ] 设置 `PROXY_ALLOWED_ORIGINS` 为**自己 Pages 的精确 origin**（主代理可用英文逗号分隔多条），没有正确设置就拒绝陌生浏览器。
- [ ] 有 WebDAV 需求时才设置 `PROXY_WEBDAV_ALLOWED_HOSTS`（英文逗号分隔精确 hostname；默认不开放）。确认 WebDAV 正常登录/备份与跨站重定向处理。
- [ ] `PROXY_ENABLE_JINA_READER` 默认不设置；启用意味着分享抓取网址给第三方 Jina。
- [ ] 不部署任何 `/cf-api` 管理权限中转，不要给公开网站或主代理提供 Cloudflare 高权限 Token。
- [ ] 用假账号/假 API key 测试允许来源、陌生来源、无 Origin、IP/内网网址、网页重定向、GitHub 和 XHS 请求跳转。CORS 不等于 API 鉴权；主代理无 Origin/被伪造 Origin 的滥用保护仍是上线阻塞项。
- [ ] **上线阻塞（待开发）**：按 [主代理独立鉴权合同](./private-proxy-auth-contract.md) 给业务请求增加真正的访问 Token，同时补齐网页及 AMSG 工具的授权头；仅依赖 Origin/CORS 不足以保护私人代理。

## AMSG Worker（角色离线主动消息）

- [ ] 创建并绑定 D1 数据库，绑定名必须为 `DB`；保持 `worker/amsg/wrangler.toml` 中的 DO `INSTANT_TICK`、每分钟 Cron Trigger 与需要的配置一致。
- [ ] `AMSG_MASTER_KEY`：设置成 Cloudflare **Secret**，保存可靠的离线备份，**以后不能随意更换**（否则已加密的任务可能无法解开）。
- [ ] `AMSG_SERVER_TOKEN`：设置为高强度、专用于 AMSG 的随机 **Secret**；在糯米机的「主动消息 2.0 → 专用访问密码」输入同一值。勿提交到 GitHub、聊天记录或打包成前端常量。
- [ ] `AMSG_ALLOWED_ORIGIN`：填唯一的正式 Pages origin，例如 `https://<your-project>.pages.dev`；不是 Worker 地址、不是 `*`、不是带路径的 URL。需要本地开发 `http://localhost` 时使用隔离的开发环境。
- [ ] 如要浏览器/PWA 通知，准备 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_EMAIL`，与糯米机推送设置里的密钥对一致，私钥放 Secret。
- [ ] **绝不配置 `CF_API_TOKEN`** 给 AMSG；私有版 `/self-update` 和 `/self-update/check` 已关闭。升级必须审核代码、重新构建 bundle、人工发布、再「重新连接并验证」。
- [ ] 验证 `/config-check` 只回配没配；缺 Token 时实际业务路由 503，Token 错误 401，陌生网页 Origin 403、且没有允许 CORS 头；正确的 Pages origin + Token 可以连接。
- [ ] 验证浏览器预检包含 `Content-Encoding`（长聊天 gzip 上传），成功的推送订阅和任务实际到点执行；确认锁屏通知、补收件箱、失败重试各有正确行为。
- [ ] 云端 `tool_config` 中关闭了的天气/新闻/Notion/飞书/XHS 工具不再带旧凭据；同时核查**之前已同步的旧版本数据是否已经被成功覆盖/清理**，不能只看本地新包。
- [ ] 新的私有版在同步 `tool_config` 后，会用已鉴权连接读回 `amsg:global/tool_config` 并逐字核对本次写入值；成功标志但值未变、读回失败、条件写冲突、重复键时都**不销掉本地待重试记录**。用假 Notion/XHS 密钥测试：开 → 关 → 云端重新读回确认相关字段消失；网络断开/恢复也应重复验证。
- [ ] **断网期间不能立即撤销服务器已持有的密钥**：云端任务有可能继续使用旧配置。若发生真实密钥泄漏或需要立刻停止调用，先在第三方服务撤销该密钥／暂停云端任务，联网后再重同步并确认 D1 数据；不要把本地开关当作即时远程擦除。
- [ ] 云端全局配置仍会包含当前**开启**工具的必需凭据，这不是端到端不可解密保存；Worker 执行工具时需要读取它们。首次上传真实凭据前请确认自己接受这一架构。
- [ ] 升级版会在已配置的 Worker 上为 `tool_config` 触发首次隐私补传；局部拒绝、条件跳过、网络失败必须留待重试，随后用假钥匙验证前后云端 **有效行**。确认历史 D1 行/分块/备份清理范围，并撤销不应继续有效的第三方旧凭据。此链路源码已写好，**尚未真实部署实测**。
- [ ] 使用假数据走一遍云端资源清点、删除与删除结果核验；不同设备、角色删除、关闭主动消息、网络断开时的失败恢复都要覆盖。

## 上线决定与回滚

- [ ] 记录测试报告、Cloudflare 部署标识、构建产物 hash、网页/Worker 版本，保留不含秘密的日志。
- [ ] 备份浏览器 IndexedDB、云端 D1（注意备份本身可能包含敏感信息），并验证恢复流程；避免因数据结构升级直接回退旧前端造成不兼容。
- [ ] 如果出现非预期数据上传、凭据泄漏或无法正常退订推送，先暂停业务/撤销相关密钥，排除泄露后再恢复；不要自动覆盖后端或盲目 Sync fork。
- [ ] 只有完整测试通过、没有未处理的高风险阻塞项且用户实际验收后，才开始迁入真正的角色资料。

**未来方向**：若决定改成 Mac Host + Tailscale 全栈自托管，届时另建集中数据库，复用正常聊天的完整上下文和记忆链路，Cloudflare 的 AMSG 小背包不再是目标方案。现在先做 Cloudflare 试玩版，不做两套大脑混合模式。
