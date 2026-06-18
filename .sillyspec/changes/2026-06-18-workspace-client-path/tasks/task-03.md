---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-03
priority: P0
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/service.py
---

# Task-03｜`dispatch_to_daemon` daemon-client 强绑路由 + 离线 fail

## 1. 目标

让 daemon-client workspace 的 agent run 强制路由到 `workspace.daemon_runtime_id` 指定的单一 daemon runtime，目标 daemon 离线或不存在时立即失败并提示目标 runtime 标识；server-local workspace 维持现有 `_get_online_runtime(user_id)` 行为不变（design §9 兼容）。

覆盖：**FR-02**、**D-001@v1**。

## 2. 修改文件

| 文件 | 改动概述 |
|---|---|
| `backend/app/modules/agent/placement.py` | `dispatch_to_daemon` 新增 `workspace_id` 参数；新增内部方法 `_resolve_dispatch_runtime(workspace_id, user_id, provider)`，按 workspace.path_source 分流选 runtime；离线/不属于 user/不存在统一抛 `NoOnlineDaemonError` 携 runtime 标识 |
| `backend/app/modules/agent/service.py` | 三处 `dispatch_to_daemon(...)` 调用点（start_run / start_stage_dispatch / start_scan_dispatch）补传 `workspace_id=` 参数 |

## 3. 覆盖来源（文档 → 代码）

- design §5 Phase 4（路由 daemon-client 按 daemon_runtime_id 选 runtime，离线即抛错）
- design §6 文件变更清单（`placement.py`：dispatch_to_daemon daemon-client 按 workspace.daemon_runtime_id 选 runtime）
- design §9 兼容策略（server-local 维持 `_get_online_runtime(user_id)` 不变）
- decisions.md **D-001@v1**（强绑单个 daemon + 离线 fail + 错误携带 runtime 标识）
- requirements.md **FR-02**（GWT 三段：daemon-client 用 daemon_runtime_id / 离线抛 NoOnlineDaemonError / server-local 不变）
- 现状代码：`placement.py:131-261`（dispatch_to_daemon 现按 `_get_online_runtime(user_id, provider)` 选 runtime，line 174）、`placement.py:37-58`（NoOnlineDaemonError，现仅携 workspace_id/user_id/message）、`service.py:294/780/1007`（三处 dispatch 调用点，均持有 `workspace` 与 `workspace_id`）

## 4. 实现要求

### 4.1 数据契约

`dispatch_to_daemon` 路由解析需读取的 workspace 字段（由 task-01 落地）：
- `path_source: str` — `server-local` | `daemon-client`
- `daemon_runtime_id: UUID | None` — daemon-client 时非空（schema validator 已保证，placement 层做防御性校验）

### 4.2 `NoOnlineDaemonError` 扩展

现状签名（placement.py:46-58）：
```python
def __init__(self, *, workspace_id=None, user_id, message=...) -> None
```
扩展为可携带目标 runtime 标识（向后兼容，新参数有默认值）：
```python
def __init__(
    self,
    *,
    workspace_id: uuid.UUID | None = None,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID | None = None,   # 新增：daemon-client 强绑的 daemon_runtime_id
    message: str = "...",
) -> None
```
- `runtime_id` 非空时，默认 message 升级为提示「目标 daemon（{runtime_id}）离线，请启动 sillyhub-daemon 后重试」，便于前端直接展示。
- `service._mark_no_online_daemon` 把 `exc.runtime_id`（若有）一并写入 `AgentRun.output_redacted` / error_code 区分（`no_online_daemon` 仍可用，runtime 标识进 message）。

### 4.3 `dispatch_to_daemon` 签名扩展

新增关键字参数 `workspace_id`（保持向后兼容：默认 None 走 server-local 兼容路径，便于既有测试与未传 workspace 的调用方平滑迁移）：

```python
async def dispatch_to_daemon(
    self,
    agent_run_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    workspace_id: uuid.UUID | None = None,   # 新增
    provider: str | None = None,
    # ...其余现有参数不变
) -> uuid.UUID | None:
```

### 4.4 控制流伪代码

```text
# 在 dispatch_to_daemon 内，替换现 line 174 的单行 _get_online_runtime 调用
runtime = await self._resolve_dispatch_runtime(
    workspace_id=workspace_id,
    user_id=user_id,
    provider=provider,
)
if runtime is None:
    log.warning("dispatch_daemon_no_online_runtime", ...)
    return None   # 与现状一致；上层 decide_backend 已先校验，此处仅兜底

runtime_id = uuid.UUID(runtime["id"]) if isinstance(runtime["id"], str) else runtime["id"]
# 后续 INSERT lease / send_ws_wakeup 不变
```

`_resolve_dispatch_runtime` 内部方法伪代码：

```text
async def _resolve_dispatch_runtime(*, workspace_id, user_id, provider):
    # 分支 0：无 workspace_id（向后兼容 / 老调用方）→ server-local 路径
    if workspace_id is None:
        return await self._get_online_runtime(user_id, provider=provider)

    # 读 workspace（单条 SELECT path_source, daemon_runtime_id）
    ws = await self._session.execute(
        text("SELECT path_source, daemon_runtime_id FROM workspaces WHERE id = :id"),
        {"id": workspace_id.hex},
    )
    row = ws.mappings().first()

    # 分支 1：workspace 不存在 → 视为 server-local 回退（防御性，log warning）
    if row is None:
        log.warning("dispatch_workspace_not_found", workspace_id=...)
        return await self._get_online_runtime(user_id, provider=provider)

    path_source = row["path_source"]
    daemon_runtime_id = row["daemon_runtime_id"]

    # 分支 2：server-local → 现状行为不变（§9 兼容）
    if path_source != "daemon-client":
        return await self._get_online_runtime(user_id, provider=provider)

    # 分支 3：daemon-client 但 daemon_runtime_id 缺失（schema 应拦，防御性兜底）
    if not daemon_runtime_id:
        raise NoOnlineDaemonError(
            workspace_id=workspace_id, user_id=user_id,
            message="daemon-client workspace 未绑定 daemon_runtime_id（数据异常）",
        )

    # 分支 4：daemon-client 强绑路由
    rt_id = uuid.UUID(daemon_runtime_id) if isinstance(daemon_runtime_id, str) else daemon_runtime_id
    rt = await self._query_online_by_id(rt_id)   # 新增内部方法：按 id + status='online' 查
    if rt is None:
        # 离线或不存在 → 立即失败，携带 runtime 标识（D-001）
        raise NoOnlineDaemonError(
            workspace_id=workspace_id, user_id=user_id,
            runtime_id=rt_id,
        )
    # 校验：该 runtime 必须属于当前 user（防越权借用他人 daemon）
    if str(rt["user_id"]) != str(user_id.hex) and rt["user_id"] != user_id:
        raise NoOnlineDaemonError(
            workspace_id=workspace_id, user_id=user_id,
            runtime_id=rt_id,
            message="目标 daemon 不属于当前用户，无法路由",
        )
    # provider 提示：若强绑 runtime 的 provider 与请求 provider 不符，仅 log warning 不回退
    # （D-001 强绑优先；provider fallback 是 server-local 才有的语义）
    if provider and rt.get("provider") and rt["provider"] != provider:
        log.warning("dispatch_bound_runtime_provider_mismatch",
                    wanted=provider, bound=rt["provider"], runtime_id=str(rt_id))
    return rt
```

新增内部方法（紧邻现有 `_query_online`）：

```python
async def _query_online_by_id(self, runtime_id: uuid.UUID) -> dict | None:
    """按 runtime_id 查单条 online daemon runtime（含 user_id 用于归属校验）。"""
    result = await self._session.execute(
        text(
            """
            SELECT id, user_id, provider, status
            FROM daemon_runtimes
            WHERE id = :rid
            """
        ),
        {"rid": runtime_id.hex},
    )
    row = result.mappings().first()
    if not row:
        return None
    # 不在此处过滤 status='online'，便于上层区分「不存在」与「离线」日志
    # 返回 dict；调用方按 row["status"] == 'online' 判定
    return dict(row) if (row and row.get("status") == "online") else None
```

> 注：上面 `_query_online_by_id` 把"离线"和"不存在"统一归并为 `None`（D-001 对用户语义都是「目标 daemon 不可用，请启动」）；如需细分日志，可改为始终返回 row + 调用方判 status。两者皆可，实现取其一并加注释。

### 4.5 `service.py` 三处调用点改造

每处 `placement.dispatch_to_daemon(...)` 调用补一个关键字参数：

| 位置 | 现状 | 改后 |
|---|---|---|
| `service.py:294` (start_run) | `await placement.dispatch_to_daemon(run.id, user_id, repo_url=..., ...)` | 追加 `workspace_id=workspace_id` |
| `service.py:780` (start_stage_dispatch) | 同上 | 追加 `workspace_id=workspace_id` |
| `service.py:1007` (start_scan_dispatch) | 同上 | 追加 `workspace_id=workspace_id` |

三处的 `workspace_id` 均已在各自函数签名中（`start_run(self, ..., workspace_id, ...)` 等），直接传入即可，无需新查询。

### 4.6 `decide_backend` 联动（可选 / 推荐）

`decide_backend`（placement.py:76-125）现状用 `_has_online_runtime(user_id)` 判定 user 级在线。daemon-client workspace 在该判定下可能"误报有 runtime"（user 名下其它 daemon 在线），但 dispatch 时强绑 runtime 离线 → 抛错。为避免「decide 通过、dispatch 失败」的语义割裂，**推荐**让 `decide_backend` 同样感知 workspace：

- 可选最小改：`decide_backend` 内 daemon-client 分支查 `_query_online_by_id(workspace.daemon_runtime_id)`，离线即抛 NoOnlineDaemonError（携带 runtime_id）。
- 若时间紧或希望聚焦 task-03 边界，可保留 decide_backend 现状（user 级），仅在 dispatch 层做强绑校验；此时 `_mark_no_online_daemon` 已能正确把 run 置 failed 并提示目标 runtime，行为正确但多一次"假性 decide 通过"日志。

**本 task 默认采用「decide_backend 同步加 daemon-client 感知」**，与 D-001「离线即失败」语义对齐最干净。decide_backend 已有 `workspace_id` 参数（line 78），无需改签名，仅改内部查询分支。

## 5. 接口定义（最终签名）

```python
# placement.py

class NoOnlineDaemonError(Exception):
    def __init__(
        self,
        *,
        workspace_id: uuid.UUID | None = None,
        user_id: uuid.UUID,
        runtime_id: uuid.UUID | None = None,
        message: str = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试",
    ) -> None: ...


class RunPlacementService:
    async def dispatch_to_daemon(
        self,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        workspace_id: uuid.UUID | None = None,        # 新增
        provider: str | None = None,
        model: str | None = None,
        prompt: str | None = None,
        resume_session_id: str | None = None,
        repo_url: str | None = None,
        branch: str | None = None,
        allowed_paths: list[str] | None = None,
        tool_config: dict | None = None,
        timeout_seconds: int | None = None,
        step_prompt: str | None = None,
        stage: str | None = None,
        read_only: bool | None = None,
        root_path: str | None = None,
        spec_root: str | None = None,
        runtime_root: str | None = None,
        workspace_name: str | None = None,
        workspace_slug: str | None = None,
    ) -> uuid.UUID | None: ...

    # 新增：路由解析（私有）
    async def _resolve_dispatch_runtime(
        self,
        *,
        workspace_id: uuid.UUID | None,
        user_id: uuid.UUID,
        provider: str | None,
    ) -> dict | None: ...

    # 新增：按 id 查 online runtime（私有）
    async def _query_online_by_id(self, runtime_id: uuid.UUID) -> dict | None: ...

    # 既有保留（server-local 兼容路径继续使用）
    async def _get_online_runtime(self, user_id, *, provider=None) -> dict | None: ...
    async def _query_online(self, user_id, *, provider=None) -> dict | None: ...
```

## 6. 边界处理

| # | 场景 | 行为 |
|---|---|---|
| 1 | **server-local workspace**（path_source='server-local' 或 NULL） | 走 `_get_online_runtime(user_id, provider=...)`，行为与现状完全一致（§9 兼容回归） |
| 2 | **daemon-client 且绑定 daemon 离线**（runtime 存在但 status≠online） | 抛 `NoOnlineDaemonError(runtime_id=...)`，message 提示目标 daemon 离线 |
| 3 | **daemon-client 且 daemon_runtime_id 对应 runtime 不存在**（被删/UUID 错） | 同上抛 `NoOnlineDaemonError(runtime_id=...)`（D-001：离线/不存在统一为"不可用"语义） |
| 4 | **daemon-client 且 daemon_runtime_id 为空**（数据异常，schema validator 应已拦） | 防御性抛 `NoOnlineDaemonError`，message="daemon-client workspace 未绑定 daemon_runtime_id（数据异常）" |
| 5 | **目标 runtime 不属于当前 user**（防越权借用他人 daemon） | 抛 `NoOnlineDaemonError`，message="目标 daemon 不属于当前用户，无法路由" |
| 6 | **workspace_id 传入但记录不存在**（理论上不该发生） | log warning，回退 server-local 路径（`_get_online_runtime`），不抛错以保持 dispatch 鲁棒性 |
| 7 | **非目标 path_source 值**（未来扩展/脏数据） | `path_source != 'daemon-client'` 一律按 server-local 处理（白名单语义） |
| 8 | **provider 与强绑 runtime 的 provider 不符** | 仅 log warning（`dispatch_bound_runtime_provider_mismatch`），**不**回退到其它 runtime（D-001 强绑优先；provider fallback 仅 server-local 才有意义） |
| 9 | **decide_backend 通过但 dispatch 时 runtime 刚下线**（race） | dispatch 抛 NoOnlineDaemonError → service `_mark_no_online_daemon` 把 run 置 failed（已有逻辑，无需新写） |
| 10 | **workspace_id=None（老调用方/旧测试）** | 走 server-local 兼容分支，向后兼容不破坏现有 dispatch_metadata 测试 |

## 7. TDD 测试用例

新增测试文件建议：`backend/app/modules/agent/tests/test_dispatch_workspace_routing.py`（沿用现有 `test_dispatch_metadata.py` / `test_no_online_daemon.py` 的 fixture 风格）。

| # | 用例 | 给定 | 当 | 则 |
|---|---|---|---|---|
| T1 | server-local 路由不变 | server-local workspace + user 名下 runtime A online | dispatch(workspace_id=ws) | lease.runtime_id == A.id；不查 daemon_runtime_id |
| T2 | daemon-client 强绑路由 | daemon-client workspace.daemon_runtime_id=B + B online + 属于 user | dispatch(workspace_id=ws) | lease.runtime_id == B.id（即使用户名下还有 A 在线） |
| T3 | daemon-client 离线 fail | daemon-client ws 绑 B，B status=offline | dispatch(workspace_id=ws) | 抛 NoOnlineDaemonError，exc.runtime_id == B.id |
| T4 | daemon-client runtime 不存在 | daemon-client ws 绑 B，daemon_runtimes 无 B | dispatch(workspace_id=ws) | 抛 NoOnlineDaemonError，exc.runtime_id == B.id |
| T5 | daemon-client daemon_runtime_id 为空 | daemon-client ws.daemon_runtime_id=None（绕过 validator 构造） | dispatch(workspace_id=ws) | 抛 NoOnlineDaemonError，message 含"未绑定 daemon_runtime_id" |
| T6 | 跨用户 daemon 拒绝 | daemon-client ws 绑 B，B 属于 other_user | dispatch(workspace_id=ws, user_id=user) | 抛 NoOnlineDaemonError，message 含"不属于当前用户" |
| T7 | workspace 不存在回退 | workspace_id 指向不存在的记录 + user 名下 A online | dispatch(workspace_id=不存在的id) | log warning + lease.runtime_id == A.id（回退 server-local） |
| T8 | provider 不符仅 warning | daemon-client ws 绑 B(provider=codex)，dispatch(provider=claude) | dispatch | lease.runtime_id == B.id；有 dispatch_bound_runtime_mismatch 日志 |
| T9 | 向后兼容（无 workspace_id） | 不传 workspace_id + A online | dispatch(run.id, user_id, prompt=...) | lease.runtime_id == A.id（兼容 test_dispatch_metadata 现有断言） |
| T10 | decide_backend daemon-client 感知 | daemon-client ws 绑 B 离线 | decide_backend(workspace_id=ws) | 抛 NoOnlineDaemonError(runtime_id=B.id)（若采用 §4.6 推荐方案） |

测试约束：
- 沿用 `db_session` fixture（见 test_dispatch_metadata.py）。
- 构造 workspace 行直接 `INSERT INTO workspaces (id, root_path, path_source, daemon_runtime_id, ...) VALUES (...)`，因 task-01 已加列。
- 构造 daemon_runtimes 行同理（status / user_id / provider / last_heartbeat_at 可控）。
- 断言 lease.runtime_id 从 `daemon_task_leases` 表读出。

## 8. 验收表

| AC# | 验收项 | 验证方式 | 关联 |
|---|---|---|---|
| AC-01 | daemon-client workspace dispatch 时 lease.runtime_id == workspace.daemon_runtime_id（即使用户名下还有其它在线 runtime） | T2 | FR-02 / D-001 |
| AC-02 | 绑定 daemon 离线（status≠online）时 dispatch 抛 NoOnlineDaemonError 且 exc.runtime_id 等于 daemon_runtime_id | T3 | FR-02 / D-001 |
| AC-03 | 绑定 daemon_runtime_id 在 daemon_runtimes 表不存在时同样抛 NoOnlineDaemonError(runtime_id=...) | T4 | FR-02 / D-001 |
| AC-04 | daemon-client 但 daemon_runtime_id 为空（数据异常）抛 NoOnlineDaemonError 且 message 可读 | T5 | FR-02 / D-001 |
| AC-05 | 目标 runtime 不属于当前 user 时拒绝路由并抛错（防越权） | T6 | FR-02 / 安全 |
| AC-06 | server-local workspace（path_source='server-local' 或 NULL）dispatch 行为与改造前完全一致（用 `_get_online_runtime(user_id)`） | T1 + 现有 test_dispatch_metadata 全绿 | §9 兼容 / FR-02 第三段 |
| AC-07 | workspace_id=None 时 dispatch 走 server-local 兼容分支，现有 dispatch_metadata 测试零修改通过 | T9 + 全量 `pytest backend/app/modules/agent/tests/` | 向后兼容 |
| AC-08 | service.py 三处 dispatch 调用点均传 `workspace_id=` 参数；改动 diff 仅 +3 行（每处一个关键字参数） | 代码 review | FR-02 |
| AC-09 | provider 与强绑 runtime 不符时仅 warning 不回退（强绑优先） | T8 | D-001 |
| AC-10 | `uv run ruff check backend/app/modules/agent/` 无新增告警 | lint | 工程约束 |
| AC-11 | `uv run pytest backend/app/modules/agent/tests/` 全绿（含现有 test_dispatch_metadata / test_no_online_daemon + 新增 test_dispatch_workspace_routing） | 测试 | 工程约束 |
| AC-12 | 错误信息可读，前端能直接展示「目标 daemon（{runtime_id}）离线，请启动」 | review NoOnlineDaemonError.message 生成逻辑 | FR-02 UX |

## 9. 依赖与影响

- **depends_on: task-01** — 需要 `workspaces.path_source` 与 `workspaces.daemon_runtime_id` 两列已落地（migration 已跑），否则 SELECT 报错。task-01 完成前本 task 测试无法运行。
- **blocks: task-08**（scan/scan-generate daemon 派发）— task-08 调 `dispatch_to_daemon(stage=scan)` 派给绑定 daemon，依赖本 task 的强绑路由生效。
- 不阻塞 task-04/05/06/07/09/10/11（其它 Wave 2/3/4 任务）。
- 不改 daemon 侧、不改 frontend、不改 spec_workspace 模块。

## 10. 风险与备注

- **R-decide-dispatch-race**：若 §4.6 decide_backend 不加 daemon-client 感知，会出现「decide 通过 → dispatch 抛错」的日志割裂；推荐同步改 decide_backend（AC 隐含）。
- **R-provider-fallback-语义变化**：daemon-client 下不再有 provider fallback（D-001 强绑优先）。需在测试 T8 显式覆盖，避免误以为回退丢失。
- **R-user-归属性能**：`_query_online_by_id` 单条主键查询 + 一次 user_id 比对，无 N+1 风险。
- **未覆盖**：daemon 删除时是否级联清理 workspace.daemon_runtime_id 属于 task-01/model 层（R-06 已登记），本 task 仅做"不存在即 fail"的读侧防御。
