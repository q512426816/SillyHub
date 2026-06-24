---
author: qinyi
created_at: 2026-06-24 13:15:00
---

# 验证报告:2026-06-24-concurrent-refresh-revoke

## 结论

**PASS WITH NOTES(条件通过)**

代码 + 单元测试充分验证 grace window 与单飞锁逻辑,设计完全一致,无 FAIL blocker。但本次属 **integration-critical**(改了 refresh session 生命周期,新增 grace 续期状态路径),按风险门控要求真实端到端集成证据,而本次未起 backend 做真实 curl 实测 → **需补端到端实测后转 PASS**(Runtime Evidence 见下,当前待补)。

## 任务完成度

| task | 状态 | 证据 |
|---|---|---|
| task-01 config | ✅ | config.py:53 `auth_refresh_grace_seconds=60` + TTL30;test_config_auth 边界 0/120/-1/601/600 |
| task-02 model | ✅ | model.py:119 `Session.rotated_at` |
| task-03 migration | ✅ | `202606241000_add_session_rotated_at.py`(down_revision=202607240900) |
| task-04 后端测试 | ✅ | test_refresh_grace_window.py 3 用例 |
| task-05 service | ✅ | service.py `_consume_refresh_token`三元+is_grace / `_find_revoked_session` / `_mark_session_rotated` / grace判定(now-rotated_at<60s) / logout三元解包 |
| task-06 前端测试 | ✅ | token-refresh.test.ts 9 用例 |
| task-07 单飞锁 | ✅ | token-refresh.ts inflight + ensureFreshAccessToken + decodeJwtExp + finally清空 |
| task-08 三处收口 | ✅ | api.ts:165 / auth.ts:64 / ppm-export.ts:80 均 import+调 ensureFreshAccessToken |
| task-09 AppShell | ✅ | app-shell.tsx:51 import + decodeJwtExp + setInterval + ensureFreshAccessToken |
| task-10 集成+文档 | ⚠️ | 代码+单测全绿;**端到端 curl 实测 + auth.md/lib-api.md 文档同步未做** |

完成率 9/10 ✅ + 1 ⚠️(task-10 非代码部分)。

## 设计一致性

对照 design.md(唯一 truth source):
- 架构决策遵循(grace 时间窗 + 前端单飞 + TTL30 + 主动刷新)✅
- 文件变更清单(design §6)与实现一致 ✅
- 数据模型(Session.rotated_at,§8)✅
- API 设计(/api/auth/refresh 协议不变,TokenPair DTO 不变)✅
- 生命周期契约表(§7.5:login/refresh rotate/refresh grace/refresh 重放/logout/expire)实现覆盖 ✅
- Reverse Sync:无实现超出 design 的项 ✅
- 模块文档一致性:⚠️ auth.md 仍写"refresh token 单次使用,登出即标 revoked",未更新 grace window(task-10 文档同步待做,非阻断)

## 探针结果

- 探针1 未实现标记扫描:本次变更文件(service/token-refresh/api/auth/ppm-export/app-shell/config/model/migration)**无 TODO/FIXME/HACK/XXX** ✅
- 探针2 关键词覆盖:grace / 单飞 / rotated_at / ensureFreshAccessToken 全覆盖 ✅
- 探针3 测试覆盖:task-01/04/06 有直接测试;task-05/07/08 被间接测试;**task-09 AppShell 无独立单测** ⚠️;task-10 集成测试待做
- 探针4 决策追踪:D-001~D-004 → FR-01~07 → task → evidence 全闭环 ✅
- 探针5 API Contract Parity:auth router 端点未变(login/refresh/logout/me/api-keys 均现有),前端无新 API 路径(收口复用 /api/auth/refresh),**无 contract gap** ✅

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 grace 窗口内换新 | FR-01, FR-04, FR-05 | task-05, task-07, task-08 | service.py grace 分支 + token-refresh.ts 单飞 + 三处收口 | PASS |
| D-002@v1 grace=60s 可配 | FR-01, FR-02 | task-01, task-02 | config.py auth_refresh_grace_seconds + Session.rotated_at | PASS |
| D-003@v1 TTL 15→30 | FR-03 | task-01 | config.py auth_access_ttl_minutes=30 + test_config_auth | PASS |
| D-004@v1 AppShell 主动刷新 | FR-06 | task-09 | app-shell.tsx useEffect setInterval | PASS |

无 P0/P1 unresolved/blocking。

## 测试结果

- 后端 `tests/modules/auth/` + `app/core/tests/test_config_auth.py`:**96 passed + 2 xpassed**(xpass 为 test_refresh_grace_window 用例2/3,xfail strict=False 容忍,grace 判定+logout 三元解包正确)
- 前端 `token-refresh.test.ts`:**9 passed**
- 前端全量 vitest(execute 阶段):**450 passed**
- 后端全量 mypy app:**361 source files, no issues**
- ruff format + ruff check(commit 时):**Passed**
- 前端 typecheck(tsc --noEmit):**通过**
- 前端 lint:2 warning(line 65/66 taskId/partial,**既有代码非本次引入**)

无失败测试。

## 技术债务

本次变更文件无 TODO/FIXME/HACK。遗留:
- task-04 用例2/3 的 `@pytest.mark.xfail(strict=False)` 标注:RED 阶段容忍 XPASS,task-05 实现后可移除 xfail 转确定 PASS(当前 XPASS 不报错,可选清理)。
- task-09 AppShell 主动刷新无独立单测(可补 vi.useFakeTimers 测)。

## 变更风险等级

**integration-critical**

判定依据:design §7.5 生命周期契约表 + 触发关键词 `session` + `lifecycle`。本次新增 refresh session 的 grace 续期状态路径(rotate→grace 内可换新→超 grace 重放),属 session 状态机变更,门控要求真实集成验证。

## Runtime Evidence(integration-critical 必填)— 当前待补

⚠️ **未起 backend 做真实端到端实测**。代码 + mock 单测已充分验证 grace 逻辑,但按 integration-critical 门控,需补:

- backend 启动:`cd backend && uv run alembic upgrade head`(应用 migration 加 rotated_at)+ `uv run uvicorn app.main:app --port 8000`
- 端到端 curl 序列(AC-01/02/03):
  1. `POST /api/auth/login` → 拿 access1 + refresh1
  2. `POST /api/auth/refresh`(refresh1)→ rotate,拿 access2 + refresh2(此时 refresh1 的 session.rotated_at=now)
  3. **60s 内** `POST /api/auth/refresh`(refresh1)→ 期望 200 新对 + 该用户其它 active session 仍 active(不被 revoke_all)✅ grace 生效
  4. 设 grace=0 或等 >60s `POST /api/auth/refresh`(refresh1)→ 期望 revoke_all + 401 ✅ 重放防护
- 验证 `access_expires_in ≈ 1800`(TTL30)
- 前端联调:登录后密集操作 + 等 ~20min(剩余<1/3 TTL)观察主动刷新触发 + 不掉线

**门控结论**:mock 单测全绿但缺真实集成证据 → 维持 PASS WITH NOTES,补上述实测后转 PASS。

## 代码审查

- service.py grace 实现:`_as_utc()` 兼容 SQLite 测试环境 naive datetime(不改逻辑边界,生产 PG 一律 UTC),grace=0 退化为旧行为(timedelta(0) 比较 <0 恒 false 走重放)✅
- token-refresh.ts 单飞:模块级 inflight + finally 清空防死锁(R-04),复用 SessionTokens 类型 ✅
- 三处收口保留 isAuthEndpoint 防递归 + x-auth-retry 防单请求无限重试 ✅
- AppShell 主动刷新:空依赖数组 + getState 动态读避免闭包旧 token,失败 catch 静默(401 由 api 层处理)✅

总体:实现严谨,边界处理完善,符合 design。唯一缺口是 integration-critical 变更缺真实端到端证据(环境限制),代码质量本身无问题。
