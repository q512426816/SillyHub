---
id: task-01
title: 新建 ppm/common/ownership.py resolve_owner 归属校验原语 + PpmOwnershipDenied 403 错误类
title_zh: ownership 原语与错误类
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/ppm/common/ownership.py
created_at: 2026-08-10 00:22:00
author: qinyi
goal: >
  提供归属校验原语 resolve_owner（非管理员显式填他人→403，admin 代填放行，None 保留默认，自填放行）与 PpmOwnershipDenied(AppError, 403) 错误类，供 6 个 service 方法复用。鸭子类型读 actor.is_platform_admin/actor.id，无 isinstance、不查库。
provides:
  - contract: ownership-helper
    fields: [resolve_owner, PpmOwnershipDenied]
expect_from: []
related_tests: []
implementation:
  - 新建 backend/app/modules/ppm/common/ownership.py
  - 定义 PpmOwnershipDenied(AppError)：code="HTTP_403_PPM_OWNERSHIP_DENIED"、http_status=status.HTTP_403_FORBIDDEN（import status from fastapi）；details 含 field/actor/requested；仿 tool_policy.SsrfBlocked 模式，不污染 core/errors.py
  - 定义 resolve_owner(*, actor, requested: uuid.UUID|None, field: str = "execute_user_id") -> uuid.UUID|None：requested is None → return None；actor.is_platform_admin → return requested；requested == actor.id → return requested；否则 raise PpmOwnershipDenied(msg, details={field, actor: str(actor.id), requested: str(requested)})
  - import：uuid、from app.core.errors import AppError、from fastapi import status；User 仅作类型注解（from app.modules.auth.models import User）或用 TYPE_CHECKING 避免循环 import
acceptance:
  - AC-8 PpmOwnershipDenied 经 core/errors.py:366 全局 handler 自动返 403 + code（子类继承 http_status）
  - resolve_owner 四分支语义正确（None→None / admin→requested / self→requested / non-admin+other→raise）
verify:
  - task-07 新增 ppm/common/tests/test_ownership.py 覆盖纯函数四分支（本 task 不写测试）
constraints:
  - 只读 actor.is_platform_admin 与 actor.id（鸭子类型），无 isinstance(User)、无 DB session 查询——使测试可用 SimpleNamespace stub
  - 错误类放 ppm/common 作用域，不改 core/errors.py
  - 不改 DTO/OpenAPI/migration
---
