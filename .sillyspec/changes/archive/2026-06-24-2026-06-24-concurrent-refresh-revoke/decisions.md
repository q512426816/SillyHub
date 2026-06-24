---
author: qinyi
created_at: 2026-06-24T10:30:00+08:00
---

# decisions: 2026-06-24-concurrent-refresh-revoke

本文件是本次变更的决策台账(只记录有实现/验收影响的决策)。长期术语在 archive/scan 时提升到 glossary.md。

## D-001@v1: grace 窗口内被 rotate 的旧 refresh token 重新签发新对

- type: boundary
- status: accepted
- source: user(方案选择)+ code(`service.py:197-238` reuse 检测现状)
- question: grace 窗口内,已 rotate 的旧 refresh token 再次提交时,后端如何处理?
- answer: 在 `auth_refresh_grace_seconds`(默认 60s)窗口内,**重新签发全新 token 对返回,不触发 `revoke_all_user_sessions`**;超出窗口才按现有重放攻击逻辑吊销该用户全部 session。
- normalized_requirement: 给定一个已被 rotate(`rotated_at` 非空)的 session,若 `now - rotated_at < grace`,则用其旧 refresh token 调 `/api/auth/refresh` 应返回 200 + 新 TokenPair,且该用户其它 active session 不被吊销;若 `now - rotated_at >= grace`,则该用户全部 session 被吊销并返回错误。
- impacts: [design §5 Phase1, §7 `_consume_refresh_token`/`refresh`, §7.5 refresh(grace 续期), 后端测试 test_refresh_grace_window.py, task-后端service改造]
- evidence: `backend/app/modules/auth/service.py:197-238`(`_consume_refresh_token` + `_lookup_revoked_session_owner`);`backend/app/modules/auth/service.py:124-140`(`revoke_all_user_sessions`);OWASP refresh token rotation grace period 推荐
- priority: P1

## D-002@v1: grace 时长 = 60s,新增可配置项

- type: boundary
- status: accepted
- source: AI(业界默认)+ user(确认根治+优化范围)
- question: grace 窗口具体多长?是否可调?
- answer: 默认 60s,新增配置 `auth_refresh_grace_seconds: int = Field(60, ge=0, le=600)`(`config.py`)。设为 0 退化为 rotate 后立即按重放处理(等价旧行为)。
- normalized_requirement: `config.Settings.auth_refresh_grace_seconds` 默认 60,范围 [0,600];grace 判定逻辑读取该值。
- impacts: [design §5 Phase1, §7 config, §8, §9 兼容回退旋钮, task-config改造]
- evidence: `backend/app/core/config.py:46-48`(现有 auth TTL 字段风格)
- priority: P1

## D-003@v1: access token TTL 15min → 30min

- type: compatibility
- status: accepted
- source: user(选"根治+额外优化")
- question: 是否延长 access TTL 以降低刷新频率?
- answer: `config.auth_access_ttl_minutes` 默认值 `15 → 30`,减少单位时间内的刷新次数,从源头降低并发刷新竞态概率与 401 风暴。项目未上线、数据可清空,无版本兼容负担。
- normalized_requirement: 新签发的 access token `exp = iat + 30min`;`/api/auth/refresh` 返回的 `access_expires_in` ≈ 1800;现有硬编码 15min 的测试同步更新。
- impacts: [design §5 Phase1, §7 config, §9, task-config + 测试同步, verify-TTL校验]
- evidence: `backend/app/core/config.py:46`(`auth_access_ttl_minutes=15`);`backend/app/core/security.py:94-96`(`create_access_token` 用该值);`frontend/src/lib/api.ts`(前端按 token exp 推算不硬编码)
- priority: P1

## D-004@v1: 前端主动刷新定时器挂 AppShell,剩余 1/3 TTL 触发

- type: architecture
- status: accepted
- source: user(选"根治+额外优化")
- question: 主动刷新(到期前预续期)放哪、何时触发?
- answer: 挂在 `frontend/src/components/app-shell.tsx`(dashboard 全局组件)的 `useEffect`;解析 access token 的 `exp`,当 `exp - now < 1/3 TTL`(30min TTL → 约 10min)时调 `ensureFreshAccessToken()`;每分钟定时校验。复用单飞锁,避免与 401 被动刷新并发竞争。
- normalized_requirement: 登录态下 AppShell 挂载后,access token 剩余有效期低于 1/3 TTL 时,自动调用一次单飞刷新并更新 store;token 缺失/解析失败时静默跳过。
- impacts: [design §5 Phase2, §7 AppShell useEffect, §7.5, task-前端主动刷新, verify-主动续期]
- evidence: `frontend/src/components/app-shell.tsx:111`(AppShell 定义,dashboard 全局);`frontend/src/stores/session.ts`(useSession);`frontend/src/lib/api.ts`(无主动刷新现状)
- priority: P1
