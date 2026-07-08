---
id: task-01
title: schema 新增 DaemonMachineRead/DaemonMachineListResponse/DaemonMachineUpdate（覆盖 FR-1,2,3）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-05]
requirement_ids: [FR-1, FR-2, FR-3]
decision_ids: [D-002, D-003, D-007]
allowed_paths:
  - backend/app/modules/daemon/schema.py
provides:
  - contract: DaemonMachineRead
    fields: [id, hostname, display_alias, os, arch, status, last_heartbeat_at, version, build_id, created_at, owner, runtime_count, online_runtime_count, runtimes]
  - contract: DaemonMachineListResponse
    fields: [items, total, limit, offset]
  - contract: DaemonMachineUpdate
    fields: [display_alias]
expects_from: {}
---

## goal
在 schema.py 新增三个 Pydantic 模型，作为机器级聚合读视图 DTO，承载 design §5.1（`GET /machines` 响应 + `PATCH /machines/{id}` 请求体），供 task-02/03 后端组装与 task-05 前端消费。

## implementation
- 在现有 `DaemonInstanceRead` 附近（约 schema.py:230 之后）新增一段 `# ── Daemon machines（machine→runtime 两级）` 分段注释，附中文说明：entity-binding 已把机器级字段上提到 daemon_instances，本 DTO 直接读 instance 行 + 嵌套其下 runtimes。
- `DaemonMachineRead(BaseModel)`：含机器字段 `id/hostname/display_alias/os/arch/status/last_heartbeat_at/version/build_id/created_at`（与 design §5.1 类型/可空性一致，`status:str`、`last_heartbeat_at:datetime|None`、`created_at:datetime`），`owner:OwnerRead|None=None`（JOIN users），派生 `runtime_count:int` + `online_runtime_count:int`，`runtimes:list[DaemonRuntimeRead]=Field(default_factory=list)`；`model_config={"from_attributes":True}`。
- `DaemonMachineUpdate(BaseModel)`：仅 `display_alias:str|None=Field(default=None,max_length=200)`，中文注释说明「省略=不变，显式 null/空白=清空」（对齐 `DaemonRuntimeUpdate` 语义）。
- `DaemonMachineListResponse(BaseModel)`：`items:list[DaemonMachineRead]` + `total/limit/offset:int`，仿 `DaemonRuntimeListResponse`。

## 验收标准
- 三个模型可在 `backend/app/modules/daemon/schema.py` 被 import（`from app.modules.daemon.schema import DaemonMachineRead, DaemonMachineListResponse, DaemonMachineUpdate`）。
- 字段名/类型/可空性与 design §5.1 完全一致；`runtimes` 复用既有 `DaemonRuntimeRead`，`owner` 复用既有 `OwnerRead`。
- 不改动 `DaemonRuntimeRead` / `DaemonInstanceRead` / `OwnerRead` 既有任何字段（纯新增）。
- mypy / ruff 对 schema.py 通过。

## verify
- `cd backend && uv run mypy app`
- `cd backend && uv run ruff check app/modules/daemon/schema.py`

## constraints
- 不改 `DaemonRuntimeRead` / `DaemonInstanceRead` / `OwnerRead` 既有字段与 validator。
- 0 改表（仅复用 entity-binding 已建两级模型）。
- 不加 `estimated_hours`；本卡只写契约定义，不放端点/SQL/组装实现代码（实现留 task-02/03）。
- `provides.fields` 已含 consumer（task-02/03/05）需读字段，勿删。
