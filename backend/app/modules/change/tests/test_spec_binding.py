"""会话 ↔ 变更/快速修复 绑定基座测试（task-02 / design §5 W1.3 / §7）。

Change 2026-08-25-session-spec-binding task-02：``change/binding.py`` 的
``extract_spec_bindings`` 命令解析规则样例库（R-02：quick/default/非 run 子命令/
误归样例均无产出）+ ``bind_session_to_change`` / ``bind_session_to_quicklog``
的 DB 行为（default 守卫 / placeholder defaults / 幂等 / best-effort 不抛）。

2026-09-25-change-center-thin-flow task-04：样例库补 flow 命令族
（start/done/amend-draft --change → 变更绑定；run quick 跳过回归保留）。

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
    # --- flow 命令族（2026-09-25-change-center-thin-flow task-04：thin 2 调用协议）---
    # start/done/amend-draft 三子命令 --change 是真变更名 → 产出变更绑定。
    (
        "sillyspec flow start --change 2026-09-25-demo-task --input '动机'",
        ["2026-09-25-demo-task"],
    ),
    ("sillyspec flow done --change=eq-flow-key", ["eq-flow-key"]),
    (
        "sillyspec flow amend-draft --change 2026-09-25-draft-fix",
        ["2026-09-25-draft-fix"],
    ),
    # flow + platform_args（--spec-root 等选项前导，--change 在后）→ 产出。
    (
        "sillyspec flow start --spec-root /data/ws --change thin-args-key",
        ["thin-args-key"],
    ),
    # flow 其它子命令（progress/status 等只读）无 --change → 无产出。
    ("sillyspec flow status", []),
    ("sillyspec flow progress show", []),
    # flow default 伪键同样跳过（与 run 族同规则）。
    ("sillyspec flow start --change default", []),
    # run quick 跳过规则与 flow 并存：run 族 quick 跳过、flow 族照常产出。
    (
        "sillyspec run quick --done --change quick-990f8c09; "
        "sillyspec flow done --change after-quick-key",
        ["after-quick-key"],
    ),
    # --- 段首收紧（D-002@v1）：--input 引号长文本内的示例命令字样不产出绑定。
    # 引号内换行被 iter_command_segments 切成独立段（分段不感知引号），段中
    # sillyspec token 序列（段首是中文描述 token、前一 token 非 exec）不命中。
    (
        'cd /repo && sillyspec flow start --change 2026-10-27-real-change --input "标题\n'
        "\n"
        "动机：agent 执行 sillyspec flow start --change task-wakeup-precision-fix 被拒\n"
        "\n"
        "成功标准：\n"
        '- 标准 一"',
        ["2026-10-27-real-change"],
    ),
    # 段中 sillyspec（前一 token 为普通词）无产出——run 族同规则。
    ("echo 执行 sillyspec run plan --change mid-token-key", []),
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


# ===========================================================================
# 终态命令识别（2026-10-28-change-usage-attribution-window）
# ===========================================================================

# (command, 期望 terminal)：终态命令（run archive / flow done）标记 True，供
# submit_commit 清锚；非终态绑定命令恒 False。顶层别名 ``sillyspec archive``
# 不在解析范围（样例库既有契约，防误归）——无 --change 的归档命令无产出，
# 清锚不触发，由统计侧 archived_at 上界兜底（见变更 decisions.md）。
TERMINAL_CASES: list[tuple[str, bool]] = [
    ("sillyspec run archive --change 2026-10-28-demo", True),
    ("sillyspec run archive --done --confirm --change=eq-archive-key", True),
    ("sillyspec flow done --change 2026-10-28-demo", True),
    ("sillyspec flow done --change=eq-flow-key", True),
    ("sillyspec run execute --change 2026-10-28-demo", False),
    ("sillyspec run verify --change 2026-10-28-demo", False),
    ("sillyspec run plan --change=eq-form-key", False),
    ("sillyspec run brainstorm --change 2026-10-28-demo", False),
    ("sillyspec flow start --change 2026-10-28-demo", False),
    ("sillyspec flow amend-draft --change 2026-10-28-demo", False),
]


@pytest.mark.parametrize(("command", "expected_terminal"), TERMINAL_CASES)
def test_extract_spec_bindings_terminal_flag(command: str, expected_terminal: bool) -> None:
    """终态命令（run archive / flow done）解析出 terminal=True，其余绑定命令 False。"""
    bindings = extract_spec_bindings(command)
    assert len(bindings) == 1
    assert bindings[0].terminal is expected_terminal


def test_extract_spec_bindings_quick_after_wrapper_still_skipped() -> None:
    """包装剥除后 quick 守卫仍生效：``pnpm exec sillyspec run quick --change …``
    的 --change 是 quick 会话 id，同样无产出（D-004 对 exec 中缀场景的延伸）。"""
    assert (
        extract_spec_bindings("pnpm exec sillyspec run quick --done --change quick-990f8c09") == []
    )


def test_extract_spec_bindings_quoted_text_not_binding() -> None:
    """D-002@v1 完整重现（2026-10-27 会话 5f088f10 实证）：flow start --input
    引号长文本内引用「sillyspec flow start --change <名>」示例字样，引号内换行
    被分段函数切成独立段，段中序列不得产出绑定——只产出真实命令段的绑定。"""
    command = (
        'cd "C:/repo" && sillyspec flow start --change 2026-10-27-real-change --input "失败命令不再生成幽灵变更占位并过滤存量\n'
        "\n"
        "动机与背景：2026-10-27 会话实证——agent 执行 sillyspec flow start --change task-wakeup-precision-fix"
        "（缺日期前缀）被 CLI exit 2 拒绝，但绑定通道不看执行结果仍建占位。\n"
        "\n"
        "成功标准：\n"
        "- bind 在无行且名字不带日期前缀时跳过建占位\n"
        '- 读侧过滤超龄无文档 draft 行"'
    )
    bindings = extract_spec_bindings(command)
    assert [b.change_key for b in bindings] == ["2026-10-27-real-change"]


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


async def _change_links_of_session(db_session, session_id: uuid.UUID) -> list[ChangeSessionLink]:
    return list(
        (
            await db_session.execute(
                select(ChangeSessionLink).where(ChangeSessionLink.session_id == session_id)
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


async def test_bind_change_rejects_undated_new_key_no_placeholder(db_session):
    """FR-01（2026-10-27-ghost-spec-binding-fix）：查库未命中 + 名字不带日期前缀
    （CLI 强制规则，必被 exit 2 拒绝——失败命令）→ 不建 placeholder、不建 link、
    返回 None。幽灵占位根因写侧防护。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)

    result = await bind_session_to_change(db_session, ws.id, "task-wakeup-precision-fix", s.id)

    assert result is None
    assert await _changes_in_ws(db_session, ws.id) == []
    assert await _change_links_of_session(db_session, s.id) == []


async def test_bind_change_binds_existing_undated_row_without_placeholder(db_session):
    """FR-03：库中已有同 key 行（历史旧格式名合法存在）→ 跳过格式校验走幂等
    link 路径，不建第二行、不误拒——CLI「已存在的旧名变更不受影响」口径。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    key = "legacy-undated-name"
    existing = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=key,
        title="历史旧格式名变更",
        status="active",
        location="active",
        path=f"changes/{key}",
    )
    db_session.add(existing)
    await db_session.commit()

    bound = await bind_session_to_change(db_session, ws.id, key, s.id)

    assert bound == existing.id
    changes = await _changes_in_ws(db_session, ws.id)
    assert [c.id for c in changes] == [existing.id]  # 不建第二行
    links = await _change_links(db_session, existing.id)
    assert len(links) == 1 and links[0].session_id == s.id


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
    """best-effort：内部异常仅告警不抛（savepoint + log.warning 自吞，不阻断调用方事务）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)

    def _boom(*_a, **_k):
        raise RuntimeError("bind exploded")

    monkeypatch.setattr("app.modules.change.binding.Change", _boom)

    # 不抛异常即通过（savepoint 回滚，外层事务可继续）；失败路径返回 None
    # （2026-10-12-run-level-change-attribution task-02 / FR-02 返回值契约）。
    assert await bind_session_to_change(db_session, ws.id, "2026-08-25-boom", s.id) is None


async def test_bind_change_returns_change_id_contract(db_session):
    """返回值契约（2026-10-12-run-level-change-attribution task-02 / FR-02）：
    绑定返回变更行 id（幂等重入同 id）；default 伪键守卫返回 None。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    key = "2026-10-12-return-contract"

    first = await bind_session_to_change(db_session, ws.id, key, s.id)
    assert first is not None
    rows = await _changes_in_ws(db_session, ws.id)
    assert [c.id for c in rows] == [first]

    # 幂等重入：同 id（既有 link 分支同样返回变更 id）。
    second = await bind_session_to_change(db_session, ws.id, key, s.id)
    assert second == first

    # default 伪键：函数内兜底返回 None，不落任何行。
    assert await bind_session_to_change(db_session, ws.id, "default", s.id) is None


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


# ===========================================================================
# effective_from：link.created_at 绑定生效时刻（2026-10-28-change-usage-attribution-window）
# ===========================================================================


async def test_bind_change_effective_from_sets_link_created_at(db_session):
    """run_sync 通道传轮 started_at → 新 link.created_at 即该时刻（绑定自本轮
    起生效，防归因窗口下界误伤执行绑定命令的立项轮自身）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    round_started = datetime(2026, 10, 28, 5, 17, 40, tzinfo=UTC)

    await bind_session_to_change(
        db_session,
        ws.id,
        "2026-10-28-effective-from",
        s.id,
        effective_from=round_started,
    )

    links = await _change_links_of_session(db_session, s.id)
    assert len(links) == 1
    # SQLite 读回 naive：剥时区比较数值（同 test_usage_stats._naive 口径）。
    assert links[0].created_at.replace(tzinfo=None) == round_started.replace(tzinfo=None)


async def test_bind_change_effective_from_none_defaults_now(db_session):
    """无 run 上下文调用方（platform_sync / 会话创建落绑定）不传 → 当前时刻
    （行为与改动前一致）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    before = datetime.now(UTC)

    await bind_session_to_change(db_session, ws.id, "2026-10-28-eff-none", s.id)

    links = await _change_links_of_session(db_session, s.id)
    assert len(links) == 1
    created = links[0].created_at.replace(tzinfo=None)
    assert created >= before.replace(tzinfo=None)


async def test_bind_change_effective_from_idempotent_keeps_existing_link(db_session):
    """幂等：link 已存在时 effective_from 不回写（首建时刻即绑定生效时刻，
    重复绑定命令不改窗口起点）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    first_started = datetime(2026, 10, 28, 5, 0, 0, tzinfo=UTC)
    await bind_session_to_change(
        db_session, ws.id, "2026-10-28-eff-idem", s.id, effective_from=first_started
    )
    later_round = datetime(2026, 10, 28, 7, 30, 0, tzinfo=UTC)
    await bind_session_to_change(
        db_session, ws.id, "2026-10-28-eff-idem", s.id, effective_from=later_round
    )

    links = await _change_links_of_session(db_session, s.id)
    assert len(links) == 1
    assert links[0].created_at.replace(tzinfo=None) == first_started.replace(tzinfo=None)
