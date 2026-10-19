---
author: sillyspec-fr-index
created_at: 2026-10-16T10:51:45.138Z
---

# FR 索引 — auth

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/auth.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auth-001 会话族建模
变更：2026-10-16-fix-auth-random-logout
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 用户完成一次登录（login）；When 后续发生 refresh 轮换或 grace 续期；Then 该登录衍生的所有 session 行共享同一 family_id；login 开新族（uuid4）；存量 NULL 行读取侧以 `family_id or id
全文：.sillyspec/changes/archive/2026-10-16-fix-auth-random-logout/requirements.md#FR-01
最近确认：d43971698

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-fix-auth-random-logout:task-01:acc-0-dac52595
  tests: backend/tests/test_align_platform_change_events_migration.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: d439716981f12e48ada940b75c72cbbbf1f58865
  source_change: 2026-10-16-fix-auth-random-logout
  status: active
- row: 2026-10-16-fix-auth-random-logout:task-01:acc-1-0927a971
  tests: backend/tests/test_align_platform_change_events_migration.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: d439716981f12e48ada940b75c72cbbbf1f58865
  source_change: 2026-10-16-fix-auth-random-logout
  status: active
- row: 2026-10-16-fix-auth-random-logout:task-02:acc-0-c43862d5
  tests: backend/app/core/tests/test_config_auth.py | backend/tests/modules/auth/
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: d439716981f12e48ada940b75c72cbbbf1f58865
  source_change: 2026-10-16-fix-auth-random-logout
  status: active
- row: 2026-10-16-fix-auth-random-logout:task-02:acc-1-c022f34b
  tests: backend/app/core/tests/test_config_auth.py | backend/tests/modules/auth/
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: d439716981f12e48ada940b75c72cbbbf1f58865
  source_change: 2026-10-16-fix-auth-random-logout
  status: active

## FR-auth-002 复用检测族级吊销
变更：2026-10-16-fix-auth-random-logout
状态：active
摘要：默认场景
依据决策：D-002@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 某 refresh token 已被轮换（revoked+rotated）且超过宽限窗后再次提交；When 后端消费该 token；Then 仅 `(user_id, family)` 范围内的存活 session 被置 revoked_at（含窃取者用该 token 衍生的后代 session）；同
全文：.sillyspec/changes/archive/2026-10-16-fix-auth-random-logout/requirements.md#FR-02
最近确认：d43971698

## FR-auth-003 宽限窗默认 300 秒
变更：2026-10-16-fix-auth-random-logout
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 配置未显式覆盖 `AUTH_REFRESH_GRACE_SECONDS`；When 读取默认值；Then 默认为 300（原 60）；grace=0 仍退化为无宽限旧行为；env 覆盖可随时回退；grace 窗内旧 token 复用仍换发新对不误杀（语义保留自被承接
全文：.sillyspec/changes/archive/2026-10-16-fix-auth-random-logout/requirements.md#FR-03
最近确认：d43971698

## FR-auth-004 前端瞬态故障不清会话
变更：2026-10-16-fix-auth-random-logout
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 前端发起 POST /api/auth/refresh 收到 5xx / 408 / 429 或超时；When doRefresh 处理该响应；Then 抛出携带实际状态码的 ApiError；useSession 不 clear、不跳 /login；调用方按请求失败展示可重试错误
全文：.sillyspec/changes/archive/2026-10-16-fix-auth-random-logout/requirements.md#FR-04
最近确认：d43971698

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-fix-auth-random-logout:task-03:acc-0-ae30320d
  tests: frontend/src/lib/__tests__/token-refresh.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: d439716981f12e48ada940b75c72cbbbf1f58865
  source_change: 2026-10-16-fix-auth-random-logout
  status: active
- row: 2026-10-16-fix-auth-random-logout:task-03:acc-1-aa592dcb
  tests: frontend/src/lib/__tests__/token-refresh.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: d439716981f12e48ada940b75c72cbbbf1f58865
  source_change: 2026-10-16-fix-auth-random-logout
  status: active

## FR-auth-005 前端明确失效仍清会话
变更：2026-10-16-fix-auth-random-logout
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 前端发起 POST /api/auth/refresh 收到 401/403/其余 4xx；When doRefresh 处理该响应；Then 返回 null；上层（api.ts 401 收口）清会话并跳 /login（既有行为不变）
全文：.sillyspec/changes/archive/2026-10-16-fix-auth-random-logout/requirements.md#FR-05
最近确认：d43971698
