---
id: task-09
title: curl 实测六路径联动 + grep 确认 import + 重建 backend Docker 部署验证
title_zh: 端到端实测与部署验证
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/plan/router.py
provides: {}
expects_from: {}
goal: |
  task-01~task-07 联动实现完成后，本 task 不改源码，仅做端到端实测与部署验收：
  逐条 curl 调用六条路径，确认每条都正确触发 PlanTask 的建/同步/迁移/解关联；
  grep 确认 PlanTask import 已在 plan/service.py 当前文件；重建 backend Docker
  镜像并 healthcheck 通过，证明变更已落到线上容器。
implementation: |
  1. 先准备测试数据：一条项目计划(ps_project_plan)、一个里程碑(ps_plan_node)、
     一条里程碑明细(ps_plan_node_detail, 状态 draft)及对应项目成员(project_member)。
  2. 按以下顺序 curl（base http://localhost:8000/api/ppm，带鉴权 header）：
     a. POST /plan-node-detail（status=done）→ 建 task：查 ppm_plan_task 应出现新任务；
     b. POST /plan-node-detail/{id}/process/save（明细 draft→done）→ 建 task；
     c. POST /plan-node/{plan_node_id}/modules/import-commit → 批量建 task；
     d. PUT /plan-node-detail/{id}（改执行人/工期）→ 对应 task 字段同步；
     e. POST /plan-node-detail/{id}/process/change → task 迁移到新版本明细；
     f. DELETE /plan-node-detail/{id} → 对应 task 的 ps_plan_node_detail_id 置 null。
  3. 每步后查 DB（ppm_plan_task）或对应接口核对预期副作用。
  4. 重建 backend：`cd deploy && docker compose up -d --build backend`，
     等 healthcheck healthy。
acceptance:
  - 六路径 curl 全部 2xx，且各自 DB 副作用（建任务/同步字段/迁移版本/解关联）符合预期。
  - change 后旧明细 archived、新明细 draft，task.ps_plan_node_detail_id 指向新明细。
  - delete 后残留 task 的 ps_plan_node_detail_id=null（软解关联，不删 task）。
  - grep 在 plan/service.py 命中 import 行，无残留 NameError/未 import。
  - backend 容器重建后 healthcheck 通过，/api/ppm/plan-node-detail 可达。
verify: |
  grep -n "from app.modules.ppm.task.model import PlanTask" backend/app/modules/ppm/plan/service.py
  依次 curl 六路径（见 implementation）并查 ppm_plan_task 校验副作用；
  cd deploy && docker compose up -d --build backend && docker compose ps backend（healthy）。
constraints: |
  - 本 task 无源码改动，仅验证既有实现（task-01~task-07 产出）。
  - 实测前需先备好项目计划/里程碑/明细/项目成员测试数据，否则建任务缺关联人。
  - grep 必须确认 PlanTask import 在 plan/service.py 当前文件（ppm.md 约定，
    曾因未 import 致 API 500）。
  - docker 重建后须 healthcheck 通过；curl 走容器暴露端口（默认 8000）。
  - 若某路径副作用不符预期，回到对应实现 task 修复，不在本 task 改源码。
