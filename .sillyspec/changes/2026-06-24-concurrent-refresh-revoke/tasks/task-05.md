---
author: qinyi
created_at: 2026-06-24 11:17:15
id: task-05
title: service grace 改造(实现)
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
blocks: [task-10]
requirement_ids: [FR-01, FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/auth/service.py
---

# task-05

> 把 task-04 写红的 grace window 测试转绿:改造 `AuthService` 让 `_consume_refresh_token` 返回三元组 `(user, session, is_grace)`、`refresh()` 加 grace 分支、新增 `_mark_session_rotated`、`_lookup_revoked_session_owner` 改名为 `_find_revoked_session` 并返回 session 行(以便读 `rotated_at`)、`logout_session_by_refresh` 三元解包。
> 全部改造只在 `backend/app/modules/auth/service.py` 一个文件内。

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/auth/service.py` | 5 个改造点(见下),无新增文件 |

只允许改这一个文件。`config.py`、`model.py`、migration、测试文件由 task-01/02/03/04 负责,本任务不碰。

## 覆盖来源

- **design.md §7 接口定义**:`_consume_refresh_token` 三元返回 + grace 判定伪代码(line 96-106)、`_mark_session_rotated`(line 108-111)、`refresh()` is_grace 分支(line 113-122)。
- **design.md §7 调用点适配 / R-03**(line 124-128):`refresh()` 三元解包;`logout_session_by_refresh()` `_, session, _`;logout 仍只走 `_mark_session_revoked` 不写 `rotated_at`。
- **design.md §7.5 生命周期契约表**(line 191-198):refresh(grace 续期) → 旧行保持 revoked+rotated、新行 active 不 revoke_all;logout → 单行 revoked_at=now,rotated_at 保持 null。
- **design.md §10 R-03**(line 225):返回值二元→三元,漏改调用点风险,grep 全量核对。
- **plan.md task-05 行**(line 45):完成标准 + 验证命令。
- **D-001@v1**(decisions):grace 换新行为边界(grace 内换新不 revoke_all,超 grace 仍 revoke_all)。

## 实现要求(逐方法改造点)

按以下 5 个改造点顺序执行。改造前先跑 `grep -rn "_consume_refresh_token" backend/app/` 核对全量调用点——预期只有两处:`service.py:103`(`refresh`)和 `service.py:117`(`logout_session_by_refresh`),加上定义处 `service.py:197`。若发现第三处调用点,必须一并三元解包适配(R-03)。

### 改造点 1:`_consume_refresh_token` 返回值 二元 → 三元 + grace 判定

- **位置**:`service.py:197-226`(当前签名 `async def _consume_refresh_token(self, refresh_token: str) -> tuple[User, SessionRow]`)。
- **改返回类型**为 `tuple[User, SessionRow, bool]`,第三位 `is_grace`。
- **控制流**(照 design §7 line 96-106):
  1. 查 live session(`revoked_at IS NULL AND expires_at > now`,按 `created_at desc`)——命中则 `return user, session, False`(is_grace=False,正常 rotate 路径)。
  2. live 未命中 → 调改名后的 `_find_revoked_session(refresh_token)`(见改造点 4,返回 `SessionRow | None`)。
  3. 命中 revoked session:
     - 读 `rotated_at` 与 `_utc_now()` 求差,`elapsed = now - rotated_at`。
     - **grace 判定**:`rotated_at is not None and elapsed < timedelta(seconds=self._settings.auth_refresh_grace_seconds)` → `return user, session, True`(**不调** `revoke_all_user_sessions`,不 raise)。
     - 否则(超窗口 或 `rotated_at is None` 的非 rotate 吊销)→ 维持现状:`await self.revoke_all_user_sessions(user_id=session.user_id)` + `raise AuthRefreshReused(...)`(原 details 带 user_id)。
  4. revoked 也没命中 → `raise AuthTokenInvalid("Refresh token is not recognised.")`(不变)。
- **grace 路径中取 user**:沿用 live 路径同样的 active 校验——`user = await self._db.get(User, session.user_id)`,`user is None or user.deleted_at or user.status != "active"` → `raise AuthUserInactive(...)`,grace 路径不得对已删除/禁用用户续发 token。
- **注意**:`self._settings.auth_refresh_grace_seconds` 由 task-01 在 `config.py` 新增(int,默认 60,ge=0 le=600)。从 `datetime` import `timedelta`(文件头已有 `from datetime import UTC, datetime`,扩为 `from datetime import UTC, datetime, timedelta`)。

### 改造点 2:`refresh()` 加 is_grace 分支

- **位置**:`service.py:96-108`。
- **当前代码**:
  ```python
  user, session = await self._consume_refresh_token(refresh_token)
  await self._mark_session_revoked(session)
  ```
- **改为**:
  ```python
  user, session, is_grace = await self._consume_refresh_token(refresh_token)
  if not is_grace:
      await self._mark_session_rotated(session)   # 正常 rotate:写 revoked_at + rotated_at
  # is_grace=True:session 已 revoked+rotated,不重复操作,直接签发新对
  pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
  await self._db.commit()
  log.info("auth.refresh.success", user_id=str(user.id), grace=is_grace)
  return user, pair
  ```
- **关键**:grace 路径**跳过** `_mark_session_rotated`(session 已是 revoked+rotated 状态,再写会刷新 `rotated_at` 把 grace 窗口无限续期——这是 bug);只有正常 rotate 路径才写。

### 改造点 3:新增 `_mark_session_rotated`(rotate 专用 helper)

- **位置**:紧挨现有 `_mark_session_revoked`(`service.py:240-243`)之后新增。
- **签名 + 实现**(照 design §7 line 108-111):
  ```python
  async def _mark_session_rotated(self, session: SessionRow) -> None:
      """Rotate 专用:同时写 revoked_at + rotated_at。

      区别于 _mark_session_revoked(logout 用,只写 revoked_at):
      rotated_at 是 grace 判定的锚点,只有 refresh rotate 路径才写,
      主动登出的 session 不参与 grace 续期。
      """
      now = _utc_now()
      session.revoked_at = now
      session.rotated_at = now
      self._db.add(session)
      await self._db.flush()
  ```
- `rotated_at` 字段由 task-02 在 `model.py` 的 `Session` 上新增(`datetime | None`,nullable),此处直接赋值即可。

### 改造点 4:`_lookup_revoked_session_owner` → `_find_revoked_session`(返回 session)

- **位置**:`service.py:228-238`(当前 `_lookup_revoked_session_owner(self, refresh_token) -> uuid.UUID | None`)。
- **改名 + 改返回类型**为 `_find_revoked_session(self, refresh_token) -> SessionRow | None`。
- **实现**:查询不变(`revoked_at IS NOT NULL`、`order_by revoked_at desc`、`limit 50`、遍历 `verify_refresh_token`),只是命中后 `return session`(整个行,而非 `session.user_id`),未命中 `return None`。
- **目的**:改造点 1 的 grace 判定需要读 `session.rotated_at`,所以必须拿到整行。
- **调用方更新**:原 `_lookup_revoked_session_owner` 唯一调用点就是 `_consume_refresh_token` 内部(`service.py:218`),改造点 1 已改为调 `_find_revoked_session` 并用返回的 session。

### 改造点 5:`logout_session_by_refresh` 三元解包

- **位置**:`service.py:110-122`(当前 `_, session = await self._consume_refresh_token(refresh_token)`)。
- **改为三元解包**:`_, session, _ = await self._consume_refresh_token(refresh_token)`。
- **后续逻辑不变**:仍走 `await self._mark_session_revoked(session)`(**不**改走 `_mark_session_rotated`)——logout 命中的 session 不写 `rotated_at`,确保主动登出的 session 不参与 grace 续期(契约表 logout 行:rotated_at 保持 null)。
- **is_grace 幂等性**:logout 命中 grace 路径(is_grace=True)时 session 已 revoked,`_mark_session_revoked` 再设 `revoked_at` 为 now 是幂等覆盖(无副作用),logout 本就不签发新对,语义正确。
- **异常分支不变**:`except (AuthTokenInvalid, AuthRefreshReused, AuthUserInactive): return`——重放(超 grace)在 `_consume_refresh_token` 内已 `revoke_all` + raise `AuthRefreshReused`,这里捕获后直接 return(logout 幂等,不向上抛)。

## 接口定义(完整签名 + 控制流伪代码)

> 搬砖工照此实现,不要自创控制流。所有方法都是 `AuthService` 的实例方法,`self._db: AsyncSession`、`self._settings: Settings`。

### `_consume_refresh_token`(改造点 1)

```python
async def _consume_refresh_token(
    self, refresh_token: str
) -> tuple[User, SessionRow, bool]:
    """消费 refresh token,返回 (user, session, is_grace)。

    is_grace=True 表示命中宽限续期(session 已 revoked+rotated 且在 grace 窗口内),
    上层 refresh() 应跳过 _mark_session_rotated 直接签发新对。
    """
    # 1) live session 命中
    stmt = (
        select(SessionRow)
        .where(col(SessionRow.revoked_at).is_(None))
        .where(col(SessionRow.expires_at) > _utc_now())
        .order_by(col(SessionRow.created_at).desc())
    )
    for session in (await self._db.execute(stmt)).scalars().all():
        if verify_refresh_token(refresh_token, session.refresh_token_hash):
            user = await self._db.get(User, session.user_id)
            if user is None or user.deleted_at is not None or user.status != "active":
                raise AuthUserInactive("User account is no longer active.")
            return user, session, False

    # 2) live 未命中 → 查 revoked session
    revoked = await self._find_revoked_session(refresh_token)
    if revoked is not None:
        user = await self._db.get(User, revoked.user_id)
        if user is None or user.deleted_at is not None or user.status != "active":
            raise AuthUserInactive("User account is no longer active.")
        # grace 判定
        if (
            revoked.rotated_at is not None
            and (_utc_now() - revoked.rotated_at)
            < timedelta(seconds=self._settings.auth_refresh_grace_seconds)
        ):
            return user, revoked, True   # 宽限续期,不 revoke_all
        # 超 grace 或 rotated_at is None(非 rotate 吊销)→ 重放攻击
        await self.revoke_all_user_sessions(user_id=revoked.user_id)
        raise AuthRefreshReused(
            "Refresh token has already been used; all sessions revoked.",
            details={"user_id": str(revoked.user_id)},
        )

    # 3) 都没命中
    raise AuthTokenInvalid("Refresh token is not recognised.")
```

### `refresh`(改造点 2)

```python
async def refresh(
    self,
    *,
    refresh_token: str,
    user_agent: str | None,
    ip: str | None,
) -> tuple[User, TokenPair]:
    user, session, is_grace = await self._consume_refresh_token(refresh_token)
    if not is_grace:
        await self._mark_session_rotated(session)   # 正常 rotate:revoked_at + rotated_at
    # is_grace=True:session 已 revoked+rotated,跳过,直接签发新对
    pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
    await self._db.commit()
    log.info("auth.refresh.success", user_id=str(user.id), grace=is_grace)
    return user, pair
```

### `_mark_session_rotated`(改造点 3,新增)

```python
async def _mark_session_rotated(self, session: SessionRow) -> None:
    """Rotate 专用:同时写 revoked_at + rotated_at。

    区别于 _mark_session_revoked(logout 用,只写 revoked_at)。
    rotated_at 是 grace 判定锚点,只有 refresh rotate 路径写。
    """
    now = _utc_now()
    session.revoked_at = now
    session.rotated_at = now
    self._db.add(session)
    await self._db.flush()
```

### `_find_revoked_session`(改造点 4,由 `_lookup_revoked_session_owner` 改名)

```python
async def _find_revoked_session(self, refresh_token: str) -> SessionRow | None:
    stmt = (
        select(SessionRow)
        .where(col(SessionRow.revoked_at).is_not(None))
        .order_by(col(SessionRow.revoked_at).desc())
        .limit(50)
    )
    for session in (await self._db.execute(stmt)).scalars().all():
        if verify_refresh_token(refresh_token, session.refresh_token_hash):
            return session
    return None
```

### `logout_session_by_refresh`(改造点 5)

```python
async def logout_session_by_refresh(self, *, refresh_token: str) -> None:
    try:
        _, session, _ = await self._consume_refresh_token(refresh_token)
    except (AuthTokenInvalid, AuthRefreshReused, AuthUserInactive):
        return
    await self._mark_session_revoked(session)   # 仍只写 revoked_at,不写 rotated_at
    await self._db.commit()
    log.info("auth.logout.success", session_id=str(session.id))
```

### 文件头 import 调整

```python
# 原:from datetime import UTC, datetime
from datetime import UTC, datetime, timedelta
```

`AuthRefreshReused`、`AuthTokenInvalid`、`AuthUserInactive` 均已在文件头 import(`service.py:27-33`),无需新增。

## 边界处理

1. **`rotated_at is None`(非 rotate 吊销的 revoked session)**:走原重放逻辑——`revoke_all_user_sessions` + `raise AuthRefreshReused`。这类 session 是 logout 或 admin 吊销产生的(从未 rotate),不属于 grace 续期范畴,必须按重放处理。判定条件显式写 `rotated_at is not None and ...`,None 短路到 else 分支。
2. **`grace=0` 退化为旧行为**:`auth_refresh_grace_seconds=0` 时 `timedelta(seconds=0)`,`elapsed < 0s` 恒为 False(除非时钟回拨),所有 revoked+rotated session 都走重放吊销——等价 task-05 之前的激进模型,提供回退旋钮(AC-03)。判定用严格 `<`,等于 0 即不进 grace。
3. **grace 路径 session 已 revoked 不重复操作**:`refresh()` 的 `if not is_grace` 分支保证 grace 路径**不**调 `_mark_session_rotated`,避免把 `rotated_at` 刷新到 now 而无限续期 grace 窗口(这是关键 bug 防线)。session 状态保持原 revoked_at+rotated_at 不变。
4. **logout 不写 `rotated_at`**:`logout_session_by_refresh` 坚持调 `_mark_session_revoked`(只写 revoked_at),**不**改走 `_mark_session_rotated`。主动登出的 session 不应参与 grace 续期(契约表 logout 行),否则攻击者可用已 logout 的 token 在 grace 窗口内换新。
5. **异常不静默**:`_consume_refresh_token` 的 grace 判定路径中,`user` active 校验失败仍 `raise AuthUserInactive`(不吞);`refresh()` 不额外 try/except(异常向上抛给 router→HTTPException)。只有 `logout_session_by_refresh` 显式 `except (AuthTokenInvalid, AuthRefreshReused, AuthUserInactive): return`(logout 幂等语义,设计如此)。
6. **`expires_at <= now` 的 revoked session**:已被 live 查询的 `expires_at > now` 排除(live 路径),但 revoked 查询 `_find_revoked_session` 不过滤 `expires_at`(沿用现状)——过期但 revoked 的 session 仍可能被 grace 匹配,此时 `rotated_at` 若在窗口内仍续期。这是可接受的:过期 session 本就不能 live 使用,grace 续期签发的是全新 session,旧过期行只是 grace 锚点。

## 非目标

- **不改** `login()`(`service.py:62-94`):login 不涉及 rotate/grace。
- **不改** `_issue_token_pair()`(`service.py:164-195`):签发逻辑、`TokenPair` 构造、`SessionRow` 字段填充不变(`rotated_at` 由默认 None,login 新 session 不设 rotated_at,正确)。
- **不改** `create_access_token` / `generate_refresh_token` / `hash_refresh_token` / `verify_refresh_token`(`core/security.py`):bcrypt 匹配模型不变(YAGNI,design §3)。
- **不改** `revoke_all_user_sessions`(`service.py:124-140`):重放吊销逻辑、返回 rowcount 不变。
- **不改** `_mark_session_revoked`(`service.py:240-243`):logout 仍用此方法,只写 revoked_at。
- **不改** router / schema / DTO:`TokenPair`、`/api/auth/refresh` 请求响应协议不变。
- **不碰** `config.py`、`model.py`、migration、测试文件(各自归属 task-01/02/03/04)。

## 参考

- **design.md §7 接口定义**(line 82-128):完整伪代码来源。
- **design.md §7.5 生命周期契约表**(line 187-200):refresh(grace 续期)/ logout 行为契约。
- **design.md §10 R-03**(line 225):返回值二元→三元的调用点适配风险。
- **plan.md task-05 行**(line 45)+ **覆盖矩阵**(line 90 D-001@v1 → task-05)。
- **decisions.md D-001@v1**:grace 换新行为边界。
- 现有源码:`backend/app/modules/auth/service.py:96-243`(refresh / logout / _consume_refresh_token / _lookup_revoked_session_owner / _mark_session_revoked)。

## TDD 步骤

本任务 = TDD 步骤 3-5(步骤 1-2 由 task-04 完成:写测试→跑红)。

1. **(task-04 已做)** 写 `test_refresh_grace_window.py` 三用例(grace 内不吊销 / 超 grace 仍吊销 / logout 三元解包不报错)→ 跑红(`_consume_refresh_token` 还是二元返回,三元解包直接 TypeError)。
2. **(task-04 已做)** 确认红是因为实现未改,而非测试本身写错。
3. **(本任务)** 按"实现要求"5 个改造点改 `service.py`(先 grep 调用点,再依次改 _consume_refresh_token / refresh / 新增 _mark_session_rotated / 改名 _find_revoked_session / logout 三元解包)。
4. **(本任务)** 跑 `cd backend && uv run pytest app/modules/auth -q` → task-04 三个用例转绿,且 `tests/modules/auth/` 下现有测试(test_seed / test_api_key_* / test_permissions / test_ppm_permissions)不回归。
5. **(本任务)** 跑 `cd backend && uv run mypy app/modules/auth/service.py` 确认三元返回类型签名通过(R-03 mypy 守护)。
6. **(后续 task-10)** 端到端 curl 实测 grace 窗口行为 + 文档同步。

## 验收标准

| AC | 标准 | 验证 |
|---|---|---|
| AC-1 | task-04 用例 1 转绿:同一 refresh token 在 grace 窗口内(`auth_refresh_grace_seconds` 默认 60s)重复/并发提交,该用户其它 active session **不**被吊销,`/api/auth/refresh` 返回新 TokenPair | `cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py::test_grace_within_window -q`(注:测试目录路径以 task-04 实际落地为准,plan.md 标注为 `tests/modules/auth/`,但项目现有 auth 测试在 `backend/tests/modules/auth/`,搬砖工按 task-04 实际路径跑) |
| AC-2 | task-04 用例 2 转绿:同一 refresh token 超 grace 窗口后再提交,仍触发 `revoke_all_user_sessions`(重放防护不削弱) | `cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py -k "beyond or expired" -q` |
| AC-3 | task-04 用例 3 转绿:`logout_session_by_refresh` 三元解包 `_, session, _` 不报 TypeError;logout 仍只写 `revoked_at`(不写 `rotated_at`) | `cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py -k "logout" -q` |
| AC-4 | `_consume_refresh_token` 全量调用点已适配三元返回(grep 核对:refresh + logout 两处 + 定义处,无遗漏第三处) | `grep -rn "_consume_refresh_token" backend/app/` → 仅 3 行(定义 + refresh 调用 + logout 调用),两处调用均三元解包 |
| AC-5 | `_lookup_revoked_session_owner` 已改名为 `_find_revoked_session`,返回 `SessionRow \| None`,原唯一调用点(_consume_refresh_token 内)已更新 | `grep -rn "_lookup_revoked_session_owner\|_find_revoked_session" backend/app/` → 旧名 0 命中,新名 2 命中(定义 + 调用) |
| AC-6 | `rotated_at is None` 的 revoked session(非 rotate 吊销)走原重放逻辑(`revoke_all` + `AuthRefreshReused`),不误进 grace 续期 | 见 task-04 对应用例或代码审查 `_consume_refresh_token` 的 `rotated_at is not None and ...` 条件 |
| AC-7 | mypy 类型检查通过:`_consume_refresh_token` 签名 `-> tuple[User, SessionRow, bool]` | `cd backend && uv run mypy app/modules/auth/service.py` |
| AC-8 | 现有 auth 测试无回归 | `cd backend && uv run pytest tests/modules/auth/ -q` 全绿(注:项目现有 auth 测试在 `backend/tests/modules/auth/`,含 test_seed/test_api_key_*/test_permissions/test_ppm_permissions,无独立 reuse-attack 测试文件——design/plan 提及的"现有 reuse-attack 测试"实际不存在,此 AC 以现有 auth 测试全绿为准) |
| AC-9 | 全量后端 auth 测试绿 | `cd backend && uv run pytest app/modules/auth tests/modules/auth -q` 全绿 |

> **路径提示**:plan.md 标注测试路径为 `backend/tests/modules/auth/`,但项目现有 auth 测试实际位于 `backend/tests/modules/auth/`。task-04 落地时以实际路径为准,本任务跑测试用对应实际路径,不因路径差异阻塞。
