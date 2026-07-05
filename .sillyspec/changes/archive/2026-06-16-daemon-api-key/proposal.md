---
author: qinyi
created_at: 2026-06-16T12:00:00
---

# Proposal — daemon-api-key

## 动机

daemon 长期运行，但目前唯一可用的鉴权凭证是登录后的 access_token（JWT，TTL=15 分钟）。token 一过期，daemon 所有 `/api/daemon/*` 调用返回 401，runtime 在 UI 上立即变为 offline。结果是：daemon 每隔 15 分钟掉线一次，用户必须手动重启 daemon（再次从 web 拷新 access_token）。这违背了 daemon "长期常驻"的设计目标，严重影响 quick chat / agent run 等所有依赖在线 daemon 的功能。

## 关键问题

**痛点 1：daemon 不存在长期凭证机制**
- 现有 `/api/auth/login` 只签发短 TTL access_token（15 min）+ refresh_token
- daemon 不应依赖浏览器 refresh 流程（refresh token 也是有限的、且会被 reuse 检测吊销）
- 平台没有任何 "service credential" / "API key" 概念，daemon 无法拿到一个真正"长期"的凭证

**痛点 2：daemon 掉线后用户体验断裂**
- 用户刷新 `/runtimes` 看到所有 runtime offline
- workspace 详情页"默认 Agent"下拉为空（在线 provider 列表为空）
- 用户不知道是 daemon 挂了还是 token 过期了——日志里全是 `HTTP_401_AUTH_TOKEN_EXPIRED`

**痛点 3：管理员无法对 daemon 凭证做生命周期管理**
- 无法签发新 key 给新机器
- 无法吊销已泄漏的 key
- 无法看到"哪些 daemon 用着哪个 key"

## 变更范围

为 daemon 引入 **API Key 长期凭证机制**：

1. **后端**：新增 `api_keys` 表 + `ApiKeyService` + `/api/auth/api-keys` CRUD 端点 + `get_current_principal` dependency（同时支持 JWT 和 X-API-Key）
2. **daemon 端点切换**：`/api/daemon/*`、`/api/agent-runs/*`、`/api/workspaces/*/spec-bootstrap` 切到新 dependency
3. **daemon CLI**：`start` 新增 `--api-key`，与 `--token` 互斥；HubClient 按 header 类型发送凭证
4. **前端**：新页 `/settings/api-keys`（签发/列表/吊销）；`/runtimes` 页面启动命令默认用 `--api-key`

## 不在范围内（显式清单）

- ❌ API Key 独立 scope / RBAC（V1 继承 owner 权限）
- ❌ Key rotate 端点（吊销 + 重建替代）
- ❌ IP 白名单 / UA 限制 / 调用频率限制
- ❌ Key 调用统计详情（仅 `last_used_at` 时间戳）
- ❌ JWT 黑名单 / refresh token 自动续期（与本变更解耦）
- ❌ 多用户多组织场景（V1 仅 platform admin 个人签发）
- ❌ Non-admin 用户签发 key（V1 仅 admin）
- ❌ Key prefix O(1) 索引优化（V1 O(n) 扫描可接受，规模上来再加）
- ❌ last_used_at 写入节流（V1 每次更新）

## 成功标准（可验证）

1. **未配 API Key 时行为完全不变**：现有 daemon 用 `--token <access_token>` 启动，所有现有端点（`/api/daemon/register`、`/api/daemon/heartbeat`、`/api/daemon/ws`、`/api/agent-runs/*`）行为 100% 保持，所有现有测试通过
2. **API Key 创建**：admin 通过 `POST /api/auth/api-keys` 创建 key，响应一次性返回 plaintext；后续 `GET /api/auth/api-keys` 不再返回 plaintext
3. **API Key 鉴权**：daemon 用 `--api-key <plaintext>` 启动，`X-API-Key` header 能通过所有切换后的端点鉴权，runtime 在 UI 上保持 online
4. **API Key 永不过期**（除非显式设 `expires_at`）：admin 签发的默认永不过期 key，daemon 重启多次后仍能注册成功
5. **API Key 可吊销**：admin `DELETE /api/auth/api-keys/{id}` 后，daemon 下次请求立即 401，UI 上 runtime 变 offline
6. **CLI 互斥校验**：daemon 同时传 `--token` 和 `--api-key` 时报错并退出
7. **前端可用**：`/settings/api-keys` 页面能签发、列出、吊销 key；`/runtimes` 页面 `CopyDaemonCommand` 默认输出带 `--api-key` 的命令
8. **回归零**：所有现有 backend/daemon 测试通过；新增测试覆盖 service / router / dependency / CLI / HubClient 五层
