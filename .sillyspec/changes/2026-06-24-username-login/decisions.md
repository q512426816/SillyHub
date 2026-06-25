---
author: WhaleFall
created_at: 2026-06-24T21:57:58
---

# decisions — username-login 决策台账

本文件记录 2026-06-24-username-login 变更中有实现/验收影响的决策。

## D-001@v1 — 登录方式：纯登录名（移除 email 登录）

- type: requirement
- status: accepted
- source: 对话式探索（Step 6）
- question: 登录方式怎么定？
- answer: 纯登录名登录。`login()` 移除 email 分支，只走 `_lookup_active_user_by_username`；登录页只引导「登录名」。
- normalized_requirement: 登录仅认 `User.username`，email 不再作为登录账号。
- impacts: `auth/service.py login` 改纯 username；`login/page.tsx` 文案改登录名；存量用 email 登录的用户需改用登录名。
- evidence: auth/service.py:83-91 当前含@走 email 分支；Step 6 用户选「纯登录名登录」。
- priority: P0

## D-002@v1 — 存量 username 沿用已生成值（零数据迁移）

- type: requirement
- status: accepted
- source: 对话式探索（Step 6）
- question: 存量用户的登录名怎么处理？
- answer: 沿用已生成的 `username`（email 前缀，可能带去重序号），不批量重设。
- normalized_requirement: 不做存量数据迁移；存量 username 即登录名，管理员可在表单里改。
- impacts: Phase 3 migration 仅 email nullable，不动 username 列；Phase 4 列表显示登录名列便于核对。
- evidence: admin/users_service.py:193-209 `_resolve_username` 已生成存量 username；Step 6 用户选「沿用」。
- priority: P0

## D-003@v1 — 非空 email 仍唯一

- type: requirement
- status: accepted
- source: 对话式探索（Step 6）
- question: 邮箱改非必填后，填了邮箱的是否仍唯一？
- answer: 非空 email 仍唯一。保留 `ux_users_email` 普通唯一索引，依赖 PG「多 NULL 不冲突」语义。
- normalized_requirement: email 可空；多个空 email 共存；非空 email 全局唯一。
- impacts: Phase 3 不改 email 唯一索引，仅 ALTER 列 nullable；测试覆盖「多空 email」+「非空重复 409」。
- evidence: auth/model.py:32 `ux_users_email_active(email, unique=True)`；PG UNIQUE 对多 NULL 放行。
- priority: P0

## D-004@v1 — 登录名（username）可编辑

- type: requirement
- status: accepted
- source: 对话式探索（Step 6）
- question: 登录名是否允许在用户编辑里修改？
- answer: 可编辑。`UserUpdateRequest` 增 username，变更带唯一校验（排除自身）。
- normalized_requirement: 编辑抽屉可改 username；冲突抛 409 友好提示；不能改成与他人重复。
- impacts: admin/schema.py UserUpdateRequest 增 username；users_service.update_user 增 username 唯一校验；admin-user-drawer 增登录名可编辑字段。
- evidence: admin/users_service.py:210 update_user 当前无 username 修改；Step 6 用户选「可编辑」。
- priority: P0

## D-005@v1 — 实现方案 A 最小兼容 + 删除多余 merge revision

- type: technical
- status: accepted
- source: 方案选择（Step 8）
- question: 选哪个实现方案？alembic 断链怎么修？
- answer: 方案 A 最小兼容（复用 username 字段+唯一索引、email 列 nullable 保留唯一索引、login 纯 username、LoginRequest.account 保留、应用层校验 username 格式）。alembic 断链修复采用**删除** `202606281200_merge_multi_heads.py`（无意义 merge，引用不存在的 202606281000），新 migration down_revision 锚定 `202606241001`。
- normalized_requirement: 复用现有字段/索引，最小改动；migration 仅 email nullable + 删坏 merge；不引入部分唯一索引/DB CHECK/字段改名。
- impacts: design Phase 0-5 全部按此；execute 顺序 Phase 0 先修 alembic 再加 migration。
- evidence: 202606241001 无子无被引用（删 merge 后即 head）；202606281200 无子无被引用；方案 B 的部分唯一索引/CHECK 收益不抵重建风险。
- priority: P0
