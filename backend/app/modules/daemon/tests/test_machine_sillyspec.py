"""daemon_instances sillyspec 三列落库语义（task-02 / FR-05 / D-002@v1）.

仿 ``test_pending_update_upsert.py`` 的夹具与断言风格（root ``db_session`` SQLite
in-memory，``RuntimeService`` 直调 + HTTP 层手签 JWT），锁定 D-002@v1 双通道语义：

* register：sillyspec_version / sillyspec_latest_version **无条件直写**（含
  None=未安装/未知 → 覆盖旧值为 NULL，本机卸载后重启收敛）；sillyspec_update
  恒置 NULL（daemon 侧状态机在内存，进程重启即失）；
* heartbeat：version / latest 兄弟字段语义——仅非 None 覆盖，缺省/null=保留
  （pydantic 下二者不可区分）；sillyspec_update 语义同 pending_update——非 None
  时 upsert（首写/内容变化盖 since=now，同内容保留原 since），None 即置 NULL；
* error 截断 200 在服务层一处实现；
* 迁移 upgrade/downgrade 在 SQLite 上可逆 + alembic 单 head 链（范式照
  ``tests/test_platform_deleted_hidden_migration.py``）。

task-03 追加端点/视图部分（FR-01 / FR-02，ws_hub mock 范式照
``test_machines_router.py`` 既有 send_cleanup / self-update 测试）：

* POST /machines/{id}/sillyspec-update：成功 ``{"sent": true}``（刻意无
  latest_version 键）、无权限 403、越权/不存在 404、离线/发送失败 504；
* GET /machines items[] 含 sillyspec_version / sillyspec_latest_version /
  sillyspec_update 三字段（嵌套类型化六键形态，非裸 dict 透传）；
* 2026-09-02-changes-overview-card task-03 追加 sillyspec_status：心跳 dict 整包
  直写 / None=清除 / register 恒清 / 机器视图嵌套透出 + OpenAPI 字段（无 since
  注入，语义同 sillyspec_update / Grill B1）；
* OpenAPI 含新端点路径与新字段（task-06 gen:types 的输入可再生产出）。

since「保留 vs 刷新」断言用哨兵值改写 DB 后再心跳验证（Windows 低分辨率时钟下
两次 ``datetime.now`` 可能同刻，不依赖真实时钟推进，确定性断言）。
"""

from __future__ import annotations

import importlib.util
import inspect
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission
from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.runtime.service import RuntimeService
from app.modules.daemon.ws_hub import DaemonWsHub

# 哨兵 since：绝无可能等于 datetime.now(UTC).isoformat() 的固定历史时刻。
_SENTINEL_SINCE = "2000-01-01T00:00:00+00:00"

REVISION_ID = "20260831150000"
DOWN_REVISION_ID = "20260831130000"  # 开工实测 alembic heads 唯一 head

_UPDATE_RUNNING = {
    "state": "running",
    "trigger": "server_command",
    "from_version": "3.26.15",
    "to_version": "3.27.11",
    "error": None,
}

# backend 仓根（test 文件位于 backend/app/modules/daemon/tests/ 下，向上 4 级）。
_BACKEND_ROOT = Path(__file__).resolve().parents[4]


# ── helpers ──────────────────────────────────────────────────────────────────


async def _seed_user(
    db_session: AsyncSession, *, name: str, is_platform_admin: bool = False
) -> tuple[User, str]:
    """插入用户并手签 15min JWT（get_current_principal Bearer 路径）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token

    user = User(
        id=uuid.uuid4(),
        email=f"sillyspec-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    settings = get_settings()
    token, _payload = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=settings,
    )
    return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_daemon(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str = "sillyspec-host",
    sillyspec_version: str | None = None,
    sillyspec_latest_version: str | None = None,
) -> uuid.UUID:
    """register 一个 daemon 实体 + 单 provider runtime（heartbeat 的前置，§9.1）。"""
    daemon_local_id = uuid.uuid4()
    svc = RuntimeService(db_session)
    await svc.register_daemon(
        user_id,
        daemon_local_id=daemon_local_id,
        server_url="http://localhost:8001",
        hostname=hostname,
        os="linux",
        arch="x86_64",
        allowed_roots=["~/.sillyhub"],
        providers=[{"provider": "claude", "status": "online", "version": "1.0"}],
        sillyspec_version=sillyspec_version,
        sillyspec_latest_version=sillyspec_latest_version,
    )
    return daemon_local_id


async def _reload_instance(db_session: AsyncSession, instance_id: uuid.UUID) -> DaemonInstance:
    """expire 后重查（绕过 identity map），直读库验证落库真值。"""
    db_session.expire_all()
    row = (
        await db_session.execute(select(DaemonInstance).where(DaemonInstance.id == instance_id))
    ).scalar_one()
    assert row is not None
    return row


async def _rewrite_since(db_session: AsyncSession, instance_id: uuid.UUID, since: str) -> None:
    """把已落库 sillyspec_update 的 since 改写为哨兵值（新 dict 整体赋值，JSON 变更可见）。"""
    row = await _reload_instance(db_session, instance_id)
    assert row.sillyspec_update is not None, "改写 since 前提：sillyspec_update 已落库"
    row.sillyspec_update = {**row.sillyspec_update, "since": since}
    db_session.add(row)
    await db_session.commit()


def _parse_since(value: object) -> datetime:
    """断言 since 可解析为 aware ISO 时刻（落库侧 ``datetime.now(UTC).isoformat()``）。"""
    assert isinstance(value, str)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    return parsed


# ── register：无条件直写（含 None）+ update 恒清（D-002@v1）──────────────────


@pytest.mark.asyncio
async def test_register_with_versions_writes_directly(db_session: AsyncSession) -> None:
    """register 携带版本 → 直写两列（新实例路径）。"""
    user, _token = await _seed_user(db_session, name="u1")

    daemon_local_id = await _register_daemon(
        db_session,
        user.id,
        sillyspec_version="3.26.15",
        sillyspec_latest_version="3.27.11",
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_version == "3.26.15"
    assert row.sillyspec_latest_version == "3.27.11"
    assert row.sillyspec_update is None, "register 不携带升级快照（状态机随进程重启而失）"


@pytest.mark.asyncio
async def test_register_without_versions_overwrites_old_values_to_null(
    db_session: AsyncSession,
) -> None:
    """register 缺省（None）→ 覆盖旧值为 NULL（D-002@v1：含 null 无条件直写，
    本机卸载 sillyspec 后 daemon 重启的收敛路径——与 daemon_version 的 Optional
    兼容语义刻意不同）。"""
    user, _token = await _seed_user(db_session, name="u2")
    daemon_local_id = await _register_daemon(
        db_session,
        user.id,
        sillyspec_version="3.26.15",
        sillyspec_latest_version="3.27.11",
    )

    # 重启后 register 不带 sillyspec 字段（未安装/未知）→ 两列清成 NULL。
    await RuntimeService(db_session).register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://localhost:8001",
        hostname="sillyspec-host",
        providers=[{"provider": "claude", "status": "online", "version": "1.0"}],
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_version is None
    assert row.sillyspec_latest_version is None


@pytest.mark.asyncio
async def test_register_clears_stale_sillyspec_update(db_session: AsyncSession) -> None:
    """心跳落了升级快照后 daemon 重启 register → sillyspec_update 置 NULL（内存
    状态机重启即失，register 清除上一进程遗留）。"""
    user, _token = await _seed_user(db_session, name="u3")
    # _reload_instance 会 expire_all：先取裸 id，避免过期对象的同步惰性加载
    # （aiosqlite 下 MissingGreenlet）。
    user_id = user.id
    daemon_local_id = await _register_daemon(db_session, user_id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, sillyspec_update=dict(_UPDATE_RUNNING))
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_update is not None

    await svc.register_daemon(
        user_id,
        daemon_local_id=daemon_local_id,
        server_url="http://localhost:8001",
        hostname="sillyspec-host",
        providers=[{"provider": "claude", "status": "online", "version": "1.0"}],
    )
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_update is None


# ── heartbeat：version/latest 非 None 覆盖 / 缺省保留（兄弟字段语义）────────


@pytest.mark.asyncio
async def test_heartbeat_non_none_overwrites_versions(db_session: AsyncSession) -> None:
    """心跳非 None → 覆盖（升级完成后新版本值上线）。"""
    user, _token = await _seed_user(db_session, name="u4")
    daemon_local_id = await _register_daemon(
        db_session, user.id, sillyspec_version="3.26.15", sillyspec_latest_version="3.27.11"
    )

    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id,
        sillyspec_version="3.27.11",
        sillyspec_latest_version="3.27.12",
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_version == "3.27.11"
    assert row.sillyspec_latest_version == "3.27.12"


@pytest.mark.asyncio
async def test_heartbeat_without_versions_keeps_old(db_session: AsyncSession) -> None:
    """心跳缺省（Pydantic 下与显式 null 不可区分）→ 保留旧值——旧 daemon 不上报
    sillyspec 字段不影响新值（R3 兼容），清除只走 register。"""
    user, _token = await _seed_user(db_session, name="u5")
    daemon_local_id = await _register_daemon(
        db_session, user.id, sillyspec_version="3.26.15", sillyspec_latest_version="3.27.11"
    )

    await RuntimeService(db_session).heartbeat_daemon(daemon_local_id)
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_version == "3.26.15"
    assert row.sillyspec_latest_version == "3.27.11"


# ── heartbeat：sillyspec_update upsert / 清除（pending_update 同款语义）──────


@pytest.mark.asyncio
async def test_first_update_heartbeat_writes_full_dict_with_since(
    db_session: AsyncSession,
) -> None:
    """首落库：五键原样 + since 盖心跳时刻 now（design §接口定义）。"""
    user, _token = await _seed_user(db_session, name="u6")
    daemon_local_id = await _register_daemon(db_session, user.id)

    started = datetime.now(UTC)
    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id, sillyspec_update=dict(_UPDATE_RUNNING)
    )
    finished = datetime.now(UTC)

    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_update is not None
    assert row.sillyspec_update["state"] == "running"
    assert row.sillyspec_update["trigger"] == "server_command"
    assert row.sillyspec_update["from_version"] == "3.26.15"
    assert row.sillyspec_update["to_version"] == "3.27.11"
    assert row.sillyspec_update["error"] is None
    since = _parse_since(row.sillyspec_update["since"])
    assert started <= since <= finished, "since 应为本次心跳时刻（首落库盖 now）"


@pytest.mark.asyncio
async def test_same_content_heartbeat_keeps_original_since(db_session: AsyncSession) -> None:
    """同内容重放心跳：整 dict（含 since）保留——since 是升级首现时刻，不随每轮
    心跳退化（对齐 pending_update 的 Grill M11 语义）。"""
    user, _token = await _seed_user(db_session, name="u7")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, sillyspec_update=dict(_UPDATE_RUNNING))
    await _rewrite_since(db_session, daemon_local_id, _SENTINEL_SINCE)

    # 同内容（五键全等）再心跳：since 哨兵原样保留。
    await svc.heartbeat_daemon(daemon_local_id, sillyspec_update=dict(_UPDATE_RUNNING))
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_update is not None
    assert row.sillyspec_update["since"] == _SENTINEL_SINCE
    assert row.sillyspec_update["state"] == "running"


@pytest.mark.asyncio
async def test_content_change_rewrites_dict_and_refreshes_since(
    db_session: AsyncSession,
) -> None:
    """内容变化（state 流转 running→success，to_version 补值）：整对象重写 + since
    刷新（≠哨兵历史值）。"""
    user, _token = await _seed_user(db_session, name="u8")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, sillyspec_update=dict(_UPDATE_RUNNING))
    await _rewrite_since(db_session, daemon_local_id, _SENTINEL_SINCE)

    await svc.heartbeat_daemon(
        daemon_local_id,
        sillyspec_update={
            "state": "success",
            "trigger": "server_command",
            "from_version": "3.26.15",
            "to_version": "3.27.11",
            "error": None,
        },
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_update is not None
    assert row.sillyspec_update["state"] == "success"
    assert row.sillyspec_update["since"] != _SENTINEL_SINCE, "内容变化应盖 since=now（新时刻）"
    _parse_since(row.sillyspec_update["since"])


@pytest.mark.asyncio
async def test_heartbeat_without_field_clears_update(db_session: AsyncSession) -> None:
    """无该字段心跳 → 置 NULL 清除（终态展示窗口结束 / 无升级进行中；与兄弟字段
    version/latest 的「缺省保留」刻意反向，D-002@v1 双通道各自锚定）。"""
    user, _token = await _seed_user(db_session, name="u9")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, sillyspec_update=dict(_UPDATE_RUNNING))
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_update is not None

    await svc.heartbeat_daemon(daemon_local_id)
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_update is None


@pytest.mark.asyncio
async def test_error_truncated_to_200_at_service_layer(db_session: AsyncSession) -> None:
    """failed 态长 error → 服务层截断至 200 字符（约束：截断一处实现，DTO 不重复）。"""
    user, _token = await _seed_user(db_session, name="u10")
    daemon_local_id = await _register_daemon(db_session, user.id)

    long_error = "x" * 300
    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id,
        sillyspec_update={**_UPDATE_RUNNING, "state": "failed", "error": long_error},
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_update is not None
    assert row.sillyspec_update["error"] == "x" * 200


# ── HTTP 层：register/heartbeat 端点接收新字段并落库 ─────────────────────────


@pytest.mark.asyncio
async def test_http_register_and_heartbeat_accept_sillyspec_fields(
    db_session: AsyncSession, client: AsyncClient
) -> None:
    """全链路 DTO 透传：register 带版本直写；心跳带新版本覆盖 + 带 update 落库；
    心跳不带 update → 置 NULL；心跳缺省 version → 保留。"""
    _owner, token = await _seed_user(db_session, name="owner")

    daemon_local_id = uuid.uuid4()
    register_body: dict = {
        "daemon_local_id": str(daemon_local_id),
        "server_url": "http://localhost:8001",
        "hostname": "http-sillyspec-host",
        "providers": [{"provider": "claude", "status": "online", "version": "1.0"}],
        "sillyspec_version": "3.26.15",
        "sillyspec_latest_version": "3.27.11",
    }
    resp = await client.post("/api/daemon/register", json=register_body, headers=_headers(token))
    assert resp.status_code == 201, resp.text
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_version == "3.26.15"
    assert row.sillyspec_latest_version == "3.27.11"

    def _heartbeat_body(
        *, sillyspec: dict | None = _UPDATE_RUNNING, versions: dict | None = None
    ) -> dict:
        body: dict = {"daemon_local_id": str(daemon_local_id)}
        if versions is not None:
            body.update(versions)
        if sillyspec is not None:
            body["sillyspec_update"] = sillyspec
        return body

    # 心跳带新版本 + 带 update → 覆盖 + upsert（含 since）。
    resp2 = await client.post(
        "/api/daemon/heartbeat",
        json=_heartbeat_body(versions={"sillyspec_version": "3.27.11"}),
        headers=_headers(token),
    )
    assert resp2.status_code == 200, resp2.text
    row2 = await _reload_instance(db_session, daemon_local_id)
    assert row2.sillyspec_version == "3.27.11"
    assert row2.sillyspec_latest_version == "3.27.11", "latest 缺省应保留 register 值"
    assert row2.sillyspec_update is not None
    assert row2.sillyspec_update["state"] == "running"
    _parse_since(row2.sillyspec_update["since"])

    # 心跳不带 update（缺省清除）+ 缺省 version 保留 → 3.27.11 保留、update NULL。
    resp3 = await client.post(
        "/api/daemon/heartbeat",
        json=_heartbeat_body(sillyspec=None, versions=None),
        headers=_headers(token),
    )
    assert resp3.status_code == 200, resp3.text
    row3 = await _reload_instance(db_session, daemon_local_id)
    assert row3.sillyspec_version == "3.27.11"
    assert row3.sillyspec_update is None


# ── 迁移：upgrade/downgrade 可逆 + 单 head 链（范式照 tests/
#    test_platform_deleted_hidden_migration.py，SQLite 兼容的纯加/删列迁移可直跑本体）──


def _load_migration() -> ModuleType:
    """按精确文件名加载迁移模块（spec_from_file_location，不依赖包导入路径）。"""
    path = (
        _BACKEND_ROOT
        / "migrations"
        / "versions"
        / (f"{REVISION_ID}_add_daemon_sillyspec_fields.py")
    )
    assert path.is_file(), f"migration file not found: {path}"
    spec = importlib.util.spec_from_file_location(f"migration_{REVISION_ID}", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_metadata() -> None:
    """revision 锚定：id / down_revision / upgrade+downgrade 可调用。"""
    mod = _load_migration()
    assert mod.revision == REVISION_ID
    assert mod.down_revision == DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_migration_revision_id_fits_alembic_version_column() -> None:
    # alembic_version.version_num is varchar(32) — revision id must fit.
    assert len(REVISION_ID) <= 32


def test_alembic_single_head_chain() -> None:
    """迁移挂载后 alembic 图仍是单 head 且本 revision 在链上（验收：单 head；
    不断言 head==REVISION_ID——后续迁移合法推进 head 后本测试不腐烂，照
    test_platform_deleted_hidden_migration.py 同款断言）。"""
    from alembic.script import ScriptDirectory

    sd = ScriptDirectory(str(_BACKEND_ROOT / "migrations"))
    heads = sd.get_heads()
    assert len(heads) == 1, f"expected single head, got {heads}"
    chain_ids = {rev.revision for rev in sd.walk_revisions()}
    assert REVISION_ID in chain_ids, f"revision {REVISION_ID} not reachable from head"
    assert DOWN_REVISION_ID in chain_ids


def _pragma_column(conn: sa.Connection, table: str, column: str) -> tuple[str, int] | None:
    """PRAGMA table_info 单列 → (type, notnull)。"""
    for _cid, name, col_type, notnull, _dflt, _pk in conn.execute(
        sa.text(f"PRAGMA table_info({table})")
    ):
        if name == column:
            return str(col_type), int(notnull)
    return None


def test_migration_upgrade_downgrade_reversible_on_sqlite() -> None:
    """upgrade 加 3 列（类型 + nullable）→ downgrade 对称删净（迁移可逆）。

    本迁移为纯 add/drop column（SQLite 兼容，无需 PG 方言 replay），直接在
    SQLite 内存库上跑迁移函数本体（Operations.context 安装 op 代理，照
    test_platform_deleted_hidden_migration.py 先例）。
    """
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    mod = _load_migration()
    engine = sa.create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    CREATE TABLE daemon_instances (
                        id CHAR(36) PRIMARY KEY NOT NULL
                    )
                    """
                )
            )
        # upgrade：3 列存在、类型正确、均可空（存量行为 NULL，D-002 兼容旧 daemon）。
        with engine.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                mod.upgrade()
        with engine.begin() as conn:
            assert _pragma_column(conn, "daemon_instances", "sillyspec_version") == (
                "VARCHAR(50)",
                0,
            )
            assert _pragma_column(conn, "daemon_instances", "sillyspec_latest_version") == (
                "VARCHAR(50)",
                0,
            )
            assert _pragma_column(conn, "daemon_instances", "sillyspec_update") == ("JSON", 0)

        # downgrade：3 列删净（回到迁移前结构）。
        with engine.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                mod.downgrade()
        with engine.begin() as conn:
            assert _pragma_column(conn, "daemon_instances", "sillyspec_version") is None
            assert _pragma_column(conn, "daemon_instances", "sillyspec_latest_version") is None
            assert _pragma_column(conn, "daemon_instances", "sillyspec_update") is None
    finally:
        engine.dispose()


def test_migration_docstring_anchors_change() -> None:
    """迁移 docstring 锚定变更名（防后续误删/改名后追溯断链）。"""
    mod = _load_migration()
    doc = inspect.getdoc(mod)
    assert doc is not None
    assert "2026-08-31-machine-sillyspec-version" in doc
    assert "D-002@v1" in doc


# ── task-03：POST /machines/{id}/sillyspec-update 端点 + GET /machines 读视图 ──
# ws_hub mock 范式照 test_machines_router.py（fresh_ws_hub 换进程级单例 +
# monkeypatch DaemonWsHub.send_sillyspec_update）；helper 就近私有复刻，不新建
# conftest（该目录既有惯例）。


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """用全新 DaemonWsHub 替换进程级单例（仿 test_ws_rpc.py / test_machines_router.py）。"""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


async def _grant_runtime_admin(db_session: AsyncSession, user_id: uuid.UUID) -> None:
    """授予 RUNTIME_ADMIN 平台权限（复刻 test_machines_router._grant_platform_permission）。"""
    from app.modules.admin.model import UserRole

    role = Role(
        id=uuid.uuid4(),
        key=f"test-ss-admin-{uuid.uuid4().hex[:6]}",
        name="test runtime_admin",
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.RUNTIME_ADMIN.value))
    db_session.add(UserRole(user_id=user_id, role_id=role.id))
    await db_session.commit()


async def _create_machine(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str,
    sillyspec_version: str | None = None,
    sillyspec_latest_version: str | None = None,
    sillyspec_update: dict | None = None,
    sillyspec_status: dict | None = None,
) -> DaemonInstance:
    """直插 daemon_instance 行（task-03 视图/端点断言用，仿 test_machines_router
    _create_instance，额外带 sillyspec 四列——不走 register，锁定读视图直读列）。"""
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://localhost:8001",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
        sillyspec_version=sillyspec_version,
        sillyspec_latest_version=sillyspec_latest_version,
        sillyspec_update=sillyspec_update,
        sillyspec_status=sillyspec_status,
    )
    db_session.add(inst)
    await db_session.commit()
    await db_session.refresh(inst)
    return inst


@pytest.mark.asyncio
async def test_sillyspec_update_endpoint_routes_to_ws_hub(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-02 成功路径：mock ws_hub，``send_sillyspec_update`` 返回 True → 200
    ``{"sent": true}``（刻意无 latest_version 键——npm latest 由 daemon 自行探测），
    且以 instance_id 作 daemon_id 路由。"""
    admin, token = await _seed_user(db_session, name="ep-admin", is_platform_admin=True)
    inst = await _create_machine(db_session, admin.id, hostname="ss-ep-host")

    captured: dict[str, Any] = {}

    async def _fake_send(
        self_hub: DaemonWsHub,
        daemon_id: uuid.UUID,
    ) -> bool:
        captured["daemon_id"] = daemon_id
        return True

    monkeypatch.setattr(DaemonWsHub, "send_sillyspec_update", _fake_send)

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/sillyspec-update", headers=_headers(token)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"sent": True}, "不返回 latest_version（design §接口定义）"
    assert captured["daemon_id"] == inst.id


@pytest.mark.asyncio
async def test_sillyspec_update_endpoint_offline_returns_504(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-02：离线 / 发送失败 → 504 DaemonRuntimeOffline（与 self-update/cleanup 同款）。"""
    admin, token = await _seed_user(db_session, name="ep504-admin", is_platform_admin=True)
    inst = await _create_machine(db_session, admin.id, hostname="ss-offline-host")

    async def _always_false(
        self_hub: DaemonWsHub,
        daemon_id: uuid.UUID,
    ) -> bool:
        return False

    monkeypatch.setattr(DaemonWsHub, "send_sillyspec_update", _always_false)

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/sillyspec-update", headers=_headers(token)
    )
    assert resp.status_code == 504, resp.text
    body = resp.json()
    assert body["details"] == {"daemon_instance_id": str(inst.id)}


@pytest.mark.asyncio
async def test_sillyspec_update_endpoint_cross_owner_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """FR-02：有 RUNTIME_ADMIN 权限但非 owner 且非平台 admin → 404（_get_owned_instance
    越权合并 404，避免存在性泄漏，与 self-update/cleanup 同语义）。"""
    owner, _owner_token = await _seed_user(db_session, name="ep404-owner")
    attacker, attacker_token = await _seed_user(db_session, name="ep404-attacker")
    await _grant_runtime_admin(db_session, attacker.id)
    inst = await _create_machine(db_session, owner.id, hostname="ss-victim-host")

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/sillyspec-update", headers=_headers(attacker_token)
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"


@pytest.mark.asyncio
async def test_sillyspec_update_endpoint_without_permission_returns_403(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """FR-02：无 RUNTIME_ADMIN 权限的普通用户 → 403（RuntimeAdminUser 权限闸，
    早于归属校验）。"""
    owner, _owner_token = await _seed_user(db_session, name="ep403-owner")
    _nobody, nobody_token = await _seed_user(db_session, name="ep403-nobody")
    inst = await _create_machine(db_session, owner.id, hostname="ss-403-host")

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/sillyspec-update", headers=_headers(nobody_token)
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_sillyspec_update_endpoint_nonexistent_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """FR-02：不存在 instance_id → 404。"""
    _admin, token = await _seed_user(db_session, name="ep404b-admin", is_platform_admin=True)

    resp = await client.post(
        f"/api/daemon/machines/{uuid.uuid4()}/sillyspec-update",
        headers=_headers(token),
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_machines_view_exposes_sillyspec_fields_typed(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """FR-01：GET /machines items[] 含三字段——上报机 sillyspec_update 为嵌套
    类型化六键形态（MachineSillySpecUpdateRead 投影，since ISO 原样透传，非裸
    dict）；旧 daemon / 无升级机三字段均 null（None 安全）。"""
    admin, token = await _seed_user(db_session, name="view-admin", is_platform_admin=True)
    await _create_machine(
        db_session,
        admin.id,
        hostname="ss-view-host",
        sillyspec_version="3.26.15",
        sillyspec_latest_version="3.27.11",
        sillyspec_update={
            "state": "running",
            "trigger": "server_command",
            "from_version": "3.26.15",
            "to_version": "3.27.11",
            "error": None,
            "since": _SENTINEL_SINCE,
        },
    )
    await _create_machine(db_session, admin.id, hostname="ss-legacy-host")

    resp = await client.get("/api/daemon/machines", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    items = {it["hostname"]: it for it in resp.json()["items"]}

    machine = items["ss-view-host"]
    assert machine["sillyspec_version"] == "3.26.15"
    assert machine["sillyspec_latest_version"] == "3.27.11"
    # 嵌套类型化形态：恰好六键（MachineSillySpecUpdateRead 投影，非裸 dict 透传）；
    # since 哨兵时刻往返（dict→Read 校验→序列化，"+00:00" 可规范成 "Z"，按时刻比较）。
    update = machine["sillyspec_update"]
    assert set(update) == {"state", "trigger", "from_version", "to_version", "error", "since"}
    assert update["state"] == "running"
    assert update["trigger"] == "server_command"
    assert update["from_version"] == "3.26.15"
    assert update["to_version"] == "3.27.11"
    assert update["error"] is None
    assert _parse_since(update["since"]) == datetime.fromisoformat(_SENTINEL_SINCE)

    legacy = items["ss-legacy-host"]
    assert legacy["sillyspec_version"] is None
    assert legacy["sillyspec_latest_version"] is None
    assert legacy["sillyspec_update"] is None


def test_openapi_contains_sillyspec_update_endpoint_and_fields() -> None:
    """验收：OpenAPI schema 含新端点路径与机器视图三字段（task-06 gen:types 的
    输入可再生产出，前端类型不手写）。

    用 ``app.openapi()`` 直出（scripts/dump_openapi.py 同源；线上 openapi.json
    路由非 dev 环境关闭，不走 HTTP）。
    """
    from app.main import app

    spec = app.openapi()
    assert "/api/daemon/machines/{instance_id}/sillyspec-update" in spec["paths"]
    machine_schema = spec["components"]["schemas"]["DaemonMachineReadWithPending"]
    assert {"sillyspec_version", "sillyspec_latest_version", "sillyspec_update"} <= set(
        machine_schema["properties"]
    )
    # 嵌套引用指向 MachineSillySpecUpdateRead（类型化，非自由形态 object；
    # anyOf[0]=模型 ref / [1]=null，与 pending_update 序列化形态一致）。
    assert (
        machine_schema["properties"]["sillyspec_update"]["anyOf"][0]["$ref"]
        == "#/components/schemas/MachineSillySpecUpdateRead"
    )


# ── task-03（2026-09-02-changes-overview-card）：sillyspec_status 落库/清除/视图 ──
# 语义锚定 Grill B1（None=清除，与 sillyspec_update 同构；刻意区别于兄弟字段
# sillyspec_version/latest 的「缺省保留」）：非 None dict 整包直写（progress 快照
# 非状态机，无 since 注入/同内容 upsert），register 恒清（快照随 daemon 进程
# 重启失效，同 sillyspec_update 收敛理由）。conflict_types 为计数映射
# （task-04 复核修正 A1：dict[str,int]，对齐 daemon 侧 Record<string,number>）。

_STATUS_KEYS = {
    "ok",
    "errors_count",
    "warnings_count",
    "generated_at",
    "active_changes",
    "healthy_count",
    "ghost_count",
    "conflict_count",
    "conflict_types",
    "changes",
    "pending_conflicts",
}

_STATUS_FULL = {
    "ok": True,
    "errors_count": 0,
    "warnings_count": 2,
    "generated_at": "2026-09-02T12:51:03+00:00",
    "active_changes": 18,
    "healthy_count": 1,
    "ghost_count": 17,
    "conflict_count": 11,
    "conflict_types": {"spec-tree": 2, "progress": 9},
    "changes": [
        {
            "name": "2026-09-02-changes-overview-card",
            "ghost": False,
            "current_stage": "execute",
            "stage_label": "执行",
            "last_active": "2026-09-02T12:50:59+00:00",
            "steps": {"total": 8, "completed": 3},
        }
    ],
    "pending_conflicts": [
        {
            "change": "2026-08-20-frontend-ai-native-style",
            "created_at": "2026-08-21T10:00:00+00:00",
            "type": "spec-tree",
        }
    ],
}


@pytest.mark.asyncio
async def test_status_heartbeat_writes_dict_verbatim(db_session: AsyncSession) -> None:
    """三态①落库（服务层直调）：非 None dict 整包原样直写——无 since 注入、无键
    增删改写（progress 快照非状态机，design §4「落库形态=上报形态」）。"""
    user, _token = await _seed_user(db_session, name="u11")
    daemon_local_id = await _register_daemon(db_session, user.id)

    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id, sillyspec_status=_STATUS_FULL
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_status == _STATUS_FULL, "dict 原样落库，服务层零增删改写"
    assert "since" not in (row.sillyspec_status or {}), "非状态机，不注入 since"


@pytest.mark.asyncio
async def test_status_heartbeat_without_field_clears(db_session: AsyncSession) -> None:
    """None=清除：心跳缺省该参 → 置 NULL（daemon 侧 CLI 能力缺失上报 null 的收敛
    路径；与兄弟字段 version/latest 的「缺省保留」刻意反向，Grill B1）。"""
    user, _token = await _seed_user(db_session, name="u12")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, sillyspec_status=_STATUS_FULL)
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_status is not None

    await svc.heartbeat_daemon(daemon_local_id)
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_status is None


@pytest.mark.asyncio
async def test_register_clears_stale_sillyspec_status(db_session: AsyncSession) -> None:
    """register 恒清：心跳落了快照后 daemon 重启 register → 置 NULL（快照随进程
    重启失效，同 sillyspec_update 重启收敛理由，else 分支）。"""
    user, _token = await _seed_user(db_session, name="u13")
    user_id = user.id
    daemon_local_id = await _register_daemon(db_session, user_id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, sillyspec_status=_STATUS_FULL)
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_status is not None

    await svc.register_daemon(
        user_id,
        daemon_local_id=daemon_local_id,
        server_url="http://localhost:8001",
        hostname="sillyspec-host",
        providers=[{"provider": "claude", "status": "online", "version": "1.0"}],
    )
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_status is None


@pytest.mark.asyncio
async def test_http_heartbeat_accepts_and_clears_sillyspec_status(
    db_session: AsyncSession,
    client: AsyncClient,
) -> None:
    """HTTP 全链路：带对象 → DTO model_dump 落库（11 键齐、嵌套 steps 投影、无
    since 键）；显式 null → 置 NULL；缺省（旧 daemon 无字段）→ 同样置 NULL
    （pydantic 缺省与显式 null 不可区分，NFR-01 旧 daemon 路径零破坏）。"""
    owner, token = await _seed_user(db_session, name="owner-status")
    daemon_local_id = await _register_daemon(db_session, owner.id)
    headers = _headers(token)

    resp = await client.post(
        "/api/daemon/heartbeat",
        json={"daemon_local_id": str(daemon_local_id), "sillyspec_status": _STATUS_FULL},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_status is not None
    assert set(row.sillyspec_status) == _STATUS_KEYS
    assert row.sillyspec_status["changes"][0]["steps"] == {"total": 8, "completed": 3}
    assert "since" not in row.sillyspec_status

    # 显式 null → 置 NULL（三态②能力缺失的 HTTP 形态）。
    resp2 = await client.post(
        "/api/daemon/heartbeat",
        json={"daemon_local_id": str(daemon_local_id), "sillyspec_status": None},
        headers=headers,
    )
    assert resp2.status_code == 200, resp2.text
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_status is None

    # 缺省（旧 daemon 无该键）→ 同置 NULL（None=清除，区别于兄弟字段保留语义）。
    resp3 = await client.post(
        "/api/daemon/heartbeat",
        json={"daemon_local_id": str(daemon_local_id)},
        headers=headers,
    )
    assert resp3.status_code == 200, resp3.text
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_status is None


@pytest.mark.asyncio
async def test_machines_view_exposes_sillyspec_status_typed(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """FR-01：GET /machines items[] 含 sillyspec_status——上报机为嵌套类型化 11 键
    形态（changes[] 六字段 + steps 投影原样，非裸 dict）；NULL 机（旧 daemon/
    总览不可用）为 null。"""
    admin, token = await _seed_user(db_session, name="view-status-admin", is_platform_admin=True)
    await _create_machine(
        db_session,
        admin.id,
        hostname="ss-status-host",
        sillyspec_status=_STATUS_FULL,
    )
    await _create_machine(db_session, admin.id, hostname="ss-status-legacy-host")

    resp = await client.get("/api/daemon/machines", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    items = {it["hostname"]: it for it in resp.json()["items"]}

    status = items["ss-status-host"]["sillyspec_status"]
    assert set(status) == _STATUS_KEYS
    assert status["ok"] is True
    assert status["conflict_types"] == {"spec-tree": 2, "progress": 9}
    change = status["changes"][0]
    assert set(change) == {
        "name",
        "ghost",
        "current_stage",
        "stage_label",
        "last_active",
        "steps",
    }
    assert change["steps"] == {"total": 8, "completed": 3}
    assert status["pending_conflicts"][0]["type"] == "spec-tree"

    assert items["ss-status-legacy-host"]["sillyspec_status"] is None


def test_openapi_contains_machine_sillyspec_status_field() -> None:
    """验收：OpenAPI schema DaemonMachineReadWithPending 含 sillyspec_status 嵌套
    引用（task-05 gen:types 的输入可再生产）。app.openapi() 直出（同源
    dump_openapi.py，不走 HTTP）。"""
    from app.main import app

    spec = app.openapi()
    machine_schema = spec["components"]["schemas"]["DaemonMachineReadWithPending"]
    assert "sillyspec_status" in machine_schema["properties"]
    assert (
        machine_schema["properties"]["sillyspec_status"]["anyOf"][0]["$ref"]
        == "#/components/schemas/MachineSillySpecStatusRead"
    )
    # 心跳载荷模型同入 components（DaemonHeartbeatRequest 引用链完整）。
    assert "DaemonHeartbeatSillySpecStatus" in spec["components"]["schemas"]
