"""KnowledgeWriterService 单测（change 2026-09-17-knowledge-precipitation task-04）。

覆盖（task-04 acceptance）：
- propose：落盘 proposed/<slug>.md、frontmatter 四字段（author/created_at/
  proposed_at/source=manual）、slug 冲突追加 -2/-3 序号、列表侧待审核 zone 可见
- update_entry：decisions zone → 422（由归档流程维护）；top zone 正常编辑
- merge 两段式：段一 conflict 时候选保留未删（409 契约 details 三键）
- merge 幂等重试：段 1 已生效后重试不重复追加同名小节与 INDEX 路由行（dupRe）
- merge 目标白名单外 → 422
- reject：单段 delete（读侧 404）

author: qinyi
created_at: 2026-09-17
"""

from __future__ import annotations

import base64
import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.errors import WorkspaceNotFound
from app.modules.auth.model import User
from app.modules.knowledge.service import KnowledgeService
from app.modules.knowledge.writer import (
    KnowledgeEditForbidden,
    KnowledgeMergeTargetNotAllowed,
    KnowledgeWriteConflict,
    KnowledgeWriterService,
    KnowledgeZoneNotAllowed,
)
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.model import Workspace

INDEX_MD = (
    "# Knowledge Index\n"
    "\n"
    "## Known Issues\n"
    "\n"
    "- 旧问题|legacy → [known-issues.md#旧问题](known-issues.md#旧问题)\n"
    "\n"
    "## Patterns\n"
    "\n"
    "- 既有|seed → [patterns.md#既有](patterns.md#既有)\n"
)
KNOWN_ISSUES_MD = "# Known Issues\n\n## 旧问题\n\n旧内容。\n"
PATTERNS_MD = "# Patterns\n\n## 既有\n\n已有小节。\n"
DECISION_MD = "# Decision Daemon\n\n决策正文。\n"


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


async def _manifest_row(session: Any, ws_id: uuid.UUID, op_path: str) -> Any:
    from sqlalchemy import select

    from app.modules.spec_workspace.model import SpecFileManifest

    return (
        await session.execute(
            select(SpecFileManifest).where(
                SpecFileManifest.workspace_id == ws_id,
                SpecFileManifest.path == op_path,
            )
        )
    ).scalar_one_or_none()


@pytest.fixture()
async def env(db_session, tmp_path):
    """平台管理 spec_root + 经 apply_ops 铺底的知识树（manifest 行随建，base_version 链路真实）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name="knowledge-writer",
        slug=f"kw-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    spec_root = tmp_path / "writer-spec"
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
            FileOp(op="add", path="knowledge/INDEX.md", content=_b64(INDEX_MD), base_version=0),
            FileOp(
                op="add",
                path="knowledge/known-issues.md",
                content=_b64(KNOWN_ISSUES_MD),
                base_version=0,
            ),
            FileOp(
                op="add", path="knowledge/patterns.md", content=_b64(PATTERNS_MD), base_version=0
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


class TestProposeManual:
    async def test_propose_manual_frontmatter_and_proposed_zone(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        entry = await writer.propose_manual(
            env.ws.id,
            env.user,
            title="部署端口冲突处理",
            category="known-issue",
            body="端口被占用时，先查占用进程再换端口。",
            tags=["部署", "端口"],
        )

        assert entry.zone == "proposed"
        assert entry.filename == "proposed/部署端口冲突处理.md"
        assert entry.title == "部署端口冲突处理"

        raw = (env.spec_root / "knowledge" / "proposed" / "部署端口冲突处理.md").read_text(
            encoding="utf-8"
        )
        # frontmatter 四字段契约（author/created_at/proposed_at/source=manual）
        assert "author: 张三" in raw
        assert "created_at: " in raw
        assert "proposed_at: " in raw
        assert "source: manual" in raw
        assert "category: known-issue" in raw
        assert "tags: 部署, 端口" in raw
        assert "# 部署端口冲突处理" in raw
        assert "端口被占用时" in raw

        # 列表侧待审核 zone 可见
        listing = await KnowledgeService(db_session).list_knowledge(env.ws.id)
        proposed = [i for i in listing.items if i.zone == "proposed"]
        assert [i.filename for i in proposed] == ["proposed/部署端口冲突处理.md"]

    async def test_propose_slug_conflict_appends_sequence(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        first = await writer.propose_manual(env.ws.id, env.user, title="端口规范", body="一")
        second = await writer.propose_manual(env.ws.id, env.user, title="端口规范", body="二")
        third = await writer.propose_manual(env.ws.id, env.user, title="端口规范", body="三")

        assert first.filename == "proposed/端口规范.md"
        assert second.filename == "proposed/端口规范-2.md"
        assert third.filename == "proposed/端口规范-3.md"
        # 第二份不是覆盖第一份
        second_entry = await KnowledgeService(db_session).get_knowledge(
            env.ws.id, "proposed/端口规范-2.md"
        )
        assert "二" in (second_entry.content or "")


class TestUpdateEntry:
    async def test_update_decisions_zone_rejected_422(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        with pytest.raises(KnowledgeEditForbidden) as ei:
            await writer.update_entry(
                env.ws.id,
                env.user,
                filename="decisions/daemon.md",
                content="# Decision Daemon\n\n篡改。\n",
            )
        assert "由归档流程维护" in ei.value.message
        assert ei.value.http_status == 422

        # 原文未被改动
        raw = (env.spec_root / "knowledge" / "decisions" / "daemon.md").read_text(encoding="utf-8")
        assert raw == DECISION_MD

    async def test_update_top_zone_roundtrip(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        updated = await writer.update_entry(
            env.ws.id,
            env.user,
            filename="patterns.md",
            content="# Patterns\n\n## 既有\n\n改写后的小节。\n",
        )
        assert updated.zone == "top"
        assert "改写后的小节" in (updated.content or "")


class TestMerge:
    async def _propose(
        self, db_session, env, *, title: str = "候选知识", body: str = "候选正文，待合并。"
    ):
        writer = KnowledgeWriterService(db_session)
        return await writer.propose_manual(
            env.ws.id, env.user, title=title, category="pattern", body=body
        )

    async def test_merge_stage1_conflict_keeps_candidate(
        self, env, db_session, monkeypatch
    ) -> None:
        """段一 conflict → 409（details 含 conflict/server_versions）、候选保留未删、目标未追加。"""
        await self._propose(db_session, env)

        orig = KnowledgeWriterService._manifest_version

        async def stale(self, workspace_id, op_path):
            v = await orig(self, workspace_id, op_path)
            return max(v - 1, 0)  # 模拟读版本后别处已改（base_version 过期）

        monkeypatch.setattr(KnowledgeWriterService, "_manifest_version", stale)

        writer = KnowledgeWriterService(db_session)
        with pytest.raises(KnowledgeWriteConflict) as ei:
            await writer.merge(
                env.ws.id,
                env.user,
                filename="proposed/候选知识.md",
                target_file="patterns.md",
                section_title="新小节",
                keywords=["关键词"],
            )

        assert ei.value.http_status == 409
        assert ei.value.message == "文件在别处被修改，请刷新后重试"
        # details 类型可空（dict | None），先收窄再索引（mypy）
        details = ei.value.details or {}
        assert details["conflict"] is True
        assert "server_versions" in details
        assert details["server_versions"]  # 非空（含冲突路径当前版本）

        monkeypatch.undo()

        # 候选保留（两段式：段一失败不会走到段二 delete）
        entry = await KnowledgeService(db_session).get_knowledge(env.ws.id, "proposed/候选知识.md")
        assert "候选正文" in (entry.content or "")
        # 目标 / INDEX 未被改动
        assert (env.spec_root / "knowledge" / "patterns.md").read_text(
            encoding="utf-8"
        ) == PATTERNS_MD
        assert (env.spec_root / "knowledge" / "INDEX.md").read_text(encoding="utf-8") == INDEX_MD

    async def test_merge_success_appends_section_and_index_route(self, env, db_session) -> None:
        await self._propose(db_session, env, title="端口守卫", body="合并正文：先查端口占用。")

        writer = KnowledgeWriterService(db_session)
        result = await writer.merge(
            env.ws.id,
            env.user,
            filename="proposed/端口守卫.md",
            target_file="patterns.md",
            section_title="端口冲突处理",
            keywords=["端口", "部署"],
        )

        assert result.merged is True
        assert result.section_appended is True
        assert result.index_updated is True

        patterns = (env.spec_root / "knowledge" / "patterns.md").read_text(encoding="utf-8")
        # 追加小节：既有字节不动 + 空行/## 标题/空行/正文 结构（CLI appendBlock 复刻）
        assert patterns == (PATTERNS_MD + "\n## 端口冲突处理\n\n合并正文：先查端口占用。\n")

        index = (env.spec_root / "knowledge" / "INDEX.md").read_text(encoding="utf-8")
        route_line = "- 端口|部署 → [patterns.md#端口冲突处理](patterns.md#端口冲突处理)"
        assert route_line in index
        # 路由行落在 ## Patterns 分类段内（段内最后一个非空行后）
        patterns_seg = index.split("## Patterns", 1)[1]
        assert route_line in patterns_seg
        assert index.count(route_line) == 1

        # 段二：候选已删（读侧 404）
        with pytest.raises(WorkspaceNotFound):
            await KnowledgeService(db_session).get_knowledge(env.ws.id, "proposed/端口守卫.md")

    async def test_merge_retry_after_stage1_applied_is_idempotent(self, env, db_session) -> None:
        """dupRe 幂等守卫：段 1 已生效（候选残留）后重试，不重复追加小节与路由行。"""
        await self._propose(db_session, env, title="幂等候选", body="只应出现一次的正文。")
        writer = KnowledgeWriterService(db_session)
        await writer.merge(
            env.ws.id,
            env.user,
            filename="proposed/幂等候选.md",
            target_file="known-issues.md",
            section_title="幂等小节",
            keywords=["幂等"],
        )

        # 模拟「段二失败候选残留」：候选文件复活（同内容重新落盘，走 apply_ops 通道）
        candidate_op = "knowledge/proposed/幂等候选.md"
        row = await _manifest_row(db_session, env.ws.id, candidate_op)
        assert row is not None
        content = (
            "---\n"
            "author: 张三\n"
            "proposed_at: 2026-09-17T00:00:00+00:00\n"
            "category: pattern\n"
            "source: manual\n"
            "---\n"
            "\n"
            "# 幂等候选\n"
            "\n"
            "只应出现一次的正文。\n"
        )
        await SpecWorkspaceService(db_session).apply_ops(
            env.ws.id,
            [
                FileOp(
                    op="add",
                    path=candidate_op,
                    content=_b64(content),
                    base_version=row.version,
                )
            ],
        )

        # 重试 merge：dupRe 守卫 → 不重复追加，仅完成段二删除
        result = await writer.merge(
            env.ws.id,
            env.user,
            filename="proposed/幂等候选.md",
            target_file="known-issues.md",
            section_title="幂等小节",
            keywords=["幂等"],
        )
        assert result.merged is True
        assert result.section_appended is False
        assert result.index_updated is False

        known = (env.spec_root / "knowledge" / "known-issues.md").read_text(encoding="utf-8")
        assert known.count("## 幂等小节") == 1
        assert known.count("只应出现一次的正文") == 1

        index = (env.spec_root / "knowledge" / "INDEX.md").read_text(encoding="utf-8")
        assert index.count("- 幂等 → [known-issues.md#幂等小节](known-issues.md#幂等小节)") == 1

        with pytest.raises(WorkspaceNotFound):
            await KnowledgeService(db_session).get_knowledge(env.ws.id, "proposed/幂等候选.md")

    async def test_merge_target_outside_whitelist_rejected_422(self, env, db_session) -> None:
        await self._propose(db_session, env)
        writer = KnowledgeWriterService(db_session)
        for target in ("INDEX.md", "uncategorized.md", "decisions/daemon.md", "manual/guide.md"):
            with pytest.raises(KnowledgeMergeTargetNotAllowed):
                await writer.preview_merge(
                    env.ws.id,
                    filename="proposed/候选知识.md",
                    target_file=target,
                    section_title="小节",
                    keywords=["关键词"],
                )
            with pytest.raises(KnowledgeMergeTargetNotAllowed):
                await writer.merge(
                    env.ws.id,
                    env.user,
                    filename="proposed/候选知识.md",
                    target_file=target,
                    section_title="小节",
                    keywords=["关键词"],
                )

    async def test_merge_source_not_proposed_zone_rejected_422(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        with pytest.raises(KnowledgeZoneNotAllowed):
            await writer.merge(
                env.ws.id,
                env.user,
                filename="patterns.md",
                target_file="known-issues.md",
                section_title="小节",
                keywords=["关键词"],
            )

    async def test_preview_merge_dry_run_shape(self, env, db_session) -> None:
        await self._propose(db_session, env, title="预览候选", body="预览正文。")
        writer = KnowledgeWriterService(db_session)
        preview = await writer.preview_merge(
            env.ws.id,
            filename="proposed/预览候选.md",
            target_file="patterns.md",
            section_title="预览小节",
            keywords=["预览", "关键词"],
        )
        # 段落文本（将追加块）+ 路由行（逐字 CLI 格式），不落盘
        assert preview.section_text == "\n## 预览小节\n\n预览正文。\n"
        assert preview.index_line == (
            "- 预览|关键词 → [patterns.md#预览小节](patterns.md#预览小节)"
        )
        assert preview.section_skipped is False
        assert preview.index_line_skipped is False
        assert (env.spec_root / "knowledge" / "patterns.md").read_text(
            encoding="utf-8"
        ) == PATTERNS_MD


class TestReject:
    async def test_reject_deletes_candidate(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        entry = await writer.propose_manual(env.ws.id, env.user, title="待拒绝", body="内容")
        assert entry.zone == "proposed"

        await writer.reject(env.ws.id, env.user, filename="proposed/待拒绝.md")

        with pytest.raises(WorkspaceNotFound):
            await KnowledgeService(db_session).get_knowledge(env.ws.id, "proposed/待拒绝.md")
        assert not (env.spec_root / "knowledge" / "proposed" / "待拒绝.md").exists()

    async def test_reject_non_proposed_zone_rejected_422(self, env, db_session) -> None:
        writer = KnowledgeWriterService(db_session)
        with pytest.raises(KnowledgeZoneNotAllowed):
            await writer.reject(env.ws.id, env.user, filename="patterns.md")


class TestMergeBacklink:
    """merge 反链（D-010①）：合并落点「目标文件#小节标题」双键写回来源蒸馏
    任务条的 metadata_.merged_to（候选合并后即入备份区，反链须指合并后位置）。"""

    async def _seed_distill_run(self, db_session, ws_id, source_type, source_ref):
        from app.modules.agent.model import AgentRun
        from app.modules.knowledge.distill import DISTILL_RUN_KIND
        from app.modules.workspace.model import AgentRunWorkspace

        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            metadata_={
                "kind": DISTILL_RUN_KIND,
                "source_type": source_type,
                "source_ref": source_ref,
                "focus": None,
                "mode": "fresh",
            },
        )
        db_session.add(run)
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws_id))
        return run

    async def _seed_candidate(self, db_session, ws_id, filename: str, frontmatter: str) -> None:
        content = f"---\n{frontmatter}---\n\n# 蒸馏候选\n\n合并正文。\n"
        await SpecWorkspaceService(db_session).apply_ops(
            ws_id,
            [
                FileOp(
                    op="add",
                    path=f"knowledge/proposed/{filename}",
                    content=_b64(content),
                    base_version=0,
                )
            ],
        )

    async def test_merge_records_merged_to_on_distill_run(self, env, db_session) -> None:
        source_session_id = uuid.uuid4()
        hit_run = await self._seed_distill_run(
            db_session, env.ws.id, "session", str(source_session_id)
        )
        # 不相关 run：source 不匹配，不应被写反链。
        miss_run = await self._seed_distill_run(db_session, env.ws.id, "change", "other-change")
        await db_session.commit()

        await self._seed_candidate(
            db_session,
            env.ws.id,
            "蒸馏候选.md",
            f"author: 蒸馏\nsource: session:{source_session_id}\n",
        )

        writer = KnowledgeWriterService(db_session)
        result = await writer.merge(
            env.ws.id,
            env.user,
            filename="proposed/蒸馏候选.md",
            target_file="known-issues.md",
            section_title="蒸馏小节",
            keywords=["蒸馏"],
        )
        assert result.merged is True

        await db_session.refresh(hit_run)
        assert hit_run.metadata_["merged_to"] == "known-issues.md#蒸馏小节"
        await db_session.refresh(miss_run)
        assert "merged_to" not in (miss_run.metadata_ or {})

        # DistillTaskRead 投影透出 merged_to（未合并任务条仍为 null）。
        from app.modules.knowledge.distill import _to_task_read

        assert _to_task_read(hit_run).merged_to == "known-issues.md#蒸馏小节"

    async def test_merge_quick_multi_ref_backlink_hits_matching_run(self, env, db_session) -> None:
        """quick 多选蒸馏：候选 frontmatter source=quick:<id>（多选逗号分隔），
        命中 source_ref list 中含该 ql 的任务条。"""
        hit_run = await self._seed_distill_run(
            db_session,
            env.ws.id,
            "quick",
            ["ql-20260917-001-a", "ql-20260917-002-b"],
        )
        await db_session.commit()

        await self._seed_candidate(
            db_session,
            env.ws.id,
            "ql候选.md",
            "author: 蒸馏\nsource: quick:ql-20260917-002-b\n",
        )

        writer = KnowledgeWriterService(db_session)
        await writer.merge(
            env.ws.id,
            env.user,
            filename="proposed/ql候选.md",
            target_file="patterns.md",
            section_title="ql 小节",
            keywords=["ql"],
        )

        await db_session.refresh(hit_run)
        assert hit_run.metadata_["merged_to"] == "patterns.md#ql 小节"

    async def test_merge_manual_source_no_backlink_no_error(self, env, db_session) -> None:
        """手工录入候选（source=manual）合并：无反链目标，静默跳过不炸。"""
        writer = KnowledgeWriterService(db_session)
        entry = await writer.propose_manual(env.ws.id, env.user, title="手工候选", body="正文")

        result = await writer.merge(
            env.ws.id,
            env.user,
            filename=entry.filename,
            target_file="patterns.md",
            section_title="手工小节",
            keywords=["手工"],
        )
        assert result.merged is True


class TestOversizedFileGuard:
    """ql-20260918-001：读侧防 OOM 截断（parser._read_file_safe >1MB 只回前 250KB）
    的内容不得成为写侧基底——

    - update_entry 整文件替换：编辑基底即 GET 回传的截断内容，保存会把 250KB 之后
      的内容静默截掉，且 apply_ops 的 update 不进 spec-backups（仅 delete 备份）
      → 磁盘超限时直接拒绝编辑（422）；
    - merge 候选正文：改走 _read_raw 原样读，>1MB 候选的截断边界外内容也完整
      并入目标（合并后随即删候选，截断即永久丢失）。
    """

    async def test_update_entry_rejects_oversized_file(self, env, db_session) -> None:
        from app.modules.knowledge.writer import KnowledgeFileTooLarge

        big_path = env.spec_root / "knowledge" / "patterns.md"
        big_content = "# Patterns\n\n## 既有\n\n" + ("x" * 1_100_000) + "\n"
        big_path.write_text(big_content, encoding="utf-8")
        # 前置自检：磁盘文件确实超读侧阈值（>1MB → GET 内容被截断）
        assert big_path.stat().st_size > 1_000_000

        writer = KnowledgeWriterService(db_session)
        with pytest.raises(KnowledgeFileTooLarge) as ei:
            await writer.update_entry(
                env.ws.id,
                env.user,
                filename="patterns.md",
                content="# Patterns\n\n篡改后。\n",
            )
        assert ei.value.http_status == 422
        assert "超过" in ei.value.message

        # 磁盘原文未被触碰
        assert big_path.read_text(encoding="utf-8") == big_content

    async def test_merge_uses_raw_candidate_body_beyond_truncation(self, env, db_session) -> None:
        tail_marker = "尾部唯一标记-TAIL-END-MARKER"
        body = "正文开头。\n" + ("填充行内容若干。\n" * 80_000) + tail_marker + "\n"
        writer = KnowledgeWriterService(db_session)
        proposed = await writer.propose_manual(
            env.ws.id, env.user, title="超大候选", category="pattern", body=body
        )

        candidate_path = env.spec_root / "knowledge" / proposed.filename
        # 前置自检：候选超读侧阈值，且 GET 回传内容确已截断（尾部标记不可见）
        assert candidate_path.stat().st_size > 1_000_000
        truncated = await KnowledgeService(db_session).get_knowledge(env.ws.id, proposed.filename)
        assert tail_marker not in (truncated.content or "")

        await writer.merge(
            env.ws.id,
            env.user,
            filename=proposed.filename,
            target_file="patterns.md",
            section_title="超大候选",
            keywords=["大"],
        )

        target_raw = (env.spec_root / "knowledge" / "patterns.md").read_text(encoding="utf-8")
        # 截断边界外的内容完整并入目标（修复前候选正文来自 parser 截断读）
        assert tail_marker in target_raw
        assert "正文开头。" in target_raw
        # 候选已删（两段式段二）
        assert not candidate_path.exists()

    async def test_preview_merge_uses_raw_candidate_body_beyond_truncation(
        self, env, db_session
    ) -> None:
        tail_marker = "预览尾部标记-PREVIEW-TAIL"
        body = "正文开头。\n" + ("预览填充内容。\n" * 80_000) + tail_marker + "\n"
        writer = KnowledgeWriterService(db_session)
        proposed = await writer.propose_manual(
            env.ws.id, env.user, title="超大预览", category="pattern", body=body
        )
        assert (env.spec_root / "knowledge" / proposed.filename).stat().st_size > 1_000_000

        preview = await writer.preview_merge(
            env.ws.id,
            filename=proposed.filename,
            target_file="patterns.md",
            section_title="超大预览",
            keywords=["预览"],
        )
        assert tail_marker in (preview.section_text or "")


class TestMergeRobustness:
    """ql-20260918-005：merge 两处健壮性（24h 审查 M3/M6）。

    - M3：目标文件含非 UTF-8 字节（Windows GBK 手工编辑残留）时，_read_raw 的
      errors="replace" 解码 + 整文件回写会把原字节永久替换为 U+FFFD 且 update 无
      备份——改严格解码，坏编码 422 拒绝（文件不动），不静默毁坏。
    - M6：知识树无 INDEX.md 时 merge/preview 前置读直接 404（_insert_route_line
      本身支持 EOF 追加）——缺失视作空内容，合并时自动建首段。
    """

    async def test_merge_rejects_non_utf8_target_file(self, env, db_session) -> None:
        from app.modules.knowledge.writer import KnowledgeFileEncodingInvalid

        # patterns.md 直接写坏字节（GBK「中」= \xd6\xd0，非法 UTF-8）
        target_path = env.spec_root / "knowledge" / "patterns.md"
        corrupted = "# Patterns\n\n## \xd6\xd0\n\nGBK \xd6\xd0\xce\xc4\n".encode("latin-1")
        target_path.write_bytes(corrupted)

        writer = KnowledgeWriterService(db_session)
        proposed = await writer.propose_manual(
            env.ws.id, env.user, title="编码守卫候选", category="pattern", body="正文。"
        )

        with pytest.raises(KnowledgeFileEncodingInvalid) as ei:
            await writer.merge(
                env.ws.id,
                env.user,
                filename=proposed.filename,
                target_file="patterns.md",
                section_title="编码守卫",
                keywords=["编码"],
            )
        assert ei.value.http_status == 422
        # 坏字节原样保留（未被 U+FFFD 回写毁坏），候选保留未删
        assert target_path.read_bytes() == corrupted
        assert (env.spec_root / "knowledge" / proposed.filename).is_file()

    async def test_preview_merge_rejects_non_utf8_target_file(self, env, db_session) -> None:
        from app.modules.knowledge.writer import KnowledgeFileEncodingInvalid

        target_path = env.spec_root / "knowledge" / "patterns.md"
        target_path.write_bytes(b"# Patterns\n\n## \xb1\xed\n")
        writer = KnowledgeWriterService(db_session)
        proposed = await writer.propose_manual(
            env.ws.id, env.user, title="预览编码候选", category="pattern", body="正文。"
        )

        with pytest.raises(KnowledgeFileEncodingInvalid):
            await writer.preview_merge(
                env.ws.id,
                filename=proposed.filename,
                target_file="patterns.md",
                section_title="预览编码",
                keywords=["编码"],
            )
        assert target_path.read_bytes() == b"# Patterns\n\n## \xb1\xed\n"

    async def test_merge_without_index_creates_first_section(self, env, db_session) -> None:
        """M6：INDEX.md 缺失（平台删除走备份区）时 merge 不再 404——自动建
        首段（分类标题 + 路由行），候选照常删除。"""
        index_path = env.spec_root / "knowledge" / "INDEX.md"
        index_row = await _manifest_row(db_session, env.ws.id, "knowledge/INDEX.md")
        assert index_row is not None
        await SpecWorkspaceService(db_session).apply_ops(
            env.ws.id,
            [
                FileOp(
                    op="delete",
                    path="knowledge/INDEX.md",
                    base_version=index_row.version,
                )
            ],
        )
        assert not index_path.exists()

        writer = KnowledgeWriterService(db_session)
        proposed = await writer.propose_manual(
            env.ws.id, env.user, title="无索引候选", category="pattern", body="正文。"
        )

        result = await writer.merge(
            env.ws.id,
            env.user,
            filename=proposed.filename,
            target_file="patterns.md",
            section_title="无索引小节",
            keywords=["索引"],
        )
        assert result.merged is True

        index_raw = index_path.read_text(encoding="utf-8")
        # 自动建首段：分类标题 + 路由行（无空段前导）
        assert index_raw.startswith("## Patterns\n")
        assert "[patterns.md#无索引小节](patterns.md#无索引小节)" in index_raw
        # 目标文件照常追加、候选照常删除
        assert "无索引小节" in (env.spec_root / "knowledge" / "patterns.md").read_text(
            encoding="utf-8"
        )
        assert not (env.spec_root / "knowledge" / proposed.filename).exists()

    async def test_preview_merge_without_index_ok(self, env, db_session) -> None:
        """M6：INDEX.md 缺失时 preview_merge 也不 404（路由行提示可预览）。"""
        index_row = await _manifest_row(db_session, env.ws.id, "knowledge/INDEX.md")
        await SpecWorkspaceService(db_session).apply_ops(
            env.ws.id,
            [FileOp(op="delete", path="knowledge/INDEX.md", base_version=index_row.version)],
        )
        writer = KnowledgeWriterService(db_session)
        proposed = await writer.propose_manual(
            env.ws.id, env.user, title="无索引预览", category="pattern", body="正文。"
        )

        preview = await writer.preview_merge(
            env.ws.id,
            filename=proposed.filename,
            target_file="patterns.md",
            section_title="无索引预览小节",
            keywords=["预览"],
        )
        assert preview.index_line_skipped is False
        assert "patterns.md#无索引预览小节" in preview.index_line


class TestMergeTargetAutoCreate:
    """ql-20260918-007：目标文件缺失自动新建（蒸馏型 workspace 无三标准文件）。"""

    async def _propose(
        self, db_session, env, *, title: str = "候选知识", body: str = "候选正文，待合并。"
    ):
        writer = KnowledgeWriterService(db_session)
        return await writer.propose_manual(
            env.ws.id, env.user, title=title, category="pattern", body=body
        )

    async def test_preview_missing_target_flags_will_create(self, env, db_session) -> None:
        await self._propose(db_session, env, title="缺目标候选", body="正文。")
        # 前置：删掉 fixture 预置的 known-issues.md 模拟蒸馏型骨架 workspace
        (env.spec_root / "knowledge" / "known-issues.md").unlink()
        assert not (env.spec_root / "knowledge" / "known-issues.md").exists()

        preview = await KnowledgeWriterService(db_session).preview_merge(
            env.ws.id,
            filename="proposed/缺目标候选.md",
            target_file="known-issues.md",
            section_title="新小节",
            keywords=["缺目标"],
        )
        assert preview.target_will_create is True
        # 预览照常：段落 = 空目标上的追加块（文件头 + ## 小节）
        assert "## 新小节" in preview.section_text
        assert "正文。" in preview.section_text
        # 仍未落盘
        assert not (env.spec_root / "knowledge" / "known-issues.md").exists()

    async def test_merge_missing_target_creates_file_and_index_section(
        self, env, db_session
    ) -> None:
        await self._propose(db_session, env, title="建目标候选", body="建目标正文。")
        (env.spec_root / "knowledge" / "known-issues.md").unlink()
        result = await KnowledgeWriterService(db_session).merge(
            env.ws.id,
            env.user,
            filename="proposed/建目标候选.md",
            target_file="known-issues.md",
            section_title="自动新建小节",
            keywords=["自动新建"],
        )
        assert result.merged is True
        created = (env.spec_root / "knowledge" / "known-issues.md").read_text(encoding="utf-8")
        assert "## 自动新建小节" in created
        assert "建目标正文。" in created
        # INDEX 建分类段 + 路由行（段缺失 EOF 追加既有语义）
        index = (env.spec_root / "knowledge" / "INDEX.md").read_text(encoding="utf-8")
        assert "## Known Issues" in index
        assert "自动新建" in index
        # 候选已删（段二）
        assert not (env.spec_root / "knowledge" / "proposed" / "建目标候选.md").exists()

    async def test_merge_existing_target_will_create_false(self, env, db_session) -> None:
        await self._propose(db_session, env, title="已有目标候选", body="正文。")
        preview = await KnowledgeWriterService(db_session).preview_merge(
            env.ws.id,
            filename="proposed/已有目标候选.md",
            target_file="patterns.md",
            section_title="小节",
            keywords=["关键词"],
        )
        assert preview.target_will_create is False
