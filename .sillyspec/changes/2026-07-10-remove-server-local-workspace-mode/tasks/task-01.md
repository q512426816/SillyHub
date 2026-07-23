---
id: task-01
title: Remove path_source/daemon_runtime_id from workspace model + schema
title_zh: workspace model + schema 删 path_source/daemon_runtime_id 字段及索引
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-12]
requirement_ids: [FR-2, FR-4, FR-5]
decision_ids: [D-005]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - backend/app/modules/workspace/schema.py
---

## goal

删除 workspace ORM model 的 `path_source` / `daemon_runtime_id` 两列与 `ix_workspaces_daemon_runtime_id` 索引，并清除 schema 各 DTO 上对应字段及 `PathSourceLiteral` 类型别名。这是 Wave 1 schema 定型前置，为后续 task-03~09 的 service/router/delegate/agent 清除提供编译期断链依据——列删除后任何残留 `ws.path_source` / `ws.daemon_runtime_id` 访问都会 AttributeError，从而被全量 pytest 抓出。覆盖 design §6 文件清单前两行 + §8 数据模型 + D-005。

## implementation

### model.py（backend/app/modules/workspace/model.py）

1. 删 `__table_args__` 中的索引行（line 35）：
   `Index("ix_workspaces_daemon_runtime_id", "daemon_runtime_id"),`
2. 删 `path_source` 字段定义（line 64-75，含 6 行注释 + Field）。
3. 删 `daemon_runtime_id` 字段定义（line 76-86，含 4 行注释 + Field，含 `ForeignKey("daemon_runtimes.id")`）。
4. 若删字段后 `ForeignKey` 在文件顶 import 中变未使用，保留 import（其他字段仍可能用，逐字核实；当前仅 daemon_runtime_id 用 ForeignKey，需一并从 `from sqlalchemy import ...` 移除 `ForeignKey`）。
5. 不动 `root_path`（保留，语义统一为 daemon 侧根路径，design §8）。

### schema.py（backend/app/modules/workspace/schema.py）

1. 删 `PathSourceLiteral` 类型别名（line 13）。
2. `ScanGenerateRequest`（line 57-100）：删 `path_source`（71）+ `daemon_runtime_id`（72）+ 其上 4 行注释（68-71）；保留 `daemon_id`（77）与 `spec_strategy`（80）；**删 `_validate_daemon_binding` model_validator 整个方法**（87-100），因为校验逻辑完全建立在 `path_source == "daemon-client"` 上，删字段后无意义（daemon_id 必填校验由 service 层 task-03 处理）。
3. `WorkspaceCreate`（line 110-182）：删 `path_source`（138）+ 上方注释（135-137）；删 `daemon_runtime_id`（142）+ 上方注释（139-141）；保留 `daemon_id`（146）与 `spec_strategy`（150）；**删 `_validate_daemon_binding` model_validator**（169-182）。
4. `WorkspaceUpdate`（line 185-235）：删 `path_source`（214）+ 上方注释（211-213）；删 `daemon_runtime_id`（215）；**删 `_validate_daemon_binding` model_validator**（229-235）。
5. `WorkspaceRead`（line 246-275）：删 `path_source: PathSourceLiteral`（273）+ `daemon_runtime_id: uuid.UUID | None`（274）。
6. 清理删字段后可能遗留的孤立 import：若 `Literal` 仍被 `WorkspaceStatusLiteral` / `SpecStrategyLiteral` 用则保留。

## 验收标准

- model.py 不再含 `path_source` / `daemon_runtime_id` / `ix_workspaces_daemon_runtime_id` 字样。
- schema.py 不再含 `PathSourceLiteral` / `path_source` / `daemon_runtime_id` 字样（含注释与 docstring）。
- `WorkspaceCreate` / `WorkspaceUpdate` / `ScanGenerateRequest` / `WorkspaceRead` 四个 DTO 均无两字段。
- 四个 `_validate_daemon_binding` model_validator 全部删除（不留空壳）。
- `root_path` 字段保留不动。
- `daemon_id` / `spec_strategy` 字段保留不动。
- 文件可被 Python import 无 SyntaxError / NameError。

## verify

```bash
# 1. import 冒烟（schema 定型后下游必断链，此时只验证本任务两文件自身可导入）
cd backend
uv run python -c "from app.modules.workspace.model import Workspace; from app.modules.workspace.schema import WorkspaceCreate, WorkspaceUpdate, WorkspaceRead, ScanGenerateRequest; print('ok')"

# 2. 类型检查（本任务两文件）
uv run mypy app/modules/workspace/model.py app/modules/workspace/schema.py

# 3. grep 零残留（本任务两文件）
uv run python -c "import pathlib; t=pathlib.Path('app/modules/workspace/model.py').read_text()+pathlib.Path('app/modules/workspace/schema.py').read_text(); assert 'path_source' not in t and 'daemon_runtime_id' not in t and 'PathSourceLiteral' not in t, 'residue found'; print('clean')"
```

注：全量 `uv run pytest` 此时**必失败**（下游 service/router/delegate 大量引用两字段，task-03~09 才修），本任务不跑全量 pytest，只跑上述冒烟 + mypy + grep。全量绿在 task-13 守。

## constraints

- **纯删除**，不新增任何字段/方法/ import。
- **列名精确**：`path_source` / `daemon_runtime_id` / `ix_workspaces_daemon_runtime_id`（索引名带 `ix_` 前缀，alembic 迁移 task-02 会显式 DROP，PG 下 DROP COLUMN 自动级联删索引，迁移不靠 model 定义）。
- **不删** `daemon_id`（daemon_instances FK，daemon-entity-binding 稳定绑定键）、`spec_strategy`（spec 同步策略）、`root_path`（语义统一为 daemon 侧根路径）。
- **不写 alembic migration**——DB 层 DROP COLUMN 由 task-02 独立迁移处理（down=7c77e09b84e1），本任务只改 ORM model 定义。
- **不碰** service.py / router.py / 其他模块——属 task-03~09。
- 删字段后顶 import 若 `ForeignKey` 变孤儿需一并清理（当前 model.py 仅 `daemon_runtime_id` 用 ForeignKey）。
- TDD 非强制（纯删除无新逻辑可先写测试），但删完两文件必须能独立 import。
