---
author: WhaleFall
created_at: 2026-06-03 15:17:41
---

# Tasks

> 细节在 plan 阶段展开，此处只列任务名与对应文件。

## 后端

- [ ] T1: scan_generate 幂等返回进行中 scan run — `backend/app/modules/workspace/service.py`
- [ ] T2: _execute_scan_run 成功收尾自动 reparse 子组件（失败仅 warning）— `backend/app/modules/agent/service.py`
- [ ] T3: scan_generate 幂等返回单测 — `backend/app/modules/workspace/tests/test_service.py`
- [ ] T4: _execute_scan_run 收尾 reparse 单测 — `backend/app/modules/agent/tests/`（相应测试文件）

## 前端

- [ ] T5: 弹窗移除 generating 阶段与 SSE，「生成项目规范」改为 scanGenerate 后跳转详情页 — `frontend/src/components/workspace-scan-dialog.tsx`
- [ ] T6: 详情页 load 查询进行中 scan run 并自动恢复 SSE 回显 — `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`
- [ ] T7: 详情页 done 后刷新子组件计数（load 重新拉取）— `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`

## 文档

- [ ] T8: 同步受影响模块文档（workspace / agent / spec_workspace）
