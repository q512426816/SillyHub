---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-02
title: execution-context 端点（run 类型分发：task/stage/scan）
priority: P0
depends_on: [task-03]
blocks: [task-05, task-11]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/context_builder.py
---

# task-02: execution-context 端点（run 类型分发：task/stage/scan）

> 对应 plan 全局验收 2；风险 R-02（端点泄漏 bundle）、R-stage（stage/scan 上下文参数未持久化，本端点需从 lease.metadata 恢复）。
> 对应 design §Phase 2（94-112）、§7.1 接口定义（246-255）。
> **依赖 task-03**：端点读取的 stage/scan 临时参数（prompt/step_prompt/stage/read_only/root_path/spec_root/runtime_root）由 task-03 持久化到 lease.metadata，task-02 才能恢复。

## 修改文件

- `backend/app/modules/agent/router.py` — 新增 `GET /agent-runs/{run_id}/execution-context` 端点（参考既有 `get_agent_run`(75-86) 的 `require_permission(Permission.TASK_READ)` + `svc.get_run` + `AgentRunNotFound` 写法）；新增 run 类型分发逻辑 + lease.metadata 临时参数恢复
- `backend/app/modules/agent/schema.py` — 新增 `ExecutionContextResponse` Pydantic 模型（含 `agent_run_id/claude_md/prompt/provider/resume_session_id/repo_url/branch/allowed_paths/tool_config/session_id`）
- `backend/app/modules/agent/context_builder.py` — **无逻辑改动**，仅消费方调用（design §6 第 227 行明确「无逻辑改动，仅消费方变更」）。复用 `build_spec_bundle`(204) / `build_stage_bundle`(318) / `build_scan_bundle`(422) / `render_bundle_to_claude_md`(585)

## 实现要求

1. **新增端点**（`router.py`，参考既有端点模式，注意既有端点用 `require_permission` 而非直接 `get_current_user`，require_permission 内部已 `Depends(get_current_user)`）：
   ```python
   @router.get(
       "/agent-runs/{run_id}/execution-context",
       response_model=ExecutionContextResponse,
   )
   async def get_execution_context(
       run_id: uuid.UUID,
       session: SessionDep,
       user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
   ) -> ExecutionContextResponse: ...
   ```
   **注意**：既有端点路径前缀是 `/workspaces/{workspace_id}/agent/runs/{run_id}/...`（如 75/89/117）。本端点 daemon 调用时**无 workspace_id**（daemon 只持 agent_run_id），故路径用 `/agent-runs/{run_id}/execution-context`（无 workspace 前缀），daemon `HubClient` 拼该路径。

2. **run 归属当前 user 校验**（R-02 应对）：查 `AgentRunWorkspace` M:N 关联 + 该 workspace 的成员身份校验；或更直接：查 AgentRun 创建时的 `user_id`（**需 execute 时确认 AgentRun 是否有 user_id/created_by 字段**，若无则通过 AgentRunWorkspace → Workspace → WorkspaceMember 校验）。**跨 user 访问 → 403**（非 404，明示权限边界）：
   ```python
   # 范式
   if not await _user_owns_run(session, user.id, run_id):
       raise HTTPException(status_code=403, detail="run not owned by current user")
   ```
   > **需 execute 时确认**：`AgentRun` 是否有 `user_id` 列。若无需通过 `AgentRunWorkspace` join `WorkspaceMember` 校验。task-11 测试用例覆盖跨 user 403。

3. **run 类型分发**（依据 task_id / change_id / spec_strategy 字段判定）：
   - **task run**：`agent_run.task_id is not None`（普通 task 执行）→ `build_spec_bundle(...)`
   - **stage run**：`agent_run.agent_type == "stage_dispatch"` 或 lease.metadata 含 `stage`/`step_prompt` → `build_stage_bundle(...)`
   - **scan run**：`agent_run.agent_type == "scan"` 或 lease.metadata 含 `root_path`/`spec_root`/`runtime_root` → `build_scan_bundle(...)`
   - **判定歧义回退**：优先 metadata 字段，其次 task_id/change_id，最后按 agent_type；无法判定 → 400 `{"detail": "cannot determine run type for execution-context"}`。
   > **需 execute 时确认**：`AgentRun.agent_type` 字段值集合；若 stage/scan run 无独立 agent_type 区分，则**完全依赖 lease.metadata 字段**判定（task-03 已确保 stage/scan run 的 metadata 必含 `stage`/`root_path`）。

4. **从 lease.metadata 恢复临时参数**（R-stage 应对，依赖 task-03）：
   - 查 `DaemonTaskLease` where `agent_run_id == run_id` AND `status IN ('pending','claimed')` ORDER BY `created_at DESC` LIMIT 1（参考 `lease_service.py:292-301` 写法）
   - 读 metadata：`prompt` / `provider` / `resume_session_id` / `step_prompt`(stage) / `stage`(stage) / `read_only`(stage) / `root_path`(scan) / `spec_root`(scan) / `runtime_root`(scan) / `repo_url` / `branch` / `allowed_paths` / `tool_config`
   - **CLAUDE.md 不入 metadata**（design §Phase 2 第 111 行明确，可达数十 KB），由本端点实时调 `render_bundle_to_claude_md(bundle)` 生成。

5. **三种 run 类型的 bundle 构建参数注入**（按 metadata 恢复值，调用既有函数，签名不变）：
   - task run：`build_spec_bundle(...)`（参考 service.py:248 既有调用范式，参数 workspace_id/task_id/lease_id 从 agent_run 字段取）
   - stage run：`build_stage_bundle(...)`，注入 `prompt`/`step_prompt`/`stage`/`read_only`/`change_id`（参考 service.py:1015-1040 的 AgentSpecBundle 构建范式，把 stage 上下文注入 task_markdown/platform_metadata）
   - scan run：`build_scan_bundle(...)`，注入 `root_path`/`spec_root`/`runtime_root`（参考 service.py:1269 既有调用范式）
   > **需 execute 时确认**：`build_stage_bundle`/`build_scan_bundle` 的确切参数列表（context_builder.py:318/422，需 Read 完整签名后注入）；本端点必须等价复刻 service.py 既有 bundle 构建逻辑，避免双源漂移。

6. **render_bundle_to_claude_md**：调 `render_bundle_to_claude_md(bundle)`(585) 生成 `claude_md` 字符串，填入 `ExecutionContextResponse.claude_md`。

7. **lease 缺失或无活跃 lease**：若该 run 无 `pending`/`claimed` lease（已完成/已取消），仍**返回上下文**（bundle 可重建），但 `prompt`/`provider`/stage/scan 临时参数可能缺失（从 AgentRun 自身字段 + 历史 lease 兜底）；不抛 404，仅 log warning。daemon 在 run 完成后不会调本端点，本分支主要服务 debug / 异常重放。

8. **鉴权失败处理**：未携带 token / token 失效 → 401（`require_permission` 已处理）；run 归属不匹配 → 403（本端点显式 raise）；run 不存在 → 404（`AgentRunNotFound`）。

## 接口定义

### Pydantic Response（schema.py）

```python
from pydantic import BaseModel, Field

class ExecutionContextResponse(BaseModel):
    """daemon 执行所需的完整上下文（GET /agent-runs/{run_id}/execution-context）。"""

    agent_run_id: str
    claude_md: str = Field(..., description="render_bundle_to_claude_md 输出，daemon 写入 {workDir}/.claude/CLAUDE.md")
    prompt: str | None = None
    provider: str | None = None
    resume_session_id: str | None = None
    repo_url: str | None = None
    branch: str | None = None
    allowed_paths: list[str] | None = None
    tool_config: dict | None = None
    session_id: str | None = None
```

### 端点签名（router.py）

```python
@router.get(
    "/agent-runs/{run_id}/execution-context",
    response_model=ExecutionContextResponse,
)
async def get_execution_context(
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> ExecutionContextResponse:
    """返回 daemon 执行所需的完整上下文。

    1. 查 AgentRun（404 if missing）。
    2. 校验 run 归属当前 user（403 if mismatch）。
    3. 查 active lease（pending/claimed），读 lease.metadata 恢复临时参数。
    4. 按 run 类型分发调 build_spec_bundle / build_stage_bundle / build_scan_bundle。
    5. render_bundle_to_claude_md(bundle) 生成 claude_md。
    6. 组装 ExecutionContextResponse 返回。
    """
```

### 内部分发范式

```python
def _determine_run_type(agent_run: AgentRun, lease_meta: dict) -> str:
    """返回 'task' | 'stage' | 'scan'；无法判定抛 ValueError(→400)。"""
    # 优先 metadata 显式标记（task-03 写入）
    if lease_meta.get("stage") or lease_meta.get("step_prompt"):
        return "stage"
    if lease_meta.get("root_path") or lease_meta.get("spec_root"):
        return "scan"
    # 兜底：agent_type / task_id
    if agent_run.agent_type == "scan":
        return "scan"
    if agent_run.task_id is not None:
        return "task"
    raise ValueError("cannot determine run type for execution-context")
```

### 归属校验范式（execute 时按实际字段调整）

```python
async def _user_owns_run(session: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID) -> bool:
    """校验 run 归属当前 user。

    若 AgentRun 有 user_id 列：直接比对。
    否则：join AgentRunWorkspace → Workspace → WorkspaceMember(user_id=user_id)。
    """
    # 需 execute 时按 AgentRun schema 实现
    ...
```

## 边界处理

1. **（null/空值）** `claude_md` 必填（即使 bundle 为空也返回 `""`，daemon 写空文件不报错）；`prompt`/`provider`/`resume_session_id`/`repo_url`/`branch`/`allowed_paths`/`tool_config`/`session_id` 全部允许 None；metadata 缺失字段返回 None 而非空字符串。
2. **（兼容性 brownfield）** 历史 AgentRun 无关联 lease（lease 已清理）→ 仍返回上下文（从 AgentRun 字段重建），临时参数可能 None；不抛错，仅 log `execution_context_lease_missing`。本项目数据可清空，不处理存量漂移。
3. **（异常不静默吞）** `build_spec_bundle` / `build_stage_bundle` / `build_scan_bundle` / `render_bundle_to_claude_md` 抛异常（如 task_id 对应 Change 不存在）→ **向上抛**（FastAPI 转 500）；不返回部分上下文。
4. **（参数不可变）** 端点不修改 AgentRun / lease 任何字段；只读。
5. **（歧义/冲突）** run 类型判定歧义（如 task_id 和 stage metadata 同时存在）→ 优先 metadata 字段（stage/scan 优先于 task），并在 response header 或 log 记录判定依据；不静默选 task。
6. **（鉴权层级）** `require_permission(Permission.TASK_READ)` 是基础鉴权（任何有读权限的 user 可调），但**run 归属校验**是二次防线（防止 user A 读 user B 的 run bundle，R-02 应对）；两层都过才返回。
7. **（跨 workspace 访问）** 既有端点路径含 `workspace_id`，本端点**不含** workspace_id（daemon 只持 agent_run_id）。归属校验通过 AgentRunWorkspace 反查 workspace 成员，**不依赖路径参数**。

## 非目标

- **不**改 `build_spec_bundle`/`build_stage_bundle`/`build_scan_bundle`/`render_bundle_to_claude_md` 函数签名或内部逻辑（design §6 第 227 行明确「无逻辑改动」）。
- **不**改 dispatch_to_daemon 签名或 lease.metadata 写入逻辑（task-03 范围）。
- **不**改 daemon 侧 fetch 逻辑（task-05 范围）。
- **不**缓存 bundle 生成结果（实时渲染，bundle 内容可能变；如需缓存后续 follow-up）。
- **不**返回完整 conversation log（那是 task-08 / AgentRunLog 范围）。
- **不**支持 POST / 多 run 批量查询（YAGNI，daemon 每次 claim 一个 lease）。
- **不**在端点内做 redact（bundle 内 proposal/design 是开发者文档，daemon 本地消费，redact 范围在 diff/output 收口 task-07）。

## TDD 步骤

1. **写测试** `backend/app/modules/agent/tests/test_execution_context.py`（task-11 主体，本任务先写骨架）：
   - `test_get_execution_context_task_run`：mock task run + lease.metadata(prompt) → response.claude_md 非空 + prompt 回填
   - `test_get_execution_context_stage_run`：mock stage run + lease.metadata(stage/prompt/step_prompt/read_only) → response 含 stage bundle
   - `test_get_execution_context_scan_run`：mock scan run + lease.metadata(root_path/spec_root/runtime_root) → response 含 scan bundle
   - `test_get_execution_context_cross_user_403`：user A 创建 run，user B 调端点 → 403
   - `test_get_execution_context_not_found_404`：不存在的 run_id → 404
   - `test_get_execution_context_unauthenticated_401`：不带 token → 401
2. **确认失败**：`cd backend && uv run pytest app/modules/agent/tests/test_execution_context.py -q` → 全红（端点不存在）。
3. **写实现**：加 `ExecutionContextResponse`（schema.py）+ `get_execution_context`（router.py）+ `_determine_run_type` + `_user_owns_run`。
4. **确认通过**：重跑测试 → 全绿。
5. **回归**：`cd backend && uv run pytest -q`（端点新增不应破坏既有测试）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `curl -s -H "Authorization: Bearer <token>" http://localhost:8000/agent-runs/<task_run_id>/execution-context` | 200 OK，response 含 `claude_md`（非空）+ `prompt` + `provider`（对齐 plan 全局验收 2 task 类型） |
| AC-02 | 同上调，`<stage_run_id>` | 200 OK，`claude_md` 含 stage bundle（含 stage prompt + read_only 标记），`prompt`/stage 参数从 lease.metadata 恢复（对齐 plan 全局验收 2 stage 类型，R-stage 应对） |
| AC-03 | 同上调，`<scan_run_id>` | 200 OK，`claude_md` 含 scan bundle，`root_path`/`spec_root`/`runtime_root` 从 lease.metadata 恢复（对齐 plan 全局验收 2 scan 类型） |
| AC-04 | 用 user B 的 token 访问 user A 的 run（`<run_id>`） | 403 Forbidden（对齐 plan 全局验收 2 跨 user 403，R-02 应对） |
| AC-05 | 不带 token 访问 | 401 Unauthorized |
| AC-06 | 访问不存在的 run_id | 404 Not Found（AgentRunNotFound） |
| AC-07 | 单测：`test_get_execution_context_*`（task/stage/scan 三种类型 + 403 + 404 + 401） | 全绿（对齐 plan 全局验收 2，task-11 完整覆盖） |
| AC-08 | `grep -n "render_bundle_to_claude_md\|build_spec_bundle\|build_stage_bundle\|build_scan_bundle" backend/app/modules/agent/router.py` | 命中（端点确实复用 context_builder，未重复实现渲染逻辑） |
