---
author: qinyi
created_at: 2026-07-07 23:22:00
goal: CustomSkill admin CRUD 端点 + service
implementation: 新建 backend/app/modules/skills/service.py（list/get/create/update/delete 业务逻辑，name 字符集+前缀校验+unique）；新建 router.py（GET/POST/PUT/DELETE /api/custom-skills，admin only require_permission(MANAGE_PLATFORM)）；main.py 注册 router（prefix=/api 或 /api 由现有约定）
acceptance: 5 端点全通（list/create/get/update/delete）；admin 权限门控（非 admin 403）；name unique 冲突 409；字符集非法 422；注册进 main.py
verify: cd backend && uv run pytest tests/modules/skills/test_router.py -q
constraints: 复用现有 require_permission + 错误码模式；content 不截断（SKILL.md 可能长）；NFR-01 权限
depends_on: [task-01]
covers: [FR-01, NFR-01, D-002]
---

# task-02: backend CustomSkill admin CRUD 端点

## 验收标准
A. `GET /api/custom-skills`（list，分页或全量）、`POST`（create，201）、`GET /{id}`、`PUT /{id}`、`DELETE /{id}`（204）五端点。
B. 全部 `require_permission(MANAGE_PLATFORM)` 门控，非 admin 返 403。
C. name unique 冲突返 409；字符集 `[a-z0-9-]{2,40}` 非法 + `sillyspec-` 前缀返 422。
