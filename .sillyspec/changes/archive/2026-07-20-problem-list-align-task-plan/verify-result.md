# 验证结果 — 2026-07-20-problem-list-align-task-plan

## 状态：PASS WITH NOTES

问题清单 (/ppm/problem-list) 详情弹窗 + 执行模式对齐任务计划 (/ppm/task-plans)。
状态机简化 3 态 (新建/进行中/已完成), 新建 → 开始 → 执行(可重复) → 完成。

## 测试与质量扫描

- **后端** `app/modules/ppm/problem/`:33 passed
  - TestStartExecute 8 case:start 建在途 TaskExecute / 仅新建可 start / execute complete→已完成 / execute submit→新建(可重复) / 仅进行中可 execute / 错 task_execute_id 拒绝 / 跨天拒绝 / 同天 OK
  - TestFsmPure:TRANSITIONS 3 态 + TestChangeFlow 变更流(deprecated 保留)零回归
- **后端 task 模块回归**:26 passed (Wave 1, 零回归)
- **后端 ruff + mypy**:全绿 (Wave 1)
- **前端 vitest 全量**:947 passed / 0 failed (92 文件), 含新增 problem-detail-modal.test 10 case
- **前端 tsc --noEmit**:全绿
- **前端 next lint**:无 error (仅 pre-existing warning, 均在未改动文件)
- **alembic heads**:单 head `20260720_problem_status_3state` (迁移链完整, 无碎片)

## AC 对照 (design.md)

| AC | 内容 | 结果 |
|---|---|---|
| 状态机 3 态 | 新建/进行中/已完成, 删审批中/待验证/已作废/变更中 | ✓ fsm.py + model status 中文化 + migration 1-7→中文数据映射 |
| 后端两步执行 | start 建 in-flight TaskExecute + execute 收口(submit 回新建/complete 已完成) | ✓ service start_problem/execute_problem + router POST /start + PUT /execute |
| TaskExecute 共用表 | plan/problem 互斥 (problem_task_id) | ✓ D-002, 前端 listTaskExecutes({problem_task_id}) 守护测试 |
| 弹窗对齐任务计划 | detail/execute 双模式 + 跨天拆分填报 | ✓ problem-detail-modal.tsx, buildDetailDays 纯函数 8 case |
| 重复执行 + 跨天 | submit 回新建可再次 start;跨天逐天收口 + 后端拒绝跨天 | ✓ service 跨天校验 + 前端跨天拆分 |
| 操作列对齐 | 新建→开始, 进行中→执行, 任意→详情/删除, 新建/进行中→编辑 | ✓ page.tsx (D-003 进行中保留编辑, D-004 任意状态可删) |
| 删除废弃流程 | 审批/验证/驳回流 + 变更前端入口 | ✓ 删 5 废弃表单 + ProblemActions 死代码 + 后端 7 审批端点 |

## 决策落地核对 (D-001 ~ D-006)

- D-001 状态机 3 中文态 ✓
- D-002 TaskExecute 共用表 problem_task_id 互斥 ✓
- D-003 进行中保留编辑入口(与执行分离) ✓
- D-004 删除任意状态(本人/管理员) ✓
- D-005 problem_change deprecated 但后端保留 ✓
- D-006 独立 problem-detail-modal(方案 B) ✓

## 遗留 (NOTES)

- **docker 部署端到端 e2e 未跑**:前端 prod build (`docker compose up -d --build frontend`) + PG migration apply + 真实浏览器交互流程未验证。与既有变更(decouple-scan / daemon-entity-binding 等)惯例一致, 留人工/部署后验证。
- migration `20260720_problem_status_3state` 待部署到生产 PG apply (本机 sqlite 因 pgcrypto 链无法跑全链, 数据映射 SQL 已在 sqlite 直接验证通过)。
