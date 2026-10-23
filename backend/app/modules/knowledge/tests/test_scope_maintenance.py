"""知识注入作用域维护（2026-10-23-knowledge-scope-maintenance）。

覆盖：
- sections 透传：GET 列表条目的节级作用域（always/repo/module+domains；无标记空数组）
- update_scope 增/改/删：keyword=移除标记；只改本节 marker，其他节逐字保留
- 422 矩阵：decisions zone / INDEX.md / 子目录 / heading 不存在 / heading 多义 /
  module 缺 domains / 非法域 id

author: qinyi
created_at: 2026-10-23
"""

from __future__ import annotations

import base64
import uuid
from types import SimpleNamespace

import pytest

from app.modules.auth.model import User
from app.modules.knowledge.service import KnowledgeService
from app.modules.knowledge.writer import KnowledgeEditForbidden, KnowledgeWriterService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.model import Workspace

PATTERNS_MD = (
    "# Patterns\n"
    "\n"
    "## 既有\n"
    "\n"
    "已有小节。\n"
    "\n"
    "## 模块路由\n"
    "\n"
    "<!-- scope: module:cli-entry,core-engine -->\n"
    "\n"
    "域 id 与 FR 域同源。\n"
    "\n"
    "## 通用规约\n"
    "\n"
    "<!-- scope: always -->\n"
    "\n"
    "每次变更都注入的规约。\n"
)
DECISION_MD = "# Decision Daemon\n\n决策正文。\n"


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


@pytest.fixture()
async def env(db_session, tmp_path):
    """平台管理 spec_root + 经 apply_ops 铺底的知识树（与 test_writer 同款）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name="knowledge-scope",
        slug=f"ks-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    spec_root = tmp_path / "scope-spec"
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()

    await SpecWorkspaceService(db_session).apply_ops(
        ws.id,
        [
            FileOp(
                op="add",
                path="knowledge/patterns.md",
                content=_b64(PATTERNS_MD),
                base_version=0,
            ),
            FileOp(
                op="add",
                path="knowledge/decisions/daemon.md",
                content=_b64(DECISION_MD),
                base_version=0,
            ),
        ],
    )

    user = User(
        id=uuid.uuid4(),
        display_name="张三",
        email="zhang@example.com",
        status="active",
        is_platform_admin=True,
    )
    return SimpleNamespace(ws=ws, spec_root=spec_root, user=user, session=db_session)


class TestSectionsRead:
    async def test_list_transports_section_scopes(self, env, db_session) -> None:
        listing = await KnowledgeService(db_session).list_knowledge(env.ws.id)
        patterns = next(i for i in listing.items if i.filename == "patterns.md")
        by_heading = {s.heading: s for s in patterns.sections}
        assert set(by_heading) == {"模块路由", "通用规约"}
        assert by_heading["模块路由"].scope == "module"
        assert by_heading["模块路由"].domains == ["cli-entry", "core-engine"]
        assert by_heading["通用规约"].scope == "always"
        assert by_heading["通用规约"].domains == []
        # 无标记文件 → 空数组（零回归）
        decision = next(i for i in listing.items if i.filename == "decisions/daemon.md")
        assert decision.sections == []


class TestUpdateScope:
    async def test_add_marker_keeps_other_sections(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        entry = await writer.update_scope(
            env.ws.id,
            env.user,
            filename="patterns.md",
            heading="既有",
            scope="repo",
            domains=[],
        )
        assert [s.scope for s in entry.sections if s.heading == "既有"] == ["repo"]
        raw = (env.spec_root / "knowledge" / "patterns.md").read_text(encoding="utf-8")
        assert "## 既有\n<!-- scope: repo -->\n\n已有小节。" in raw
        # 其他节逐字保留（既有 scope 行不动）
        assert "<!-- scope: module:cli-entry,core-engine -->" in raw
        assert "<!-- scope: always -->" in raw

    async def test_change_scope_replaces_marker(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        entry = await writer.update_scope(
            env.ws.id,
            env.user,
            filename="patterns.md",
            heading="通用规约",
            scope="module",
            domains=["cli-entry"],
        )
        mod = next(s for s in entry.sections if s.heading == "通用规约")
        assert mod.scope == "module"
        assert mod.domains == ["cli-entry"]
        raw = (env.spec_root / "knowledge" / "patterns.md").read_text(encoding="utf-8")
        section = raw.split("## 通用规约", 2)[1].split("\n## ", 1)[0]
        assert section.count("<!-- scope:") == 1, "节内 marker 恒至多一条"
        assert "<!-- scope: module:cli-entry -->" in section

    async def test_keyword_removes_marker(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        entry = await writer.update_scope(
            env.ws.id,
            env.user,
            filename="patterns.md",
            heading="通用规约",
            scope="keyword",
            domains=[],
        )
        assert all(s.heading != "通用规约" for s in entry.sections)
        raw = (env.spec_root / "knowledge" / "patterns.md").read_text(encoding="utf-8")
        assert "每次变更都注入的规约。" in raw, "正文保留"
        assert "## 通用规约\n\n<!-- scope:" not in raw, "标记已删"

    @pytest.mark.parametrize(
        ("kwargs", "needle"),
        [
            (
                {"filename": "decisions/daemon.md", "heading": "Decision Daemon", "scope": "repo"},
                "仅顶层知识文件",
            ),
            (
                {"filename": "INDEX.md", "heading": "任意", "scope": "repo"},
                "仅顶层知识文件",
            ),
            (
                {"filename": "patterns.md", "heading": "不存在的节", "scope": "repo"},
                "目标节不存在",
            ),
            (
                {"filename": "patterns.md", "heading": "既有", "scope": "module", "domains": []},
                "至少一个知识域",
            ),
            (
                {
                    "filename": "patterns.md",
                    "heading": "既有",
                    "scope": "module",
                    "domains": ["Bad Domain"],
                },
                "非法知识域",
            ),
        ],
    )
    async def test_rejections(self, env, db_session, kwargs, needle) -> None:
        writer = KnowledgeWriterService(db_session)
        with pytest.raises(KnowledgeEditForbidden) as ei:
            await writer.update_scope(env.ws.id, env.user, **kwargs)
        assert needle in str(ei.value)

    async def test_duplicate_heading_rejected(self, env, db_session) -> None:
        # 追加同名节（整文件 update 造多义态）
        writer = KnowledgeWriterService(db_session)
        raw = (env.spec_root / "knowledge" / "patterns.md").read_text(encoding="utf-8")
        await writer.update_entry(
            env.ws.id, env.user, filename="patterns.md", content=raw + "\n## 既有\n\n重复节。\n"
        )
        with pytest.raises(KnowledgeEditForbidden) as ei:
            await writer.update_scope(
                env.ws.id, env.user, filename="patterns.md", heading="既有", scope="repo"
            )
        assert "标题重复" in str(ei.value)
