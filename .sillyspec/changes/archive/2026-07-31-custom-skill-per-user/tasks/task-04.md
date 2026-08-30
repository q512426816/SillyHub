---
id: task-04
title: skills service per-user filter and ownership check
title_zh: skills service 加 user_id 过滤与归属校验（越权 404）
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P1
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-001]
allowed_paths:
  - backend/app/modules/skills/service.py
---

## 目标
`CustomSkillService` 所有查询/写入方法加 `user_id` 维度：list 按用户过滤、get/update/delete 校验归属（不符 404，不泄露存在）、`_get_by_name` 改 per-user 查重。

## 实现要点
- `list_(self, user_id)`（现 `:83-86`）：stmt 加 `.where(CustomSkill.created_by == user_id)`，仍按 created_at desc。
- `get(self, skill_id, user_id)`（现 `:88-95`）：取到后校验 `skill.created_by != user_id` → raise `SkillNotFound`（404，防越权 + 不泄露存在），与「不存在」走同一错误码。
- `create`（现 `:99-133`）：created_by 由 router 透传 `user.id`（必填，task-01 已 NOT NULL）；`_get_by_name(name)` 调用改带 user_id 做 per-user 查重。
- `update(self, skill_id, user_id, *, ...)`（现 `:135-169`）：先 `get(skill_id, user_id)` 做归属校验；改 name 时 `_get_by_name(name, user_id)` per-user 查重（A 改成自己的 name 不应被 B 的同名挡）。
- `delete(self, skill_id, user_id)`（现 `:171-174`）：先 `get(skill_id, user_id)` 做归属校验。
- `_get_by_name(self, name, user_id)`（现 `:178-180`）：stmt 加 `.where(CustomSkill.created_by == user_id)`。
- 注意 mypy 假绿坑（disable_error_code 含 arg-type）：改方法签名后须 grep 全部调用点（router + skills_bundle_service + tests）一并改，不能只靠 mypy 报警。

## 验收
- list 只返当前 user 的；越权 get / update / delete 别人的 skill → 404（不返 403 不泄露）。
- `_get_by_name` per-user 查重：A 建 name=x 后 B 也能建 name=x（不报 409），同名同用户才报 409。
- task-03 router 在 update/delete 调用时已传 user.id；router 现有测试 + 新增 per-user 隔离测试（task-11）通过。
- mypy / ruff 过；service 模块 docstring 同步更新签名说明。
