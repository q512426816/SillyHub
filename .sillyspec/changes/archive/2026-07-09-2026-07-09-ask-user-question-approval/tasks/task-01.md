---
id: task-01
title: 新增 WorkspaceDialogRead DTO（扩展 SessionDialogRead + 来源字段）
title_zh: 新增工作区级对话查询 DTO
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: []
blocks: [task-02]
allowed_paths:
  - backend/app/modules/daemon/permission_service.py
provides:
  fields: [WorkspaceDialogRead]
expects_from: {}
---

## 目标

在 `permission_service.py` 现有 `SessionDialogRead`（:110-140）基础上，新增 `WorkspaceDialogRead` dataclass，加 4 个来源上下文字段（D-002/D-003），**全部 Optional**，供 task-02 的 `list_pending_dialogs_for_workspace` 返回。本任务只加 DTO + `from_model` 扩展，不接端点、不改既有调用方。

依据：design §4.1（DTO 字段）/ §5.2（新增扩展）/ §6 D-003。

## 实现

`backend/app/modules/daemon/permission_service.py`：

1. **新增 `WorkspaceDialogRead`**（紧跟 `SessionDialogRead` 之后，同文件同风格 `@dataclass(frozen=True, slots=True)`）：
   - 复用 `SessionDialogRead` 全部字段：`id / session_id / run_id / request_id / tool_name / dialog_kind / dialog_payload / status / answer / created_at / answered_at`
   - 加 4 个来源字段，**全 `Optional`、`default=None`**：
     - `workspace_id: uuid.UUID | None = None`
     - `workspace_name: str | None = None`
     - `session_type: str | None = None`（scan / chat / stage，D-003）
     - `run_summary: str | None = None`（任务 prompt 派生，可空，D-003）

2. **新增 `from_model` 类方法**（重载签名，参数比 SessionDialogRead 多 4 个上下文入参，全 keyword + 默认 None）：
   ```
   @classmethod
   def from_model(
       cls,
       row: SessionDialogRequest,
       *,
       workspace_id: uuid.UUID | None = None,
       workspace_name: str | None = None,
       session_type: str | None = None,
       run_summary: str | None = None,
   ) -> "WorkspaceDialogRead":
   ```
   - 内部照搬 `SessionDialogRead.from_model` 的字段映射（status 兜底 `"pending"`）+ 填 4 个上下文字段

3. **不动** `SessionDialogRead` 本体与其既有调用方（:127 from_model）。

## 验收标准

- `WorkspaceDialogRead` 字段齐全（11 既有 + 4 新增）。
- 4 个来源字段全 `Optional` 且 `default=None`（D-003，可空语义）。
- `from_model` keyword-only 上下文入参，默认 None，不破坏 `SessionDialogRead.from_model` 既有用法。
- 中文 docstring 说明「工作区级 dialog 查询 DTO，来源字段由 JOIN 填充，可空」。

## 验证

```
cd backend
uv run pytest -q app/modules/daemon/    # 既有测试不回归
uv run mypy app                          # 类型干净（注意 type:ignore 注释禁带中文）
```

## 约束

- 遵循 D-003：来源字段语义（session_type 推导规则 / run_summary 可空）由 task-02 填充，DTO 只承载。
- 只改 `permission_service.py` 一个文件，不碰 `schema.py`（DTO 实际定义在此文件，design §9「schema.py +WorkspaceDialogRead」属措辞便利，落点以既有 `SessionDialogRead` 所在文件为准）。
- 不动既有 `SessionDialogRead` 调用方（:127），不接 router，本任务无端点改动。
