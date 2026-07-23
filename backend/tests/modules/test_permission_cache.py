"""权限缓存测试(FR-06, AC-01~05)。

覆盖:
- helper 读写正确性 + 三键分离(AC-01)
- Redis 故障降级:get → None / set 静默 / invalidate 失败升 ERROR(AC-03)
- invalidate 整体清空 perm:* + ppm-scope:*,不影响无关 key(AC-02 helper 层)
- ppm-scope uuid 反序列化类型断言(AC-04 安全关键)
- rbac collect_permissions 命中缓存不打 DB JOIN(AC-01)/ 无 Redis 回退查库(AC-03)
- 经理 problem_operable 在缓存启用后仍正确(AC-05)
- 失效触发点:role create / workspace create(D-006)/ scan_generate 新建分支(AC-02)

测试范式照抄 ``tests/modules/auth/test_api_key_service.py``:``_FakeRedis`` 内存替身 +
``monkeypatch.setattr("app.core.permission_cache.get_redis", ...)`` + 降级用 raising。
``_FakeRedis.delete`` 支持 ``*keys`` 以适配 ``invalidate_all_permissions`` 的
``redis.delete(*keys)`` 批量删除。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.permission_cache import (
    _breaker_is_open,
    _BreakerState,
    _record_failure,
    _record_success,
    get_cached_permissions,
    get_cached_ppm_scope,
    invalidate_all_permissions,
    set_cached_permissions,
    set_cached_ppm_scope,
)
from app.modules.admin.roles_service import RoleService
from app.modules.admin.schema import RoleCreateRequest
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import collect_permissions
from app.modules.daemon.model import DaemonInstance
from app.modules.ppm.common.data_scope import manager_project_ids, problem_operable
from app.modules.workspace.schema import WorkspaceCreate
from app.modules.workspace.service import WorkspaceService

# ── 内存 Redis 替身 ──────────────────────────────────────────────────────────


class _FakeRedis:
    """In-memory async Redis stand-in.

    覆盖权限缓存 helper 触碰的子集:GET / SET(ex) / DELETE(*keys) / SCAN(match)。
    ``delete`` 支持 ``*keys``(``invalidate_all_permissions`` 用 ``redis.delete(*keys)``
    批量删);不做 TTL 过期模拟(测试断言 key 存在性,不断言时序)。
    """

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value

    async def delete(self, *keys: str) -> int:
        n = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                n += 1
        return n

    async def scan_iter(
        self, match: str | None = None, count: int | None = None
    ) -> AsyncIterator[str]:
        import fnmatch

        for k in list(self.store):
            if match is None or fnmatch.fnmatch(k, match):
                yield k


class _LogSpy:
    """structlog logger 替身:数 error 调用次数(invalidate 失败升 ERROR 断言用)。"""

    def __init__(self) -> None:
        self.errors = 0

    def error(self, *args: Any, **kwargs: Any) -> None:
        self.errors += 1

    def info(self, *args: Any, **kwargs: Any) -> None:
        return None

    def warning(self, *args: Any, **kwargs: Any) -> None:
        return None

    def debug(self, *args: Any, **kwargs: Any) -> None:
        return None


def _raising() -> Any:
    """模拟 Redis 全挂:get_redis() 直接抛。"""
    raise RuntimeError("redis down")


# ── AC-01 / AC-04:helper 读写正确性 + uuid 类型(纯缓存,无 DB)──────────────


@pytest.fixture(autouse=True)
def _reset_breaker() -> None:
    """每个测试前重置熔断器状态,避免模块级状态泄漏导致序相关失败。"""
    _BreakerState["failure_count"] = 0
    _BreakerState["state"] = "CLOSED"
    _BreakerState["open_at"] = 0.0


@pytest.mark.asyncio
async def test_permissions_roundtrip_all_scopes(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC-01:platform/all/workspace 三键分离 set/get 往返,互不污染。"""
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)

    uid = uuid.uuid4()
    ws_id = uuid.uuid4()
    plat = {"platform:admin", "user:read"}
    all_perms = {"workspace:read", "change:create"}
    ws_perms = {"code:read", "task:read"}

    await set_cached_permissions(uid, plat, scope="platform")
    await set_cached_permissions(uid, all_perms, scope="all")
    await set_cached_permissions(uid, ws_perms, scope="workspace", workspace_id=ws_id)

    assert await get_cached_permissions(uid, scope="platform") == plat
    assert await get_cached_permissions(uid, scope="all") == all_perms
    assert await get_cached_permissions(uid, scope="workspace", workspace_id=ws_id) == ws_perms
    # 三键独立存储(D-003@v2 闭合互相覆盖污染)。
    assert len(fake.store) == 3


@pytest.mark.asyncio
async def test_permissions_miss_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC-01:空缓存各 scope miss 返回 None(调用方回退查 DB)。"""
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)

    uid = uuid.uuid4()
    ws_id = uuid.uuid4()
    assert await get_cached_permissions(uid, scope="platform") is None
    assert await get_cached_permissions(uid, scope="all") is None
    assert await get_cached_permissions(uid, scope="workspace", workspace_id=ws_id) is None


@pytest.mark.asyncio
async def test_invalid_scope_raises_value_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """非法 scope 是编程错误,ValueError 向上抛(不走降级)。"""
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)

    uid = uuid.uuid4()
    with pytest.raises(ValueError):
        await set_cached_permissions(uid, {"x"}, scope="bogus")
    with pytest.raises(ValueError):
        await get_cached_permissions(uid, scope="bogus")


@pytest.mark.asyncio
async def test_workspace_scope_requires_workspace_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """scope='workspace' 缺 workspace_id → ValueError(编程错误)。"""
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)

    uid = uuid.uuid4()
    with pytest.raises(ValueError):
        await set_cached_permissions(uid, {"x"}, scope="workspace")
    with pytest.raises(ValueError):
        await get_cached_permissions(uid, scope="workspace")


@pytest.mark.asyncio
async def test_ppm_scope_uuid_deserialization(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC-04(安全关键):ppm-scope 反序列化后 manager_project_ids 元素是 uuid.UUID。

    闭合 D-005@v1:JSON 只能存 str,若读回仍是 set[str],则
    ``data_scope.problem_operable`` 的 ``project_id in manager_pids``
    (uuid-in-set[str])恒为 False,经理编辑/删除问题会静默失效。
    """
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)

    uid = uuid.uuid4()
    pid1 = uuid.uuid4()
    pid2 = uuid.uuid4()
    await set_cached_ppm_scope(
        uid,
        {"manager_project_ids": {pid1, pid2}, "is_super_admin": True},
    )

    cached = await get_cached_ppm_scope(uid)
    assert cached is not None
    manager_ids = cached["manager_project_ids"]
    # 类型断言:必须是 uuid.UUID,不是 str
    assert all(isinstance(x, uuid.UUID) for x in manager_ids)
    assert pid1 in manager_ids
    assert pid2 in manager_ids
    assert isinstance(cached["is_super_admin"], bool)
    assert cached["is_super_admin"] is True


@pytest.mark.asyncio
async def test_ppm_scope_miss_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC-04:空缓存 ppm-scope miss 返回 None。"""
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)
    assert await get_cached_ppm_scope(uuid.uuid4()) is None


# ── AC-03:Redis 故障降级 ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_returns_none_on_redis_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC-03:Redis 故障时 get 各处返回 None(降级回查 DB,认证/鉴权不失败)。"""
    monkeypatch.setattr("app.core.permission_cache.get_redis", _raising)

    uid = uuid.uuid4()
    ws_id = uuid.uuid4()
    assert await get_cached_permissions(uid, scope="platform") is None
    assert await get_cached_permissions(uid, scope="all") is None
    assert await get_cached_permissions(uid, scope="workspace", workspace_id=ws_id) is None
    assert await get_cached_ppm_scope(uid) is None


@pytest.mark.asyncio
async def test_set_silent_on_redis_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC-03:Redis 故障时 set 静默吞错(D-004 降级,写失败不影响请求)。"""
    monkeypatch.setattr("app.core.permission_cache.get_redis", _raising)

    uid = uuid.uuid4()
    pid = uuid.uuid4()
    # 不抛异常即通过
    await set_cached_permissions(uid, {"x"}, scope="platform")
    await set_cached_ppm_scope(uid, {"manager_project_ids": {pid}, "is_super_admin": False})


@pytest.mark.asyncio
async def test_invalidate_silent_on_redis_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC-03 / D-002@v2:invalidate 失败不向上抛(业务已 commit 不回滚),
    但升 ERROR(安全事件,structlog 可监控告警)。"""
    spy_log = _LogSpy()
    monkeypatch.setattr("app.core.permission_cache.log", spy_log)
    monkeypatch.setattr("app.core.permission_cache.get_redis", _raising)

    # 不向上抛
    await invalidate_all_permissions()
    # D-002@v2:失效失败升 ERROR(可能留下最长 TTL 的越权窗口,必须告警)
    assert spy_log.errors >= 1


@pytest.mark.asyncio
async def test_set_skipped_when_ttl_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-004 排障:ttl<=0 跳过写(禁用缓存)。set 后 fake.store 仍空。"""
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)
    settings = get_settings().model_copy(update={"permission_cache_ttl": 0})
    monkeypatch.setattr("app.core.permission_cache.get_settings", lambda: settings)

    uid = uuid.uuid4()
    pid = uuid.uuid4()
    await set_cached_permissions(uid, {"x"}, scope="platform")
    await set_cached_ppm_scope(uid, {"manager_project_ids": {pid}, "is_super_admin": True})
    assert fake.store == {}  # ttl<=0 → 跳过写


# ── AC-02:invalidate 整体清空(helper 层)──────────────────────────────────


@pytest.mark.asyncio
async def test_invalidate_clears_perm_and_ppm_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC-02:invalidate 清空 perm:* + ppm-scope:*,无关 key 保留。"""
    fake = _FakeRedis()
    u = uuid.uuid4()
    u2 = uuid.uuid4()
    ws = uuid.uuid4()
    fake.store[f"perm:{u}:platform"] = "[]"
    fake.store[f"perm:{u2}:all"] = "[]"
    fake.store[f"perm:{u}:{ws}"] = "[]"
    fake.store[f"ppm-scope:{u}"] = "{}"
    fake.store["auth:apikey:abc"] = "1"  # 无关 key,必须保留
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)

    await invalidate_all_permissions()

    remaining = list(fake.store)
    assert not any(k.startswith("perm:") for k in remaining)
    assert not any(k.startswith("ppm-scope:") for k in remaining)
    assert "auth:apikey:abc" in remaining


# ── AC-01 / AC-03:rbac 缓存接入(DB seed)──────────────────────────────────


async def _seed_workspace_perms(
    session: AsyncSession,
) -> tuple[User, uuid.UUID, set[str]]:
    """seed User + Role + RolePermission + UserWorkspaceRole,让 collect_permissions
    (workspace) 首次查库返回非空 set。返回 (user, workspace_id, expected_perms)。"""
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:6]}@example.com",
        password_hash="x",
        status="active",
        is_platform_admin=False,
    )
    role = Role(id=uuid.uuid4(), key=f"r{uuid.uuid4().hex[:6]}", name="R")
    session.add_all([user, role])
    await session.flush()
    ws_id = uuid.uuid4()
    session.add(UserWorkspaceRole(user_id=user.id, workspace_id=ws_id, role_id=role.id))
    expected: set[str] = set()
    for perm in (Permission.WORKSPACE_READ, Permission.CHANGE_CREATE):
        session.add(RolePermission(role_id=role.id, permission=perm.value))
        expected.add(perm.value)
    await session.commit()
    return user, ws_id, expected


@pytest.mark.asyncio
async def test_collect_permissions_caches_and_skips_db_on_hit(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-01:首次 miss 查库 + 回填缓存;二次命中缓存不再打 DB JOIN。"""
    user, ws_id, expected = await _seed_workspace_perms(db_session)

    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)

    # 计数 session.execute 调用(缓存命中时 collect_permissions 不查库)
    calls = {"n": 0}
    real_execute = db_session.execute

    async def counting(*args: Any, **kwargs: Any) -> Any:
        calls["n"] += 1
        return await real_execute(*args, **kwargs)

    monkeypatch.setattr(db_session, "execute", counting)

    # 首次:miss → 查库 + 回填缓存
    first = await collect_permissions(db_session, user_id=user.id, workspace_id=ws_id)
    assert first == expected
    after_first = calls["n"]
    assert after_first >= 1
    assert any(k.startswith(f"perm:{user.id}") for k in fake.store)

    # 二次:命中缓存,session.execute 计数不增(AC-01:除 miss/失效后首次外不打 DB)
    second = await collect_permissions(db_session, user_id=user.id, workspace_id=ws_id)
    assert second == expected
    assert calls["n"] == after_first


@pytest.mark.asyncio
async def test_collect_permissions_degrades_to_db_without_redis(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-03:Redis 全挂时 collect_permissions 回退查 DB,结果与无缓存一致。"""
    user, ws_id, expected = await _seed_workspace_perms(db_session)

    monkeypatch.setattr("app.core.permission_cache.get_redis", _raising)

    result = await collect_permissions(db_session, user_id=user.id, workspace_id=ws_id)
    assert result == expected  # 降级回查 DB,认证/鉴权不失败


# ── AC-04 / AC-05:经理 problem_operable(缓存启用后)──────────────────────


@pytest.mark.asyncio
async def test_manager_problem_operable_with_cache(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-05 + AC-04:缓存启用后经理对本项目问题可编辑/删除,类型匹配 uuid-in-set[uuid]。

    预填 ppm-scope 缓存(manager_project_ids 含 pid),``manager_project_ids`` 命中
    缓存返回 set[uuid.UUID];``problem_operable``(纯函数)对本项目问题返回 True。
    """
    user = User(
        id=uuid.uuid4(),
        email=f"mgr-{uuid.uuid4().hex[:6]}@example.com",
        password_hash="x",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()

    pid = uuid.uuid4()
    other_pid = uuid.uuid4()
    fake = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake)
    await set_cached_ppm_scope(user.id, {"manager_project_ids": {pid}, "is_super_admin": False})

    manager_pids = await manager_project_ids(db_session, user)
    # AC-04:元素类型 uuid.UUID(不是 str)——闭合 uuid-in-set[str] 恒 False 的静默失效
    assert all(isinstance(x, uuid.UUID) for x in manager_pids)
    assert pid in manager_pids

    # AC-05:经理对本项目问题可编辑/删除(created_by/duty 均 None,仅经理维度放行)
    own_problem = SimpleNamespace(project_id=pid, created_by=None, duty_user_id=None)
    assert problem_operable(own_problem, user.id, manager_pids) is True

    # 非本项目问题、非创建人/责任人 → 不放行
    other_problem = SimpleNamespace(project_id=other_pid, created_by=None, duty_user_id=None)
    assert problem_operable(other_problem, user.id, manager_pids) is False


# ── AC-02 / D-006:失效触发点(写操作 commit 后 invalidate 被调)────────────


@pytest.mark.asyncio
async def test_role_create_calls_invalidate(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-02:角色 create commit 后 invalidate_all_permissions 被调用一次。"""
    actor = User(
        id=uuid.uuid4(),
        email=f"actor-{uuid.uuid4().hex[:6]}@example.com",
        password_hash="x",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(actor)
    await db_session.commit()

    calls = {"n": 0}

    async def spy() -> None:
        calls["n"] += 1

    monkeypatch.setattr("app.modules.admin.roles_service.invalidate_all_permissions", spy)

    svc = RoleService(db_session, actor_id=actor.id)
    await svc.create(
        RoleCreateRequest(
            key=f"role{uuid.uuid4().hex[:6]}",
            name="Test Role",
            permission_keys=[Permission.WORKSPACE_READ],
        )
    )
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_workspace_create_calls_invalidate(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-02 / D-006:create 新增 owner 角色 → commit 后 invalidate 被调用一次。

    daemon-client create 经 ``_ensure_creator_as_owner`` 写 owner 绑定,
    commit 后清 perm:*/ppm-scope:*。
    """
    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"ws-{user_id.hex[:8]}@example.com",
            password_hash="x",
            status="active",
        )
    )
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="host-create",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(daemon)
    # workspace_owner 角色:_ensure_creator_as_owner 据此真正加 owner 绑定
    db_session.add(Role(key="workspace_owner", name="Owner"))
    await db_session.flush()

    calls = {"n": 0}

    async def spy() -> None:
        calls["n"] += 1

    monkeypatch.setattr("app.modules.workspace.service.invalidate_all_permissions", spy)

    service = WorkspaceService(db_session)
    await service.create(
        WorkspaceCreate(
            name="Inv Workspace",
            root_path="/remote/inv/ws",
            daemon_id=daemon.id,
        ),
        created_by=user_id,
    )
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_scan_generate_new_workspace_calls_invalidate(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-02 / D-006(plan-review 阻断项):scan_generate 新建 workspace 分支触发失效。

    scan_generate 不经 ``WorkspaceService.create``,但新建 workspace 时同样调
    ``_ensure_creator_as_owner`` 写 owner 角色,并在 ``workspace_created=True`` 时
    commit 后调 ``invalidate_all_permissions``(task-08 实现)。本测试直接断言该路径,
    与 ``app/modules/workspace/tests/test_daemon_client_scan.py`` 共同构成回归保护。
    """
    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"scan-{user_id.hex[:8]}@example.com",
            password_hash="x",
            status="active",
        )
    )
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="host-scan",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(daemon)
    db_session.add(Role(key="workspace_owner", name="Owner"))
    await db_session.flush()

    calls = {"n": 0}

    async def spy() -> None:
        calls["n"] += 1

    monkeypatch.setattr("app.modules.workspace.service.invalidate_all_permissions", spy)

    agent_service = AsyncMock()
    agent_run = AsyncMock()
    agent_run.id = uuid.uuid4()
    agent_service.start_scan_dispatch = AsyncMock(return_value=agent_run)

    service = WorkspaceService(db_session)
    await service.scan_generate(
        root_path="/remote/scan/invalidate-proj",
        user_id=user_id,
        agent_service=agent_service,
        daemon_id=daemon.id,
    )
    assert calls["n"] == 1  # 新建 workspace(workspace_created=True)后失效


class TestBreaker:
    """熔断器三态 + threshold=0 禁用 + 不影响 invalidate。"""

    async def test_breaker_closed_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """熔断器默认 CLOSED,失败计数为 0。"""
        assert _BreakerState["state"] == "CLOSED"
        assert _BreakerState["failure_count"] == 0
        assert _breaker_is_open() is False

    async def test_breaker_opens_after_threshold(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """连续失败达阈值后 state 切换为 OPEN。"""
        threshold = get_settings().permission_cache_breaker_threshold
        for _ in range(threshold):
            assert _breaker_is_open() is False
            _record_failure()
        assert _BreakerState["state"] == "OPEN"
        assert _breaker_is_open() is True

    async def test_breaker_open_skips_redis(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """熔断 OPEN 后 get_cached_permissions 直接返回 None,mock redis 确保不被调用。"""
        threshold = get_settings().permission_cache_breaker_threshold
        for _ in range(threshold + 1):
            _record_failure()

        async def _boom(*a, **kw):
            pytest.fail("should not reach redis")

        monkeypatch.setattr(
            "app.core.permission_cache.get_redis", lambda: SimpleNamespace(get=_boom)
        )
        uid = uuid.uuid4()
        result = await get_cached_permissions(uid, scope="platform")
        assert result is None

    async def test_breaker_half_open_recovers(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """HALF_OPEN 时成功操作恢复 CLOSED。"""
        threshold = get_settings().permission_cache_breaker_threshold
        for _ in range(threshold):
            _record_failure()
        assert _BreakerState["state"] == "OPEN"
        _BreakerState["state"] = "HALF_OPEN"
        _record_success()
        assert _BreakerState["state"] == "CLOSED"

    async def test_breaker_half_open_fails_back_to_open(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """HALF_OPEN 时失败重回 OPEN。"""
        _BreakerState["state"] = "HALF_OPEN"
        _BreakerState["failure_count"] = get_settings().permission_cache_breaker_threshold - 1
        _record_failure()
        assert _BreakerState["state"] == "OPEN"

    async def test_breaker_threshold_zero_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """threshold=0 时熔断器始终 CLOSED,失败不累计。"""
        old = get_settings().permission_cache_breaker_threshold
        monkeypatch.setattr(get_settings(), "permission_cache_breaker_threshold", 0)
        for _ in range(10):
            _record_failure()
        assert _BreakerState["state"] == "CLOSED"
        assert _breaker_is_open() is False
        monkeypatch.setattr(get_settings(), "permission_cache_breaker_threshold", old)

    async def test_breaker_does_not_affect_invalidate(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """熔断 OPEN 时 invalidate_all_permissions 仍尝试 Redis。"""
        threshold = get_settings().permission_cache_breaker_threshold
        for _ in range(threshold + 1):
            _record_failure()
        assert _breaker_is_open() is True
        mock_redis = AsyncMock()
        mock_redis.scan_iter.return_value.__aiter__.return_value = iter([])
        spy = mock_redis.scan_iter
        monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: mock_redis)
        await invalidate_all_permissions()
        spy.assert_called()
