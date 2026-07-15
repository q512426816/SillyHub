<!-- author: WhaleFall -->
<!-- created_at: 2026-07-15T12:50:20 -->

# 模块影响分析（Module Impact）— 用户自助修改密码

> 对照 _module-map.yaml + worktree commit ac8b8382（14 files changed）

## 影响模块清单

### backend.auth（主，需同步模块文档）
- 改动：schema.py 新增 ChangePasswordRequest；service.py 新增 AuthService.change_password（事务原子撤销其他会话）；router.py 新增 POST /api/auth/change-password(204)；tests/modules/auth/test_change_password.py（新，7/7）
- 同步建议：auth.md 契约摘要加 change-password 端点 + AuthService.change_password 方法

### backend.core（需同步）
- 改动：errors.py 新增 PasswordIncorrect(401 HTTP_401_PASSWORD_INCORRECT)
- 同步建议：core.md 错误类清单加 PasswordIncorrect

### backend.workflow（无源码改动）
- 仅复用 AuditLog model（action=user.password_change），不改源码

### frontend.frontend_app（需同步）
- 改动：app/(dashboard)/account/page.tsx（新，个人中心页+修改密码表单）+ page.test.tsx（新，5/5）

### frontend.frontend_components（需同步）
- 改动：components/top-bar.tsx（用户下拉「个人设置」→「个人中心」入口，UserRound 图标 + router.push）

### frontend.frontend_lib（需同步）
- 改动：lib/auth.ts（新增 changePassword）；lib/api-types.ts（gen-api-types 重新生成，含 ChangePasswordRequest）

### 其他（配置/生成物）
- backend/openapi.json（dump_openapi 刷新）；frontend/app/(dashboard)/layout.tsx（WORKSPACE_WHITELIST 加 /account）+ layout.test.tsx（白名单测试同步）

## unmapped
无（所有改动文件均映射到上述模块）
