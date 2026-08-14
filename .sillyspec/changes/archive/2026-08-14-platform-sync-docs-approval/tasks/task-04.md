---
id: task-04
title: router two POST endpoints + GET approval read-through
title_zh: 两新 POST 端点 + GET approval 改读库
author: qinyi
created_at: 2026-08-14 21:55:00
priority: P1
depends_on: [task-02, task-03]
blocks: [task-05, task-06, task-07]
requirement_ids: [FR-01, FR-02, FR-03, FR-06]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
goal: >
  POST /changes/{name}/documents + POST /changes/{name}/approval 两新端点（require_platform_sync）+
  GET approval 改读 approval 列（无记录默认 approved 放行保持兼容）。
implementation:
  - POST documents：body DocumentsSyncRequest → service.upsert_documents → 200 DocumentsSyncOk
  - POST approval：body ApprovalSubmitRequest → decided_by = auth 解包 User.username（权威，禁 header fallback，Grill UB-2）→ service.set_approval → 200 ApprovalSubmitOk
  - GET approval 改造：service.get_approval_record 返回 None → ChangeApprovalResponse(status="approved", reason="no approval record; default-approved")；有记录 → status/reason 从 approval JSON 映射
  - 模块 docstring 端点清单同步（"3 端点"→"6 端点"）
acceptance:
  - 404→200（documents）/ 405→200（approval）/ GET 三态正确
verify:
  - uv run pytest app/modules/platform_sync -q --no-cov
constraints: 不改现有 3 端点路由签名；GET approval 对占位行（仅 documents/approval 有值）照常可读审批。
---
