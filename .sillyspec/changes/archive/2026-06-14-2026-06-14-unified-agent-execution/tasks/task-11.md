---
author: qinyi
created_at: 2026-06-14T17:55:00
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-11
title: 后端测试（execution-context 端点 + NoOnlineDaemon + 状态映射 + diff redact）
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
blocks: [task-13]
allowed_paths:
  - backend/app/modules/agent/tests/test_execution_context.py
---

# task-11: 后端测试（execution-context 端点 + NoOnlineDaemon + 状态映射 + diff redact）

> 对应 plan §Wave 5（48-52）、任务总表 task-11（68）；全局验收 2 / 3 / 4 / 5 / 8 / 11；风险 R-01（删除面广）/ R-02（端点泄漏 bundle）/ R-04（kill 改道）/ R-stage（stage/scan bundle）。
> 对应 design §Phase 5（213-216）、§6 文件清单（231）、§7.1 端点定义（246-255）。

## 前置依赖核实（execute 时不可省）

1. **task-01 已 merge**：`NoOnlineDaemonError` 存在于 `placement.py`；`AgentRun.error_code` 字段已新增（model.py 当前**无**此列，task-01 接口定义章节 77-84 明确要求新增 `String | None`）；claude_code.py 已删除。
2. **task-02 已 merge**：`GET /agent-runs/{run_id}/execution-context` 端点已存在于 `router.py`（**注意路径前缀**：router 以 `prefix="/api"` 挂载 `main.py:236`，既有端点统一带 `/workspaces/{workspace_id}` 前缀，新端点应对齐既有风格 `/api/workspaces/{workspace_id}/agent/runs/{run_id}/execution-context`；若 task-02 实际选用无 workspace 前缀的扁平路径 `/api/agent-runs/{run_id}/execution-context`，本任务测试以 task-02 实际路径为准，AC 不锁死具体前缀）。
3. **task-03 已 merge**：`dispatch_to_daemon` 签名扩展 + 三处 dispatch 把 stage/scan 上下文参数（prompt/step_prompt/stage/read_only/root_path/spec_root/runtime_root）持久化到 `lease.metadata`；`_build_claim_payload` 透传 repo_url/branch/allowed_paths/tool_config。
4. **task-04 已 merge**：`kill_run` 调用 `DaemonLeaseService.cancel_lease(agent_run_id)`；`sync_agent_run_status` 为 lease.status→AgentRun.status 状态映射单一驱动。

> **路径前缀灵活性**：本任务测试通过 `client.get("/api/...")` 发请求；若 task-02 落地后实际路径与本任务假设不同，**测试路径以 task-02 实际为准**，AC 表用「端点存在 + 返回 200/401/403」而非硬编码路径字符串。

## 修改文件

- `backend/app/modules/agent/tests/test_execution_context.py` — **新建**（唯一交付物）

## 测试框架核实（生效路径，非臆断）

- **命令**：`cd backend && uv run pytest -q --cov=app --cov-fail-under=60`（`.sillyspec/.runtime/local.yaml:12` `backend_test`；coverage 门槛 60%）。
- **HTTP 级测试**：复用 `backend/conftest.py` 的 `client` fixture（`httpx.AsyncClient` + ASGI transport + in-memory SQLite，conftest.py:103-125）、`auth_headers` fixture（conftest.py:167-169，返回 `{"Authorization": f"Bearer {token}"}`）。
- **鉴权依赖**：`router.py` 既有端点统一用 `Annotated[User, Depends(require_permission(Permission.X))]`（router.py:49/77/97/125/152）；`require_permission` 走 `get_current_user`（auth_deps.py:40-45，**未认证 → 401**）。本任务测试 execution-context 端点的鉴权用相同模式验证未登录 401。
- **既有测试参考**：`backend/app/modules/agent/tests/test_router.py`（HTTP 级 + `_setup` helper 构造 Workspace/Change/Task/User/GitIdentity/WorktreeLease）、`test_kill.py`（service 单元 + AsyncMock）、`test_context_builder.py`（bundle 构造）、`backend/app/modules/daemon/tests/test_lease_service.py`（lease lifecycle helper：`_create_user`/`_create_runtime`/`_create_lease_row`，含 `DaemonTaskLease.metadata` 写入）。
- **run 类型分发标识**：`AgentRun` 无 `run_type` 列，分发依据 task_id（task run，非空）/change_id+spec_strategy（stage run，spec_strategy 形如 "propose"/"plan"）/spec_root（scan run，scan run 通常 task_id 为空）。测试通过构造不同字段的 AgentRun + 对应 lease.metadata 模拟三种 run 类型。

## 实现要求

### 测试模块结构（5 组测试类）

#### 1. `TestExecutionContextEndpoint`（端点三种 run 类型返回完整 bundle）

- `test_task_run_returns_complete_bundle`：构造 task_id 非空的 AgentRun + lease.metadata 含 prompt/provider/repo_url/branch/allowed_paths/tool_config → GET 端点返回 200，body 含 `claude_md`（非空，来自 `render_bundle_to_claude_md`）、`prompt`、`provider`、`repo_url`、`branch`、`allowed_paths`、`tool_config` 全字段。**断言 claude_md 非空字符串**（覆盖 design Phase 2 缺口：原 daemon 裸 prompt，现拿到完整 bundle）。
- `test_stage_run_recovers_from_lease_metadata`：构造 change_id 非空 + spec_strategy="plan" 的 AgentRun + lease.metadata 含 stage/step_prompt/read_only（task-03 持久化的 stage 上下文参数）→ GET 端点返回 200，body 的 claude_md 来自 `build_stage_bundle`（用恢复的 stage/step_prompt/read_only 重建 bundle）。**断言**：claude_md 内容反映 stage 上下文（如含 stage 名或 step_prompt 关键词），证明端点从 lease.metadata 恢复了 stage 参数。
- `test_scan_run_recovers_root_paths`：构造 task_id 为空 + lease.metadata 含 root_path/spec_root/runtime_root（task-03 持久化的 scan 上下文参数）→ GET 端点返回 200，claude_md 来自 `build_scan_bundle`（用恢复的 root_path/spec_root/runtime_root 重建）。**断言**：返回字段对齐 scan run 形态。
- `test_resume_session_id_passed_through`：lease.metadata 含 resume_session_id → 返回 body 含该字段（daemon 用来续接 session）。
- `test_run_not_found`：不存在的 run_id → 404（对齐既有 `AgentRunNotFound` 错误处理）。

> **对齐 plan 验收 2**：task/stage/scan 三种 run 类型均返回完整 bundle（claude_md + prompt + repo/branch + allowed_paths + tool_config）。

#### 2. `TestExecutionContextAuth`（鉴权 + 归属校验，风险 R-02）

- `test_unauthenticated_returns_401`：不带 `Authorization` header GET 端点 → **401**（验证 `get_current_user` 拦截）。
- `test_cross_user_access_returns_403`：构造 user A 的 run，用 user B 的 token GET → **403**（R-02 应对：防 bundle 泄漏）。归属校验逻辑：run → workspace → workspace 成员/owner 与当前 user 不匹配则 403。**注意**：AgentRun 无 user_id 字段，归属校验经 `AgentRunWorkspace` M:N 关联表 + workspace 成员关系判定（task-02 实现需复用既有 workspace 成员校验，本测试验证其行为而非内部实现）。
- `test_same_user_access_allowed`：user A 的 run + user A 的 token → 200（正向用例，确保 403 不是误杀）。

> **对齐 plan 验收 2**：未鉴权 → 401；run 归属不匹配 → 403。

#### 3. `TestNoOnlineDaemonPath`（无在线 daemon 路径）

- `test_start_run_failed_when_no_daemon`：mock `decide_backend`（或 `_get_online_runtime`）返回无在线 daemon → 触发 `start_run`（经 router POST `/api/workspaces/{ws_id}/agent/runs`）→ 返回的 AgentRun.status=="failed" + **error_code=="no_online_daemon"** + output_redacted 含「未检测到在线 daemon，请启动 sillyhub-daemon 后重试」。
- `test_start_stage_dispatch_failed_when_no_daemon`：同上，针对 stage dispatch 入口。
- `test_start_scan_dispatch_failed_when_no_daemon`：同上，针对 scan dispatch 入口。
- `test_no_silent_fallback`：构造无 daemon 场景，断言**不会**创建 lease（`SELECT FROM daemon_task_leases WHERE agent_run_id=...` 为空），证明没有走 SERVER fallback（已删）。

> **对齐 plan 验收 3**：无在线 daemon → AgentRun.status=failed + error_code=no_online_daemon + 用户可读消息。
> **注意**：本组测试依赖 task-01 新增的 `AgentRun.error_code` 字段；若 task-01 未新增该列，测试会失败——这是 task-11 对 task-01 的硬依赖。

#### 4. `TestLeaseStatusMapping`（lease.status → AgentRun.status 状态映射）

- `test_claimed_maps_to_running`：lease.status="claimed" + 调 `sync_agent_run_status(lease_id, token, "running")`（或触发 daemon claim 后的状态同步）→ AgentRun.status=="running" + started_at 非空。
- `test_completed_maps_to_completed`：lease.status="completed" → AgentRun.status=="completed" + finished_at 非空。
- `test_expired_maps_to_failed`：lease.status="expired"（daemon 超时未续约）→ 触发状态同步后 AgentRun.status=="failed"。
- `test_cancelled_maps_to_killed`：lease.status="cancelled"（kill_run 调 cancel_lease 后）→ AgentRun.status=="killed"。
- `test_single_driver_no_drift`：构造 lease 状态变化序列（pending→claimed→completed），断言 AgentRun.status 跟随 lease 唯一演进，无中间对账步骤产生漂移。

> **对齐 plan 验收 5**：状态映射测试通过，单一驱动无对账漂移。
> **注意**：`sync_agent_run_status`（daemon/service.py:667）当前接收的是 daemon 传入的目标 status 值（非 lease.status 字段），task-04 需确保 lease.status 变化触发对应 status 调用；本测试通过模拟 daemon 侧调用（传不同 status）验证映射，或通过 lease_service 的状态变更钩子验证。

#### 5. `TestKillRunViaCancelLease`（kill 改道，风险 R-04）

- `test_kill_calls_cancel_lease`：mock `DaemonLeaseService.cancel_lease`，调用 kill 端点 → 断言 cancel_lease 被调用且参数为 agent_run_id。
- `test_kill_no_sigterm_in_service`：`grep` 静态断言 —— `service.py` 无 `SIGTERM`/`SIGKILL`/`_proc_registry`（对齐验收 4）。
- `test_kill_offline_daemon`（R-04）：daemon 离线时 kill → cancel_lease 标 lease→cancelled，AgentRun.status 在 daemon 重连后下一次状态同步时变 killed（测试用：cancel 后手动触发 sync_agent_run_status 模拟重连）。

#### 6. `TestDiffRedact`（diff 二次脱敏，验收 8）

- `test_complete_lease_redacts_diff`：构造含 API key / token / PAT 模式的 diff（如 `Authorization: Bearer sk-ant-xxxxx`、`api_key: "ghp_xxxxx"`），调 `complete_lease`（带 diff payload）→ 断言入库的 AgentRun.output_redacted（或 diff 落库字段）**不含**原始密钥，含 redact 占位符（如 `[REDACTED]`）。
- `test_large_diff_does_not_crash_complete_lease`：构造 >100KB diff 字符串，调 complete_lease → 不抛异常（截断由 task-07 daemon 侧做 50KB，后端二次 redact 不重复截断但需处理大 payload 不 OOM）。
- **redact 真相源核实**：`backend/app/modules/git_gateway/service.py:106 redact_output` 是单一 redact 函数；task-07 设计后端 `complete_lease` 复用此函数对 diff 二次脱敏。本测试断言 `redact_output` 被调用且输出无密钥。

> **对齐 plan 验收 8**：daemon 上报 diff 经 50KB 截断（daemon 侧 task-07）+ 后端 redact_output 二次脱敏（本测试覆盖后端侧）；含密钥 diff 不入库。
> **注意**：50KB 截断测试在 daemon 侧（task-12），本任务只测后端 redact 二次脱敏（redact 单一真相源留后端，design A4 方案 b）。

### 共用 fixture / helper（测试文件内部定义）

```python
# 复用 backend/conftest.py 的 client / auth_headers / db_session fixture
# 测试文件内部定义 _setup_task_run / _setup_stage_run / _setup_scan_run helper，
# 构造 Workspace/Change/Task/User/AgentRun/DaemonTaskLease + lease.metadata，
# 模式参考 test_router.py:_setup (23-100) 与 test_lease_service.py:_create_lease_row
```

### 现有测试不破坏

- `test_kill.py`：task-01 删除 `_proc_registry` 后，`test_kill.py` 的 `TestProcRegistry` 类（40-52）会失败。**本任务不修 test_kill.py**（task-01 的 `allowed_paths` 已包含 adapter 测试清理，但 test_kill.py 的 `_proc_registry` 测试应由 task-01 或 task-04 清理）。**execute 时核实**：若 task-01/task-04 未删 test_kill.py 的 ProcRegistry 测试，本任务需补删（`TestProcRegistry` 类整块删除，`TestKillRun` 的 `AgentService._proc_registry[run_id] = fake_proc` 用例改为 mock cancel_lease）。

## 边界处理

1. **（路径前缀不锁死）** execution-context 端点的具体 URL 前缀（带 `/workspaces/{ws_id}` 或扁平 `/agent-runs/{run_id}`）由 task-02 定；本任务测试通过相对路径发请求，AC 用「端点返回 200/401/403」而非硬编码路径字符串。execute 时若发现 task-02 实际路径与本任务假设不同，**改测试不改实现**（实现以 task-02 为准）。
2. **（AgentRun.error_code 前置）** 本任务 `TestNoOnlineDaemonPath` 断言 `error_code=="no_online_daemon"`，依赖 task-01 新增该字段。若 task-01 未做，本任务测试 RED（AttributeError）——这是正常的依赖链体现，**不**在本任务新增 model 字段（那是 task-01 范围）。
3. **（403 归属校验逻辑依赖 task-02）** 跨 user 403 的判定逻辑（workspace 成员关系）由 task-02 实现端点时落地；本任务测试验证**行为**（跨 user 403）而非内部实现。若 task-02 实现为「跨 workspace 404」（防 enumeration），本任务测试调整断言为 404（防 enumeration 是更安全的设计，execute 时按 task-02 实际行为调整 AC）。
4. **（mock 边界）** HTTP 级测试不 mock service 内部方法（走完整 stack）；单元级测试（状态映射、NoOnlineDaemon 触发）用 `unittest.mock.patch` mock `decide_backend` / `_get_online_runtime` / `cancel_lease`。**禁止** mock DB（用 conftest 的 in-memory SQLite + 真实模型行）。
5. **（redact 真相源单一）** diff redact 测试只断言 `redact_output`（git_gateway/service.py:106）被调用且输出无密钥；**不**在测试文件里复制 redact 正则（避免规则漂移）。
6. **（coverage 门槛）** `backend_test` 命令含 `--cov-fail-under=60`，本任务新增测试会提升 agent 模块覆盖率；若新增测试后总覆盖率 <60%，说明测试覆盖不足，需补用例。
7. **（既有测试破坏处理）** task-01 删 `_proc_registry` 后 test_kill.py 部分用例失效；本任务若发现 test_kill.py 红，按「现有测试不破坏」章节处理（删 ProcRegistry 类 + 改 kill 测试为 mock cancel_lease）。

## 非目标

- **不**新增 execution-context 端点实现（task-02 范围）。
- **不**新增 `NoOnlineDaemonError` / `AgentRun.error_code` 字段（task-01 范围）。
- **不**改 `dispatch_to_daemon` 签名 / lease.metadata 持久化（task-03 范围）。
- **不**改 `kill_run` 实现 / `cancel_lease` 接入（task-04 范围）。
- **不**测 daemon 侧（execution-context fetch / CLAUDE.md 写入 / stats 透传 / diff 截断）——那是 **task-12** 范围。
- **不**测 50KB 截断（daemon 侧，task-12）；本任务只测后端 redact 二次脱敏。
- **不**测 token 注入 / 超时 / 重试（B1/B2/B3，daemon 侧，task-12）。
- **不**跑全量回归（task-13 范围）。
- **不**清理孤儿变更（task-13 范围）。

## TDD 步骤

1. **核实前置**：`grep -n "error_code" backend/app/modules/agent/model.py`（task-01 应已新增）；`grep -n "execution-context" backend/app/modules/agent/router.py`（task-02 应已新增端点）；`grep -n "NoOnlineDaemonError" backend/app/modules/agent/placement.py`（task-01 应已新增）。三项全绿才继续，否则报告前置缺失。
2. **写测试**：按 6 组测试类逐个写 `test_execution_context.py`（约 20-25 个用例）。
3. **确认失败**（若实现就绪则跳过 RED）：针对尚未实现的部分跑 RED；针对已实现（task-01~04）的部分直接跑应全绿。
4. **确认通过**：`cd backend && uv run pytest app/modules/agent/tests/test_execution_context.py -q` → 全绿。
5. **回归**：`cd backend && uv run pytest -q --cov=app --cov-fail-under=60`（plan 风险 R-01 应对）；若 test_kill.py 因 `_proc_registry` 删除失败，按边界处理 7 清理。
6. **静态断言**：`grep -n "_proc_registry\|SIGTERM" backend/app/modules/agent/service.py` → 无命中（对齐验收 4）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `test -f backend/app/modules/agent/tests/test_execution_context.py` | 文件存在 |
| AC-02 | `cd backend && uv run pytest app/modules/agent/tests/test_execution_context.py -q` | 全绿（约 20-25 用例） |
| AC-03 | 单测：`test_task_run_returns_complete_bundle` / `test_stage_run_recovers_from_lease_metadata` / `test_scan_run_recovers_root_paths` | 三种 run 类型均返回完整 bundle（claude_md 非空 + prompt + repo/branch + allowed_paths + tool_config），对齐 plan 全局验收 2 |
| AC-04 | 单测：`test_unauthenticated_returns_401` | 401（对齐验收 2 / R-02） |
| AC-05 | 单测：`test_cross_user_access_returns_403`（或 task-02 若用 404 防 enumeration 则 404） | 跨 user 访问被拒，bundle 不泄漏（对齐验收 2 / R-02） |
| AC-06 | 单测：`test_start_run_failed_when_no_daemon` | AgentRun.status=="failed" + error_code=="no_online_daemon" + output_redacted 含「未检测到在线 daemon」（对齐验收 3） |
| AC-07 | 单测：`test_claimed_maps_to_running` / `test_completed_maps_to_completed` / `test_expired_maps_to_failed` / `test_cancelled_maps_to_killed` | 四种 lease.status 正确映射到 AgentRun.status，单一驱动无漂移（对齐验收 5） |
| AC-08 | 单测：`test_kill_calls_cancel_lease` | kill_run 调 DaemonLeaseService.cancel_lease(agent_run_id)，cancel_lease 被 mock 断言调用（对齐验收 4） |
| AC-09 | 单测：`test_complete_lease_redacts_diff` | 含 API key/token/PAT 的 diff 经 redact_output 后入库版本无原始密钥（对齐验收 8 / R-06 后端侧） |
| AC-10 | `grep -n "_proc_registry\|SIGTERM" backend/app/modules/agent/service.py` | 无命中（静态断言对齐验收 4） |
| AC-11 | `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` | 全绿且覆盖率 ≥ 60%（风险 R-01 应对）；test_kill.py 无因 _proc_registry 删除而红的用例 |
