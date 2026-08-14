---
author: qinyi
created_at: 2026-08-15 00:30:00
scale: large
plan_level: full
risk_level: module-sufficient
---

# 设计文档（Design）— security-audit-remediation 安全审查高危修复

## 背景

2026-08-14 多代理安全审查（6 个并行审查代理：认证授权 / 注入边界 / 密钥泄露 / DB 性能 / 文件系统 / 前端 daemon）确认了 5 个可实际利用的高危漏洞与若干配套中危。本变更按方案 A（最小侵入逐点修复）闭合全部高危 + 7 项配套中危。性能类发现另立变更处理，不在本变更范围。

审查发现的核心模式是**「认证了但没校验归属」**：端点要求登录但不校验资源 owner，导致跨用户读写删；以及一处路径穿越（`startswith` 前缀判断）与一处全局密钥外流（LiteLLM master key 复用下发）。

## 设计目标

1. 闭合 5 个高危：daemon WS 无鉴权、file 模块 IDOR、platform_sync 裸 JWT 写全局桶、claim_lease 无归属校验、sync_documents 路径穿越。
2. 闭合 7 项配套中危：quick-chat 无属主过滤、mission SSE 跨 workspace、workspace activate/init 权限过宽、daemon heartbeat 无归属校验、`/api` 通道 query token 回退、LiteLLM master key 明文下发、git_identity 换行注入。
3. 每个修复点先写失败测试（另一用户访问 → 404/403）再改实现。

## 非目标（Non-Goals）

- LiteLLM per-user virtual key 签发体系（依赖 LiteLLM 管理接口，独立 change 处理）。
- SSRF DNS rebinding pin 解析、tar filter 收紧（M-1）、run_tests/git args 白名单（M-3）——独立中危项，后续 quick 或独立 change。
- 全部性能类发现（reparse to_thread、_bump_files_processed 批量化、scan_docs content 列、api_key prefix 索引查询等）——另立性能修复 change。
- daemon WS 认证协议升级（mTLS / per-connection token 轮换）；本变更只复用现有 X-API-Key。
- McpToken/shpsync_ token 过期时间、JWT jti 吊销黑名单（低危，暂不做）。

## 拆分判断

不拆分：所有修复同属「认证归属校验补全」主题，共享同一修复范式（owner 断言 / `relative_to` / scope 收紧），任务模式高度重复。拆成多个 change 会成倍增加 SillySpec 流程开销而无隔离收益（代码不重叠 = 无并发冲突面）。不走批量模式：12 个修复点非「模板 × 数据」。

## 总体方案

方案 A：最小侵入逐点修复，不动架构。分 5 段：

### 段 1 · daemon 域（W1）

1. **WS 升级期鉴权**（`daemon/router.py:2196`）：`accept()` 之前从 `X-API-Key` header 或 `Authorization: Bearer` 解析 principal（复用 `get_current_principal` 的解析逻辑但直接操作 Request——WS 端点不能走标准 Depends 鉴权，需在 handler 内显式调用）；断言解析出的 `user.id == instance.user_id`，不匹配 `close(code=4003, reason="daemon instance ownership mismatch")`；无凭据 / 凭据无效 `close(4001)`。同用户断言放行。daemon 侧 `ws-client.ts` `_createSocket` 传 `headers: { 'X-API-Key': apiKey }`（daemon `config.api_key` 已持有，`ws` npm 包支持 headers 选项）。
2. **claim_lease / pending-leases / heartbeat 归属校验**：`daemon/lease/service.py:141` `claim_lease` 增加 `actor_user_id` 参数，校验 `runtime.user_id == actor_user_id`（runtime 隶属 workspace member runtime，经 join 查 user）；`router.py:992` 从 `user` 参数取 id 传入。`pending-leases`（`router.py:2444`）与 `heartbeat`（`router.py:343`）同样校验 daemon_instance / runtime 归属，不匹配 404（沿 287eed60 owner-only 404 约定）。
3. **LiteLLM master key 收窄**（两处，Grill M-1）：`daemon/lease/context.py:106-119`（默认供应商）**和** `:179-190` `resolve_bound_provider_config`（档案绑定供应商）的 openai_chat 分支都下发 `settings.litellm_master_key`，两处全部改掉。provider_config 不再携带 `litellm_auth_token` 明文，改为携带 `litellm_proxy: true` 标记 + `litellm_base_url` 指向 hub 代理（`<hub_origin>/api/daemon/llm-proxy`）。**D-003@v1**：backend 新增 `ANY /api/daemon/llm-proxy/{path:path}` 透传端点：
   - **鉴权（Grill UB-4a）**：子进程（Claude Code）只发 `Authorization: Bearer`，而 `get_current_principal` 的 Bearer 分支只认 JWT——代理端点自写分流：Bearer 值先试 ApiKeyService.authenticate（shk_live_ 前缀短路判断），失败再走 JWT。daemon 的 apiKey 作为 ANTHROPIC_AUTH_TOKEN 注入子进程 env（替代原 master key 位置，credential-injector.ts 落点，Grill M-2）。
   - **model 归属校验（Grill UB-4b）**：转发前解析请求 body/model 路径中的 `usr-<uid>-<pid>` 模型名，断言 `uid == 认证 user.id`，不匹配 403——任何有效用户不能经代理消耗他人上游 key。
   - backend 注入 master key 后 httpx 流式转发 `{litellm_base_url}/{path}`。master key 只存在于 backend 进程内。

### 段 2 · file 域（W2）

`file/service.py` 增加归属断言：`get_stream/get_meta/batch_meta/soft_delete` 校验 `row.uploaded_by == current_user.id` **或**（owner_type=workspace 时）调用者对该 workspace 有 WORKSPACE_READ 权限（**Grill M-3：改用 user_workspace_roles / has_permission 口径**——`WorkspaceService.get_member` 不存在，`MemberBindingResolver` 查的是 per-member daemon binding 而非角色成员，语义不符）。不满足 → 404（不存在与无权统一）。`list_files`：无参数时不再返回全平台文件，改为 `uploaded_by == current_user.id OR owner_type='workspace' AND owner_id IN (用户有 WORKSPACE_READ 的 workspace 集合)`；按 owner_id 过滤时同样校验成员关系（PPM 借用方案场景）。platform_admin 豁免（is_platform_admin 可见全部，与项目 RBAC 约定一致）。

### 段 3 · platform_sync 域（W3）

`platform_sync/auth.py:84` JWT 分支不再返回 `(user, None)` 放行全局桶。**Grill UB-3 修订**：三个写端点（POST progress / documents / approval）的路径与 body 均无 workspace_id——因此 **JWT/shk_live_ 对写端点一律 403**（不尝试从 body 补字段，避免破坏 CLI 六表 JSON 契约）；只有 shpsync_ token（token 派生 workspace_id 唯一通道）可写。读端点（GET /changes、GET progress）：JWT/shk_live_ 返回该用户有 CHANGE_READ 权限的 workspace 集合的并集聚合，不再返回全局桶。NULL-workspace 存量数据保留只读兼容（读走并集聚合 fallback），写路径全部关闭。shpsync_ 分支逐字不动（CLI sync.js 固化 Bearer shpsync_，Grill F-d 核实不受影响）。

### 段 4 · change 域（W4）

`change/service.py:650-656` `sync_documents` 路径守卫：`startswith` → `resolved.relative_to(root_resolved)`（`try/except ValueError → ChangeDocNotFound`），与同文件 `read_file/write_file`（:334/:371）范式对齐；`root_resolved` 循环外解析一次。schema 层（`change/schema.py` documents 端点的 extra map）加 filename 白名单校验：`^[A-Za-z0-9._\-]+$`（单段文件名，禁路径分隔符）——现有 CLI 契约（platform_sync documents RootModel 裸 map）只推 `design.md/proposal.md` 等单段名，白名单不破坏契约。

### 段 5 · 杂项中危（W5）

1. quick-chat 四端点（`main.py:324-519`）：**Grill UB-1 修订——agent_runs 表无 user_id 列**，归属链走 `agent_runs.lease_id → daemon_task_leases.metadata.actor_user_id`（placement.py dispatch_to_daemon 写入 `metadata["actor_user_id"]`，需核实：当前 metadata 未显式存 actor，若核实缺失则在 dispatch 写入处补 `metadata["actor_user_id"] = str(user_id)`——写路径在本 change 内）。读/杀端点 join lease 取 actor_user_id 与当前 user 比对，不匹配 404。
2. mission SSE（`mcp_gateway/sse.py:149`）：`require_permission_any(TASK_READ)` → workspace-scoped `require_permission(TASK_READ, workspace_id)`。
3. workspace `activate`（`workspace/router.py:158`）与 `init`（`:256`）：`_any` → workspace-scoped。
4. `core/auth_deps.py:44-60`：删除 `token` / `api_key` query 参数回退。**Grill UB-2 修订——前端 5 处运行时依赖必须同 change 改造**：`frontend/src/lib/agent-stream.ts:103`、`lib/daemon.ts:823`、`components/permissions/session-permission-panel.tsx:138`（浏览器 EventSource 无法带 header）改为 fetch-based SSE（`fetch` + `ReadableStream` 解析 `text/event-stream`，Authorization 走 header）或经 Next route handler 代理（route handler 收 cookie/header 转发时不再把 token 拼 backend URL query，改用 header 转传）：`app/api/daemon-chat/[runId]/stream/route.ts:21`、`app/api/workspaces/.../runs/[runId]/stream/route.ts:29`。统一方案：三处直连 EventSource 改 fetch-SSE（社区成熟模式，project 内 daemon.ts 已有 EventSource，替换为统一 lib helper），两处 Next 代理改 header 转传。
5. git_identity（`git_identity/schema.py:14`）：`git_username`/`git_email` 加 pattern 校验（单行、无 `[]`、无控制字符；email 格式）。
6. claim_token 比较（`lease/service.py:993`）：`!=` → `secrets.compare_digest`。
7. daemon heartbeat（并入段 1.2）。
8. **markdown XSS（用户新增发现）**：`frontend/src/components/ui/markdown-text.tsx` 渲染管线加 `rehype-sanitize`（schema 用默认基础上放开平台自身 markdown 扩展语法所需标签）；排查 `@uiw/react-markdown-preview` 三处引用点（change-file-tree.tsx / markdown-text.tsx / scan-docs 页面）是否需要同步 sanitize 配置。
9. **compose 弱口令 fail-fast（用户新增发现，最小面）**：`deploy/docker-compose.yml` 的 `POSTGRES_PASSWORD:-platform` / `MINIO_ROOT_PASSWORD:-minioadmin` / S3 默认值改 `:?must set` 强制（与 SECRET_KEY 同款）；端口暴露面收紧（5432/9000 去掉宿主映射或绑 127.0.0.1）与备份脚本、.env 扩散、root IP 硬编码等**独立 change**（不在本变更，避免范围膨胀）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/router.py | WS 升级期鉴权（X-API-Key/Bearer 解析 + user_id 归属断言）；claim/pending-leases/heartbeat 归属校验；新增 llm-proxy 透传端点（Bearer→ApiKeyService 分流 + usr-uid-pid model 归属校验 + httpx 流式转发注入 master key） |
| 修改 | backend/app/modules/daemon/lease/service.py | claim_lease 加 actor_user_id 校验；claim_token compare_digest |
| 修改 | backend/app/modules/daemon/lease/context.py | **两处**（resolve_default :106 + resolve_bound :179）openai_chat 分支移除 master key 下发，改 litellm_proxy 标记。数据流：provider_config（backend）→ claim payload / WS push → daemon credential-injector.ts（env 注入真正落点，Grill M-2）→ ANTHROPIC_BASE_URL=<hub>/api/daemon/llm-proxy + ANTHROPIC_AUTH_TOKEN=daemon apiKey → 子进程 Bearer → backend 代理注入 master key → LiteLLM |
| 修改 | backend/app/modules/daemon/runtime/service.py | heartbeat 归属校验 |
| 修改 | backend/app/modules/agent/placement.py | dispatch_to_daemon metadata 补写 actor_user_id（Grill UB-1 归属链锚点） |
| 修改 | backend/app/modules/file/service.py | get_stream/get_meta/batch_meta/soft_delete/list_files 归属断言 + 可见域过滤 |
| 修改 | backend/app/modules/file/router.py | 传 current_user 给 service 调用 |
| 修改 | backend/app/modules/platform_sync/auth.py | JWT/shk_live_ 分支要求 workspace 权限并派生 workspace_id |
| 修改 | backend/app/modules/platform_sync/router.py | 读端点并集聚合；写端点仅 shpsync_ 可写（JWT/shk_live_ 一律 403） |
| 修改 | backend/app/modules/change/service.py | sync_documents relative_to 守卫 |
| 修改 | backend/app/modules/change/schema.py | documents filename 白名单 |
| 修改 | backend/app/main.py | quick-chat 四端点归属过滤（join lease metadata actor_user_id） |
| 修改 | backend/app/modules/mcp_gateway/sse.py | mission SSE workspace-scoped |
| 修改 | backend/app/modules/workspace/router.py | activate/init 权限收紧 |
| 修改 | backend/app/core/auth_deps.py | 删 token/api_key query 回退 |
| 修改 | backend/app/modules/git_identity/schema.py | username/email pattern 校验 |
| 修改 | backend/app/modules/worktree/exec_env.py | write_gitconfig 前防御性拒绝换行（纵深，配合 schema 校验） |
| 修改 | sillyhub-daemon/src/ws-client.ts | _createSocket 传 X-API-Key header。数据流：config.api_key → WsClient opts → _createSocket headers → backend WS 升级期校验 |
| 修改 | sillyhub-daemon/src/credential-injector.ts | openai_chat litellm_proxy 标记 → ANTHROPIC_BASE_URL 指向 hub 代理 + AUTH_TOKEN=daemon apiKey |
| 修改 | sillyhub-daemon/src/spawn-env.ts | provider_config litellm_proxy 标记透传 injector（Object.assign 上层） |
| 修改 | frontend/src/lib/agent-stream.ts | EventSource → fetch-SSE（token 走 header，Grill UB-2） |
| 修改 | frontend/src/lib/daemon.ts | 同上（:823 SSE 直连处） |
| 修改 | frontend/src/components/permissions/session-permission-panel.tsx | 同上（:138） |
| 修改 | frontend/src/app/api/daemon-chat/[runId]/stream/route.ts | token 改 header 转传（不再拼 backend URL query） |
| 修改 | frontend/src/app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts | 同上 |
| 修改 | frontend/src/components/ui/markdown-text.tsx | 加 rehype-sanitize（XSS） |
| 修改 | deploy/docker-compose.yml | PG/MinIO 弱口令改 :?must set；5432/9000 端口绑 127.0.0.1 或去映射 |
| 新增 | backend/app/modules/daemon/tests/test_ws_auth.py | WS 鉴权失败测试（task-01）；其余各修复点的失败测试在各自模块 tests/ 下新增（file/platform_sync/change/mcp_gateway/git_identity 等） |

### 连带改动清单（execute 实测后回补——子代理报备的必要最小改动，超出原清单但属修复闭环必需）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/core/config.py | 新增 hub_proxy_base_url settings 字段（task-04 llm-proxy 代理地址，daemon 可达 hub origin） |
| 修改 | backend/app/core/tests/test_monitoring.py | ruff format 波及（另一并行工作区文件，格式化对齐） |
| 修改 | backend/app/modules/daemon/service.py | facade 层透传 actor_user_id（router 经 facade 调 lease/runtime service，签名链必需） |
| 修改 | backend/app/modules/daemon/tests/test_resolve_default_provider_config.py | openai 断言改造为 proxy 契约（task-04 master key 收窄连带） |
| 修改 | backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py | 同上 |
| 修改 | backend/app/modules/ppm/problem/router.py | export-excel 是 get_stream 唯一外部调用者，签名加 user 透传（task-05 连带） |
| 修改 | backend/app/modules/ppm/problem/tests/test_template_export.py | mock 签名同步（task-05 连带） |
| 修改 | backend/tests/modules/daemon/lease/test_provider_config_payload.py | 契约字段断言 litellm_auth_token→litellm_proxy（task-04 连带） |
| 修改 | deploy/.env.example | 补必填密钥条目 + HUB_PROXY_BASE_URL（task-14/task-04 连带） |
| 修改 | frontend/src/app/api/daemon/sessions/[sessionId]/stream/route.ts | 前端 token 移 header 后该代理必须支持 Authorization 转传（task-12 连带，3 行最小改动） |
| 修改 | frontend/src/components/__tests__/change-file-tree.test.tsx | 补 rehypePlugins 断言（task-13 连带） |
| 修改 | frontend/src/lib/__tests__/daemon-session.test.ts | EventSource mock 改 fetch mock（task-12 连带） |
| 修改 | sillyhub-daemon/src/cli.ts | setDaemonApiKey 进程级注入落点（task-04 连带，daemon.ts 受 allowed_paths 约束） |
| 修改 | sillyhub-daemon/src/types.ts | ProviderConfig.litellm_proxy 可选字段（task-04 连带） |

## 接口定义

- WS 鉴权：`daemon_websocket` 内新增 `_authenticate_ws_upgrade(websocket) -> User | None`（复用 ApiKeyService/JWT 解析）；拒绝码 4001（无/坏凭据）、4003（归属不匹配）。
- `claim_lease(self, lease_id, runtime_id, actor_user_id: uuid.UUID)`：校验 `runtime → workspace member → user_id` 链。
- llm-proxy：`ANY /api/daemon/llm-proxy/{path:path}`，鉴权 X-API-Key/Bearer → user；httpx 转发 `{litellm_base_url}/{path}` + `Authorization: Bearer {master_key}`，流式透传响应。
- `require_platform_sync` 返回类型不变 `tuple[User, uuid.UUID | None]`，但 JWT/shk_live_ 分支语义收紧为：读端点要求可解析 CHANGE_READ 并集聚合；写端点一律 403（仅 shpsync_ 可写，D-004）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| WS connect | daemon | backend | daemon_local_id + X-API-Key header | 校验通过 → registered；失败 → close 4001/4003 |
| claim lease | daemon | backend | lease_id, runtime_id, X-API-Key（actor 归属） | pending → claimed（仅 owner） |
| heartbeat | daemon | backend | daemon_local_id + X-API-Key | last_heartbeat_at 刷新（仅 owner） |
| POST progress/approval | CLI/daemon | backend | shpsync_ token（唯一可写通道；JWT/shk_live_ 403） | 全局桶写入关闭 |
| LLM proxy call | agent 进程（经 daemon env） | backend → LiteLLM | X-API-Key + path | master key 仅 backend 内部注入 |

本变更不改变上述事件的状态机本身（pending→claimed→… 不变），只增加归属/鉴权前置断言。

## 兼容策略

- 未配置/旧 daemon（不带头）：WS 被 4001 拒绝 → daemon 需升级；本项目未正式上线（规则 11），允许 breaking。daemon 侧同 change 内升级，无版本漂移窗口。
- llm-proxy：无 openai_chat 默认供应商的用户不受影响（provider_config 缺省路径不变）；anthropic 分支 9 字段逐字不变（NFR-02 零回归）。兼容性锚点：现有 openai_chat 已把 ANTHROPIC_BASE_URL 直指 litellm_base_url 且 live 可用（llm-provider-openai-format change），证明 Claude Code base_url + /v1/messages 拼接行为可依赖，代理替换同构。
- platform_sync NULL 桶存量数据保留只读；CLI 用 shpsync_ token 不受影响（memory：local.yaml mcp+platform 配置）；JWT/shk_live_ 写端点 403 是行为变更（原可写全局桶）——过渡期使用 JWT 直写的调用方（若有）需换 shpsync_。存量 quick-chat run 的 lease metadata 无 actor_user_id，归属过滤后统一 404（未上线可接受，规则 11）；实现期核实 agent_runs.lease_id 回填是否存在，缺失则 placement 补 UPDATE。
- `?token=` query 回退删除：daemon hub-client 全走 header（已核实 `hub-client.ts:309`）；MCP 通道本就禁；前端 5 处依赖同 change 改造为 fetch-SSE / header 转传（Grill UB-2）。
- markdown sanitize：sanitize schema 放开平台 markdown 扩展所需标签，普通文档渲染不受影响；若有页面依赖 raw HTML 能力（如原型 HTML 预览），白名单页面绕过 sanitize 需逐一确认。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | WS 加鉴权后现有 daemon 连不上（漏传 header） | P1 | daemon 同 change 升级；集成测试覆盖 register→ws→claim 全链 |
| R-02 | llm-proxy 透传引入性能/超时问题 | P1 | httpx 流式转发 + 复用连接池；超时对齐 litellm 配置 |
| R-03 | platform_sync 权限收紧破坏 CLI 同步 | P1 | CLI 用 shpsync_ 路径不变；JWT 路径测试覆盖权限矩阵 |
| R-04 | file 可见域过滤破坏 PPM 借用方案场景 | P2 | owner_id 过滤时校验成员关系而非拒绝；platform_admin 豁免 |
| R-05 | auth_deps 删 query 回退破坏前端 SSE | P1 | 前端 5 处同 change 改造（fetch-SSE / header 转传），vitest 覆盖（Grill UB-2 修订后） |
| R-06 | llm-proxy 被其它用户借用消耗他人上游 key | P1 | usr-uid-pid model 名归属断言 + 集成测试（Grill UB-4b） |
| R-07 | markdown sanitize 误伤平台文档渲染 | P2 | sanitize schema 按平台 markdown 语法白名单调优 + 快照测试 |

## 决策追踪

- D-001@v1（step3）：跨用户访问统一 404（沿 287eed60 owner-only 约定）。覆盖 FR-01/02/04。
- D-002@v1（step4）：修复模式 = endpoint 层归属依赖或 service 层 owner 断言；路径校验统一 relative_to。覆盖全部 FR。
- D-003@v1（本文件段1.3，Grill 修订版）：LiteLLM master key 不出 backend 进程；daemon 经 /api/daemon/llm-proxy 透传（Bearer→ApiKeyService 分流 + usr-uid-pid model 归属断言）。
- D-004@v1（Grill UB-3）：platform_sync JWT/shk_live_ 写端点一律 403，只保留读端点并集聚合——不从 body 补 workspace 字段（保 CLI 六表 JSON 契约）。
- D-005@v1（Grill UB-1）：quick-chat 归属链 = agent_runs.lease_id → lease metadata.actor_user_id（placement 补写锚点），不加 agent_runs.user_id 列。
- D-006@v1（用户 2026-08-15 汇总新增）：markdown XSS（rehype-sanitize）与 compose 弱口令 fail-fast 纳入本变更；部署面其余硬化（端口收敛、备份、.env 扩散、root IP）与依赖升级（Next.js/passlib）独立 change。
- 未解决：LiteLLM per-user virtual key（非目标，后续 change）。

## 自审（Self-Review）

- 章节齐全：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/兼容策略/风险登记/决策追踪/自审 ✅
- Grill FAIL 修订（2026-08-15）：UB-1（quick-chat 归属链改 lease metadata.actor_user_id + placement 补写）、UB-2（前端 5 处 query token 依赖纳入清单改 fetch-SSE/header 转传）、UB-3（JWT 写端点 403 不补 body 字段）、UB-4（llm-proxy Bearer 分流 + model 归属断言）全部落入正文；M-1（master key 两处 :117+:188）、M-2（credential-injector.ts 落点）、M-3（file 成员校验改 RBAC 口径）全部修订 ✅
- 每个修复点均有 file:line 依据（审查代理 + 主代理二次核实 + Grill 独立核验）✅
- 测试策略：module 级（daemon/file/platform_sync/change 各自 pytest 子集）+ daemon vitest + 前端 vitest（SSE 改造与 sanitize）；先写失败测试。
