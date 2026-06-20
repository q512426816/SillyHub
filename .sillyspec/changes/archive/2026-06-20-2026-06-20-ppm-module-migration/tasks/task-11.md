---
id: task-11
title: 前端 plan + problem 页面(里程碑状态机 + 问题审批流)
priority: P1
estimated_hours: 16
depends_on: [task-09]
blocks: [task-13]
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-002@v1, D-004@v1, D-006@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现计划策划(模板 plan-node/module、项目计划、里程碑明细)与问题清单/变更(含 4 节点审批流)页面,重点保证状态机驱动的操作按钮显隐与流转交互正确(本变更最复杂的前端)。

## 文件
- 新增 frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx(模板 plan-node 树/列表 + module 子表)
- 新增 frontend/src/app/(dashboard)/ppm/project-plans/page.tsx(项目计划 ps_project_plan)
- 新增 frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx(里程碑明细 + 状态机操作)
- 新增 frontend/src/app/(dashboard)/ppm/problem-list/page.tsx(问题清单 + 审批流操作)
- 新增 frontend/src/app/(dashboard)/ppm/problem-changes/page.tsx(问题变更 + 审批流操作)

## 实现要点(参照源)
- 里程碑状态机(D-002@v1):草稿→审核→审批→完成 + 驳回 + 变更(parent_id 版本链);参照源 views/ppm/psplannodedetail,按 `status` 显隐 save/reject/change 操作按钮。
- 问题审批流(D-004@v1,4 节点:申请→审核→处置→验证→关闭):参照源 views/ppm/problemlist/index.vue(~598 行,最复杂)与 problemchange;按 `status` + 当前登录用户匹配 `checkUser` 显隐 nextProcess/rejectProcess/doneTask/closeTask 按钮。
- 驳回/挂起(fallback:项目无对应角色成员)参照 X-003 展示待指派提示。
- 流转动作调 task-09 的 process 动词,提交后表格/明细刷新;流转写 audit_log(D-006@v1)后端已处理,前端只需刷新。
- 附件 file_urls(JSON 数组,D-007@v1)用简单 url 列表 + 新增/删除,不做上传服务。
- 参照 admin/users 的 Table+Drawer 模式;明细页用 Drawer 或独立 page 内嵌详情区。
- 无 i18n,中文文案。

## 验收
- [ ] 5 页面可访问,基础 CRUD 可用
- [ ] 里程碑明细按 status 正确显隐 save/reject/change 按钮,流转后状态更新
- [ ] 问题清单按 status + 当前用户(checkUser)显隐 nextProcess/rejectProcess/doneTask/closeTask
- [ ] 驳回/变更路径正确(变更生成新版本,parent_id 链可追溯)
- [ ] 无对应角色成员时显示待指派提示(X-003 fallback)
- [ ] 附件 file_urls 列表可增删
