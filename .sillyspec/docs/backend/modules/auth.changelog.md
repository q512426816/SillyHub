---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — rbac 新增 list_user_ids_with_permission（变更 2026-08-29-approval-notify-push task-03）
- `list_user_ids_with_permission(session, *, workspace_id, permission)`：广播收件人反查，镜像 `has_permission` 三段解析（工作区 grant 含 PLATFORM_ADMIN 角色 ∪ 平台级 UserRole ∪ is_platform_admin），全程过滤 `users.status == 'active'`。消费方：notification.notify_broadcast。用例 tests/modules/auth/test_rbac_broadcast.py。

## 2026-10-16 — refresh 复用检测改族级吊销 + 宽限窗默认 300s（变更 2026-10-16-fix-auth-random-logout task-01/02）
- `Session.family_id`（UUID NULL，会话族）：login 开新族 uuid4、refresh rotate/grace 继承（`family_id or id` 兜底存量 NULL 行）；迁移 `c3f8a1d6e2b4` 仅加列、不回填、不加索引。
- `AuthService._revoke_session_family(user_id, family)`：超 grace 复用旧 token 只吊销命中族（含其后代），同用户异族不牵连；内部 commit（D-008 执行期裁决——异常路径 rollback 语义必需）。`revoke_all_user_sessions` 用途收窄（复用检测不再调用）。
- `auth_refresh_grace_seconds` 默认 60→300（`backend/app/core/config.py`；D-003@v1）。
- 用例：tests/modules/auth/test_refresh_family_revocation.py（新，4 用例：族隔离/grace 继承/legacy NULL 兜底/新族）+ test_refresh_grace_window.py 用例 2 改族断言、用例 3 过期 xfail 清偿。
- 2026-10-21-agent-profile-slim-default | 档案瘦身重定位为人格加技能清单并支持用户默认档案
- 2026-10-23-askuser-history-live-sync | AskUser 问答历史实时回显（用户实测 bug 修复）
- 2026-10-23-session-network-context | 2026-10-23-session-network-context
