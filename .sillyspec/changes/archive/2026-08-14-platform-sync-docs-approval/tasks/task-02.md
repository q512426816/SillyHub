---
id: task-02
title: schema DTOs for documents + approval
title_zh: 四个新 schema DTO
author: qinyi
created_at: 2026-08-14 21:55:00
priority: P1
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
goal: >
  定义 DocumentsSyncRequest / ApprovalSubmitRequest / DocumentsSyncOk / ApprovalSubmitOk，body 契约照
  CLI sync.js 字面（D-004@v1）。
implementation:
  - DocumentsSyncRequest：RootModel[dict[str, str]] + validator 白名单 {proposal.md, design.md, requirements.md, tasks.md}，空 map / 白名单外键 / 值非 str → 422
  - ApprovalSubmitRequest：decision: Literal["approved", "rejected"]（过去式，sync.js:961），reason: str | None = None（**default None 必须可缺省**——CLI approved 分支 body 不带 reason 键，Grill UB-3）
  - DocumentsSyncOk：{synced: int, change_name: str}
  - ApprovalSubmitOk：{status: str, decision: str, change_name: str}
acceptance:
  - 三种非法 documents body 与非法 decision 均 422；合法 body 全通过
verify:
  - uv run pytest app/modules/platform_sync -q（task-05 用例落地后全绿；本 task 先保证 import 无误）
constraints: 不动现有 DTO（ChangeListItem/ConflictResponse/ProgressSyncOk/ChangeApprovalResponse）。
---
