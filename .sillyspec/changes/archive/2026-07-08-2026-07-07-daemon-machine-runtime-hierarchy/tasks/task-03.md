---
id: task-03
title: router 新增 GET /machines + PATCH /machines/{id} + POST /machines/{id}/self-update（覆盖 FR-1,2,3）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-02]
blocks: [task-05]
requirement_ids: [FR-1, FR-2, FR-3]
decision_ids: [D-001]
allowed_paths:
  - backend/app/modules/daemon/router.py
provides: {}
expects_from:
  task-01:
    - contract: DaemonMachineListResponse
      needs: [items, total, limit, offset]
    - contract: DaemonMachineRead
      needs: [id, hostname, status, runtime_count, online_runtime_count]
    - contract: DaemonMachineUpdate
      needs: [display_alias]
  task-02:
    - contract: DaemonService.list_machines
      needs: [actor_user_id, is_platform_admin, q, status, provider, user_id, limit, offset]
    - contract: DaemonService.update_machine_alias
      needs: [instance_id, actor_user_id, display_alias, display_alias_set, is_platform_admin]
    - contract: DaemonService._get_owned_instance
      needs: [instance_id, actor_user_id, is_platform_admin]
---

# task-03 — router 三个机器级 HTTP 端点

## goal
新增 `GET /machines`、`PATCH /machines/{instance_id}`、`POST /machines/{instance_id}/self-update` 三个机器级 HTTP 端点，显式 `response_model`，统一 `RuntimeAdminUser` 权限 + 机器归属校验（D-001）。

## implementation
- `GET /machines`（`response_model=DaemonMachineListResponse`）：
  - Query 参数 `q: str|None=Query(max_length=200)`、`status: str|None`、`provider: str|None`、`user_id: uuid|None`、`limit: int=Query(default=20, ge=1, le=100)`、`offset: int=Query(default=0, ge=0)`（D-007 机器级分页）。
  - 依赖 `user: RuntimeAdminUser`；`svc = DaemonService(session)` → `await svc.cleanup_stale_runtimes()`（与 `list_runtimes_page` L462 一致先收敛 stale）→ `rows, total = await svc.list_machines(actor_user_id=user.id, is_platform_admin=user.is_platform_admin, ...)` → 返回 `DaemonMachineListResponse(items=..., total=total, limit=limit, offset=offset)`。
- `PATCH /machines/{instance_id}`（`response_model=DaemonMachineRead`）：
  - body: `data: DaemonMachineUpdate`；`svc.update_machine_alias(instance_id, user.id, display_alias=data.display_alias, display_alias_set="display_alias" in data.model_fields_set, is_platform_admin=user.is_platform_admin)`（省略=不变/显式 null=清空，语义对齐 `update_runtime` L497）；返回重新聚合的 `DaemonMachineRead`。0-runtime 机器亦直写 instance，归属校验由 service 层 `_get_owned_instance` 完成（越权 403 / 不存在 404）。
- `POST /machines/{instance_id}/self-update`（返回 `dict[str, str|bool]`，无 response_model）：
  - 先 `svc._get_owned_instance(...)` 做归属校验（403/404）→ lazy import `get_daemon_ws_hub` + `get_daemon_latest_version()` → `sent = await hub.send_self_update(instance_id, version=latest)`；`if not sent: raise DaemonRuntimeOffline(...)`（504，与 `trigger_daemon_self_update` L603 同款）。返回 `{"sent": True, "latest_version": latest}`。
- 路径声明位置：`/machines` 为独立固定前缀，不与 `/runtimes/{runtime_id}` 动态段冲突（design §5.1 / §14）；新增端点集中声明在一处，避免分散。

## 验收标准
- 三个端点均显式声明 `response_model`（POST 除外，沿用现有 self-update 的 dict 返回）。
- `RuntimeAdminUser` 权限生效：admin 看全部/普通用户仅自己（service 层追加 `user_id == actor`，请求 `user_id` 被忽略）。
- `PATCH /machines/{id}`：正常更新 / 显式 null 清空；越权 403；不存在 404；0-runtime 机器可改。
- `POST /machines/{id}/self-update`：按 instance 路由；离线或 WS 发送失败 → 504 `DaemonRuntimeOffline`。
- 既有 `/runtimes/*` 全部端点（page/usage/{id}/allowed-roots/{id}/self-update 等）契约不删不改。
- `mypy` / `ruff` 通过。

## verify
- `cd backend && uv run mypy app`
- `cd backend && uv run ruff check app/modules/daemon/router.py`

## constraints
- 保留现有 `/runtimes/*` 全部端点不删不改契约（design §5.4、§14 生命周期豁免）。
- self-update 复用既有 `daemon:self_update` WS 消息，不引入新事件 type（design §14）。
- 不新增 daemon 侧代码（daemon 进程协议不动）。
- 不放实现代码细节，仅描述契约与调用链。
