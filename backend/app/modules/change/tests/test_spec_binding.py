"""会话 ↔ 变更/快速修复 绑定基座测试（task-02 / design §5 W1.3 / §7）。

Change 2026-08-25-session-spec-binding task-02：``change/binding.py`` 的
``extract_spec_bindings`` 命令解析规则样例库（R-02：quick/default/非 run 子命令/
误归样例均无产出）+ ``bind_session_to_change`` / ``bind_session_to_quicklog``
的 DB 行为（default 守卫 / placeholder defaults / 幂等 / best-effort 不抛）。

DB 用例走根 conftest ``db_engine`` 的 SQLite ``create_all``（change model 已在
其 import 列表，参照 test_quicklog_session_links.py 模式）。

author: qinyi
created_at: 2026-08-25
"""

from __future__ import annotations

import uuid
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.change.binding import (
    bind_session_to_change,
    bind_session_to_quicklog,
    extract_spec_bindings,
)
from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink
from app.modules.workspace.model import Workspace

# ===========================================================================
# 解析样例库（design §5 W2.1 解析规则 / D-004 / D-005@v2）
# ===========================================================================

# (command, 期望产出的 change_key 列表)：空列表 = 无产出。
PARSE_CASES: list[tuple[str, list[str]]] = [
    # --- 产出：普通阶段 + --change 空格形式（锚点实证样例）---
    (
        "sillyspec run execute --change 2026-08-12-quick-independent-stage",
        ["2026-08-12-quick-independent-stage"],
    ),
    # --- quick 子命令无产出（D-004：--change 是 CLI quick 会话 id）---
    (
        'sillyspec run quick --done --change quick-990f8c09 --output "修复登录崩溃"',
        [],
    ),
    ("sillyspec run quick --linked-changes none --files a.ts", []),
    ("sillyspec run quick", []),
    # --- default 伪键跳过（D-005@v2 解析层第一道；锚点实证样例）---
    ("sillyspec run scan --done --change default", []),
    ("sillyspec run execute --change=default", []),
    # --- 等号形式 → 产出 ---
    ("sillyspec run plan --change=eq-form-key", ["eq-form-key"]),
    # --- 复合命令：分段后命中 sillyspec 段 → 产出 ---
    ("cd x && sillyspec run plan --change a-b", ["a-b"]),
    # --- 包装剥除（pnpm 剥后残留 exec 中缀，段内定位 sillyspec run）→ 产出 ---
    ("pnpm exec sillyspec run verify --change c-d", ["c-d"]),
    ("sudo sillyspec run verify --change bare-wrap", ["bare-wrap"]),
    # --- 一条命令多个 sillyspec 子段（;）→ 多个产出 ---
    (
        "sillyspec run plan --change m-one; sillyspec run verify --change m-two",
        ["m-one", "m-two"],
    ),
    # --- 非 sillyspec / 非 run 子命令 / 参数含字样误归 → 无产出 ---
    ("git status", []),
    ("grep sillyspec *.ts", []),
    ("cat docs/sillyspec-note.md", []),
    ("sillyspec status", []),
    ("sillyspec progress show", []),
    ("sillyspec archive --change ghost", []),
    ("", []),
    # --- --change 值缺失 / 值是选项 → 无产出（值取下一个非选项 token）---
    ("sillyspec run execute --change", []),
    ("sillyspec run execute --change --done", []),
    ("sillyspec run execute --change=", []),
]


@pytest.mark.parametrize(("command", "expected_keys"), PARSE_CASES)
def test_extract_spec_bindings_sample_library(command: str, expected_keys: list[str]) -> None:
    """解析样例库：命中预期的 change_key 序列，kind 恒为 change。"""
    bindings = extract_spec_bindings(command)
    assert [b.change_key for b in bindings] == expected_keys
    assert all(b.kind == "change" for b in bindings)


def test_extract_spec_bindings_returns_frozen_dataclass() -> None:
    """产出为 frozen dataclass（design §7 契约：kind + change_key 不可变）。"""
    binding = extract_spec_bindings("sillyspec run plan --change frozen-key")[0]
    with pytest.raises(FrozenInstanceError):
        binding.change_key = "mutated"  # type: ignore[misc]


def test_extract_spec_bindings_quick_after_wrapper_still_skipped() -> None:
    """包装剥除后 quick 守卫仍生效：``pnpm exec sillyspec run quick --change …``
    的 --change 是 quick 会话 id，同样无产出（D-004 对 exec 中缀场景的延伸）。"""
    assert (
        extract_spec_bindings("pnpm exec sillyspec run quick --done --change quick-990f8c09") == []
    )


# ===========================================================================
# bind_session_to_change（DB）
# ===========================================================================


async def _make_user(db_session) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"spb-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="Spb",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_ws(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="spec binding ws",
        slug=f"spb-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/spec-binding-test-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_session(db_session, *, workspace_id: uuid.UUID, user_id: uuid.UUID) -> AgentSession:
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=workspace_id,
        provider="claude",
        status="active",
        created_at=datetime.now(UTC),
    )
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


async def _changes_in_ws(db_session, workspace_id: uuid.UUID) -> list[Change]:
    return list(
        (await db_session.execute(select(Change).where(Change.workspace_id == workspace_id)))
        .scalars()
        .all()
    )


async def _change_links(db_session, change_id: uuid.UUID) -> list[ChangeSessionLink]:
    return list(
        (
            await db_session.execute(
                select(ChangeSessionLink).where(ChangeSessionLink.change_id == change_id)
            )
        )
        .scalars()
        .all()
    )


async def test_bind_change_default_guard_creates_nothing(db_session):
    """D-005@v2 函数内兜底：default 伪键不建 Change 行、不建 link 行。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)

    await bind_session_to_change(db_session, ws.id, "default", s.id)

    assert await _changes_in_ws(db_session, ws.id) == []
    links = (
        (
            await db_session.execute(
                select(ChangeSessionLink).where(ChangeSessionLink.session_id == s.id)
            )
        )
        .scalars()
        .all()
    )
    assert list(links) == []


async def test_bind_change_creates_placeholder_with_ensure_defaults(db_session):
    """变更不存在时建 placeholder 行，defaults 对齐 _ensure_change_row：
    status=draft / location=active / path=changes/<名> / title=名，并建 link。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    key = "2026-08-25-placeholder-demo"

    await bind_session_to_change(db_session, ws.id, key, s.id)

    changes = await _changes_in_ws(db_session, ws.id)
    assert len(changes) == 1
    change = changes[0]
    assert change.change_key == key
    assert change.status == "draft"
    assert change.location == "active"
    assert change.path == f"changes/{key}"
    assert change.title == key

    links = await _change_links(db_session, change.id)
    assert len(links) == 1
    assert links[0].session_id == s.id


async def test_bind_change_reuses_existing_row_and_is_idempotent(db_session):
    """幂等：已有 Change 行直接复用（不建第二行）；二次调用不重复建 link。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    key = "2026-08-25-idem"
    existing = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=key,
        title="既有行",
        status="active",
        location="active",
        path=f"changes/{key}",
    )
    db_session.add(existing)
    await db_session.commit()

    await bind_session_to_change(db_session, ws.id, key, s.id)
    await bind_session_to_change(db_session, ws.id, key, s.id)

    changes = await _changes_in_ws(db_session, ws.id)
    assert len(changes) == 1
    assert changes[0].id == existing.id
    assert changes[0].title == "既有行"  # 已存在行不被 placeholder 覆写
    links = await _change_links(db_session, existing.id)
    assert len(links) == 1
    assert links[0].session_id == s.id


async def test_bind_change_failure_is_best_effort_no_raise(db_session, monkeypatch):
    """best-effort：内部异常仅告警不抛（对齐 _bind_change_to_session 风格）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)

    def _boom(*_a, **_k):
        raise RuntimeError("bind exploded")

    monkeypatch.setattr("app.modules.change.binding.Change", _boom)

    # 不抛异常即通过（savepoint 回滚，外层事务可继续）
    await bind_session_to_change(db_session, ws.id, "2026-08-25-boom", s.id)


# ===========================================================================
# bind_session_to_quicklog（DB）
# ===========================================================================


async def _quicklog_links(
    db_session, workspace_id: uuid.UUID, ql_id: str
) -> list[QuicklogSessionLink]:
    return list(
        (
            await db_session.execute(
                select(QuicklogSessionLink).where(
                    QuicklogSessionLink.workspace_id == workspace_id,
                    QuicklogSessionLink.ql_id == ql_id,
                )
            )
        )
        .scalars()
        .all()
    )


async def test_bind_quicklog_idempotent_without_entry_row(db_session):
    """D-001@v1：不要求 quicklog_entries 行存在即可先绑；二次调用幂等。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    ql_id = "ql-20260825-009-x"

    await bind_session_to_quicklog(db_session, ws.id, ql_id, s.id)
    await bind_session_to_quicklog(db_session, ws.id, ql_id, s.id)

    rows = await _quicklog_links(db_session, ws.id, ql_id)
    assert len(rows) == 1
    assert rows[0].session_id == s.id


async def test_bind_quicklog_failure_is_best_effort_no_raise(db_session, monkeypatch):
    """best-effort：内部异常仅告警不抛。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)

    def _boom(*_a, **_k):
        raise RuntimeError("quicklog bind exploded")

    monkeypatch.setattr("app.modules.change.binding.QuicklogSessionLink", _boom)

    await bind_session_to_quicklog(db_session, ws.id, "ql-20260825-boom", s.id)
