---
id: task-03
title: 'add-rbac-broadcast-recipient-lookup'
title_zh: 'rbac 广播收件人反查 list_user_ids_with_permission（三段语义+活跃过滤）'
author: 'qinyi'
created_at: 2026-08-29 21:05:09
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/auth/rbac.py
  - backend/tests/modules/auth/
goal: >
  在 auth/rbac.py 新增 list_user_ids_with_permission 广播收件人反查：镜像
  has_permission 三段解析语义（工作区 grant ∪ 平台级 grant ∪ PLATFORM_ADMIN
  ∪ is_platform_admin 用户）并过滤非活跃用户，供 task-02 的
  NotificationService.notify_broadcast 计算收件人集合。
provides:
  contract: list_user_ids_with_permission
  fields: [user_ids, workspace_id, permission]
implementation:
  - 在 backend/app/modules/auth/rbac.py（has_permission :107-132 旁）新增 async def list_user_ids_with_permission(session, *, workspace_id, permission) -> list[uuid.UUID]
  - 三段语义并集去重：user_workspace_roles（含工作区 PLATFORM_ADMIN 放行）∪ 平台级 user_roles（含 PLATFORM_ADMIN）∪ users.is_platform_admin；join users 过滤禁用/已删除账户（Grill X-04）
  - 在 backend/tests/modules/auth/（已存在该目录惯例）新建 test_rbac_broadcast.py：覆盖三段各命中、并集去重、非活跃用户被过滤、空结果
acceptance:
  - 函数签名与 design.md §7.1 一致，返回去重后的活跃 user id 列表
  - 三段语义与 has_permission 放行口径镜像一致（含 PLATFORM_ADMIN 角色与 is_platform_admin 标记）
  - 非活跃/已删除用户不出现在结果中
  - test_rbac_broadcast.py 全部用例通过
verify:
  - cd backend && uv run pytest tests/modules/auth/test_rbac_broadcast.py -q --no-cov -n auto
constraints:
  - 不修改 has_permission 既有行为
  - 不引入通知模块依赖（函数只依赖 auth 表模型）
  - 不做权限缓存改动
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
