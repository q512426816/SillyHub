---
id: task-11
title: 后端测试 per-user 隔离与越权防护
title_zh: 后端测试覆盖 per-user 隔离、跨用户同名与越权 404
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P1
depends_on: [task-04]
blocks: []
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: []
allowed_paths:
  - backend/app/modules/skills/tests/
---

## 目标
为 skills service/router 的 per-user 隔离与越权防护补测试，覆盖三类核心场景：A 的技能 B 看不到；**Grill gap#3：A 建 name=x 时 B 也能建 name=x（不报 409，per-user 联合唯一核心保证）**；越权 update/delete 别人的技能返回 404。

## 实现要点
- 沿用 `test_router.py` 的 `_make_user` / `_headers` 工具（`admin=False` 即可造普通登录用户）；追加到 `test_router.py` 或新建 per-user 测试文件。
- 场景 1（隔离，FR-04）：A 建 skill → A list 含、B list 不含；A get 成功、B get 同 id → 404。
- 场景 2（**gap#3 跨用户同名**，FR-02）：A POST name=x → 201，B POST name=x → 201（不报 409，验证 `(created_by, name)` 联合唯一而非全局唯一）；同用户内重名仍 409。
- 场景 3（越权，FR-05）：B 对 A 的 skill PUT/DELETE → 404（service.get 校验归属不符抛 SkillNotFound，不泄露存在、不返 403）。
- 断言用真实 HTTP 状态码（201/404/409），不直接断 service 内部异常类型。
- 测试 user 用独立 uuid 避免与既有用例串扰。

## 验收
- 三类测试全部通过（`pytest backend/app/modules/skills/tests/`）。
- gap#3 场景明确断言 201 而非 409。
- 越权场景明确断言 404（不是 403）。
