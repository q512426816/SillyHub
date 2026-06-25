---
author: WhaleFall
created_at: 2026-06-25T12:55:00
---

# 补充任务（quick 收尾）

> 变更 2026-06-24-username-login verify 已通过（PASS WITH NOTES）。
> 本文件登记 verify 阶段发现的 task-02 测试债务补救任务，归档前补齐。

- [x] **task-11** 补 task-02 测试债务（AC-07 / AC-08）✅ 已完成
  - **AC-07**：`auth.schema.UserRead` email=null 无直接单测（仅 login 间接覆盖）→ 补 `test_auth_user_read_email_optional`（构造 email=None 对象 `model_validate` 不报错 + `.email is None` + JSON `"email":null`）
  - **AC-08**：§9 要求的 `test_settings_reexport_synced` 缺失 → 补（`settings.schema.UserCreateRequest is admin.schema.UserCreateRequest` + 字段同步断言：username 必填 min_length=3 / email Optional）
  - **依据**：`tasks/task-02.md` §9 TDD 步骤 / §10 验收标准 AC-07/AC-08、`verify-result.md` 技术债务
  - **文件**：`backend/tests/modules/admin/test_schema_username_login.py`（新增，纯 Pydantic + import 单测，无 DB/HTTP fixture）
