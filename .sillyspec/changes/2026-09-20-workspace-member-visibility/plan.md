---
author: WhaleFall
created_at: 2026-09-20 18:05:00
plan_level: light
---

# 轻量计划（Light Plan）：工作区可见性收紧为成员制

## 来源

brainstorm 四件套（design.md 三 Wave 方案 / requirements.md FR-01~06 / decisions.md D-001~004，用户三轮确认：平台级权限纯功能入口、全权限统一、三触点判定链+列表+通知收件人）。触发实证：账号 180490 持 developer 系统角色（平台级 workspace:read）看到全部 5 个非成员工作区。

## 范围

- backend/app/modules/auth/rbac.py — `has_permission` 判定链收紧 + `list_user_ids_with_permission` 段 2 收窄
- backend/app/modules/workspace/router.py — `list_workspaces` 平台分支收窄为仅 platform:admin
- backend/app/modules/workspace/tests/test_platform_grant_list.py — ql-20260917-007 断言语义反转 + 三口径一致性
- NEW:backend/app/modules/auth/tests/test_rbac_workspace_scope.py — 判定链收紧专项测试
- 模块：auth、workspace、notification（消费方回归，不改 notification 源码）

## 验收

- AC-01（FR-01）：非成员 + 平台级任意权限（workspace:read / mcp:read 等）→ `has_permission(workspace_id=W)` False，对应端点 403（新测试 test_rbac_workspace_scope.py 覆盖）
- AC-02（FR-02）：`is_platform_admin` / 持 platform:admin → 判定与列表行为同改动前（测试覆盖）
- AC-03（FR-03）：非成员持平台级 workspace:read → GET /api/workspaces 空列表；test_platform_grant_list.py 断言反转后覆盖
- AC-04（FR-04）：工作区事件通知收件人 = 成员 + platform:admin 持有者 + is_platform_admin 用户，平台级仅持业务权限者不收件（测试覆盖）
- AC-05（FR-05）：`require_permission_any` / auth/me / 菜单门控行为不变（测试回归）
- AC-06（FR-06）：创建者自动 workspace_owner（`_ensure_creator_as_owner`）不受影响（回归）
- AC-07：三口径一致性断言（列表 ⊆ 可访问 ⊆ 通知收件人）在 test_platform_grant_list.py 中成立
- AC-08：ruff + mypy scoped 0；仅跑相关测试（CLAUDE.md 规则 0），全量留 CI

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-04, task-05 | AC-01/02/03 |
| D-002@v1 | task-01, task-05 | AC-01（无权限白名单） |
| D-003@v1 | task-02, task-03, task-04 | AC-03/04/07 |
| D-004@v1 | —（非目标，路径显示另开 quick） | — |
