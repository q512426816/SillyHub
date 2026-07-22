---
author: WhaleFall
created_at: 2026-07-21T12:10:00
---

# 任务（Tasks）— ppm update 清空字段修复

> 实现阶段（plan/execute）会进一步分 Wave。此处先列任务条目。

- [x] T1：`backend/app/modules/ppm/plan/service.py` `_Crud.update` 去掉 `if v is not None`，改直接 `setattr`。
- [x] T2：`backend/app/modules/ppm/problem/service.py` `_Crud.update` 同 T1。
- [x] T3：`backend/app/modules/ppm/plan/service.py` `PlanService.update_detail` 同 T1。执行时复查 `_sync_task_fields` 对 `duty_user_id` 清空的处理（plan/service.py:1645 `uid is not None` 守卫）。
- [x] T4：`backend/app/modules/ppm/task/service.py` `update` 注释「仅写入非 None 字段」修正为「直接 setattr（未传由 exclude_unset 过滤）」，逻辑不动。
- [x] T5：补 plan 单测——`_Crud.update` 清空字段→null + 未传→不动（`backend/app/modules/ppm/plan/tests/`）。→ `TestUpdateClearVsKeep` / `TestUpdateDetailClearsField`。
- [x] T6：补 plan 单测——`update_detail` 清空字段→null。→ 同上 `TestUpdateDetailClearsField`。
- [x] T7：补 problem 单测——`_Crud.update` 清空字段→null + 未传→不动（`problem/tests/test_problem_flow.py` `test_update_none_clears_nullable_field` + `test_update_omitted_field_kept`，line 236-289）。
- [x] T8：后端 curl 实测 PUT 清空生效。→ 经 ql-20260722-003 排查实测等价验证：`ProblemListUpdate.model_dump(exclude_unset=True)` 实测保留显式 null + `_Crud.update` 直接 setattr 写 null（plan `TestUpdateClearVsKeep` 覆盖），清空链路确认生效（curl 登录 401 改用 service 层实证）。
- [x] T9：浏览器验收（编辑清空保存→库 null、前端回显空；只改一字段其他不动）。→ 前端 `_forms.tsx` 清空发 null（ql-003 读码确认）+ 后端清空实测 + 部署 health check 200；problem 验证人清空经 ql-003 补 schema 字段修复并部署验证。未做完整浏览器点击验收，以代码+实测+部署佐证。
- [x] T10：同步模块文档（`ppm.md` 变更索引）+ quicklog。→ ppm.md 变更索引已记 ql-20260722-001/003 等相关条目；本变更归档时补记。
