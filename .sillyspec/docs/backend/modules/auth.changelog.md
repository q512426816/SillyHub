---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — rbac 新增 list_user_ids_with_permission（变更 2026-08-29-approval-notify-push task-03）
- `list_user_ids_with_permission(session, *, workspace_id, permission)`：广播收件人反查，镜像 `has_permission` 三段解析（工作区 grant 含 PLATFORM_ADMIN 角色 ∪ 平台级 UserRole ∪ is_platform_admin），全程过滤 `users.status == 'active'`。消费方：notification.notify_broadcast。用例 tests/modules/auth/test_rbac_broadcast.py。
