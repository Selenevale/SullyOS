# 私有主代理 Worker：独立鉴权和回归验收合同

> 2026-10-14：Token 全链路**源码已施工，但新 HEAD 尚未 Work/Vitest/tsc/build 实测，Cloudflare 未部署**。不能把这份文件当作公网可安全使用的证明。
> `PROXY_SERVER_TOKEN` 是主代理专用 Bearer；绝不能与 `AMSG_SERVER_TOKEN`、第三方 API Key 或 Cloudflare 高权限管理 Token 混用。

## 认证链路与部署变量

- 主代理 `worker/index.js` 要求非空且至少 32 个字符的 Cloudflare Secret `PROXY_SERVER_TOKEN`。业务请求用 `X-Proxy-Token` 送同一密钥；缺 Secret 返回 503，缺/错误 Token 返回 401，不在 `PROXY_ALLOWED_ORIGINS` 精确名单内的浏览器来源返回 403。浏览器 OPTIONS 预检、GET `/api/health` 不要求业务 Token，已删除的 `/cf-api` 始终不可代理。
- 网页只在「设置 → 自定义网络代理」输入本机访问密钥（保存于该网页来源的 localStorage），不会进 `tool_config`、Vite 构建常量、URL 或日志。换 Worker 地址自动撤销本机旧 Token；网页环境无法提供 HttpOnly 的 XSS 隔离，任何执行于同源的恶意脚本仍可能读到它。
- `utils/proxyWorker.ts` 的 `proxyWorkerAuthHeadersFor(targetUrl)` 只在目标 URL 属于当前精确的主 Worker origin 时添加 `X-Proxy-Token`。其他 HTTPS 域名、攻击者子域、用户自行设置的其他 MCP/音乐服务以及非本地 HTTP 地址都不能拿到 Token。仅本地 localhost/127.0.0.1 HTTP 允许开发。
- 搜索/新闻、Notion/飞书、WebDAV/GitHub 的 fetch 及 XHR、麦当劳/瑞幸 MCP、网易云音乐（仅走相同主 Worker 时）、小红书 Lite（仅相同主 Worker 时）、网页展开/抓取都需要用这层来源限定，不直接往任意 `fetch` 加 Token。
- **AMSG Worker 需要单独配置 `PROXY_WORKER_ORIGIN`（Text，准确的自建主 Worker origin）与 `PROXY_SERVER_TOKEN`（Cloudflare Secret，值与主 Worker 相同）。** AMSG 从绑定读 Token，绝不从 D1 `amsg:global/tool_config` 读；云端配置提供的 `proxyWorkerUrl` 若与可信 origin 不相同，主动工具请求必须 fail-closed 到 `https://proxy.invalid`，不能向任意远端传输 Token 或第三方工具凭据。未配这两项时 AMSG 云端搜索/Notion/飞书不可用；不应影响无需主代理的普通消息投递。

## 重定向与密钥传播边界

- 主代理向第三方请求必须只转发该业务需要的上游凭据，不能传 `X-Proxy-Token`。带 Token 的浏览器 fetch 和 XHR 不能收到可自动跟随的上游 3xx：主 Worker 将业务 3xx 统一转换为无 `Location` 的 502。此行为可能让原来依赖 302 的 GitHub/WebDAV 备份下载失败；只能在后续按可信下载目标白名单设计不带 Token 的受控二次取回，不能直接放开跳转。
- CORS 只能限制网页跨域读取，不能防 curl 伪造 Origin。真正认证是每请求 Token；后续仍需流控/配额、轮换与泄漏撤销策略。

## 上线前阻塞验收

- `worker/proxyTokenAuth.test.ts`：未配置/短 Token 503，缺/错误 Token 401，伪造或无 Origin 仍不得越过 Token，正确 Token 转发搜索但不泄密，允许 CORS OPTIONS、非敏感 health、拒绝恶意浏览器来源；上游 302 不让浏览器继续跳转。
- `utils/proxyWorker.test.ts`：浏览器本机密钥限来源、切换地址清除旧密钥、AMSG 运行时 Secret 优先、旧版/恶意/不匹配地址不得拿 Token。
- 回归 GitHub/WebDAV 二进制 XHR 上传、网易云独立地址、XHS Lite 健康探测、McD/Luckin MCP，以及 AMSG Worker 到点使用 Search/Notion/飞书且不泄露 Cloudflare Secret；假数据网络断开/恢复时错误状态应准确。
- Work 必须以**新 HEAD 完整 Git tree** 重跑 targeted Vitest、默认全量 `pnpm run test:run`、`pnpm run test:private-artifact`、`pnpm run build` 与 TypeScript 对照（原版 656 条历史诊断不是全绿）；不能继承旧提交的 7,586 项成功结果。
- Cloudflare 尚未部署；真实 D1 `tool_config` 有效行/备份/分块的物理清理、Token 撤销/轮换、跨设备数据恢复需继续在完全隔离的假数据环境验证。**完成上述步骤前不上传真实角色资料或私密第三方账户令牌。**
