---
author: qinyi
created_at: 2026-06-20T14:50:00+0800
updated_at: 2026-06-20T14:58:00+0800
plan_level: full
change: 2026-06-20-ppm-module-migration
---

# 实现计划(ppm 模块全量迁移)

> Spike:无。技术方案确定 —— 状态机参照 `change.TRANSITIONS`、权限参照 `auth.Permission`、四件套参照 `release/admin`。
> Wave 已按 depends_on 拓扑重排(step8),同 Wave 内任务无依赖可并行。

## Wave 0(基础设施,无依赖,并行)
- [x] task-01: ppm 模块骨架 + common helper(crud/export/fsm/perms)+ openpyxl(覆盖:D-003@v1, FR-01~06) ✅34测试
- [x] task-02: PPM_* 权限枚举(auth/permissions.py)+ RBAC 种子迁移(覆盖:D-005@v1) ✅24权限+迁移,30测试

## Wave 1(依赖 W0,并行:pm + plan + task 后端)
- [x] task-03: project 子域四件套 + 迁移 + 测试(覆盖:FR-01, D-001@v1/D-007@v1) ✅4表33端点19测试
- [x] task-04: plan 子域 + 里程碑状态机 + 迁移 + 测试(覆盖:FR-02, FR-04, D-002@v1) ✅7表+状态机+变更版本链27测试
- [x] task-06: task 子域 + 工时统计 + 迁移 + 测试(覆盖:FR-05) ✅3表+executePlan+工时统计16测试

## Wave 2(依赖 W1,并行:problem 审批流 + kanban)
- [x] task-05: problem 子域 + 4 节点审批流状态机 + 迁移 + 测试(覆盖:FR-03, D-004@v1/D-006@v1) ✅6表+审批流(bug跳过部门经理)+fallback,18测试
- [x] task-07: kanban 子域(聚合/分配/拖拽)+ 测试(覆盖:FR-06, X-001) ✅5端点+组织分组+reorder持久化,18测试

## Wave 3(依赖 W1+W2)
- [x] task-08: main.py 注册所有 ppm 路由 /api/ppm(覆盖:D-001@v1) ✅5子域全集成,102路由,132测试

## Wave 4(依赖 W3)
- [x] task-09: 前端 lib/ppm API client + 领域类型(覆盖:FR-01~06) ✅7文件/102函数/73类型,typecheck通过

## Wave 5(依赖 W4,并行:前端页面)
- [x] task-10: 前端 pm 项目管理页面(覆盖:FR-01) ✅4页面+ppm-resource-table公共组件
- [x] task-11: 前端 plan + problem 页面(里程碑状态机 + 审批流交互)(覆盖:FR-02/03/04) ✅5页面+ppm-status-actions(状态机/审批流按钮显隐)
- [x] task-12: 前端 task + kanban 页面(工时统计 + 拖拽)(覆盖:FR-05/06) ✅4页面+原生拖拽+零依赖统计(CSS饼图)

## Wave 6(依赖 W5)
- [x] task-13: 菜单权限登记 menu-permissions.ts + 端到端集成验证(覆盖:D-005@v1) ✅ppm section+13菜单,build成功+1719测试

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | ppm 骨架 + common + openpyxl | W0 | P0 | — | D-003@v1, FR-01~06 |
| task-02 | PPM_* 权限枚举 + RBAC 种子 | W0 | P0 | — | D-005@v1 |
| task-03 | project 子域四件套 + 迁移 | W1 | P0 | 01,02 | FR-01, D-001@v1/D-007@v1 |
| task-04 | plan 子域 + 里程碑状态机 + 迁移 | W1 | P0 | 01 | FR-02, FR-04, D-002@v1 |
| task-06 | task 子域 + 工时统计 + 迁移 | W1 | P0 | 01 | FR-05 |
| task-05 | problem 子域 + 审批流状态机 + 迁移 | W2 | P0 | 01,03 | FR-03, D-004@v1/D-006@v1 |
| task-07 | kanban 子域(聚合/拖拽) | W2 | P1 | 03,06 | FR-06, X-001 |
| task-08 | main.py 注册 /api/ppm | W3 | P0 | 03,04,05,06,07 | D-001@v1 |
| task-09 | 前端 lib/ppm API + 类型 | W4 | P0 | 08 | FR-01~06 |
| task-10 | 前端 pm 项目管理页面 | W5 | P1 | 09 | FR-01 |
| task-11 | 前端 plan + problem 页面 | W5 | P1 | 09 | FR-02/03/04 |
| task-12 | 前端 task + kanban 页面 | W5 | P1 | 09 | FR-05/06 |
| task-13 | 菜单权限登记 + 集成验证 | W6 | P0 | 09,10,11,12 | D-005@v1 |

## 关键路径
task-01 → task-03(project) → task-05(problem 审批流) → task-08(注册) → task-09(前端 API) → task-11(前端 problem 审批流交互,最复杂)

## 全局验收标准
- [ ] 19 表 alembic 迁移 upgrade 成功,migrations/env.py import 完整
- [ ] 所有 ppm 端点 require_permission_any(PPM_*)鉴权,无权限返回 403
- [ ] 问题清单 4 节点审批流:申请→审核→处置→验证→关闭 流转正确,bug 跳过部门经理,驳回/变更正确
- [ ] 里程碑明细状态机:草稿→审核→审批→完成 + 驳回 + 变更(parent_id 版本链)正确
- [ ] 各子域 /export-excel 导出 openpyxl 正常(同步端点 / anyio.to_thread)
- [ ] 看板:人员列(可见 project_member)+ 拖拽 reorder 持久化 kanban_order
- [ ] 前端各子域页面可访问,菜单权限按 PPM_* 显隐
- [ ] 现有 auth/admin/workspace 业务不受影响(回归测试通过)
- [ ] backend pytest + frontend vitest 全绿

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 平台级 | task-03~08,13 | 路由 /api/ppm,无 workspace_id,require_permission_any |
| D-002@v1 里程碑简化 | task-04 | 状态机流转 + parent_id 版本链 |
| D-003@v1 openpyxl | task-01,03,06 | /export-excel 导出 |
| D-004@v1 项目角色 | task-05 | 宩批流按角色查 project_member |
| D-005@v1 PPM_* 权限 | task-02,08,13 | 权限枚举 + 鉴权 + 菜单 |
| D-006@v1 通知审计 | task-05 | 流转写 audit_log |
| D-007@v1 附件 fileUrl | task-03,05,06 | file_urls JSON 字段 |
| D-008@v1 无历史迁移 | 全局 | 仅建表 + 种子,无 ETL |
