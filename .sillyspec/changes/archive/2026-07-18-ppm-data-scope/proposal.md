---
author: qinyi
created_at: 2026-07-18 17:21:00
change: 2026-07-18-ppm-data-scope
---

# 提案:任务计划 / 问题清单 数据查询范围权限控制

> ⚠️ 本提案为人工重写,纠正 sillyspec CLI 自动生成的错误版本(CLI 把对象写成"项目计划/项目维护")。以本版本为准。

## 背景

PPM「任务计划」(`GET /api/ppm/task-plan/page`) 与「问题清单」(`GET /api/ppm/problem-list`) 列表当前对任何持功能权限的用户**返回全表数据**:后端不强制按角色过滤,前端"我的/全部"切换是纯前端可选行为,普通用户点"全部"即可看全平台数据。

## 目标

按当前登录用户的角色限定查询数据范围(5 档):

- **超级管理员**(`is_platform_admin` 或 `super_admin` 角色)→ 全部
- **部门经理 / 项目经理 / 开发经理 / 业务经理**(在某项目成员 `role_name` 含对应角色)→ 该项目(集合)下的全部任务
- **其余**→ 只看自己要干的(任务=`user_id` 自己;问题=自己是 `duty_user_id`/`audit_user_id`/`now_handle_user` 任一)
- 多项目取并集;四类经理权限相同仅 `role_name` 值不同。

## 影响范围

- 后端 PPM `task` + `problem` 两个子域的列表/导出查询(4 个端点)。
- 新增 `backend/app/modules/ppm/common/data_scope.py`(经理项目集计算 + 范围 where)。
- **无新表、无新字段、无 migration**(复用现有 `PpmProjectMember.role_name` + 业务表字段)。
- 前端零改动(后端过滤生效即满足需求;前端文案优化留后续 quick)。

## 非目标

- **不碰组织/部门表**(部门经理同项目经理,不引入部门维度)。
- 不新增 RBAC 角色(复用现有 `role_name` 文本匹配)。
- 不覆盖项目计划/项目维护/看板的数据范围(本次仅 task + problem)。
- 不纳入 `work_partner`/`TaskExecute.execute_user_id`(用户选"只看自己负责的")。
- 不做前端改造。

## 风险

`role_name` 文本匹配拼写变体、`now_handle_user` 字符串拆分匹配、`project_id` NULL 任务归属、导出端点绕过——对策见 design.md §8。
