---
author: qinyi
created_at: 2026-06-24 10:45:30
---

# Proposal

## 动机

登录用户在**持续操作**过程中会突然登录失效、被迫重新登录。不是闲置超时,而是越密集操作越容易掉线,约每 15 分钟一个周期,且为断崖式失效(非渐进过期)。这严重影响日常使用,用户每次密集操作一段时间就被踢出。

## 关键问题

现有认证方案在"并发刷新"场景下存在误杀,具体三个痛点:

1. **后端 refresh 轮换过于激进**:旧 refresh token 被成功消费后立即吊销(`revoked_at`),同一个已吊销的 token 再次提交即判定为重放攻击 → `revoke_all_user_sessions` 吊销该用户**全部** session。在并发刷新下,合法的"近乎同时的第二次刷新"会被误判为攻击。

2. **前端无并发刷新互斥锁**:`api.ts` / `ppm/export.ts` / `auth.ts` 三处独立的 401 刷新逻辑各自发起 `/api/auth/refresh`,无 single-flight。access token 过期瞬间多个并发请求同时 401、同时用同一个旧 refresh token 刷新 → 必然触发上述误杀。

3. **access TTL 偏短 + 纯被动刷新**:TTL=15min 且无主动续期,导致过期点集中爆发 401 风暴,放大并发刷新概率。

## 变更范围

- **后端**:`config` 新增 `auth_refresh_grace_seconds=60`、`auth_access_ttl_minutes` 默认 `15→30`;`Session` 新增 `rotated_at` 字段 + migration;`AuthService.refresh`/`_consume_refresh_token` 增加 grace 判定(窗口内重签不吊销、超窗口仍吊销),`logout` 调用点适配三元返回。
- **前端**:新增 `lib/token-refresh.ts` 单飞锁 `ensureFreshAccessToken()`;三处 401 刷新收口到它;`AppShell` 增加主动刷新定时器(剩余 < 1/3 TTL 触发)。
- **测试(TDD)**:后端复现 grace 行为(误杀不再发生、重放仍防护);前端单飞只发 1 次 refresh。

## 不在范围内(显式清单)

- 不做 refresh token 的 JWT+jti 黑名单重构(沿用 bcrypt 遍历匹配)。
- 不做跨 tab 同步(BroadcastChannel);多 tab 由后端 grace 兜底。
- 不改 login/logout/me 协议与 RBAC/权限链路。
- 不做版本/数据兼容(项目未上线,数据可清空)。

## 成功标准(可验证)

- 同一 refresh token 在 60s 内被重复/并发提交,该用户其它 active session **不被吊销**,用户保持登录。
- 同一 refresh token 超过 60s 后再次提交,仍触发 `revoke_all`(重放防护不削弱)。
- `grace=0` 时退化为旧行为(rotate 后立即按重放处理)。
- 前端 N 个并发 401 只发起 1 次 `/api/auth/refresh`。
- access token 默认有效期 30 分钟;`/api/auth/refresh` 返回 `access_expires_in≈1800`。
- 登录态下 access token 剩余 < 1/3 TTL 时自动续期,无需用户感知。
- 后端测试(`pytest`)与前端测试(`vitest`)全绿。
