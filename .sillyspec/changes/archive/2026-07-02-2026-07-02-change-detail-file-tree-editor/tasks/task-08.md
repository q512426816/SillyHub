---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-08
title: 4 新 router 端点 + schema + 删 documents 死端点 + 删 get_document_content
priority: P0
depends_on: [task-03, task-04, task-05, task-06, task-07]
wave: W4
requirement_ids: [FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/service.py
---

# task-08 — 4 新端点 + schema + 删死代码（D-008）

## 目标
接线 task-03/04/05/06/07 的 service 方法为 4 个 HTTP 端点，新增 schema，删除被文件树替代的死端点与 service 方法（D-008@v1）。

## 依据
- design.md §5 Phase1/2/3、§6 文件变更清单、§7 接口定义、§9 兼容策略、§11 D-008。
- plan.md Wave4 task-08 行 + 覆盖矩阵 D-005@v1（POST 时 resync）。
- 现有范式 router.py:57-151（`require_permission(Permission.CHANGE_READ/CREATE)` + `SessionDep` + `ChangeService(session)` 实例化）。
- 死代码定位：router.py:130-151（`get_change_document`）+ service.py:211-265（`get_document_content`）。

## schema.py 新增（design §7 原文）
```python
class ChangeFileEntry(BaseModel):
    path: str; name: str; size: int
    last_modified_at: datetime | None; is_text: bool
class ChangeFileList(BaseModel):
    change_id: uuid.UUID; items: list[ChangeFileEntry]
class ChangeFileContent(BaseModel):
    path: str; content: str | None; exists: bool
class ChangeFileWriteRequest(BaseModel):
    path: str; content: str
class ChangeFileWriteResponse(BaseModel):
    status: Literal["done", "pending"]; task_id: uuid.UUID | None = None
class PendingFileEntry(BaseModel):
    path: str; status: Literal["pending", "claimed"]; created_at: datetime
class PendingFileList(BaseModel):
    items: list[PendingFileEntry]
```
加 `from typing import Literal` 导入。

## router.py 新增 4 端点（prefix 已有 `/workspaces/{workspace_id}`）
- `GET /changes/{change_id}/files` → `ChangeFileList`，调 `service.list_files(workspace_id, change_id)`，权限 `CHANGE_READ`。
- `GET /changes/{change_id}/files/content` → `ChangeFileContent`，query `path: str`，调 `service.read_file(workspace_id, change_id, path)`，权限 `CHANGE_READ`。
- `POST /changes/{change_id}/files/content` body `ChangeFileWriteRequest` → `ChangeFileWriteResponse`，调 `service.write_file(workspace_id, change_id, path, content)`，权限 `CHANGE_CREATE`。
- `GET /changes/{change_id}/files/pending` → `PendingFileList`，调 `service.list_pending_files(workspace_id, change_id)`，权限 `CHANGE_READ`。

四端点签名仿 `get_change`（router.py:86-99）：`workspace_id`/`change_id`/`session: SessionDep`/`_user: Annotated[User, Depends(require_permission(...))]`。service 方法签名以 task-03/04/05/07 实际实现为准（task-08 仅接线，不重复路径守卫/截断逻辑——由 service 层负责）。

## 删除（D-008@v1 死代码清理）
- router.py:130-151 整个 `get_change_document` 端点（`GET /changes/{change_id}/documents/{doc_type}`）。
- router.py import 段移除 `ChangeDocContent`（仅此端点用，grep 确认）。
- service.py:211-265 整个 `get_document_content` 方法（含其唯一引用的 `ChangeDocNotFound` 异常导入若变孤儿一并清，需 grep 确认其它处无引用再删）。
- schema.py:84-88 `ChangeDocContent` 类。

## 保留（勿误删）
- `get_change_documents` 端点（router.py:101-127）+ `get_documents` service 方法（service.py:201-209）+ `ChangeDocMatrix`/`ChangeDocMatrixEntry` schema —— `check_archive_gate`（service.py:675）仍依赖。
- `ChangeDocNotFound` 若 service 其它处仍 raise 则保留导入。

## 验收标准
- `cd backend && python -m pytest app/modules/change/tests/ -q`（含现有 router 测试零回归 + task-13 新增 files 测试如已就绪）。
- `ruff check app/modules/change/` + `mypy app/modules/change/`。
- 手测 4 端点（curl/httpie）：list 返回扁平 path 清单、content 读出文本、write server-local 返 `done`/daemon-client 返 `pending`、pending 列出排队行。
- 启动重建容器（main.py import）无 crash-loop（[[backend-router-change-run-router-tests]] 坑）。

## 约束
- 权限按现有模式：读 `CHANGE_READ`、写 `CHANGE_CREATE`。
- 路径守卫/1MB 截断/path_source 分流均在 service（task-04/05），router 不重复。
- mypy `# type: ignore[code]` 后禁中文（[[mypy-type-ignore-no-chinese]]）。
- 改完 router 必跑 test_router 不只 test_service（[[backend-router-change-run-router-tests]]）。

## 风险
- 删 `ChangeDocContent`/`get_document_content` 前必须 grep 确认无其它引用（前端 wrapper 在 task-12 删，后端此处先删 endpoint 即断前端调用，需与 task-11/12 顺序协调——但 endpoint 删除本身不破坏后端启动）。
- service 方法签名若 task-03/04/05/07 与 design §7 微调（如返回 dataclass vs tuple），router 接线时按实际签名适配。
