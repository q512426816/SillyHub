---
author: qinyi
created_at: 2026-06-20T14:46:30+0800
change: 2026-06-20-ppm-module-migration
---

# Requirements

## 角色
| 角色 | 说明 |
|---|---|
| 平台管理员 | 管理 PPM_* 权限分配 |
| 项目经理 | 创建项目/计划/里程碑,审批 |
| 开发经理 | 审批问题,分配任务 |
| 部门经理 | 问题终审(bug 类型跳过) |
| 成员 | 执行任务,填报工时 |

## 功能需求

### FR-01: pm 项目管理 CRUD(覆盖 D-001@v1/D-003@v1/D-005@v1/D-007@v1)
Given 已登录且有 PPM_PROJECT_WRITE 权限的用户
When 创建/查询/修改/删除 项目、客户、成员、干系人
Then 记录落库 + 自动审计;无权限返回 403;支持 /export-excel 导出;附件存 file_urls(JSON)

### FR-02: plan 计划策划与模板(覆盖 D-001@v1/D-005@v1)
Given 有 PPM_PLAN_WRITE 权限
When 管理项目计划/里程碑/计划节点模板及子表明细
Then 主子表一致性保存;查询按项目聚合

### FR-03: problem 问题清单审批流(覆盖 D-002@v1/D-004@v1/D-006@v1)
Given 问题清单记录(status=已保存)且有 PPM_PROBLEM_WRITE
When 依次执行 nextProcess(申请→开发经理→项目经理→部门经理→验证→关闭)/ rejectProcess / doneTask / closeTask
Then status 按 4 节点状态机流转;bug 类型跳过部门经理;每次流转写 ProcessLog + ProcessTask + audit_log;有未关闭变更时列表标记"变更中"

### FR-04: 里程碑明细流(覆盖 D-002@v1)
Given 里程碑明细(status=草稿)
When saveProcess / rejectProcess / changeProcess
Then status 在(草稿→审核→审批→完成)流转,驳回回退,变更生成新版本(parent_id 关联);写 _process 履历

### FR-05: task 任务与工时(覆盖 D-001@v1/D-003@v1/D-005@v1)
Given 有 PPM_TASK_WRITE / PPM_WORKHOUR_WRITE
When 管理任务计划/执行/工时,执行 executePlan,统计 stat-by-user/project
Then 任务执行联动 TaskExecute 生成;工时统计正确;支持 /export-excel;个人视图按当前登录人过滤

### FR-06: kanban 看板(覆盖 D-001@v1, X-001)
Given 有 PPM_KANBAN_VIEW
When 查询看板人员列/任务卡片/分配/拖拽排序
Then 人员=可见 project_member(可按 Organization 分组);reorder 持久化 kanban_order

## 非功能需求
- 兼容性:不改动现有 auth/admin/workspace 表与 API;新模块独立(CLAUDE.md 规则7 可清空)
- 可回退:删 ppm 模块 + 回滚迁移即可完全移除
- 可测试:各 Wave 接口/表/页面独立 verify;状态机用 pytest 覆盖所有转移
- 安全:所有端点 require_permission_any(PPM_*);导出防越权

## 决策覆盖矩阵
| 决策 ID | 覆盖 FR |
|---|---|
| D-001@v1 平台级 | FR-01~06 |
| D-002@v1 里程碑简化 | FR-03/04 |
| D-003@v1 openpyxl | FR-01/05 |
| D-004@v1 项目角色 | FR-03 |
| D-005@v1 PPM_* 权限 | FR-01~06 |
| D-006@v1 通知审计 | FR-03/04 |
| D-007@v1 附件 fileUrl | FR-01/03/05 |
| D-008@v1 无历史迁移 | 全局 |
