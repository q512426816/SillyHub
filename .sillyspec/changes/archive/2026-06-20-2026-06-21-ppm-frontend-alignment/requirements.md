---
author: qinyi
created_at: 2026-06-21T01:05:40+0800
change: 2026-06-21-ppm-frontend-alignment
---

# Requirements

## 角色
| 角色 | 说明 |
|---|---|
| 项目经理 | 创建计划/里程碑,审批 |
| 开发经理 | 审批问题,处置任务 |
| 部门经理 | 终审 |
| 成员 | 执行 |

## 功能需求

### FR-01: PpmUserSelect 基础组件(覆盖 D-009@v1)
Given ppm 表单含 *_user_id 字段
When 用 PpmUserSelect(res + searchData)
Then 按 res(user/projectMember/role/project)+ searchData(pm_project_id/role_name)过滤,服务端搜索/分页

### FR-02: 项目成员角色+联动(覆盖 D-009@v1)
Given 项目成员表单
When 选角色(res=role 多选)+ 选用户(res=user)
Then 角色 auth.Role 多选;选用户联动回填 depart_name/phone/user_name;项目→成员入口

### FR-03: 里程碑主子+审批表单
Given 里程碑明细
When expand 里程碑→内嵌明细(模块三级)+ 按状态操作(审核/审批/变更差异化表单)
Then 主子展开 + 模块层 + 状态化表单 + Timeline 履历

### FR-04: 计划节点模板行内编辑+字典
Given 计划节点模板明细
When 行内批量编辑 + project_type 字典 + 责任人下拉
Then 整表行内编辑 + 字典选项 + 责任人 PpmUserSelect

### FR-05: 细节(附件URL/工作日/处置)(覆盖 D-010@v1)
Given 附件/工作日/问题处置
When 附件 URL 管理(PpmFileUrls)+ 工作日联动 + 处置按钮
Then 多 URL 增删(D-010)+ 选开始+工时算完成 + 处置操作

## 非功能需求
- 兼容:不改后端业务,project-member query 加可选过滤(不破坏现有)
- 可测试:各 Wave 对照源交互 verify
- 复用:lib/ppm + ppm-status-actions + ppm-resource-table

## 决策覆盖矩阵
| 决策 | 覆盖 FR |
|---|---|
| D-009@v1 角色 auth.Role | FR-01/02 |
| D-010@v1 附件 URL | FR-05 |
