---
author: WhaleFall
created_at: 2026-06-04 13:44:54
---

# Tasks: 修正 Agent 驱动变更中心流程闭环

## 后端状态机

- [ ] task-01: 修正 resolve_human_gate 全返回 none — `backend/app/modules/change/service.py`
- [ ] task-02: 新增 complete_stage 统一入口 — `backend/app/modules/change/service.py`, `backend/app/modules/change/dispatch.py`
- [ ] task-03: 新增 rerun_stage 同阶段重跑 — `backend/app/modules/change/service.py`
- [ ] task-04: TRANSITIONS 加 verify→propose 回退边 — `backend/app/modules/change/model.py`

## 后端 Review API 修正

- [ ] task-05: 修正 proposal-review（approve→plan, revise→rerun, unclear→brainstorm） — `backend/app/modules/change/service.py`
- [ ] task-06: 修正 plan-review（approve→execute, replan→rerun, back_to_propose, back_to_brainstorm） — `backend/app/modules/change/service.py`
- [ ] task-07: 修正 human-test（pass→archive+need_archive_confirm, bug→quick, doc_mismatch→propose） — `backend/app/modules/change/service.py`
- [ ] task-08: 新增 archive-confirm API — `backend/app/modules/change/schema.py`, `backend/app/modules/change/router.py`, `backend/app/modules/change/service.py`

## 前端 Gate 面板

- [ ] task-09: Gate 面板加 comment textarea — `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- [ ] task-10: 修 need_archive_confirm 按钮调 archiveConfirm — `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`, `frontend/src/lib/changes.ts`
- [ ] task-11: 清理 ready_for_dev/accepted/旧审批残留 — `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`

## 测试

- [ ] task-12: 后端状态流转测试（complete_stage + rerun_stage + archive-confirm） — `backend/app/modules/change/tests/`
- [ ] task-13: 前端手工 E2E 验证
