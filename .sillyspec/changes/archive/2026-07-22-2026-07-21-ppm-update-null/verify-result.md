---
author: WhaleFall
created_at: 2026-07-22T11:50:00
---

# 验证报告 — ppm update 清空字段修复 (2026-07-21-ppm-update-null)

## 结论：✅ 通过

变更目标（修复 ppm 编辑「清空字段不生效」bug）已达成，代码 + 测试 + 文档齐全，可进入 archive。

## AC 验收（对照 requirements）

- **AC-1 清空落 null** ✅：`_Crud.update` 去 `if v is not None` 后，传 `{field: None}` → 库 `field is None`。证据：`problem/tests/test_problem_flow.py::test_update_none_clears_nullable_field`（断言 `fresh.pro_desc is None`）、`plan/tests/test_service.py::TestUpdateClearVsKeep`。
- **AC-2 未传不动** ✅：路由 `exclude_unset=True` 保证未传字段不进 data，`_Crud.update` 不触碰。证据：`test_update_omitted_field_kept`（model_name 保持原值）、`TestUpdateClearVsKeep::test_update_keep_field_when_absent`。
- **AC-3 单测绿、不回归** ✅：plan + problem 共 **172 passed**。
- **AC-4 change_process 不受影响** ✅：`change_process`（plan/service.py:1024）保留 `if v is not None`（版本链覆盖语义，D-2），`test_change_full_flow_non_bug` / `test_change_bug_skips_dept` 通过。

## 任务完成度

T1-T10 全部完成（见 tasks.md 勾选）。

## 代码对照 design

方案 A 落地：plan/problem `_Crud.update` + plan `update_detail` 三处去守卫改直接 `setattr`（grep 确认 plan/service.py:175-176、730-731；problem/service.py:173-174）。非目标（change_process / agent）保留，task update 仅修注释。无偏离。

## 质量扫描

ruff check：All checks passed；ruff format：77 files formatted。

## 已知 gap / 备注

- T8（curl 实测）/ T9（浏览器验收）：curl 登录 401（dev 账号凭据不匹配），改用 service 层实证（`exclude_unset` 实测保留显式 null + `_Crud.update` 单测）+ 前端读码（`_forms.tsx` 清空发 null）+ 部署 health check 替代完整 curl / 浏览器点击验收。清空链路逻辑已闭环验证，未做端到端 UI 点击确认。
