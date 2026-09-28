"""P2a/P3 回归（2026-09-16-platform-progress-ingest-persist task-07）。

- title 归一化四态（纯模板 H1 / ``— key`` 后缀变体 / 自定义 H1 / H1 缺失）——
  ``normalize_display_title`` 纯函数 + parser `_parse_change` 集成（reparse 路径
  同源，不回翻）。
- ``upsert_documents`` 文档推送 title 重派生（模板 H1 → key 派生名 / 自定义 H1
  原样 / 行缺失建占位行 / 已删 key 防复活守卫 GAP-1）。
- P3 MASTER 占位行：缺席不发 exists=False 行、存在照发；存量脏行由 ``_sync_docs``
  seen_keys 删除环清理。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

# ── 归一化纯函数 ──────────────────────────────────────────────────────────────


class TestNormalizeDisplayTitle:
    def test_template_h1_falls_back_to_key(self) -> None:
        from app.modules.change.title_norm import normalize_display_title

        assert (
            normalize_display_title("提案书（Proposal）", "2026-09-15-ehs-reward-punishment")
            == "ehs-reward-punishment"
        )

    def test_template_h1_with_key_suffix_falls_back(self) -> None:
        from app.modules.change.title_norm import normalize_display_title

        # 新 CLI 模板变体：模板 + em dash + change_key
        assert (
            normalize_display_title(
                "提案书（Proposal）— 2026-09-15-ehs-reward-punishment",
                "2026-09-15-ehs-reward-punishment",
            )
            == "ehs-reward-punishment"
        )
        # 双 em dash / 连字符分隔变体同判
        assert normalize_display_title("设计文档（Design）—— 旧稿", "2026-09-15-x") == "x"
        assert normalize_display_title("需求规格（Requirements）- draft", "2026-09-15-x") == "x"

    def test_custom_h1_kept_as_is(self) -> None:
        from app.modules.change.title_norm import normalize_display_title

        # 冒号形式是作者自定义语义标题（plan 审查校准），原样保留
        assert (
            normalize_display_title("提案：共识收口超时活动感知续期", "2026-09-15-x")
            == "提案：共识收口超时活动感知续期"
        )
        # 英文自定义标题同样保留（parser 测试 fixture 用英文 H1，禁收裸英文模板）
        assert normalize_display_title("Proposal", "2026-09-15-x") == "Proposal"
        assert normalize_display_title("用户登录超时修复", "2026-09-15-x") == "用户登录超时修复"

    def test_missing_h1_falls_back_to_key(self) -> None:
        from app.modules.change.title_norm import normalize_display_title

        assert normalize_display_title(None, "2026-09-15-x") == "x"
        # key 无日期前缀时原样
        assert normalize_display_title(None, "plain-key") == "plain-key"

    def test_extract_h1_takes_first_heading(self) -> None:
        from app.modules.change.title_norm import extract_h1

        text = "---\nauthor: x\n---\n\n# 提案书（Proposal）\n\n## 动机\n"
        assert extract_h1(text) == "提案书（Proposal）"
        assert extract_h1("no heading here") is None


# ── parser 集成（reparse 路径同源）────────────────────────────────────────────


def _write_change_dir(root: Path, key: str, proposal_h1: str | None, *, master: bool) -> Path:
    silly = root / ".sillyspec" / "changes"
    change_dir = silly / key
    change_dir.mkdir(parents=True, exist_ok=True)
    if proposal_h1 is not None:
        (change_dir / "proposal.md").write_text(f"# {proposal_h1}\n\n正文。\n", encoding="utf-8")
    if master:
        (change_dir / "MASTER.md").write_text("# MASTER\n", encoding="utf-8")
    return change_dir


def _parse_one(root: Path, key: str):
    from app.modules.change.parser import ChangeParser

    result = ChangeParser().parse_workspace(root)
    return next(c for c in result.changes if c.change_key == key)


class TestParserTitleNormalization:
    def test_template_h1_yields_key_derived_title(self, tmp_path: Path) -> None:
        key = "2026-09-15-ehs-reward-punishment"
        _write_change_dir(tmp_path, key, "提案书（Proposal）", master=False)
        parsed = _parse_one(tmp_path, key)
        assert parsed.title == "ehs-reward-punishment"

    def test_custom_h1_yields_custom_title(self, tmp_path: Path) -> None:
        key = "2026-05-25-title-from-proposal"
        _write_change_dir(tmp_path, key, "用户登录超时修复", master=False)
        parsed = _parse_one(tmp_path, key)
        assert parsed.title == "用户登录超时修复"

    def test_no_proposal_yields_key(self, tmp_path: Path) -> None:
        key = "no-master"
        _write_change_dir(tmp_path, key, None, master=False)
        parsed = _parse_one(tmp_path, key)
        assert parsed.title == "no-master"


class TestParserMasterPlaceholder:
    def test_master_absent_emits_no_row(self, tmp_path: Path) -> None:
        """P3：MASTER.md 缺席不发 exists=False 占位行（单变更交付常态）。"""
        key = "2026-09-15-single-delivery"
        _write_change_dir(tmp_path, key, "提案书（Proposal）", master=False)
        parsed = _parse_one(tmp_path, key)
        master_docs = [d for d in parsed.docs if d.doc_type == "MASTER"]
        assert master_docs == [], "MASTER 缺席不得发占位行"

    def test_master_present_emits_exists_row(self, tmp_path: Path) -> None:
        """P3：MASTER.md 存在（brainstorm 拆分交付）照发 exists=True 行。"""
        key = "2026-09-15-split-delivery"
        _write_change_dir(tmp_path, key, "提案书（Proposal）", master=True)
        parsed = _parse_one(tmp_path, key)
        master_docs = [d for d in parsed.docs if d.doc_type == "MASTER"]
        assert len(master_docs) == 1
        assert master_docs[0].exists is True

    def test_other_standard_docs_still_emit_missing_rows(self, tmp_path: Path) -> None:
        """P3 边界：其余标准文档缺席仍补 exists=False 行（归档门禁可见性来源）。"""
        key = "2026-09-15-only-proposal"
        _write_change_dir(tmp_path, key, "提案书（Proposal）", master=False)
        parsed = _parse_one(tmp_path, key)
        missing = {d.doc_type for d in parsed.docs if not d.exists}
        assert {"design", "tasks", "plan"} <= missing


# ── upsert_documents title 重派生（P2a 写路径）────────────────────────────────


async def _make_workspace(db_session: Any):
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-title-{uuid.uuid4().hex[:8]}",
        slug=f"ws-title-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-title-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws.id


async def _get_change(db_session: Any, ws_id: Any, name: str):
    from app.modules.change.model import Change

    return (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws_id,
                    Change.change_key == name,
                )
            )
        )
        .scalars()
        .one_or_none()
    )


async def _push_documents(
    db_session: Any, ws_id: Any, name: str, documents: dict[str, str]
) -> None:
    from app.modules.platform_sync.service import PlatformSyncService

    await PlatformSyncService(db_session).upsert_documents(
        workspace_id=ws_id, name=name, documents=documents
    )


_TEMPLATE_DOCS = {
    "proposal.md": "# 提案书（Proposal）\n\n动机正文。",
    "requirements.md": "# 需求规格（Requirements）\n\nFR-01。",
    "design.md": "# 设计文档（Design）\n\n总体方案。",
    "tasks.md": "# 任务清单（Tasks）\n\n- task-01",
}


class TestUpsertDocumentsTitle:
    async def test_template_docs_yield_key_derived_title(self, db_session) -> None:
        """推四件套全模板 H1 → title=change_key 去日期前缀（最深阶段文档同归一）。"""
        ws_id = await _make_workspace(db_session)
        name = "2026-09-15-ehs-reward-punishment"
        await _push_documents(db_session, ws_id, name, dict(_TEMPLATE_DOCS))
        row = await _get_change(db_session, ws_id, name)
        assert row is not None, "documents 通道应建占位行"
        assert row.title == "ehs-reward-punishment"

    async def test_custom_h1_in_deepest_doc_wins(self, db_session) -> None:
        """最深阶段文档（tasks.md）自定义 H1 → 原样采用（按最新阶段文档重派生）。"""
        ws_id = await _make_workspace(db_session)
        name = "2026-09-15-custom-title"
        docs = dict(_TEMPLATE_DOCS)
        docs["tasks.md"] = "# 奖惩模块执行清单\n\n- task-01"
        await _push_documents(db_session, ws_id, name, docs)
        row = await _get_change(db_session, ws_id, name)
        assert row.title == "奖惩模块执行清单"

    async def test_existing_row_title_refreshed(self, db_session) -> None:
        """既有行（旧模板 title）推送后刷新为归一化 title（核心缺陷：从不刷新）。"""
        from app.modules.change.model import Change

        ws_id = await _make_workspace(db_session)
        name = "2026-09-15-refresh-me"
        db_session.add(
            Change(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                change_key=name,
                title="提案书（Proposal）",
                status="draft",
                location="active",
                path=f"changes/{name}",
                updated_at=datetime.now(UTC),
            )
        )
        await db_session.commit()
        await _push_documents(db_session, ws_id, name, dict(_TEMPLATE_DOCS))
        row = await _get_change(db_session, ws_id, name)
        assert row.title == "refresh-me", "旧模板 title 应被重派生刷新"

    async def test_deleted_key_no_resurrection(self, db_session) -> None:
        """GAP-1 防复活守卫：已删行不被迟到 documents 推送重派生 title。"""
        from app.modules.change.model import Change

        ws_id = await _make_workspace(db_session)
        name = "2026-09-15-deleted-late-push"
        db_session.add(
            Change(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                change_key=name,
                title=name,
                status="draft",
                location="deleted",
                path=f"changes/{name}",
                updated_at=datetime.now(UTC),
            )
        )
        await db_session.commit()
        await _push_documents(db_session, ws_id, name, dict(_TEMPLATE_DOCS))
        row = await _get_change(db_session, ws_id, name)
        assert row is not None and row.location == "deleted"
        assert row.title == name, "已删行不被迟到推送重派生 title"

    async def test_placeholder_defaults(self, db_session) -> None:
        """documents 通道建占位行 defaults 对齐 binding.py（draft/active/path）。"""
        ws_id = await _make_workspace(db_session)
        name = "2026-09-15-doc-placeholder"
        await _push_documents(db_session, ws_id, name, dict(_TEMPLATE_DOCS))
        row = await _get_change(db_session, ws_id, name)
        assert row.status == "draft"
        assert row.location == "active"
        assert row.path == f"changes/{name}"


# ── _sync_docs 存量 MASTER 脏行清理（P3 收敛环）───────────────────────────────


async def test_sync_docs_cleans_stale_master_rows(db_session) -> None:
    """存量 MASTER exists=False 行：下次 _sync_docs（reparse 落库段）按 seen_keys 删除。"""
    from app.modules.change.model import Change, ChangeDocument
    from app.modules.change.parser import ParsedChange, ParsedDoc
    from app.modules.change.service import ChangeService

    ws_id = await _make_workspace(db_session)
    name = "2026-09-15-stale-master"
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key=name,
        title=name,
        status="draft",
        location="active",
        path=f"changes/{name}",
        updated_at=datetime.now(UTC),
    )
    db_session.add(change)
    await db_session.flush()
    db_session.add(
        ChangeDocument(
            id=uuid.uuid4(),
            change_id=change.id,
            doc_type="MASTER",
            path=f"changes/{name}/MASTER.md",
            exists=False,
            last_modified_at=None,
        )
    )
    await db_session.commit()

    parsed = ParsedChange(change_key=name, location="active", path=f"changes/{name}")
    parsed.docs = [
        ParsedDoc(
            doc_type="proposal",
            path=f"changes/{name}/proposal.md",
            exists=True,
            filename="proposal.md",
            last_modified_at=None,
        )
    ]
    await ChangeService(db_session)._sync_docs(
        change=parsed, workspace_id=ws_id, existing_change=change, stats={}
    )
    await db_session.commit()

    remaining = (
        (
            await db_session.execute(
                select(ChangeDocument).where(
                    ChangeDocument.change_id == change.id,
                    ChangeDocument.doc_type == "MASTER",
                )
            )
        )
        .scalars()
        .all()
    )
    assert remaining == [], "存量 MASTER 占位脏行应被 seen_keys 删除环清理"


# ── description 提取（2026-09-28-change-list-description）─────────────────────
# 列表辨识痛点：title 提取自 proposal H1，模板 H1 归一化后回退 key 派生名——
# 变更中心行只剩 change_key 可辨。描述真源在 proposal.md `## 动机` 段
# （thin 机器稿=「任务原话转写：<--input>」、完整流程=agent 散文），本组测试
# 锚定共享提取纯函数 + 两条写路径同源 + 搜索命中。


class TestExtractDescription:
    """纯函数：proposal.md 全文 → 动机段描述。"""

    def test_thin_machine_shape(self) -> None:
        """thin 机器稿形态：注释包裹 + 任务原话转写前缀 + 内联成功标准截断 + 列表行剥除。"""
        from app.modules.change.title_norm import extract_description

        text = (
            "---\nauthor: flow-machine-draft\n---\n"
            "# 提案书（Proposal）— 2026-09-28-x\n\n"
            "## 动机\n"
            "<!-- MACHINE-DRAFT:proposal-motivation:abc:begin 机器预填段 -->\n"
            "任务原话转写：修复近期 CI 全线失败（backend/frontend/daemon/e2e 四 workflow 红）：\n"
            "- backend-ci 6 用例稳定失败\n"
            "- frontend-ci 4 用例稳定失败\n"
            "\n"
            "成功标准：\n"
            "- 上列失败用例根因定位并修复\n"
            "<!-- MACHINE-DRAFT:proposal-motivation:end -->\n"
            "\n"
            "## 变更范围\n机器段。\n"
        )
        assert (
            extract_description(text)
            == "修复近期 CI 全线失败（backend/frontend/daemon/e2e 四 workflow 红）："
        )

    def test_fullflow_prose_shape(self) -> None:
        """完整流程形态：散文动机段，止于下一个 ## 标题。"""
        from app.modules.change.title_norm import extract_description

        text = (
            "# Proposal: demo\n\n## 动机\n\n"
            "SillyHub 平台管理的每个 Workspace 应有独立的\nspec 文档目录，而非堆积在自身仓库。\n\n"
            "当前问题：\n1. 表有模型 0 行数据\n\n"
            "## 关键问题\n- 如题\n"
        )
        assert (
            extract_description(text)
            == "SillyHub 平台管理的每个 Workspace 应有独立的 spec 文档目录，而非堆积在自身仓库。"
        )

    def test_no_motivation_section_returns_none(self) -> None:
        from app.modules.change.title_norm import extract_description

        assert extract_description("# 提案书（Proposal）\n\n直接正文。\n") is None
        assert extract_description("") is None
        assert extract_description(None) is None

    def test_empty_after_strip_returns_none(self) -> None:
        """动机段只有注释/空行 → None（前端零占位）。"""
        from app.modules.change.title_norm import extract_description

        text = "## 动机\n<!-- AGENT:槽1 -->\n\n## 变更范围\n"
        assert extract_description(text) is None

    def test_list_only_paragraph_fallback_kept(self) -> None:
        """段内剥列表后为空 → 回退保留原段（不静默丢整段）。"""
        from app.modules.change.title_norm import extract_description

        text = "## 动机\n- 第一条动机\n- 第二条动机\n\n## 变更范围\n"
        assert extract_description(text) == "- 第一条动机 - 第二条动机"

    def test_truncate_500(self) -> None:
        from app.modules.change.title_norm import DESCRIPTION_MAX_LEN, extract_description

        text = f"## 动机\n{'字' * 600}\n"
        out = extract_description(text)
        assert out is not None and len(out) == DESCRIPTION_MAX_LEN


class TestParserDescription:
    """parser 集成：reparse 路径提取 description（与 title 同源不互翻）。"""

    def test_proposal_motivation_parsed(self, tmp_path: Path) -> None:
        key = "2026-09-28-desc-thin"
        _write_change_dir(tmp_path, key, "提案书（Proposal）", master=False)
        (tmp_path / ".sillyspec" / "changes" / key / "proposal.md").write_text(
            "# 提案书（Proposal）\n\n## 动机\n任务原话转写：登录页移动端白屏修复。\n\n成功标准：\n- 白屏消失\n",
            encoding="utf-8",
        )
        parsed = _parse_one(tmp_path, key)
        assert parsed.description == "登录页移动端白屏修复。"

    def test_no_proposal_yields_none(self, tmp_path: Path) -> None:
        key = "2026-09-28-desc-none"
        _write_change_dir(tmp_path, key, None, master=False)
        parsed = _parse_one(tmp_path, key)
        assert parsed.description is None


class TestUpsertDocumentsDescription:
    """documents 推送路径：description 重派生（与 title 同一 best-effort 语义）。"""

    async def test_push_with_motivation_sets_description(self, db_session) -> None:
        ws_id = await _make_workspace(db_session)
        name = "2026-09-28-doc-desc"
        docs = dict(_TEMPLATE_DOCS)
        docs["proposal.md"] = (
            "# 提案书（Proposal）\n\n## 动机\n登录页在移动端偶发白屏，用户反馈强烈。\n\n## 变更范围\n"
        )
        await _push_documents(db_session, ws_id, name, docs)
        row = await _get_change(db_session, ws_id, name)
        assert row is not None
        assert row.description == "登录页在移动端偶发白屏，用户反馈强烈。"

    async def test_partial_push_without_proposal_keeps_description(self, db_session) -> None:
        """迟到部分推送（仅 design.md）不动既有 description。"""
        from app.modules.change.model import Change

        ws_id = await _make_workspace(db_session)
        name = "2026-09-28-doc-partial"
        db_session.add(
            Change(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                change_key=name,
                title=name,
                description="既有描述不该被部分推送清掉",
                status="draft",
                location="active",
                path=f"changes/{name}",
                updated_at=datetime.now(UTC),
            )
        )
        await db_session.commit()
        await _push_documents(db_session, ws_id, name, {"design.md": "# 设计文档（Design）\n"})
        row = await _get_change(db_session, ws_id, name)
        assert row.description == "既有描述不该被部分推送清掉"


class TestListSearchHitsDescription:
    """列表搜索 ILIKE 扩列：change_key/title 之外的 description 命中。"""

    async def test_search_by_description(self, db_session) -> None:
        from app.modules.change.model import Change
        from app.modules.change.service import ChangeService

        ws_id = await _make_workspace(db_session)
        name = "2026-09-28-search-desc"
        db_session.add(
            Change(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                change_key=name,
                title=name,
                description="登录页在移动端偶发白屏",
                status="draft",
                location="active",
                path=f"changes/{name}",
                updated_at=datetime.now(UTC),
            )
        )
        await db_session.commit()
        items, total = await ChangeService(db_session).list_(
            ws_id, location="active", search="偶发白屏"
        )
        assert total == 1
        assert items[0].change_key == name
