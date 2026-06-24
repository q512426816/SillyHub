---
author: qinyi
created_at: 2026-06-24 11:17:15
id: task-04
title: 后端测试 test_refresh_grace_window(TDD 红)
priority: P1
depends_on: [task-01, task-02]
blocks: [task-05]
requirement_ids: [FR-01, FR-07]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/tests/modules/auth/test_refresh_grace_window.py
---

# task-04

## 修改文件

- `backend/tests/modules/auth/test_refresh_grace_window.py` —— **新增**文件,直接驱动 `AuthService`(不经 HTTP 层),复现并发/重复刷新在 grace 窗口内外的行为差异,并守护 `_consume_refresh_token` 三元返回改造后 logout 调用点不崩。

> 本任务是 TDD 的"先写测试(红)"步骤。此时 task-05 尚未实现 grace 逻辑 + 三元返回,本测试文件**应当失败(RED)**;task-05 实现后转绿(GREEN)。不要为了让本任务通过而提前实现 service 改造。

## 覆盖来源

- 需求:
  - `FR-01`(后端 grace window):grace 内旧 token 重签、不误杀;超 grace 仍吊销(两条 GWT 均覆盖)。
  - `FR-07`(logout 调用点适配三元返回):`logout_session_by_refresh` 与 `refresh` 两处解包正确,logout 命中 grace 不签发新对、不抛 unpack 错误。
- 决策:
  - `D-001@v1`(grace 窗口内被 rotate 的旧 refresh token 重新签发新对):测试用例 1/2 的核心断言来源。
  - `D-002@v1`(grace=60s 可配置):grace 窗口判定时长与 `auth_refresh_grace_seconds` 注入方式。
- 设计:
  - `design.md` §7 接口定义(`_consume_refresh_token` 返回三元组 `(User, Session, is_grace)`;`refresh()` 的 `is_grace` 分支;`logout_session_by_refresh` 三元解包 `_, session, _`)。
  - `design.md` §7.5 生命周期契约表(refresh 正常 rotate / refresh grace 续期 / refresh 重放超 grace 三行的状态变化)。
  - `design.md` §10 风险 R-01(grace 内旧 token 可被多次换新,接受残余风险——测试用例 1 正向覆盖)、R-03(`_consume_refresh_token` 二元改三元可能漏改调用点——测试用例 3 守护)。

## 实现要求

1. **只测 service 层,不经 HTTP**。直接构造 `AuthService(db_session, settings=...)` 调 `refresh(...)` / `logout_session_by_refresh(...)`,断言异常类型、`TokenPair` 字段、DB 行的 `revoked_at`/`rotated_at`/active session 数量。**不**用 `client` fixture 发 HTTP 请求(降低耦合,聚焦逻辑)。
2. **复用根 `conftest.py` 的 `db_session` fixture**(内存 SQLite + `BaseModel.metadata.create_all`,自动注入各模块 model)。**不**新建 `tests/__init__.py` 或 `conftest.py`;若 `backend/tests/modules/auth/` 目录不存在,本任务创建目录(空目录或仅含本测试文件即可,Python 包发现由 pytest rootdir + `backend/conftest.py` 覆盖)。
3. **Settings 注入方式**:用 `get_settings()` 拿默认 settings(根 conftest `_reset_settings_cache` autouse 已清缓存,每个测试拿干净实例),并按用例 `settings = get_settings(); settings.auth_refresh_grace_seconds = 60`(或 =0 的边界用例)就地覆盖后传给 `AuthService(db_session, settings=settings)`。**不**用环境变量注入(根 conftest 已设 `SECRET_KEY` 等默认,避免污染)。
4. **bcrypt rounds 加速**:每个建 user 的 fixture/步骤调 `password_hasher.configure(settings.auth_bcrypt_rounds)` 对齐默认 12 轮;若测试因 bcrypt 慢,可在本文件内用一个 `@pytest.fixture` 临时把 `settings.auth_bcrypt_rounds=4` 后再 `password_hasher.configure(4)`(参考 `conftest.py:auth_admin_token` / `test_users_router.py:target_user` 的 configure 模式)。
5. **模拟 `rotated_at` 时间**:不引入 `freezegun`/`time-machine` 等新依赖。直接在 rotate 后**手动设置 session 行的 `rotated_at` 字段**(从 DB 查回该行,赋值 `session.rotated_at = now - timedelta(seconds=61)` 或 `now`),flush + commit 后再触发第二次 refresh。grace 判定逻辑由 task-05 读取该字段,本测试只负责把字段值摆到位。
6. **建 active session Sx**:用例 1 要验证"该用户其它 active session 仍 active 未被 revoke_all",需提前插入一行 `Session(user_id=user.id, refresh_token_hash=<不可匹配的随机 hash>, revoked_at=None, expires_at=future)` 作为"另一个 active session",刷新后查它的 `revoked_at` 仍为 None。
7. **断言"未触发 revoke_all"**:用例 1 不直接 mock `revoke_all_user_sessions`(脆弱),而是通过"该 user 下 active session 数量不变 / Sx 的 revoked_at 仍为 None"间接证明未误杀。
8. **断言异常类型**:用例 2 用 `pytest.raises(AuthRefreshReused)`(从 `app.core.errors` 导入),对齐 service 现有 `raise AuthRefreshReused(...)` 风格。
9. **logout 调用点守护(用例 3)**:`logout_session_by_refresh` 内部调 `_consume_refresh_token` 返回三元组后解包 `_, session, _`;若 task-05 漏改仍二元,本测试会在 `await service.logout_session_by_refresh(refresh_token=...)` 处抛 `ValueError: too many values to unpack` 而非业务异常——这正是要守护的回归。断言:logout 调用**不抛 unpack 错误**(成功返回 None 或吞掉业务异常),且 logout 命中已 rotate 的 session 时**不签发新对**(DB 中 active session 数量不增加)。
10. **ruff line-length 100**:本文件遵循 `CONVENTIONS.md`(`design.md` §12 自审引用),过长断言用括号多行。
11. **文件头 docstring** 注明覆盖 FR-01/FR-07、对应 design 章节、TDD 红→绿顺序(本任务=红,task-05=绿)。

## 接口定义

### 测试用例列表(3 条,对齐 FR-01 两条 GWT + FR-07)

| 用例 | 覆盖 | 场景简述 | 预期(本任务=RED) | task-05 后(GREEN) |
|---|---|---|---|---|
| `test_refresh_within_grace_does_not_revoke_other_sessions` | FR-01 GWT-1 | T1 已 rotate(rotated_at=now),60s 内再用 T1 refresh | RED:当前 service 无 grace 分支 → 抛 `AuthRefreshReused` + 触发 `revoke_all`(Sx 被 revoke) | GREEN:返回新 TokenPair,Sx 仍 active,新增 1 active session |
| `test_refresh_beyond_grace_revokes_all_user_sessions` | FR-01 GWT-2 | T1 已 rotate(rotated_at=now-61s),超 grace 再用 T1 refresh | RED:当前 service 无 `rotated_at` 判定,但会走 reuse 路径(行为碰巧接近,但断言读 `rotated_at` 字段会 AttributeError) | GREEN:`pytest.raises(AuthRefreshReused)`,Sx 被 revoke |
| `test_logout_unpacks_three_tuple_without_error` | FR-07 | T1 已 rotate 后,用 T1 调 `logout_session_by_refresh` | RED:logout 内 `_, session = await _consume_refresh_token(...)` 二元解包,task-05 改三元后此处因本测试先存在而暴露——**实际 RED 形态**:`AttributeError` 读 `rotated_at`(因 service 尚未写该字段)/ 或 service 仍二元时 logout 正常通过(此时该用例可能在 RED 阶段意外 PASS,需用 `xfail(strict=False)` 标注,task-05 后转 PASS;见"边界处理"边界 5) | GREEN:logout 返回 None 不抛 unpack 错;DB active session 数不增加(logout 不签发新对) |

### 断言伪代码

```python
# 用例 1:test_refresh_within_grace_does_not_revoke_other_sessions
async def test_refresh_within_grace_does_not_revoke_other_sessions(db_session):
    settings = get_settings()
    settings.auth_refresh_grace_seconds = 60
    password_hasher.configure(settings.auth_bcrypt_rounds)
    service = AuthService(db_session, settings=settings)

    # 1) 建用户 + login 拿 T1
    user = User(email="u1@example.com", password_hash=password_hasher.hash("Xx1!abcd"))
    db_session.add(user); await db_session.commit()
    _, pair1 = await service.login(account="u1@example.com", password="Xx1!abcd",
                                   user_agent="ua", ip="1.1.1.1")
    t1 = pair1.refresh_token

    # 2) 建另一个 active session Sx(同 user,不可被 T1 匹配)
    sx = Session(id=uuid.uuid4(), user_id=user.id,
                 refresh_token_hash=hash_refresh_token(generate_refresh_token()),
                 created_at=datetime.now(UTC),
                 expires_at=datetime.now(UTC) + timedelta(days=7))
    db_session.add(sx); await db_session.commit()

    # 3) 正常 rotate T1 → 旧行 revoked_at+rotated_at=now
    await service.refresh(refresh_token=t1, user_agent="ua", ip="1.1.1.1")
    rotated_row = (await db_session.execute(
        select(Session).where(Session.user_id == user.id, Session.revoked_at.is_not(None))
    )).scalars().first()
    # 手动把 rotated_at 摆到 now(grace 内)
    rotated_row.rotated_at = datetime.now(UTC)
    await db_session.commit()

    # 4) grace 内再用 T1 refresh —— 期望:不抛异常,返回新对
    user2, pair2 = await service.refresh(refresh_token=t1, user_agent="ua", ip="1.1.1.1")
    assert pair2.access_token
    assert pair2.refresh_token != t1

    # 5) 断言未误杀:Sx 仍 active(revoked_at 为 None)
    await db_session.refresh(sx)
    assert sx.revoked_at is None, "grace 内重复刷新不应吊销其它 active session"
    # 该 user 至少有 Sx + grace 新签发的行 两条 active
    active_count = (await db_session.execute(
        select(func.count()).select_from(Session).where(
            Session.user_id == user.id, Session.revoked_at.is_(None)
        )
    )).scalar_one()
    assert active_count >= 2


# 用例 2:test_refresh_beyond_grace_revokes_all_user_sessions
async def test_refresh_beyond_grace_revokes_all_user_sessions(db_session):
    settings = get_settings()
    settings.auth_refresh_grace_seconds = 60
    password_hasher.configure(settings.auth_bcrypt_rounds)
    service = AuthService(db_session, settings=settings)

    user = User(email="u2@example.com", password_hash=password_hasher.hash("Xx1!abcd"))
    db_session.add(user); await db_session.commit()
    _, pair1 = await service.login(account="u2@example.com", password="Xx1!abcd",
                                   user_agent="ua", ip="1.1.1.1")
    t1 = pair1.refresh_token
    sx = Session(id=uuid.uuid4(), user_id=user.id,
                 refresh_token_hash=hash_refresh_token(generate_refresh_token()),
                 created_at=datetime.now(UTC),
                 expires_at=datetime.now(UTC) + timedelta(days=7))
    db_session.add(sx); await db_session.commit()

    await service.refresh(refresh_token=t1, user_agent="ua", ip="1.1.1.1")
    rotated_row = (await db_session.execute(
        select(Session).where(Session.user_id == user.id, Session.revoked_at.is_not(None))
    )).scalars().first()
    # 手动把 rotated_at 摆到 now-61s(超 grace)
    rotated_row.rotated_at = datetime.now(UTC) - timedelta(seconds=61)
    await db_session.commit()

    # 期望:AuthRefreshReused + revoke_all(Sx 被吊销)
    with pytest.raises(AuthRefreshReused):
        await service.refresh(refresh_token=t1, user_agent="ua", ip="1.1.1.1")
    await db_session.refresh(sx)
    assert sx.revoked_at is not None, "超 grace 重放应吊销该用户全部 session"


# 用例 3:test_logout_unpacks_three_tuple_without_error
async def test_logout_unpacks_three_tuple_without_error(db_session):
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    service = AuthService(db_session, settings=settings)

    user = User(email="u3@example.com", password_hash=password_hasher.hash("Xx1!abcd"))
    db_session.add(user); await db_session.commit()
    _, pair1 = await service.login(account="u3@example.com", password="Xx1!abcd",
                                   user_agent="ua", ip="1.1.1.1")
    t1 = pair1.refresh_token

    # logout 直接调用 —— 守护 _consume_refresh_token 三元返回改造后此处不抛 unpack 错
    # (FR-07: logout_session_by_refresh 解包 _, session, _)
    active_before = (await db_session.execute(
        select(func.count()).select_from(Session).where(
            Session.user_id == user.id, Session.revoked_at.is_(None)
        )
    )).scalar_one()
    # 不应抛 ValueError(too many/few values to unpack)
    await service.logout_session_by_refresh(refresh_token=t1)
    # logout 不签发新对:active 数量只减不增(原 T1 session 被 revoke)
    active_after = (await db_session.execute(
        select(func.count()).select_from(Session).where(
            Session.user_id == user.id, Session.revoked_at.is_(None)
        )
    )).scalar_one()
    assert active_after <= active_before, "logout 不应签发新 token 对"
```

> 上述伪代码仅说明断言意图与 fixture 组合方式;实际编写时可抽一个 `_login_and_rotate(settings, db_session, email)` helper 减少重复(建 user + login + 建 Sx + rotate + 设 rotated_at),三个用例共享。

## 边界处理

1. **模拟 `rotated_at` 时间——用直接设字段而非 freezegun**:`rotated_at` 是 `Session` 普通可空字段(task-02 已声明),测试 rotate 后从 DB 查回该行,直接 `row.rotated_at = datetime.now(UTC)`(grace 内)或 `row.rotated_at = datetime.now(UTC) - timedelta(seconds=61)`(超 grace),commit 后再触发第二次 refresh。**不**引入 `freezegun`/`time-machine` 新依赖(项目当前测试无此类依赖,保持零新增 deps;且 service 内部 `_utc_now()` 在 grace 判定时读真实时间,只摆 `rotated_at` 即可精确控制窗口内外)。注意:task-05 实现的 `_mark_session_rotated` 会同时写 `revoked_at`+`rotated_at`,本测试手动覆盖 `rotated_at` 时只改这一个字段,不动 `revoked_at`(已由 service 写过)。
2. **`grace=0` 边界**(回退旋钮,D-002@v1 / 非功能需求):额外可加一个用例或参数化:设 `settings.auth_refresh_grace_seconds = 0`,rotate 后立即(任何 `now - rotated_at >= 0`)用 T1 refresh 应触发 `AuthRefreshReused` + revoke_all(等价旧行为)。若不单独建用例,至少在 docstring 标注"grace=0 退化由 task-05 实现保证,本文件聚焦默认 60s 主路径"。建议作为用例 2 的参数化变体(`@pytest.mark.parametrize("grace_seconds, rotated_delta, expect_reuse", [(60, timedelta(seconds=0), False), (60, timedelta(seconds=61), True), (0, timedelta(seconds=0), True)])`)。
3. **超 grace 用 `timedelta` 精确越界**:grace=60s,用 `timedelta(seconds=61)` 而非 `timedelta(minutes=2)`(避免边界 60.0s 浮点/取整歧义;`now - rotated_at >= grace` 是 `>=` 还是 `>` 由 task-05 决定,用 61s 安全落在"明确超窗"区间,不卡在 60s 整数边界)。grace 内用 `timedelta(seconds=0)`(即 rotated_at=now)安全落在窗口内。
4. **并发用 `asyncio.gather` 模拟**(可选增强,不强制):用例 1 可加一个并发变体——`asyncio.gather(*[service.refresh(refresh_token=t1, ...) for _ in range(5)])`,断言"不抛 AuthRefreshReused、至少 1 个返回新对、Sx 仍 active"。但注意:单 event loop 下 `asyncio.gather` 并非真并行(service 内无 await 点交错时可能串行),且 SQLite 内存库并发写可能锁冲突。**建议**:并发场景作为前端单飞锁(task-06/07)的主战场,后端测试聚焦"时间窗口"维度即可;若加并发用例,用 `pytest.mark.xfail(reason="单 event loop 非真并行,仅作冒烟")` 标注或仅断言"无 AuthRefreshReused 抛出"。本任务**不强制**写并发用例,主路径 3 用例优先。
5. **logout 调用点 RED 形态处理**:用例 3 在本任务(RED 阶段)的行为依赖 service 现状——当前 `logout_session_by_refresh` 用二元解包 `_, session = await self._consume_refresh_token(...)`(`service.py:117`),service 尚未改三元,则本用例**不会**因 unpack 报错(二元解包二元正好成立),而是正常 logout 成功,`active_after < active_before`(T1 session 被 revoke),断言 PASS——这会让本用例在 RED 阶段意外绿。处理方式:给用例 3 加 `@pytest.mark.xfail(reason="待 task-05 _consume_refresh_token 改三元返回后此用例转为强制 PASS;RED 阶段 service 仍二元,用例碰巧通过", strict=False)`。task-05 改三元后,logout 正确解包三元,用例稳定 PASS,移除 xfail。**或在用例 3 内额外断言"service 已是三元返回"**(如 `import inspect; sig = ...` 读源码——脆弱不推荐)。推荐 xfail 方案,简洁且语义明确。
6. **`revoke_all` 不误杀的间接证明**:用例 1 不 mock `revoke_all_user_sessions`(mock 会绑定实现细节,service 重构即坏),而是插一个 Sx active session,刷新后查 `sx.revoked_at is None` + `active_count >= 2`。若 service 误触发 revoke_all,Sx 会被批量 update `revoked_at=now`,断言即失败——这是行为级断言,稳健。
7. **bcrypt 慢的加速**:`password_hasher.configure(settings.auth_bcrypt_rounds)` 默认 12 轮,单测试建 3 个 user + 多次 login/refresh 可能累计数秒。可在本文件顶部加一个 autouse fixture `@pytest.fixture(autouse=True) def _fast_benchmark(): settings = get_settings(); settings.auth_bcrypt_rounds = 4; password_hasher.configure(4); yield`(**注意**:根 conftest `_reset_settings_cache` autouse 会清 settings 缓存,本 fixture 需在它之后运行或直接 operate on a fresh `get_settings()` 实例)。若与其它 auth 测试隔离运行无压力,可省略此加速。
8. **SQLite 时区**:内存 SQLite 的 `DateTime(timezone=True)` 存储行为与 Postgres 略有差异(SQLite 不真存 tz),但 SQLAlchemy 层会把 `datetime.now(UTC)` 序列化/反序列化为带 tz 的 datetime,`now - rotated_at` 的 timedelta 计算不受影响。本测试不依赖 DB 层 tz 精度,只比较秒级差,SQLite 足够。
9. **测试隔离**:每个用例独立建 user(不同 email `u1/u2/u3@example.com`),避免跨用例 session 行互相干扰;`db_session` fixture 为函数级(根 conftest),每用例新建 engine,天然隔离。

## 非目标

- **不**测 RBAC / 权限链路(本测试不挂 workspace/role,纯 auth service 逻辑)。
- **不**测 login 的邮箱/账号/大小写/防枚举(已由 `test_users_router.py:test_login_by_email_or_username` 覆盖)。
- **不**测 HTTP 层(`/api/auth/refresh` 路由、状态码、响应体 DTO)——只测 `AuthService` 方法;HTTP 层是薄壳,由 task-10 端到端 curl 覆盖。
- **不**测 access TTL=30min(FR-03 由 task-01 + 独立 config 测试覆盖,本文件不重复断言 `access_expires_in≈1800`)。
- **不**测前端单飞锁(FR-04 由 task-06/07 前端测试覆盖)。
- **不**实现 service 改造(本任务=写测试,实现是 task-05;本任务提交时测试应为 RED)。
- **不**修改 `service.py` / `model.py` / `config.py`(均在 allowed_paths 之外)。
- **不**引入新依赖(`freezegun`/`time-machine`/`pytest-asyncio` 额外插件等);`pytest`/`sqlalchemy`/`app.*` 均已在项目内。

## 参考

现有 auth 测试风格参考 `backend/tests/modules/admin/test_users_router.py`(根 conftest 的 `db_session` + `get_settings()` + `password_hasher.configure(...)` 建用户模式):

```python
# test_users_router.py:23-37 —— 建 user 的标准 fixture 风格
@pytest.fixture
async def target_user(db_session):
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(email="target@example.com",
                password_hash=password_hasher.hash("Xx1!abcd"), ...)
    db_session.add(user); await db_session.commit(); await db_session.refresh(user)
    return user
```

- 建 active session 行参考 `test_users_router.py:131-169`(`test_disable_login_revokes_sessions` 插 `AuthSession(...)` + 查 `revoked_at.is_not(None)` 计数)。
- `AuthService` 构造签名:`AuthService(db, *, settings: Settings)`(`service.py:55-58`),测试直接 `AuthService(db_session, settings=settings)`。
- service 现状(本任务 RED 的基线):`refresh()` 二元解包 `user, session = await self._consume_refresh_token(...)`(`service.py:103`)→ 无 grace 分支 → 命中 revoked session 走 `_lookup_revoked_session_owner` → `revoke_all_user_sessions` + `raise AuthRefreshReused`(`service.py:218-224`)。task-05 改造后此路径被 grace 短路。
- 异常导入:`from app.core.errors import AuthRefreshReused`(对齐 `service.py:27-33` 的导入源)。
- Session/TokenPair 导入:`from app.modules.auth.model import Session as SessionRow, User`;`from app.modules.auth.schema import TokenPair`(本测试主要断言 `pair.refresh_token != t1` 与 DB 行,TokenPair 类型可不显式导入)。
- 根 `conftest.py` 的 autouse fixtures(`_reset_settings_cache`、`db_engine`、`db_session`、`_redirect_session_factory`)对本文件自动生效,无需重复定义。

## TDD 步骤

本变更后端 service 改造的 TDD 节奏:**task-04 = 步骤 1-2(写测试 + 确认 RED)**,task-05 = 步骤 3-5(写实现 + 转绿 + 回归)。

1. **(读码·已完成)** 确认 `AuthService.refresh`/`_consume_refresh_token`/`_lookup_revoked_session_owner`/`revoke_all_user_sessions`/`logout_session_by_refresh` 现状(`service.py:96-238`),确认 `Session` 字段(task-02 已加 `rotated_at`)、`Settings` 字段(task-01 已加 `auth_refresh_grace_seconds`)。
2. **(写测试·本任务)** 新建 `backend/tests/modules/auth/test_refresh_grace_window.py`,按"接口定义"3 用例 + 断言伪代码编写。运行 `cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py -q` 确认 **RED**:
   - 用例 1:`AuthRefreshReused` 抛出(当前无 grace 分支)→ FAIL。
   - 用例 2:`AttributeError` 读 `rotated_at` 或 `AuthRefreshReused` 抛出——若断言点在异常之后(Sx.revoked_at 断言)则 FAIL。
   - 用例 3:可能意外 PASS(见边界 5),用 `xfail(strict=False)` 标注。
   - RED 确认后,**提交本任务**(测试文件单独提交,不夹带 service 改动)。
3. **(写实现·task-05)** 不在本任务进行。task-05 改 `_consume_refresh_token` 返回三元 + grace 判定 + `_mark_session_rotated` + `refresh` 分支 + `logout_session_by_refresh` 三元解包。
4. **(跑测试·task-05)** task-05 实现后,重跑本文件 → 用例 1/2 转 PASS,用例 3 移除 xfail 后 PASS(GREEN)。
5. **(回归·task-05)** task-05 还需确认现有 reuse-attack 相关测试(若有)仍绿;`cd backend && uv run pytest app/modules/auth -q` 全绿。
6. **(更新文档·task-10)** task-10 收口同步 `docs/` 下 auth 模块文档的 grace 行为说明。

> 本任务交付物 = RED 状态的测试文件 + 运行截图/日志证明 RED。**禁止**为让本任务"通过 CI"而提前写 service 实现(违反 CLAUDE.md 规则 2/7:禁止先写代码再补文档/禁止改测试逻辑让测试通过——此处反向适用:禁止改实现让红测试变绿,绿化是 task-05 的职责)。

## 验收标准

| 编号 | 验收项 | 验证方式 | 通过标准(本任务=RED 阶段) | task-05 后(GREEN 阶段) |
|---|---|---|---|---|
| AC-04-1 | 测试文件存在且可被 pytest 收集 | `cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py --collect-only -q` | 收集到 3 个测试项(用例 1/2/3),无 import 错误 | 同左 |
| AC-04-2 | 用例 1(grace 内不误杀)为 RED | `uv run pytest tests/modules/auth/test_refresh_grace_window.py::test_refresh_within_grace_does_not_revoke_other_sessions -q` | **FAIL**(抛 `AuthRefreshReused`,因 service 无 grace 分支) | **PASS**(返回新对,Sx 仍 active,active_count>=2) |
| AC-04-3 | 用例 2(超 grace 仍吊销)为 RED | `uv run pytest ...::test_refresh_beyond_grace_revokes_all_user_sessions -q` | **FAIL**(`AttributeError` 读 `rotated_at` 或断言点未到达) | **PASS**(`pytest.raises(AuthRefreshReused)`,Sx.revoked_at 非空) |
| AC-04-4 | 用例 3(logout 三元解包)标注 xfail | 读测试源码 + 运行 | 带 `@pytest.mark.xfail(strict=False)`,运行结果为 XFAIL 或 XPASS 均可(不强制 FAIL) | task-05 后移除 xfail,**PASS**(logout 不抛 unpack 错,active 数不增) |
| AC-04-5 | 只测 service 不经 HTTP | 读测试源码 | 无 `client` fixture 使用,无 `await client.post("/api/auth/refresh")`;全部经 `AuthService(...)` 直接调用 | 同左 |
| AC-04-6 | 未修改 service/model/config | `git diff --name-only` | 仅 `backend/tests/modules/auth/test_refresh_grace_window.py` 一处变更(+ 可能新建空 `tests/` 目录) | task-05 时才动 service.py |
| AC-04-7 | 未引入新依赖 | 读 `backend/pyproject.toml` diff | 无 `freezegun`/`time-machine` 等新增;时间模拟用直接设 `rotated_at` 字段 | 同左 |
| AC-04-8 | 覆盖 FR-01 两条 GWT | 用例映射 | 用例 1↔FR-01 GWT-1,用例 2↔FR-01 GWT-2,文件 docstring 标注 | 同左 |
| AC-04-9 | 覆盖 FR-07 调用点守护 | 用例 3 | 用例 3 断言 logout 不抛 unpack 错 + 不签发新对,docstring 引用 design §7 调用点适配 | 同左 |
| AC-04-10 | lint 通过 | `cd backend && uv run ruff check tests/modules/auth/test_refresh_grace_window.py` | 无报错(line-length 100) | 同左 |
