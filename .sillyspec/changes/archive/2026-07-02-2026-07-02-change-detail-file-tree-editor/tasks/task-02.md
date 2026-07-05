---
id: task-02
title: DaemonChangeWrite 加 kind 列 + migration + schema 透传
author: qinyi
created_at: 2026-07-02 11:01:00
priority: P0
depends_on: []
blocks: [task-05, task-07]
requirement_ids: [FR-05, FR-08]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/schema.py
  - backend/migrations/versions/
---

## goal

给 `DaemonChangeWrite` 加 `kind` 列（`create` / `edit`），让 task-05 编辑保存入队时能用 `kind="edit"` 区分创建行；task-07 `list_pending_files` 按 `kind="edit"` 过滤避免误纳 create 行。覆盖 FR-05（写回分流）/ FR-08（pending 查询过滤）。依据 design §6（model/schema 行）、§8（数据模型 `kind VARCHAR DEFAULT 'create' NOT NULL`）、§7.5（必需字段落点）、§9（brownfield 旧行默认 create 行为不变）。

## implementation

1. **model.py** `DaemonChangeWrite`（model.py:288-365）在 `status` 字段附近加：
   ```python
   kind: str = Field(
       default="create",
       sa_column=Column(
           String(20), nullable=False, server_default=text("create"),
       ),
   )
   ```
   加注释：`# create: proxy_create_change 入队（默认，行为不变）；edit: POST files/content 编辑保存入队（task-05）`。对齐同表 `status` / `DaemonTaskLease.kind`（model.py:237-244）的 `server_default=text(...)` 写法。

2. **schema.py** `ChangeWritePendingItem`（schema.py:359-368）加 `kind: str` 字段（透传 daemon 轮询 payload，让 daemon 不依赖也零影响——daemon 只读 files 写盘）；`ChangeWriteClaimResponse`（schema.py:371-378）也加 `kind: str`（claim 回执带上，完整契约）。

3. **migration**（新文件 `backend/migrations/versions/202607021100_add_kind_to_daemon_change_writes.py`）：
   - `revision = "202607021100_add_kind_to_daemon_change_writes"`（唯一 id，规避多 head R-01）。
   - `down_revision = "202607011300"`（接当前真实 head，即 merge 节点 202607011300_merge_align_change_and_collaborative_heads.py:20）。
   - `upgrade()`：`op.add_column("daemon_change_writes", sa.Column("kind", sa.String(length=20), nullable=False, server_default="create"))`。
   - `downgrade()`：`op.drop_column("daemon_change_writes", "kind")`。
   - 文件头 docstring 仿 202606301500_reparse_field_length.py 格式（Revision ID / Revises / Create Date + 中文说明）。

## 验收标准
- `DaemonChangeWrite` 含 `kind` 字段，默认 `"create"`，`server_default="create"`（brownfield 旧行自动补 create）。
- `ChangeWritePendingItem` / `ChangeWriteClaimResponse` 含 `kind: str`。
- migration 文件 revision 唯一、down_revision 接真实 head、upgrade/downgrade 对称。

## verify

执行（在 `backend/` 下）：
- `python -m alembic heads` → 单 head（无 Multiple head revisions）。
- `python -m alembic upgrade head` → 无报错，`daemon_change_writes` 多 `kind` 列。
- `python -m alembic downgrade -1` → 回滚成功，`kind` 列消失。
- `python -c "from app.modules.daemon.model import DaemonChangeWrite; print(DaemonChangeWrite.__table__.c.kind)"` → 不崩，列存在。
- 现有 daemon 测试 `python -m pytest app/modules/daemon/tests/ -q` 零回归（kind 默认 create 行为不变）。

## constraints

- **R-01 migration 链不断**（P0）：revision id 必须唯一；down_revision 接 execute 时真实 head（当前 202607011300）。execute 时先 `alembic heads` 复核仍为单 head；若 head 已变（并行变更 merge），改 down_revision 接新 head。本地 PG 若断链，`down -v` 重置（项目未上线，勿 stamp）。
- **brownfield 旧行**：`server_default="create"` 让历史 `proxy_create_change` 行自动补 `create`，行为完全不变。
- **不改 daemon 端消费逻辑**：`runChangeWrite`（task-runner.ts:1558-1606）通用写 `files[]`，无 create 专属副作用（design §12 自审已核实）；kind 仅 backend 侧用于 pending 过滤，daemon 不读不依赖。旧 daemon claim/complete edit-kind 行为与 create 一致（向前兼容，design §9）。
- 不改 `proxy_create_change` 创建路径（kind 默认 create，`_await_change_write_receipt` 60s 不动，design §9）。
- 本任务不动 service / router，仅 model + schema + migration（task-05/07/08 才接线读写逻辑）。
