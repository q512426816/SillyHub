---
author: qinyi
created_at: 2026-06-16T12:00:00
---

# Requirements — daemon-api-key

## 角色

| 角色 | 说明 |
|---|---|
| Platform Admin | 平台管理员，唯一可签发/吊销 API Key 的角色 |
| Daemon Process | 本地常驻进程，使用 API Key（或 access_token）向 backend 鉴权 |
| Browser User | 浏览器登录用户，使用 access_token（JWT）—— 本次变更不影响此角色 |

## 功能需求

### FR-01: Admin 签发 API Key

**Given** admin 已登录并通过 `get_current_user` 鉴权
**When** admin `POST /api/auth/api-keys` body=`{name: "my-daemon", expires_at: null}`
**Then** 响应 201，返回 `ApiKeyCreated`：含 `id`/`name`/`key_prefix`/`expires_at`/`created_at`/`plaintext`；DB 新增一行 `api_keys`（`key_hash=bcrypt(plaintext)`, `revoked_at=NULL`）

**Given** admin 已登录
**When** admin `POST /api/auth/api-keys` body=`{name: "", expires_at: null}`（name 为空）
**Then** 响应 422 校验错误

**Given** 非 admin 用户已登录
**When** `POST /api/auth/api-keys`
**Then** 响应 403

### FR-02: Admin 列出 API Keys

**Given** admin 已有 3 个 key（2 活跃 + 1 已吊销）
**When** admin `GET /api/auth/api-keys`
**Then** 响应 200，返回 3 行 `ApiKeyRead`（不含 `plaintext`），按 `created_at desc` 排序

**Given** 非 admin 用户已登录
**When** `GET /api/auth/api-keys`
**Then** 响应 403

### FR-03: Admin 吊销 API Key

**Given** admin 有一个活跃 key（id=K1）
**When** admin `DELETE /api/auth/api-keys/K1`
**Then** 响应 204；DB 中 K1 的 `revoked_at` 设为 now

**Given** admin 试图吊销他人（或不存在的）key id=K2
**When** `DELETE /api/auth/api-keys/K2`
**Then** 响应 404（不暴露存在性）

**Given** key K1 已被吊销
**When** 再次 `DELETE /api/auth/api-keys/K1`
**Then** 响应 404（幂等）

### FR-04: API Key 鉴权（X-API-Key header）

**Given** 存在一个活跃未过期的 key，plaintext=P
**When** 请求 `GET /api/auth/me` 带 header `X-API-Key: P`
**Then** 响应 200，返回 owner user 的 me 信息（与 Bearer JWT 路径行为一致）

**Given** plaintext=P 对应的 key 已被吊销
**When** 请求带 `X-API-Key: P`
**Then** 响应 401 `AuthTokenInvalid`（`API key is invalid, expired, or revoked.`）

**Given** plaintext=P 对应的 key 已过期（`expires_at < now`）
**When** 请求带 `X-API-Key: P`
**Then** 响应 401 `AuthTokenInvalid`

**Given** plaintext 不匹配任何 key
**When** 请求带 `X-API-Key: <random>`
**Then** 响应 401 `AuthTokenInvalid`

**Given** owner 用户已禁用（`status != 'active'` 或 `deleted_at != NULL`）
**When** 请求带 `X-API-Key: P`
**Then** 响应 401 `AuthTokenInvalid`（不返回 AuthUserInactive 暴露用户存在性）

### FR-05: 鉴权 dependency header 优先级

**Given** 请求同时带 `Authorization: Bearer <jwt>` 和 `X-API-Key: <plaintext>`
**When** 走 `get_current_principal`
**Then** 优先走 JWT 路径，X-API-Key 被忽略

**Given** 请求只带 `Authorization: Bearer <jwt>`
**When** 走 `get_current_principal`
**Then** 走 JWT 路径（行为与原 `get_current_user` 完全一致）

**Given** 请求只带 `X-API-Key: <plaintext>`
**When** 走 `get_current_principal`
**Then** 走 API Key 路径

**Given** 请求两个 header 都不带
**When** 走 `get_current_principal`
**Then** 响应 401 `AuthTokenMissing`（`Bearer token or API key is required.`）

### FR-06: API Key 持久化 last_used_at

**Given** key K1 plaintext=P，`last_used_at=NULL`
**When** 一次请求通过 P 鉴权成功
**Then** DB 中 K1 的 `last_used_at` 更新为 now（精确到秒）

### FR-07: daemon CLI --api-key 选项

**Given** daemon 配置中无 token 也无 api_key
**When** `sillyhub-daemon start --server X`
**Then** 输出错误 `Error: --token or --api-key is required.`，退出码 1

**Given** daemon 同时传 `--token T --api-key K`
**When** `sillyhub-daemon start`
**Then** 输出错误 `Error: --token and --api-key are mutually exclusive.`，退出码 1

**Given** daemon 只传 `--api-key K`
**When** `sillyhub-daemon start --server X --api-key K`
**Then** daemon 启动，HubClient 所有请求带 `X-API-Key: K` header（不带 Authorization）

**Given** daemon 只传 `--token T`
**When** `sillyhub-daemon start --server X --token T`
**Then** 行为与现状完全一致，HubClient 所有请求带 `Authorization: Bearer T`

### FR-08: daemon config.json 持久化 api_key

**Given** daemon 用 `--api-key K` 启动
**When** 启动流程读 / 写 config.json
**Then** config.json 持久化 `api_key: K`，下次启动可作为默认值

### FR-09: 前端 API Keys 管理页

**Given** admin 登录后访问 `/settings/api-keys`
**When** 页面加载
**Then** 显示当前 admin 的所有 key 列表（name/key_prefix/created/last_used/expires/status/吊销按钮），活跃/已吊销状态视觉区分

**Given** admin 点击「+ 签发 API Key」
**When** 弹窗输入 name + 选择过期 → 提交
**Then** 弹窗进入"plaintext 单次显示"阶段，显示完整 plaintext + 复制按钮 + 警告"关闭后不再显示"

**Given** admin 在 plaintext 显示阶段关闭弹窗
**When** 重新打开列表
**Then** 该 key 的 plaintext 不再可见，仅显示 `key_prefix`

**Given** admin 点击某 key 的「吊销」按钮
**When** 二次确认后
**Then** 调用 DELETE 端点，列表刷新，状态变为「已吊销」

### FR-10: runtimes 页面启动命令优先用 API Key

**Given** admin 有至少一个活跃 key
**When** admin 在 `/runtimes` 页面看启动命令
**Then** 命令形如 `sillyhub-daemon start --server <url> --api-key <latest_active_key>`

**Given** admin 没有任何活跃 key
**When** 在 `/runtimes` 页面看启动命令
**Then** fallback 到 `sillyhub-daemon start --server <url> --token <access_token>`（保持现状）

## 非功能需求

- **兼容性**：现有 access_token 流水完全不变；未签发 API Key 时所有 daemon 行为与现状一致；现有所有 backend/daemon 测试零回归
- **可回退**：admin 吊销所有 key + daemon 改回 `--token` 即可完全回滚到变更前状态
- **安全性**：plaintext 仅创建时返回一次；DB 仅存 bcrypt hash；吊销立即生效（下次请求即 401）；secret 前缀 `shk_live_` 便于 GitHub secret scanning 自定义规则
- **可测试**：每个 FR 有对应单元/集成测试（service/router/dependency/CLI/HubClient 五层覆盖）
- **性能**：V1 规模 <1k key 时 O(n) 鉴权扫描可接受（与现有 refresh_token 同模式）；将来加 prefix 索引可平滑升级
- **可观测**：每次 API Key 鉴权成功更新 `last_used_at`；admin 可在 UI 看到 key 最近使用时间，发现异常可立即吊销
- **审计**：`api_keys` 表的 create/revoke 通过现有 `core/audit_hooks.py` 自动写入 AuditLog（继承 BaseModel 自动捕获）
