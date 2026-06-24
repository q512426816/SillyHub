---
author: qinyi
created_at: 2026-06-24T10:30:00+08:00
---

# design: 修复并发刷新导致登录态误吊销

> 变更名:`2026-06-24-concurrent-refresh-revoke`
> 范围:backend(auth/core/migrations) + frontend(lib-api/lib-auth/lib-ppm/stores-session/components-shared)

## 1. 背景

用户反馈:登录后一直在操作,却会突然登录失效、被迫重新登录;不是放着不动,而是密集操作时更容易掉线,约每 15 分钟一个周期,且是断崖式失效(不是渐进过期)。

根因(已通过读码确认):

- 后端 access token TTL = 15 分钟(`backend/app/core/config.py:46` `auth_access_ttl_minutes=15`),refresh 采用 **rotate + 立即吊销旧 token** 模型(`backend/app/modules/auth/service.py:96-108`)。
- refresh 复用检测激进(`service.py:197-238`):旧 refresh token 被成功消费后立即 `revoked_at`,若同一个已 revoked 的 refresh token 再次被提交 → 判定重放攻击 → `revoke_all_user_sessions`(`service.py:124-140`)把**该用户全部 session** 吊销。
- 前端**无主动续期**,纯靠请求拿到 401 被动刷新;且**三处独立的刷新逻辑全部没有并发互斥锁**:`frontend/src/lib/api.ts:156-206`、`frontend/src/lib/ppm/export.ts:76-108`、`frontend/src/lib/auth.ts:55-72`;`stores/session.ts` 也无任何 lock/pending 字段。
- 页面存在大量 5–10s 业务轮询(`server-status-card`、`health-card`、`agent-run-panel`、`workspaces/agent`、`mission-console`、`runtimes` 等)。

竞态时序:access token 到 15min 过期瞬间,多个并发请求同时 401 → 几乎同时读到 store 里**同一个旧 refreshToken** 各自发起 `/api/auth/refresh` → 第 1 个成功(revoke 旧 session、签发新对)→ 后续请求用的旧 token 命中**已 revoked 的 session** → 触发 reuse-attack → `revoke_all_user_sessions` → 前端 `clear()` + 跳 `/login`。

这解释了"越密集操作越容易掉线、断崖式失效、约 15min 周期"的全部现象。

## 2. 设计目标

- **G1 根治误杀**:并发刷新(单 tab 多请求 / 多 tab)不再触发该用户全部 session 被吊销。
- **G2 降低刷新频率**:access TTL 偏短 + 纯被动刷新导致过期点 401 风暴,延长 TTL 并增加主动续期。
- **G3 保留重放防护**:grace 窗口之外的真实重放仍按攻击处理(吊销全部),不削弱安全性。
- **G4 收口**:前端三处刷新逻辑统一到单一单飞(single-flight)入口,杜绝重复实现带来的新竞态。

## 3. 非目标

- **不**改 refresh token 的 bcrypt 存储/遍历匹配模型(改为 JWT+jti 黑名单是更大重构,违反 YAGNI)。
- **不**做跨 tab 同步(BroadcastChannel);多 tab 由后端 grace 兜底,前端只保证单 tab 内单飞。
- **不**改 login/logout/me 的协议,不改 RBAC/权限链路。
- **不**做版本兼容(项目未上线,数据可清空,`CLAUDE.md` 规则 8)。

## 4. 拆分判断

虽跨 backend + frontend 两个子项目,但本质是**同一 bug 的两端协同修复**(前端单飞锁消除竞态 + 后端 grace window 兜底 + TTL/主动刷新降低频率),逻辑内聚、任务数 < 10,无批量特征。不拆分,在同一变更内按 Wave 分组(后端 → 前端 → 集成测试)。

## 5. 总体方案(分 Phase)

### Phase 1 · 后端 grace window + TTL

- `config.py` 新增 `auth_refresh_grace_seconds=60`;`auth_access_ttl_minutes` 默认 `15 → 30`。
- `model.py` `Session` 新增 `rotated_at: datetime | None`。
- 新增 alembic migration:`sessions` 加 `rotated_at` 列。
- `service.py`:`refresh()` rotate 时同时写 `revoked_at` + `rotated_at`;`_consume_refresh_token` 在 live session 未命中、命中已 revoked session 时先判 grace —— 窗口内**重新签发新对**(不 `revoke_all`),超窗口维持现有重放吊销。

### Phase 2 · 前端单飞锁 + 主动刷新

- 新增 `frontend/src/lib/token-refresh.ts`:模块级 `inflight` Promise,`ensureFreshAccessToken()` 单飞。
- `api.ts` / `ppm/export.ts` / `auth.ts` 三处 401 刷新收口到 `ensureFreshAccessToken()`。
- `AppShell` 增加主动刷新 `useEffect`:解析 access token `exp`,剩余 < 1/3 TTL(~10min)时调 `ensureFreshAccessToken()`。

### Phase 3 · 测试(TDD)

- 后端:复现"同一 refresh token 并发/重复提交,grace 内不误杀、超 grace 仍吊销";现有 reuse-attack 测试仍绿;TTL=30min。
- 前端:`token-refresh` 单飞只发 1 次 `/api/auth/refresh`;`api.ts` 401 重试走单飞。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/core/config.py` | 新增 `auth_refresh_grace_seconds=60`;`auth_access_ttl_minutes` 默认 `15→30` |
| 修改 | `backend/app/modules/auth/model.py` | `Session` 新增 `rotated_at: datetime \| None` 字段 |
| 新增 | `backend/migrations/versions/202606241000_add_session_rotated_at.py` | `sessions` 加 `rotated_at TIMESTAMP WITH TIME ZONE NULL`;`down_revision` = 当前 head(execute 用 `alembic heads` 确认) |
| 修改 | `backend/app/modules/auth/service.py` | `_consume_refresh_token` 加 grace 判定 + 返回 `is_grace` 标志;`refresh()` 分支跳过重复 revoke;新增 `_mark_session_rotated`;`_lookup_revoked_session_owner` 返回 session 以读取 `rotated_at` |
| 新增 | `backend/tests/modules/auth/test_refresh_grace_window.py` | 复现并发/重复刷新 grace 行为(先写,红→绿) |
| 新增 | `frontend/src/lib/token-refresh.ts` | `ensureFreshAccessToken()` 单飞锁 + `decodeJwtExp()` 工具 |
| 修改 | `frontend/src/lib/api.ts` | 401 分支改调 `ensureFreshAccessToken()`,删除内联 fetch refresh |
| 修改 | `frontend/src/lib/ppm/export.ts` | 401 分支改调 `ensureFreshAccessToken()` |
| 修改 | `frontend/src/lib/auth.ts` | `refreshTokens()` 复用同一单飞 inflight |
| 修改 | `frontend/src/components/app-shell.tsx` | 增加主动刷新 `useEffect`(定时校验 exp,剩余<1/3 TTL 触发) |
| 新增 | `frontend/src/lib/__tests__/token-refresh.test.ts` | 单飞只发 1 次 refresh |
| 修改 | `frontend/src/lib/api.ts` 相关测试 | 401 重试走单飞(如已有 api 测试则补充) |

## 7. 接口定义

### 后端 `service.py`(关键签名变更)

```python
# config.py 新增字段
auth_refresh_grace_seconds: int = Field(60, ge=0, le=600)
auth_access_ttl_minutes: int = Field(30, ge=1, le=24 * 60)  # 默认 15→30

# model.py Session 新增字段
rotated_at: datetime | None = Field(
    default=None,
    sa_column=Column(DateTime(timezone=True), nullable=True),
)

# service.py —— _consume_refresh_token 返回值增加 is_grace 标志
async def _consume_refresh_token(
    self, refresh_token: str
) -> tuple[User, SessionRow, bool]:
    """第三返回值 is_grace: True=命中宽限续期(session 已 revoked,上层无需再 revoke)。"""
    # 1) live session 命中 → return user, session, False
    # 2) live 未命中 → 查 revoked session(_find_revoked_session 返回 session 而非仅 user_id)
    #    若 rotated_at 存在且 now-rotated_at < grace → return user, session, True
    #    否则 revoke_all_user_sessions + raise AuthRefreshReused
    # 3) 都没有 → raise AuthTokenInvalid

# service.py —— rotate 专用 helper(区别于 logout 的纯 revoke)
async def _mark_session_rotated(self, session: SessionRow) -> None:
    now = _utc_now()
    session.revoked_at = now
    session.rotated_at = now  # 记录轮换时刻,供 grace 判定

# service.py —— refresh() 分支
async def refresh(self, *, refresh_token, user_agent, ip) -> tuple[User, TokenPair]:
    user, session, is_grace = await self._consume_refresh_token(refresh_token)
    if not is_grace:
        await self._mark_session_rotated(session)  # 正常 rotate:写 revoked_at+rotated_at
    # is_grace=True: session 已 revoked,不再操作
    pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
    await self._db.commit()
    return user, pair
```

> **调用点适配**(Design Grill X-001 / R-03):`_consume_refresh_token` 返回值从二元组改为三元组后,现有两处调用点必须同步(execute 时 grep `_consume_refresh_token` 全量核对):
> - `refresh()`:`user, session, is_grace = await self._consume_refresh_token(...)`(见上文)。
> - `logout_session_by_refresh()`(`service.py:117`):`_, session, _ = await self._consume_refresh_token(...)`。logout 命中 grace 路径(is_grace=True)时 session 已 revoked,`_mark_session_revoked` 幂等再设 `revoked_at`,**不签发新对**(logout 本就不签发),语义正确。
> - `logout_session_by_refresh` 仍只走 `_mark_session_revoked`(**不**设 `rotated_at`),确保主动登出的 session 不参与 grace 续期判定。

### 前端 `token-refresh.ts`(新增)

```typescript
import { useSession, type SessionTokens } from "@/stores/session";
import { getApiBaseUrl } from "@/lib/api";

let inflight: Promise<SessionTokens | null> | null = null;

/** 单飞:并发调用只发起一次 /api/auth/refresh,共享结果。成功写回 store。 */
export async function ensureFreshAccessToken(): Promise<string | null> {
  const { refreshToken, hydrated } = useSession.getState();
  if (!refreshToken || !hydrated) return null;
  if (inflight) return (await inflight)?.accessToken ?? null;
  inflight = doRefresh();
  try {
    const tokens = await inflight;
    if (tokens) useSession.getState().setTokens(tokens);
    return tokens?.accessToken ?? null;
  } finally {
    inflight = null;
  }
}

async function doRefresh(): Promise<SessionTokens | null> {
  const { refreshToken } = useSession.getState();
  if (!refreshToken) return null;
  const resp = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!resp.ok) return null;
  const pair = (await resp.json()) as {
    access_token: string; refresh_token: string;
  };
  return { accessToken: pair.access_token, refreshToken: pair.refresh_token };
}

/** 仅解析 JWT exp/iat(不验签,前端只读过期时间)。 */
export function decodeJwtExp(token: string): { exp: number; iat: number } | null { /* base64url decode payload */ }
```

### 前端 `api.ts` 401 分支(改造后)

```typescript
if (resp.status === 401 && !String(finalHeaders["x-auth-retry"] ?? "").includes("1") && !isAuthEndpoint(url.pathname)) {
  const newToken = await ensureFreshAccessToken();
  if (newToken) {
    return apiFetch<T>(path, { ...options, headers: { ...headers, "x-auth-retry": "1" }, json, query });
  }
  useSession.getState().clear();
  if (typeof window !== "undefined") window.location.href = "/login";
}
throw new ApiError(resp.status, errorPayload);
```

`TokenPair` DTO 不变(`access_token`/`refresh_token`/`token_type`/`access_expires_in`/`refresh_expires_in`,见 `schema.py:21-28`)。

## 7.5 生命周期契约表(refresh session)

涉及 `session` 关键词,必填。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化(sessions 行) |
|---|---|---|---|---|
| login | client | `POST /api/auth/login` | account, password | (无) → 新行 `active`(revoked_at=null) |
| refresh(正常 rotate) | client | `POST /api/auth/refresh` | refresh_token | 旧行 → `revoked_at=now, rotated_at=now`;新行 active |
| refresh(grace 续期) | client | `POST /api/auth/refresh` | refresh_token(已 rotated,窗口内) | 旧行保持 revoked+rotated;**新行 active(不 revoke_all)** |
| refresh(重放,超 grace) | client | `POST /api/auth/refresh` | refresh_token(已 rotated,超窗口) | 该 user **全部**行 → revoked |
| logout | client | `POST /api/auth/logout` | refresh_token + Bearer access | 单行 → revoked_at=now(rotated_at 保持 null) |
| expire | 系统 | — | `expires_at < now` | 视为失效(_consume 查询 `expires_at > now` 已排除) |

每个事件均有对应代码任务(service/refresh 改造)与测试任务(Phase 3 复现测试)。

## 8. 数据模型

`sessions` 表新增一列:

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `rotated_at` | `TIMESTAMP WITH TIME ZONE` | `NULL` | rotate 时刻;logout 不写;grace 判定用 `now - rotated_at < auth_refresh_grace_seconds` |

现有索引 `ix_sessions_user_revoked(user_id, revoked_at)` 不变;grace 查询走 `revoked_at IS NOT NULL` + 内存比对 `rotated_at`,无需新索引(单机 <1k session,沿用现有遍历匹配策略)。

## 9. 兼容策略

- 项目未上线、数据可清空(`CLAUDE.md` 规则 8),migration 直接 `ADD COLUMN ... NULL`,无需回填。
- `grace=60s` 为可配置项(`auth_refresh_grace_seconds`),设为 0 时退化为"rotate 后立即按重放处理"(等价旧行为),提供回退旋钮。
- access TTL 改 30min 为默认值变更,`/api/auth/refresh` 返回的 `access_expires_in` 随之变化,前端主动刷新按 token 自带 `exp`/`iat` 推算,不硬编码 15/30。
- 未登录 / refresh token 缺失时 `ensureFreshAccessToken()` 返回 `null`,401 分支走原 `clear()` + 跳 `/login`,行为不变。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | grace 窗口内旧 token 可被多次换新,理论上攻击者偷到旧 token 在 60s 内可换 | P1 | 窗口短(60s)且可配置;真攻击在超窗口后仍触发 `revoke_all`;接受该残余风险(OWASP 推荐 trade-off) |
| R-02 | access TTL 15→30min 可能与硬编码 15min 的现有测试冲突 | P1 | execute 时 grep `15` / `auth_access_ttl` 相关测试,同步更新;TDD 先红后绿 |
| R-03 | `_consume_refresh_token` 返回值从二元改三元,可能漏改调用点 | P1 | grep `_consume_refresh_token` 调用点(`refresh`、`logout_session_by_refresh`),全部更新;mypy 守护 |
| R-04 | 前端 `inflight` 在 tab 刷新/SPA 路由切换时的生命周期 | P2 | 模块级变量随页面单例,无需清理;`finally` 保证异常后置空 |
| R-05 | migration head 在多分支 merge 后需精确定位 | P1 | execute 用 `alembic heads` 确认 head,再设 `down_revision` |

## 11. 决策追踪

本次决策见 `decisions.md`:

| 决策 ID | 类型 | 覆盖章节 |
|---|---|---|
| D-001@v1 | boundary | §5 Phase1、§7 `_consume_refresh_token` grace 分支、§7.5 refresh(grace 续期) |
| D-002@v1 | boundary | §5 Phase1、§8(config `auth_refresh_grace_seconds=60`) |
| D-003@v1 | compatibility | §5 Phase1、§7 config `auth_access_ttl_minutes 15→30`、§9 |
| D-004@v1 | architecture | §5 Phase2、§7 `AppShell` 主动刷新 |

无未解决决策;R-01 为已接受的残余风险。

## 12. 自审

- ✅ 需求覆盖:G1(误杀根治)→ grace + 单飞锁;G2(降频)→ TTL30min + 主动刷新;G3(重放防护)→ 超 grace 仍吊销;G4(收口)→ 三处统一单飞。
- ✅ Grill/决策覆盖:design 引用全部 D-001~D-004(§11)。
- ✅ 约束一致性:遵循 `CONVENTIONS.md`(ruff line-length 100、异常事件命名、FastAPI router、Pydantic v2);TDD 执行顺序(文档→读码→写测试→实现→跑测试→验收→更新文档)。
- ✅ 真实性:表名 `sessions`、字段 `revoked_at/rotated_at/expires_at`、类 `AuthService/SessionRow/TokenPair`、方法 `_consume_refresh_token/_mark_session_revoked/revoke_all_user_sessions/_issue_token_pair` 均来自真实代码(`model.py`/`service.py`/`schema.py`)。新方法 `_mark_session_rotated`、`_find_revoked_session`、`ensureFreshAccessToken`、`decodeJwtExp` 标注为新增。
- ✅ YAGNI:未引入跨 tab 同步、未重构为 JWT+jti。
- ✅ 验收标准可测:grace 内重复刷新不吊销(后端测试)、单飞只发 1 次(前端测试)、超 grace 仍吊销(保留测试)。
- ✅ 非目标清晰(§3)。
- ✅ 兼容策略(§9):grace=0 回退旋钮、migration NULL 不回填。
- ✅ 风险识别(§10)。
- ✅ 生命周期契约表(§7.5):session 关键词已覆盖,每个事件有代码任务 + 测试任务。
- ⚠️ 自审存疑:无。

自审通过。
