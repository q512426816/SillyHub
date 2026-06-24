---
author: qinyi
created_at: 2026-06-24 11:15:00
plan_level: full
---

# 实现计划:修复并发刷新导致登录态误吊销

> 任务编号 = 实现顺序(TDD:测试任务排在前);Wave 按 depends_on 拓扑排序(同 Wave 内无依赖、可并行)。

## Spike 前置验证

无。技术方案(grace 时间窗 + 前端单飞锁 + access TTL/主动刷新)均为成熟模式,设计已在 Design Grill 通过(X-001 已修正),无技术不确定性。

## Wave 1 · 无依赖(并行)

- [x] task-01: config 新增 `auth_refresh_grace_seconds=60` + access TTL `15→30min`(覆盖:FR-03, D-002@v1, D-003@v1)
- [x] task-02: `Session` 新增 `rotated_at` 字段(覆盖:FR-02, D-002@v1)
- [x] task-06: 前端测试 `token-refresh` 单飞 + `api` 401(先写,红)(覆盖:FR-04, FR-05)

## Wave 2 · 依赖 Wave 1(并行)

- [x] task-03: migration `add_session_rotated_at`(覆盖:FR-02;依赖 task-02)
- [x] task-04: 后端测试 `test_refresh_grace_window`(先写,红)(覆盖:FR-01, FR-07;依赖 task-01/02)
- [x] task-07: 新增 `lib/token-refresh.ts` 单飞锁 + `decodeJwtExp`(实现,绿)(覆盖:FR-04;依赖 task-06)

## Wave 3 · 依赖 Wave 2(并行)

- [x] task-05: service grace 改造(实现,绿)(覆盖:FR-01, FR-07, D-001@v1;依赖 task-01/02/03/04)
- [x] task-08: `api.ts`/`ppm-export.ts`/`auth.ts` 三处 401 收口(覆盖:FR-05;依赖 task-07)
- [x] task-09: `AppShell` 主动刷新定时器(覆盖:FR-06, D-004@v1;依赖 task-07)

## Wave 4 · 依赖全部

- [x] task-10: 端到端实测 + 文档同步(覆盖:全部 FR)

## 任务总表

| ID | Wave | 任务 | 文件 | 覆盖 | 依赖 | 完成标准 | 验证命令 |
|---|---|---|---|---|---|---|---|
| task-01 | W1 | config 加 grace + TTL | `backend/app/core/config.py` | FR-03, D-002, D-003 | — | `auth_refresh_grace_seconds=60`(ge=0,le=600)、`auth_access_ttl_minutes` 默认 30 | `cd backend && uv run pytest app/core -q` |
| task-02 | W1 | Session.rotated_at | `backend/app/modules/auth/model.py` | FR-02, D-002 | — | 新增 `rotated_at: datetime\|None`(nullable DateTime tz) | `cd backend && uv run ruff check app/modules/auth/model.py` |
| task-06 | W1 | 前端测试(红) | `frontend/src/lib/__tests__/token-refresh.test.ts`(新增) | FR-04, FR-05 | — | 并发调 `ensureFreshAccessToken` N 次只发 1 次 `/api/auth/refresh`;此时失败(红) | `cd frontend && pnpm test -- token-refresh`(预期 RED) |
| task-03 | W2 | migration | `backend/migrations/versions/202606241000_add_session_rotated_at.py`(新增) | FR-02 | task-02 | `sessions` 加 `rotated_at TIMESTAMP WITH TIME ZONE NULL`;`down_revision`=`alembic heads` 当前 head | `cd backend && uv run alembic upgrade head` |
| task-04 | W2 | 后端测试(红) | `backend/tests/modules/auth/test_refresh_grace_window.py`(新增) | FR-01, FR-07 | task-01/02 | 3 用例:grace 内重复刷新不吊销 / 超 grace 仍吊销 / logout 调用点三元解包不报错;此时失败(红) | `cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py -q`(预期 RED) |
| task-07 | W2 | token-refresh 单飞锁(绿) | `frontend/src/lib/token-refresh.ts`(新增) | FR-04 | task-06 | 模块级 `inflight` + `ensureFreshAccessToken()` + `decodeJwtExp()`;task-06 转绿 | `cd frontend && pnpm test -- token-refresh` |
| task-05 | W3 | service grace 改造(绿) | `backend/app/modules/auth/service.py` | FR-01, FR-07, D-001 | task-01/02/03/04 | 先 `grep -rn "_consume_refresh_token" backend/app/` 核对全量调用点(refresh+logout);`_consume_refresh_token` 返回三元组+grace 判定;`refresh` 分支;新增 `_mark_session_rotated`;`_lookup_revoked_session_owner`→`_find_revoked_session`;`logout_session_by_refresh` 三元解包;task-04 转绿 | `cd backend && uv run pytest tests/modules/auth -q` 全绿 |
| task-08 | W3 | 三处 401 收口 | `frontend/src/lib/api.ts`、`frontend/src/lib/ppm/export.ts`、`frontend/src/lib/auth.ts` | FR-05 | task-07 | 删除内联 fetch refresh,改调 `ensureFreshAccessToken()`;保留 `isAuthEndpoint` 防递归 | `cd frontend && pnpm typecheck && pnpm test` |
| task-09 | W3 | AppShell 主动刷新 | `frontend/src/components/app-shell.tsx` | FR-06, D-004 | task-07 | `useEffect` 定时(每分钟)校验 exp,剩余<1/3 TTL 调 `ensureFreshAccessToken()`;token 缺失静默跳过 | `cd frontend && pnpm typecheck && pnpm lint` |
| task-10 | W4 | 实测 + 文档同步 | 联调 + 模块文档 | 全 FR | task-01~09 | curl 实测 grace(60s 内重提不吊销、超 60s 吊销)+ 前端联调;同步 `auth.md`/`lib-api.md` 模块文档 | 手动 curl + `make test` |

## 依赖关系

```
Wave 1 (无依赖,并行)
  task-01 (config) ──┐
  task-02 (model) ───┼──▶ Wave 2
  task-06 (前端测试)─┘
       │                  task-03 (migration ←02)
       │                  task-04 (后端测试 ←01,02)     ◀─ 后端
       │                  task-07 (单飞锁   ←06)        ◀─ 前端
       │                       │
Wave 3 ◀──────────────────────┘
  task-05 (service ←01,02,03,04)  ◀─ 后端
  task-08 (三处收口 ←07)          ◀─ 前端
  task-09 (AppShell ←07)          ◀─ 前端
                       │
Wave 4                 ▼
  task-10 (集成实测+文档 ←01~09)
```

- 后端链:task-02 → (task-03, task-04) → task-05。
- 前端链:task-06 → task-07 → (task-08, task-09)。
- 后端链与前端链在 Wave 1 起即可并行推进(各自独立,task-10 才汇合)。
- 无循环依赖。

### 关键路径

- 后端关键路径:`task-02(W1) → task-03(W2) → task-05(W3)`(task-04 与 task-03 同 Wave2 并行,task-05 等齐 01/02/03/04)。
- 前端关键路径:`task-06(W1) → task-07(W2) → task-08(W3)`。
- 整体工期 = 4 Wave(瓶颈 task-05 service 改造 + task-07 单飞锁,二者分处不同链可并行)。

## 覆盖矩阵

| 决策/需求 | 覆盖任务 | 验收证据(AC) |
|---|---|---|
| FR-01 grace 误杀根治 | task-04, task-05 | AC-01/02: grace 内重复刷新不吊销;超 grace 仍吊销 |
| FR-02 rotated_at + migration | task-02, task-03 | AC: `alembic upgrade head` 成功,新增列 NULL |
| FR-03 TTL 30min | task-01 | AC-05: 新 token exp=iat+30min,`access_expires_in≈1800` |
| FR-04 单飞锁 | task-06, task-07 | AC-04: 并发 N 次只发 1 次 refresh |
| FR-05 三处收口 | task-08 | AC: 三处均走 `ensureFreshAccessToken`,无内联 refresh |
| FR-06 主动刷新 | task-09 | AC-06: 剩余<1/3 TTL 自动续期 |
| FR-07 logout 适配 | task-04, task-05 | AC: logout 三元解包不报错、不签发新对 |
| D-001@v1 | task-05, task-07, task-08 | grace 换新行为(后端)+ 单飞(前端) |
| D-002@v1 | task-01, task-02 | grace=60s + rotated_at |
| D-003@v1 | task-01 | TTL 15→30 |
| D-004@v1 | task-09 | 主动刷新挂 AppShell |

## 验收标准(对应 proposal 成功标准)

- AC-01:同一 refresh token 60s 内重复/并发提交,该用户其它 active session 不被吊销,用户保持登录。
- AC-02:同一 refresh token 超 60s 后再提交,仍触发 `revoke_all`(重放防护不削弱)。
- AC-03:`grace=0` 时退化为旧行为(rotate 后立即按重放处理)——回退旋钮。
- AC-04:前端 N 个并发 401 只发起 1 次 `/api/auth/refresh`。
- AC-05:access token 默认 30min;`/api/auth/refresh` 返回 `access_expires_in≈1800`。
- AC-06:登录态下 access token 剩余 < 1/3 TTL 自动续期。
- AC-07:后端 `pytest` + 前端 `vitest` 全绿。
- AC-08(跨平台):主动刷新用标准 `setTimeout`/`useEffect` + `atob`,Windows/macOS 浏览器通用。
