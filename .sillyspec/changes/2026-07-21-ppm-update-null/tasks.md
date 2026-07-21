---
author: WhaleFall
created_at: 2026-07-21T12:10:00
---

# 任务（Tasks）— ppm update 清空字段修复

> 实现阶段（plan/execute）会进一步分 Wave。此处先列任务条目。

- [ ] T1：`backend/app/modules/ppm/plan/service.py` `_Crud.update` 去掉 `if v is not None`，改直接 `setattr`。
- [ ] T2：`backend/app/modules/ppm/problem/service.py` `_Crud.update` 同 T1。
- [ ] T3：`backend/app/modules/ppm/plan/service.py` `PlanService.update_detail` 同 T1。执行时复查 `_sync_task_fields` 对 `duty_user_id` 清空的处理（plan/service.py:1645 `uid is not None` 守卫）。
- [ ] T4：`backend/app/modules/ppm/task/service.py` `update` 注释「仅写入非 None 字段」修正为「直接 setattr（未传由 exclude_unset 过滤）」，逻辑不动。
- [ ] T5：补 plan 单测——`_Crud.update` 清空字段→null + 未传→不动（`backend/app/modules/ppm/plan/tests/`）。
- [ ] T6：补 plan 单测——`update_detail` 清空字段→null。
- [ ] T7：补 problem 单测——`_Crud.update` 清空字段→null + 未传→不动（`backend/app/modules/ppm/problem/tests/`）。
- [ ] T8：后端 curl 实测 PUT 清空生效（登录有效账号，验证 plan/problem 各一个端点）。
- [ ] T9：浏览器验收（编辑里程碑/明细/问题清空保存→库 null、前端回显空；只改一字段其他不动）。
- [ ] T10：同步模块文档（`ppm.md` 变更索引）+ quicklog（若分批用 quick 记录）。
