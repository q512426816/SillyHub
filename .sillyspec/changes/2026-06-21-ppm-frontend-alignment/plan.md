---
author: qinyi
created_at: 2026-06-21T01:10:00+0800
updated_at: 2026-06-21T01:15:00+0800
plan_level: full
change: 2026-06-21-ppm-frontend-alignment
---

# 实现计划(ppm 前端交互对齐)

> Spike:无。对照源 dept_project_front Vue 重写交互。
> Wave 已按 depends_on 拓扑重排(step8),同 Wave 内无依赖可并行。

## Wave 0(基础组件,无依赖,并行)
- [x] task-01: PpmUserSelect + PpmText + PpmDictSelect 基础组件(覆盖:D-009@v1, FR-01)
- [x] task-02: 后端 project-member 过滤 + lib + PpmSubTable(覆盖:FR-01)

## Wave 1(依赖 W0,并行:成员 + 里程碑主子 + 模板 + 细节)
- [x] task-03: 项目成员 角色 auth.Role 多选 + 联动 + 入口(覆盖:FR-02, D-009@v1)
- [x] task-04: 里程碑 主子 expand + 模块三级(覆盖:FR-03)
- [x] task-06: 计划节点模板 行内编辑 + 字典 + 责任人(覆盖:FR-04)
- [x] task-07: PpmFileUrls 附件URL + 工作日联动 + 处置按钮(覆盖:FR-05, D-010@v1)

## Wave 2(依赖 W1 task-04)
- [x] task-05: 里程碑 审批表单差异化 + Timeline(覆盖:FR-03;依赖 task-04)

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 |
|---|---|---|---|---|---|
| task-01 | 基础组件 PpmUserSelect/Text/DictSelect | W0 | P0 | — | FR-01, D-009@v1 |
| task-02 | 后端 project-member 过滤 + lib + PpmSubTable | W0 | P0 | — | FR-01 |
| task-03 | 项目成员 角色+联动+入口 | W1 | P0 | 01,02 | FR-02, D-009@v1 |
| task-04 | 里程碑 主子+模块三级 | W1 | P0 | 01,02 | FR-03 |
| task-06 | 计划节点模板 行内+字典+责任人 | W1 | P1 | 01,02 | FR-04 |
| task-07 | 细节 附件URL+工作日+处置 | W1 | P2 | 01 | FR-05, D-010@v1 |
| task-05 | 里程碑 审批表单+Timeline | W2 | P1 | 01,04 | FR-03 |

## 关键路径
task-01 → task-04(里程碑主子)→ task-05(审批表单,最复杂)

## 全局验收标准
- [ ] PpmUserSelect 覆盖所有 *_user_id 字段,res+searchData 按项目/角色过滤
- [ ] 项目成员角色 auth.Role 多选 + 选用户联动回填部门/手机
- [ ] 里程碑主子展开 + 模块三级 + 审批表单差异化 + Timeline
- [ ] 计划节点模板行内批量编辑 + 字典 + 责任人下拉
- [ ] 附件 URL 管理(D-010)+ 工作日联动 + 处置按钮
- [ ] 对照源 dept_project_front 逐项 verify
- [ ] frontend typecheck + build 通过

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-009@v1 角色 auth.Role | task-01,03 | PpmUserSelect res=role + 成员多选 |
| D-010@v1 附件 URL | task-07 | PpmFileUrls 多 URL 增删 |
