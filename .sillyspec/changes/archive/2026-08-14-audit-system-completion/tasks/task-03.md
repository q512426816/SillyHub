---
author: qinyi
created_at: 2026-08-14 14:40:00
title: auth login 三分支手工审计 + 测试
priority: P0
wave: 2
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/auth/service.py
  - backend/tests/modules/auth/
---

# task-03: auth login 三分支手工审计 + 测试

## 目标

漂移点 #2 修复：登录成功/失败/禁登入 `audit_logs` 表（登录请求无 Bearer → 无 audit_context → hooks 不触发，必须手工构造；Grill C-3/C-4 已核时序可行）。

## 实现要点（`backend/app/modules/auth/service.py` login，:81-112）

1. **成功分支**：在现有 `await self._db.commit()`（:110）**之前**构造并 add AuditLog（随同一事务落库，C-3 已核）：
   - `actor_id=user.id`，`action=AUTH_LOGIN_SUCCESS`，`resource_type="user"`，`resource_id=user.id`，`workspace_id=None`
   - `details_json`：`{"account": normalized, "ip": ip, "user_agent": user_agent}`（None 值序列化为 null 即可）
2. **失败分支**（:94-96 raise `AuthInvalidCredentials` 前）：
   - `actor_id=None`（无认证主体，requirements 剩余风险已固化）、`resource_id=AUDIT_PLACEHOLDER_ID`、`action=AUTH_LOGIN_FAILED`、`details_json`：`{"account": normalized, "ip": ip, "reason": "invalid_credentials"}`
   - **raise 前显式 commit**；审计写入整体 try/except 包裹，写失败仅 `log.error("login_audit_write_failed", ...)` 不阻断原登录错误（R-03）
3. **禁登分支**（:102-106 raise `AuthUserLoginDisabled` 前）：同失败分支，`reason="login_disabled"`，若 user 已解析可填 `actor_id=user.id`。
4. 常量全部 import 自 workflow/model.py（D-005，禁内联字面量）。不动既有手工插入（D-003）。

## 测试（`backend/tests/modules/auth/` 新增登录审计用例）

- 成功登录 → 1 条 AuditLog（action/resource_id=真实 id/details 含 account）
- 密码错 → 1 条（占位 id + reason=invalid_credentials），且原 AuthInvalidCredentials 照常抛出
- 禁登 → 1 条（reason=login_disabled）
- 审计写失败（mock commit 抛错）→ 登录错误仍正常返回（R-03 实证）

## 验收标准

| AC | 检查方式 | 通过条件 |
|---|---|---|
| AC-01~04 | 上述测试 | 全过 |
| AC-05 | `uv run pytest tests/modules/auth -q --no-cov`（backend） | 全过（含既有用例） |
| AC-06 | ruff + mypy | 全过 |
