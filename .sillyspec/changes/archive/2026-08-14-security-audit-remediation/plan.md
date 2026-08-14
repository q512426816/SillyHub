---
author: qinyi
created_at: 2026-08-15 01:05:00
plan_level: full
---

# 实现计划（Plan）— security-audit-remediation

## 复杂度

plan_level: full（14 task、25 文件、跨 backend/daemon/frontend/deploy 四子项目、含新端点 llm-proxy 与鉴权行为变更）。并行性：Wave 内任务彼此独立；Wave 间按依赖串行。W1（backend daemon 域）与 W5 前端/部署线可由不同 agent 并行（文件不重叠）。

## 前置核实（task-01 开始前）

- 核实 quick-chat 路 `agent_runs.lease_id` 回填：main.py INSERT 后 dispatch_to_daemon 内是否 UPDATE agent_runs.lease_id（placement.py），缺失则在 task-08 的 placement 补写中一并处理。

## Wave 1 · daemon WS 鉴权 + daemon 客户端（同窗口落地）

- [x] task-01: daemon WS 升级期鉴权。backend/app/modules/daemon/router.py:2196：accept 前手动解析凭据（starlette WebSocket 有 headers API）：`Authorization: Bearer` 值先 shk_live_ 前缀短路 → ApiKeyService.authenticate，否则 JWT（get_current_user 逻辑）；无/坏凭据 close 4001，`user.id != instance.user_id` close 4003。测试 backend/app/modules/daemon/tests/test_ws_auth.py：①无 header 4001 ②他人 apiKey 4003 ③本人 apiKey 通过并注册 hub。连带测试债（预置改造勿等跑红）：test_ws_handshake_daemon_id.py:107 等既有 WS 测试 fixtures 补凭据 header。
- [x] task-02: daemon ws-client.ts 传 X-API-Key。sillyhub-daemon/src/ws-client.ts:355 `_createSocket` → `new WebSocket(url, { headers: { 'X-API-Key': apiKey } })`；WsClient opts 加 apiKey（daemon.ts:2243 工厂传 config.api_key）。vitest：headers 传入断言 + 无 apiKey 时仍可连（向后兼容测试环境 mock）。

## Wave 2 · daemon 域归属校验

- [x] task-03: claim/pending-leases/heartbeat 归属 + compare_digest。lease/service.py:141 claim_lease 加 actor_user_id 参数，join runtime→user 校验（runtime.user_id）；router.py:992/:2444 与 runtime/service.py:322（heartbeat_daemon）端点接 user.id 传入，不匹配 404；lease/service.py:993 claim_token 改 secrets.compare_digest。测试：他人 claim 404、他人 pending-leases 404、他人 heartbeat 404、本人路径回归。

## Wave 3 · llm-proxy + master key 收窄

- [x] task-04: llm-proxy 端点 + master key 两处收窄。①daemon/router.py 新增 `ANY /llm-proxy/{path:path}`：Bearer 分流（shk_live_ → ApiKeyService，否则 JWT）、body/path 提取 usr-<uid>-<pid> 断言 uid==user.id（不匹配 403）、httpx AsyncClient 流式转发 settings.litellm_base_url/path + 注入 `Authorization: Bearer {master_key}`。②context.py 两处（resolve_default :106-119、resolve_bound :179-190）openai_chat 分支：删 litellm_auth_token，改 `litellm_proxy: true` + `litellm_base_url` = hub 代理地址（从 settings 构造，注意 daemon 可达的 hub origin）。③sillyhub-daemon/src/credential-injector.ts:95-106：litellm_proxy 标记时 ANTHROPIC_BASE_URL=代理地址、ANTHROPIC_AUTH_TOKEN=daemon apiKey；spawn-env.ts 透传标记。测试：proxy 端点归属断言（他人 uid 403）、payload 无 master key 断言、injector env 单测。
  - 依赖：task-01（鉴权分流函数可复用）。

## Wave 4 · file 域

- [x] task-05: file IDOR。file/service.py：get_stream/get_meta/batch_meta/soft_delete 加 current_user 参数，断言 `uploaded_by == user.id or is_platform_admin(user) or (owner_type=='workspace' and has_permission(user, WORKSPACE_READ, owner_id))`；不满足 404（FileNotFound 同语义）。list_files 可见域：无过滤参数时 `uploaded_by==user.id OR owner workspace IN (user 有 WORKSPACE_READ 的 ws 集合)`；带 owner_id 时校验成员关系；admin 豁免。router.py 传 current_user。连带测试债：test_file_api.py:178 test_list_without_filters_returns_all_active 断言全量语义需改造（上传者视角或 admin 视角）。测试：他人下载/meta/软删 404、他人 list 不见、workspace 成员可见、admin 全见、PPM owner_id 过滤成员场景回归。

## Wave 5 · platform_sync + change 域

- [x] task-06: platform_sync 收紧。auth.py：require_platform_sync 加 `write: bool` 参数（或路由层分别依赖）；shk_live_/JWT 分支写端点 403。router.py：GET /changes 与 GET progress 对 JWT/shk_live_ 按 user 的 CHANGE_READ workspace 并集聚合（workspace_id=None 时不再全局桶，改为 IN 查询）；POST progress/documents/approval 仅 shpsync_。连带测试债：platform_sync/tests/test_router.py:58 test_post_jwt_auth_ok（JWT POST progress 将 403）需改造为 403 断言。测试：JWT POST approval 403、shpsync_ 写回归、JWT 读只见自己的 ws。
- [x] task-07: sync_documents 路径守卫。change/service.py:650-656：root_resolved 循环外 resolve 一次；`resolved.relative_to(root_resolved)` try/except ValueError → ChangeDocNotFound。change/schema.py：documents 键白名单 `^[A-Za-z0-9._\-]+$`（pydantic validator）。测试：`../../evil` 与 `foo-evil/../../x` 形态 4xx、正常 design.md/proposal.md 回归。

## Wave 6 · 杂项 backend

- [x] task-08: quick-chat 归属。main.py 四端点（:325/:347/kill/logs）：按 run_id 查 lease_id → lease.metadata.actor_user_id（placement 补写：dispatch_to_daemon metadata["actor_user_id"]=str(user_id)，先核实 lease_id 回填）。比对 user.id 不匹配 404。测试：他人读/杀 404、本人回归、prev_run_id resume 校验。
- [x] task-09: mission SSE + workspace activate/init 收紧。mcp_gateway/sse.py:153 require_permission_any(TASK_READ) → workspace-scoped require_permission(TASK_READ)；workspace/router.py:158 activate、:256 init 同理 WORKSPACE_WRITE。测试：非成员订阅 mission 403/404、非成员 activate 403。
- [x] task-10: git_identity schema 校验。git_identity/schema.py:14-15：git_username pattern `^[\w.\- ]{1,64}$`（无换行/[]/控制符）；git_email 用 EmailStr 或 pattern。exec_env.py write_gitconfig 前防御性拒绝换行。测试：换行注入 payload 422。
- [x] task-11: compare_digest 已并入 task-03（此 task 保留编号但标记并入，execute 时跳过）。

## Wave 7 · 前端 + 部署（可与 W1-W6 并行）

- [x] task-12: auth_deps query 回退删除 + 前端 5 处 SSE 改造。①backend/app/core/auth_deps.py:44-60 删 query_params 回退（保留 MCP 通道现状）。②frontend：lib/agent-stream.ts:103、lib/daemon.ts:823、components/permissions/session-permission-panel.tsx:138 EventSource → fetch-SSE helper（新增 lib/fetch-sse.ts：fetch + ReadableStream 解析 text/event-stream，Authorization header）；app/api/daemon-chat/[runId]/stream/route.ts:21 与 app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts:29 改 header 转传。测试：backend 删回退后 401（无 header 时）；前端 vitest fetch-SSE 解析单测 + 三处调用点替换回归。
- [x] task-13: markdown sanitize。frontend/src/components/ui/markdown-text.tsx 加 rehype-sanitize（默认 schema 基础上放开平台 markdown 所需：code/span/table 等）；排查 @uiw/react-markdown-preview 三处引用（change-file-tree.tsx:21、markdown-text.tsx:20、scan-docs/page.tsx:13）按需同配。测试：`<script>`/`<img onerror>` 注入被剥离的快照断言。
- [x] task-14: compose 硬化 + 全量回归。deploy/docker-compose.yml：POSTGRES_PASSWORD/MINIO_ROOT_PASSWORD/S3 默认值改 `${VAR:?must set}`；5432/9000 宿主映射改 127.0.0.1 绑定或删除。收尾跑：backend 命中模块 pytest（daemon/file/platform_sync/change/auth/mcp_gateway/workspace/git_identity + main 相关）+ sillyhub-daemon vitest + frontend vitest + tsc；无 DB schema 变化故无迁移；如 backend 响应模型有变化跑 pnpm gen:types（本变更无新 DTO，预计不需要）。

## 依赖关系

- task-04 依赖 task-01（Bearer 分流复用）。
- task-02 与 task-01 必须同 Wave 落地（backend 加鉴权后 daemon 必须带头，否则所有 daemon 断连）——execute 时这两个 task 同一提交窗口。
- task-12 的 backend 侧（auth_deps 删除）与 frontend 侧必须同窗口合入（否则 SSE 全断）。
- 其余任务互相独立。W5 与 W1-W4 文件不重叠可并行 agent。

## 完成标准（每 task）

失败测试先行 → 实现绿 → 本模块 pytest 子集绿 → ruff/mypy 过。W 收尾：`cd backend && uv run ruff check . && uv run mypy app`（backend）；daemon/frontend 各自 typecheck/vitest。

## 测试策略

test_strategy=module（local.yaml）：按 git diff 命中模块跑子集；daemon/frontend 各自 vitest。跨模块集成点（WS 鉴权 + daemon header；auth_deps 删除 + 前端 SSE）在 task 边界内闭环。

## 需求与决策覆盖对照

- FR-01（WS 鉴权）→ task-01/task-02；FR-02（claim/heartbeat 归属）→ task-03；FR-03（master key 收窄+proxy）→ task-04；FR-04（file IDOR）→ task-05；FR-05（platform_sync）→ task-06；FR-06（sync_documents）→ task-07；FR-07（quick-chat）→ task-08；FR-08（mission SSE）+ FR-09（activate/init）→ task-09；FR-10（query 回退+前端 SSE）→ task-12；FR-11（git_identity）→ task-10；FR-12（compare_digest）→ task-03（task-11 占位）；FR-13（markdown sanitize）→ task-13；FR-14（compose）→ task-14。
- D-001@v1（404 约定）→ task-03/05/08；D-002@v1（修复模式）→ 全部 task；D-003@v1（llm-proxy）→ task-04；D-004@v1（写端点 403）→ task-06；D-005@v1（lease 归属链）→ task-08；D-006@v1（XSS+compose 入范围）→ task-13/task-14。
