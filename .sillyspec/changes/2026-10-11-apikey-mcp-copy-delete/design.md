---
author: flow-machine-draft
created_at: 2026-10-11T07:00:52.199Z
---
# 设计记录（Design Record）— 2026-10-11-apikey-mcp-copy-delete

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

核心矛盾：API key 存 bcrypt、MCP token 存 sha256，均为单向哈希，明文「只此一次」——这是
现有产品文档反复声明的安全契约（R-06 / api_key_schema.py docstring）。用户需求要求列表可
复制已生成凭据、命令可直接携带密钥，即放弃「一次性明文」模型。方案是**保留原哈希鉴权路径
完全不动**，新增一列可逆加密存储（libsodium secretbox，复用 `app/core/crypto.py` 的
`CredentialCipher` 与 `SILLYSPEC_MASTER_KEY` KEK），存储格式与 mcp_webhooks.secret 既有
惯例同构：`{key_id}:{hex(ciphertext)}`。这样鉴权面零改动（bcrypt O(n) 扫描 / sha256 O(1)
查表 / Redis 缓存全部原样），只在「管理面」多一条可逆通道。

配套：按 id 取明文的 GET 端点（仅活跃记录）、DELETE 端点加 `hard=true` 查询参数做物理删除
（仅已吊销记录放行）、列表 DTO 加 `plaintext_recoverable` 布尔。前端三个页面（runtimes /
settings/api-keys / workspaces/[id]/mcp-tokens）接新端点。runtimes 页复制时走「有活跃 key
→ 取明文；无 → 自动创建永不过期 key」的解析函数，明文只进剪贴板、渲染面保持 prefix 打码。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

后端新增/变更（均挂既有权限门，OpenAPI 随 `pnpm gen:types` 再生成）：

1. `GET /api/auth/api-keys/{id}/plaintext`（新）→ `{"plaintext": "shk_live_..."}`。
   权限 `API_KEY_ADMIN` 且属于当前用户；不存在/已吊销/已过期 → 404（沿用 `ApiKeyNotFound`）；
   存量无加密列 → 409（新 `ApiKeyPlaintextUnavailable`，中文 detail 引导新建）。
2. `GET /api/workspaces/{wid}/mcp-tokens/{tid}/plaintext`（新）→ `{"token": "shmcp_..."}`。
   权限 `WORKSPACE_WRITE`；不存在/已吊销/跨 workspace → 404（沿用 `McpTokenNotFound`）；
   存量无加密列 → 409。
3. `DELETE /api/auth/api-keys/{id}?hard=true`（变）：hard 且已吊销 → 物理删行 204；
   hard 且未吊销 → 409（中文 detail「请先吊销再删除」）；无 hard 参数 → 原吊销语义逐字不变。
4. `DELETE /api/workspaces/{wid}/mcp-tokens/{tid}?hard=true`（变）：同上；删行时其
   mcp_webhooks 子行随外键 `ondelete=CASCADE` 一并移除。
5. DTO：`ApiKeyRead` / `McpTokenRead` 增 `plaintext_recoverable: bool`（加密列非空）。
   `ApiKeyCreated` / `McpTokenCreated` 响应形态不变（明文字段仍在，语义从「此后不可恢复」
   改为「列表可再取」，对应 docstring 同步修正）。
6. 数据模型：`api_keys` 加列 `encrypted_key TEXT NULL`；`mcp_tokens` 加列
   `encrypted_token TEXT NULL`。单个 alembic 迁移（20261011160000）完成两列。
7. 前端 `frontend/src/lib/api-keys.ts` / `mcp-tokens.ts`：新增 `fetchApiKeyPlaintext` /
   `deleteApiKey` / `fetchMcpTokenPlaintext` / `deleteMcpToken` 与
   `resolveDaemonApiKey`（无活跃 key 时自动创建 `expires_at=null` 的 key）。
8. daemon 侧：无改动（`--api-key` 消费方式不变）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   明文列与哈希列在同一 `create` 事务内写入，不存在半行状态；复制命令是即时请求-响应，
   无乱序面。硬删除与吊销的先后顺序由 409 门保证（未吊销拒绝删除），即使用户先点删除后点
   吊销，重试即成功，无乱序损坏。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   物理删除的 DELETE 带 `revoked_at IS NOT NULL` 条件（`hard_delete` 先读行校验再删），
   与并发 revoke 的 `revoked_at IS NULL` 条件互斥；plaintext 读取与并发 revoke 之间最多
   读到一条刚被吊销的 key（读时校验 revoked_at，窗口毫秒级，且吊销后 60s 正缓存已由现有
   revoke 清缓存逻辑保证失效）。hard_delete 后防御性按前缀/token_hash 再清一次正缓存。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   KEK 轮换（key_id 变更）后旧密文 `CipherKeyMismatch`——明文端点捕获转 409（提示重新
   签发），不 500；master key 缺失时 create 跳过加密列（置 NULL）而非 503，保证未配置
   KEK 的部署创建链路不回归（有测试覆盖该降级分支）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   plaintext 端点复用各自现有权限门与归属校验（api-key 按 user_id + `API_KEY_ADMIN`、
   mcp-token 按 workspace_id + `require_permission` 路径注入），无跨用户/跨工作区串面
   （mcp 侧有跨 workspace 404 用例）；自动创建 key 走现有 POST 端点（同权限门），不引入
   旁路。Redis 缓存 namespace（`auth:apikey:*` / `auth:mcptoken:*`）维持独立。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**可逆存储是安全降级**——DB 全量泄露 + KEK 同时泄露时凭据直接暴露（原 bcrypt
方案下不可能）。接受理由：内部平台、用户明确要求列表可复制；缓解措施是密文落库（DB 备份/
日志拖库单独不构成泄露）+ KEK 走环境变量与 DB 分离，与 mcp_webhooks.secret 既有风险面
持平。

试过放弃的方案：(a) 明文直接入库——放弃，密文列成本极低而拖库面显著恶化；(b) 每次「复制」
都新建 key（保持 hash-only 模型）——放弃，key 会随复制次数无限堆积，且「列表复制已生成
凭据」的需求语义不符；(c) 单独 `POST .../purge` 端点——放弃，`?hard=true` 查询参数复用
既有 DELETE 路由与权限门，改动面更小。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | backend/app/modules/auth/model.py | ApiKey 加 `encrypted_key` 列 + `plaintext_recoverable` property |
| 改 | backend/app/modules/auth/api_key_schema.py | ApiKeyRead 加 `plaintext_recoverable`；新增 ApiKeyPlaintextResponse |
| 改 | backend/app/modules/auth/api_key_service.py | create 落加密列；新增 `get_plaintext` / `hard_delete` 与 409 错误类 |
| 改 | backend/app/modules/auth/router.py | plaintext GET 端点；DELETE 支持 `hard` 参数 |
| 改 | backend/app/modules/mcp_gateway/model.py | McpTokenORM 加 `encrypted_token` 列 + property |
| 改 | backend/app/modules/mcp_gateway/service.py | create 落加密列；`get_plaintext` / `hard_delete` 与 409 错误类 |
| 改 | backend/app/modules/mcp_gateway/router.py | plaintext GET 端点；DELETE 支持 `hard` 参数 |
| 增 | backend/migrations/versions/20261011160000_add_credential_plaintext_columns.py | 两表各加一可空 TEXT 列 |
| 改 | frontend/src/lib/api-keys.ts | plaintext/hard-delete 封装 + `resolveDaemonApiKey`（自动创建永不过期） |
| 改 | frontend/src/lib/mcp-tokens.ts | plaintext/hard-delete 封装 |
| 改 | frontend/src/app/(dashboard)/runtimes/page.tsx | CopyDaemonCommand 复制时解析真实凭据（渲染打码） |
| 改 | frontend/src/app/(dashboard)/settings/api-keys/page.tsx | 复制密钥 + 删除按钮 + 禁用降级 |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx | 复制令牌 + 删除按钮 |
| 改 | frontend/src/components/api-key-create-dialog.tsx | 明文展示文案按 plaintext_recoverable 动态 |
| 改 | frontend/src/lib/api-types.ts + backend/openapi.json | gen:types 再生成 |
| 改 | backend/tests/modules/auth/test_api_key_service.py 等 3 件 | 新端点/新列用例 |
| 增 | frontend/src/lib/__tests__/api-keys.test.ts | resolveDaemonApiKey 分支（7 用例） |
| 增 | frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx | 复制/删除/降级 UI（5 用例） |
| 增 | frontend/src/app/(dashboard)/runtimes/__tests__/copy-daemon-command.test.tsx | 命令内嵌真实密钥（4 用例） |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/__tests__/page.test.tsx | 复制/删除 UI（+5 用例） |
