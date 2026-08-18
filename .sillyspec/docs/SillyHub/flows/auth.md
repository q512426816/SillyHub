---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# 鉴权与会话流程

## 目标
为浏览器、daemon 与外部调用方提供认证（JWT 会话 + API Key 双路径为主，另有 shpsync_ / shmcp_ 两条专用 token 轨），登录防爆破（限流 + 滑块验证码），并基于 workspace 维度做 RBAC 权限校验。

## 参与模块
- auth：登录（IP 限流 + 滑块验证码）、JWT/refresh 签发轮换吊销、改密、ApiKeyService（`shk_live_` 前缀 API Key 生命周期）、rbac 权限聚合、启动 seed（bootstrap 管理员 + RBAC 种子）
- core：core.security（HS256 JWT / bcrypt / refresh token 仅哈希存储）、core.auth_deps（get_current_principal 双路径依赖 + require_permission 装配）、core.permission_cache（Redis 缓存 + 熔断降级）
- admin：用户/角色/组织运维管理
- daemon：WS 升级期鉴权（4001/4003 语义）与 llm-proxy 转发前校验 daemon apiKey 归属
- platform_sync：`shpsync_` workspace 级同步 token 的第三条鉴权轨（CLI 进度回传唯一写通道）
- mcp_gateway：`shmcp_` McpToken（挂 `/mcp` 子应用，与 /api 鉴权通道物理隔离）
- workspace：UserWorkspaceRole 工作区角色绑定
- frontend_app / frontend_lib / frontend_stores：(auth)/login 页、lib/auth.ts、stores/session.ts（zustand persist）

## 流程摘要

```text
=== 浏览器登录 ===
(frontend)  POST /api/auth/login {username, password}   ← 纯登录名，email 不再作账号
(backend)   同 IP 60s 窗口限流 → 累计失败达阈值强制滑块验证码
     │  未过验证码再错 → 423 need_captcha（前端弹「我不是机器人」）
     │  已过验证码密码错 → 401 AuthInvalidCredentials（统一文案，不泄露账号存在性）
     ▼
(backend)   成功 → _issue_token_pair(access+refresh) + 清失败计数（Redis，故障降级放行）
(frontend)  stores/session 持久化 token；apiFetch 注入 Authorization: Bearer
     ▼
(backend)   受保护端点 Depends(get_current_principal)
     ├─ Bearer JWT：decode_access_token → User
     └─ X-API-Key：ApiKeyService.authenticate
        （负缓存拒无效 key 探测 → 正缓存 user_id → DB 实时校验用户 active → bcrypt 放 to_thread）
     ▼
            require_permission(p) → rbac.has_permission(user, p, workspace_id?)
            ← core.permission_cache（Redis 缓存 + 熔断降级直查 DB）
            缺权限 → 403
     ▼
(frontend)  access 过期 → POST /auth/refresh
            （消费旧 refresh 轮换签新，grace 窗口防并发刷新竞态）
            refresh 失效 → 跳登录页

=== daemon 通道 ===
(daemon)    持 API Key（X-API-Key header）调 REST + 主动拨号 /api/daemon/ws
(backend)   WS 升级期鉴权：无/坏凭据 close 4001；解析 user 与 DaemonInstance.user_id
            归属不匹配 close 4003（query token 回退已删）
(daemon)    LLM 调用经 ANY /api/daemon/llm-proxy/{path}：
            校验 daemon apiKey 归属 → 注入 master key 转发 LiteLLM（master key 不出 hub 进程）

=== 专用 token 轨（与 JWT/APIKey 前缀分流，互不复用）===
 shpsync_（platform_sync）：SillySpec CLI / daemon 进度回传唯一写通道，绑 user + workspace
 shmcp_（mcp_gateway）：第三方 MCP client 连 /mcp/，scope ∈ read/dispatch/converge
 shk_live_（auth）：用户 API Key 前缀，daemon 与脚本长期凭证
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 密码错 | 401 统一文案；累计失败触发验证码（423） |
| Redis 故障 | 限流/验证码/权限缓存全部降级放行或直查 DB（可用性优先，勿改硬失败） |
| refresh 并发竞态 | grace 窗口内旧 token 仍可完成一次轮换 |
| api_key 吊销 | revoke 按 key_prefix SCAN 清正缓存，TTL 内即失效 |
| api_key 持有人被禁 | 正缓存命中后仍回 DB 实时校验 active，绝不放行 |
| WS 凭据坏/归属不符 | close 4001 / 4003，未升级旧 daemon 一律 4001 |
| 无凭据访问 platform_sync | 401；凭据有效但非 shpsync_ 走写通道 → 403（写通道仅接受 shpsync_） |
| bootstrap admin 缺失 | 启动 seed bootstrap_admin_and_seed_rbac（幂等，重启不重复建号） |
