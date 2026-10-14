# 私有主代理 Worker：独立鉴权与兼容性验收合同

> 2026-10-14，**待实现/待复测**，不是当前代理已经安全对外开放的证明。
> 作用范围：`worker/index.js` 主代理；与 `worker/amsg/src/index.ts` 的 AMSG_SERVER_TOKEN 是不同服务、不同密钥，绝不能共用。

## 当前发现（禁止误解）

- 主代理目前以 `PROXY_ALLOWED_ORIGINS` 比对浏览器的 Origin，并对允许来源返回 CORS 头。
- **这不是身份验证**。任意非浏览器程序可以手工指定 Origin，甚至省略 Origin；因此在拥有公网 Worker URL 的前提下，仍可能直接触发未受个人身份验证保护的搜索/抓取/第三方调用。
- 原有 `/cf-api` 高权限管理中转已关闭，XHS 公共 Worker Cookie 回退也已关闭，网址重定向边界已有加固；这些措施降低风险但不能替代代理身份验证。
- 当前阶段不要把主代理当作已经隔绝陌生服务端请求的私人接口。

## 待实施的设计（先核查所有调用方再合并）

1. 给主代理 Worker 增加独立、高熵、强制配置的 `PROXY_SERVER_TOKEN` Cloudflare Secret。业务路由必须校验 `X-Proxy-Token`；无/错误 Token 拒绝。非敏感 CORS OPTIONS 和 /api/health 可保留受控预检/探活，但不可因此转发业务。
2. 设置页面新增主代理访问密码输入框；放在用户自己控制的本地设置，不写进 GitHub、前端 Vite 构建变量、公共 Worker 源码、URL 查询参数或日志。不要把密钥发送给第三方服务。
3. 所有从网页向主代理发起的请求（搜索、网页抓取、XHS Lite、GitHub、WebDAV、Notion、飞书、网易云、McD/Luckin MCP 等）必须走明确的授权头封装，不能仅改主代理 Worker 而使现有功能全部 401。**先盘点哪些请求是主代理、哪些是直达第三方或用户本地服务**，不许盲目把 Token 附到任何 URL。
4. AMSG Worker 到点调用同一主代理时，应从 **AMSG Worker 自己的 Cloudflare Secret** 获取独立凭据，再只发给精确配置的主代理地址；不要为了省事把主代理密码塞进 `amsg:global/tool_config` 云端小背包或发给模型。
5. CORS 的 `Access-Control-Allow-Headers` 明确纳入 `X-Proxy-Token`；拒绝不在 `PROXY_ALLOWED_ORIGINS` 中的浏览器 Origin。无 Origin 不能绕过 Token。未来可加限速/配额以防已泄露 Token 被滥用。
6. 安全测试覆盖：Origin 正确但 Token 缺失、Origin 伪造但 Token 缺失、无 Origin 无 Token、Token 错误、Token 正确、CORS 预检、MCP/AMSG 服务器端工具调用、携带第三方账号凭据的 URL 重定向、防密钥落日志。隔离假账号实际回归测试通过之前，不部署真实凭据。

## 另一个独立上线门槛：AMSG 旧工具凭据清理

- `tool_config` 的新包仅包含当前开启的第三方功能密钥；Worker 解析旧包时也会去掉关闭功能的旧字段。
- 升级后的首次前端启动有一笔 **按 Worker + 用户归属的隐私迁移补传**；成功确认云端接收后才在本地标记完成。条件写跳过、局部拒绝或网络错误都不能视为清理成功；旧上传在飞时，新配置要接着传。
- 这意味着**最新生效行会尝试被干净版本覆盖**，但**不等于曾经上传过的明文/密文旧行、数据快照、备份和分块一定已物理删除**。待在假数据 Cloudflare 环境做 D1 行/分块/备份检查，云端数据管理的清理/凭据撤销另行验收。
- 角色卡、世界书、长期记忆和用户对话上下文不为此裁剪；只处理不必要的第三方工具凭据。

**当前状态：** 初版主代理独立 Token 链路尚未施工；AMSG 凭据迁移及回归测试已写进 `hardening-v1`，但尚未在完整项目真实运行。全部通过前，仍仅可用假数据做功能性试运行。
