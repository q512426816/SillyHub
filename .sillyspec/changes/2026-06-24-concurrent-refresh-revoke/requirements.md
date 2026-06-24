---
author: qinyi
created_at: 2026-06-24 10:45:30
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 浏览器登录后持续操作的开发/管理用户,期望不被莫名踢出登录 |
| 攻击者 | 假设 refresh token 可能泄露,系统需在 grace 窗口外仍能检测重放并吊销 |

## 功能需求

### FR-01: 后端 grace window(grace 内旧 token 重签、不误杀)
覆盖决策:D-001@v1, D-002@v1

Given 用户已登录,有一 active session S1(refresh_token=T1);T1 被正常 rotate 产生 S2,`S2.rotated_at=now`、`S2.revoked_at=now`,且该用户另有 active session Sx
When 在 grace 窗口(`now - rotated_at < auth_refresh_grace_seconds`,默认 60s)内再次用 T1 调 `POST /api/auth/refresh`
Then 返回 200 + 全新 TokenPair;**不**触发 `revoke_all_user_sessions`;Sx 仍 active;新增一个 active session 行

Given T1 已 rotate 且 `now - rotated_at >= auth_refresh_grace_seconds`
When 用 T1 调 `POST /api/auth/refresh`
Then 触发 `revoke_all_user_sessions`(该用户全部 session 吊销),返回错误(AuthRefreshReused)

### FR-02: Session.rotated_at 字段 + migration
覆盖决策:D-002@v1

Given `sessions` 表现状(无 rotated_at)
When 执行新 migration `202606241000_add_session_rotated_at`
Then 新增 `rotated_at TIMESTAMP WITH TIME ZONE NULL`;现有行 rotated_at 保持 NULL;`down_revision` 指向 `alembic heads` 当前 head

### FR-03: access token TTL 15min → 30min
覆盖决策:D-003@v1

Given `config.Settings` 默认值
When 调 `create_access_token` 签发
Then access token `exp = iat + 30min`;`/api/auth/refresh` 返回 `access_expires_in≈1800`

### FR-04: 前端单飞刷新锁
覆盖决策:D-001@v1(前端侧)

Given 浏览器单 tab,N 个并发请求同时收到 401,store 内为同一 refreshToken
When 各自调用 `ensureFreshAccessToken()`
Then 仅发起 **1 次** `POST /api/auth/refresh`;所有调用共享同一结果;成功后 store 更新为新 token

### FR-05: 三处 401 刷新收口到单飞锁

Given `api.ts`(apiFetch 401 分支)、`ppm/export.ts`(downloadExcel 401 分支)、`auth.ts`(refreshTokens)
When 任一处需要刷新
Then 统一调用 `ensureFreshAccessToken()`,删除各处内联的 fetch refresh;`/api/auth/*` 端点自身不触发刷新重试(防递归)

### FR-06: AppShell 主动刷新定时器
覆盖决策:D-004@v1

Given 用户处于登录态(accessToken 非空)
When AppShell 定时校验(每分钟)发现 `exp - now < (exp - iat)/3`(剩余 < 1/3 TTL)
Then 自动调 `ensureFreshAccessToken()` 续期;token 缺失/解析失败时静默跳过

### FR-07: logout 调用点适配三元返回(Design Grill X-001)

Given `_consume_refresh_token` 返回值由二元组改为三元组 `(User, Session, is_grace)`
When `logout_session_by_refresh` 与 `refresh` 调用它
Then 两处解包正确(logout 用 `_, session, _`);logout 命中 grace 时幂等 revoke、**不签发新对**;`logout` 路径不写 `rotated_at`

## 非功能需求

- **兼容性/可回退**:`auth_refresh_grace_seconds=0` 时退化为旧行为(rotate 后立即按重放处理);migration 加 NULL 列无需回填(数据可清空)。
- **安全性**:grace 窗口外真实重放仍触发 `revoke_all`,不削弱重放防护;窗口内可被多次换新为已接受残余风险(R-01)。
- **可测试**:grace 内不误杀、单飞只发 1 次、TTL=30min、超 grace 仍吊销均有对应测试。
- **跨平台**:前端逻辑不依赖平台特定 API(主动刷新用标准 setTimeout/useEffect + JWT base64 解码,Windows/macOS 浏览器通用)。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-04, FR-05 | grace 窗口内换新行为(后端)+ 单飞锁(前端) |
| D-002@v1 | FR-01, FR-02 | grace=60s 可配置 + rotated_at 字段 |
| D-003@v1 | FR-03 | access TTL 15→30min |
| D-004@v1 | FR-06 | 主动刷新挂 AppShell、剩余 1/3 TTL 触发 |

无未覆盖决策;R-01 为已接受残余风险(见 design.md §10)。
