---
author: qinyi
created_at: 2026-07-03 08:33:48
change: 2026-07-02-decouple-scan-from-change-flow
---

# Tasks: scan 从变更流程彻底移除

> 本表只列任务名称 / 文件 / 覆盖的需求与决策。Wave 分组、依赖关系、详细步骤在 plan 阶段展开。

| 任务 | 文件 | 覆盖 |
|---|---|---|
| task-01 后端状态机收敛 5 段 | `backend/app/modules/change/model.py`（StageEnum 删 SCAN / spec_stages / TRANSITIONS）、`dispatch.py`（STAGE_ORDER / STAGE_AGENT_CONFIG / assert） | FR-01, FR-03, D-001 |
| task-02 新建变更起点 brainstorm | `backend/app/modules/change/service.py:654-655`（draft→brainstorm）、`parser.py:589`（scan→brainstorm） | FR-02, D-001 |
| task-03 删 scan stage 派发资源 | `backend/app/modules/change/prompts/scan.md`（删除） | FR-03 |
| task-04 前端步骤条 5 段 | `frontend/.../changes/[cid]/page.tsx`（WORKFLOW_STAGES 去 scan）、`changes/page.tsx`（筛选去 scan） | FR-04 |
| task-05 未扫描 workspace 门禁 | `backend/app/modules/change/service.py` create/注册路径（检查 last_scanned_at / scan_docs） | FR-05, D-004 |
| task-06 alembic 存量迁移 | `backend/migrations/versions/202607022300_remove_scan_from_change_flow.py`（down_revision 接真实 head） | FR-06, D-005 |
| task-07 测试更新 | `test_dispatch.py` / `test_gate_transitions.py` / `test_complete_stage.py` / `test_projection.py`（scan→brainstorm）；`runtime/test_router.py` 与 `agent/test_execution_context*.py` 的 workspace-scan 不动 | FR-01~FR-06 |
| task-08 验证 | 后端 pytest + 前端 vitest + 手动确认变更详情页步骤条 | SC-1~SC-7 |
