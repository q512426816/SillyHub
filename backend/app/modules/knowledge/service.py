"""Knowledge / Quicklog service — reads from filesystem, no DB persistence."""

from __future__ import annotations

import asyncio
import re
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.knowledge.parser import KnowledgeParser, ParsedEntry
from app.modules.knowledge.schema import KnowledgeEntry, KnowledgeList, QuicklogEntry, QuicklogList
from app.modules.workspace.service import WorkspaceService


class KnowledgeService:
    """Read-only service for knowledge and quicklog entries."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        workspace_service: WorkspaceService | None = None,
        parser: KnowledgeParser | None = None,
    ) -> None:
        self._session = session
        self._ws_service = workspace_service or WorkspaceService(session)
        self._parser = parser or KnowledgeParser()

    async def _spec_content_root(self, workspace) -> Path:
        """解析 `.sillyspec` 内容根（parser 在其下找 knowledge/、quicklog/）。

        task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
        后所有 workspace 均走 platform-managed spec_root（扁平布局，knowledge/ 直接在
        spec_root 下）。先尝试读 SpecWorkspaceService.spec_root，失败兜底
        ``Path(root_path) / ".sillyspec"``（spec_workspace 无数据时零回归）。
        """
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws = await SpecWorkspaceService(self._session).get(workspace.id)
            if spec_ws.spec_root:
                return Path(spec_ws.spec_root)
        except Exception:
            pass
        return Path(workspace.root_path) / ".sillyspec"

    async def list_knowledge(self, workspace_id: uuid.UUID) -> KnowledgeList:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        # BQ-2（2026-08-20 审计）：同步 rglob+read 移线程池，别占事件循环
        # （对齐 scan_docs task-01 范式）。
        entries = await asyncio.to_thread(self._parser.parse_knowledge, root)
        # task-03（2026-09-20-knowledge-effect-panel）：列表透传文件级 use_count
        # （无数据 0；proposed 条目同口径，不分 zone 特判）。
        file_use = await self._usage_file_counts(workspace_id)
        items = [
            self._to_knowledge_entry(
                e, include_content=False, use_count=file_use.get(e.filename, 0)
            )
            for e in entries
        ]
        return KnowledgeList(items=items, total=len(items))

    async def _usage_file_counts(self, workspace_id: uuid.UUID) -> dict[str, int]:
        """文件级使用计数：使用计数行（type∈{inject, fr-inject}）matched_anchors
        拆锚点后按 ``#`` 前缀（=filename）聚合，与 HitsService.stats 的
        entry_counts 同口径（不整跑 stats——列表低频单查仅取锚点列，开销可控）。

        延迟导入防环：hits.py 顶层 import 本模块（复用 _spec_content_root）。
        """
        from sqlalchemy import select

        from app.modules.knowledge.hits import USAGE_TYPES, KnowledgeHit

        rows = (
            (
                await self._session.execute(
                    select(KnowledgeHit.matched_anchors).where(
                        KnowledgeHit.workspace_id == workspace_id,
                        KnowledgeHit.type.in_(USAGE_TYPES),
                    )
                )
            )
            .scalars()
            .all()
        )
        counts: dict[str, int] = {}
        for matched in rows:
            for anchor in matched or []:
                file_key = anchor.split("#", 1)[0]
                counts[file_key] = counts.get(file_key, 0) + 1
        return counts

    async def get_knowledge(self, workspace_id: uuid.UUID, filename: str) -> KnowledgeEntry:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = await asyncio.to_thread(self._parser.parse_knowledge, root)
        for e in entries:
            if e.filename == filename:
                return self._to_knowledge_entry(e, include_content=True)

        from app.core.errors import WorkspaceNotFound

        raise WorkspaceNotFound(
            "知识库文件不存在，请刷新文件列表后重试。",
            details={"workspace_id": str(workspace_id), "filename": filename},
        )

    # ── 治理信号（2026-09-27-knowledge-governance-cards）───────────────────────
    # 三层治理②层的平台出口：从已同步 spec 内容根直接计算三类信号（rot 待复核/收件箱
    # 积压/伪域 auto-*），与 CLI 侧 `sillyspec knowledge digest` 同构口径。绑定类信号
    # 需仓工作树在场做文件存在性校验，留 CLI 侧（平台 spec 树无源码）。unmapped 大池
    # 无 fr_unmapped_baseline 可读（local.yaml 不入同步集），只进 totals 不当警报。
    async def governance_signals(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID | None = None
    ) -> dict:
        """治理信号（v2 起 RPC 优先，2026-09-27-governance-rpc-actions）。

        优先经绑定 daemon 直采 ``sillyspec knowledge digest --json``——CLI 为单源
        真相（绑定信号/基线消音只在仓工作树在场可得，平台本地计算结构性缺失）；
        daemon 离线/超时/未注册方法/未绑定一律回退本地计算（既有函数保留为回退，
        degrade 语义与 runtime-live 同族：读点失效不 502，页面保持可用）。
        """
        if user_id is not None:
            try:
                from app.modules.daemon.ws_hub import get_daemon_ws_hub
                from app.modules.runtime.service import RuntimeLiveService

                rt = RuntimeLiveService(self._session)
                daemon_id, root_path = await rt._resolve_binding(workspace_id, user_id)
                hub = get_daemon_ws_hub()
                from app.modules.workspace.service import resolve_root_path_for_daemon

                resp = await hub.send_rpc(
                    daemon_id,
                    "knowledge.digest",
                    {
                        "workspace_id": str(workspace_id),
                        "root_path": resolve_root_path_for_daemon(root_path),
                    },
                    timeout=60,
                )
                digest = resp.get("digest") if isinstance(resp, dict) else None
                if isinstance(digest, dict) and "signals" in digest and "totals" in digest:
                    digest = dict(digest)
                    digest["source"] = "daemon-rpc"
                    return digest
            except Exception:
                pass  # 回退本地计算（离线/超时/未绑定/未注册——degrade 不阻断）
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        result = await asyncio.to_thread(_compute_governance_signals, root)
        result["source"] = "local"
        return result

    async def governance_action(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        kind: str,
        params: dict,
    ) -> dict:
        """治理动作执行（v2 ②：信号卡按钮 → daemon knowledge.action 白名单执行）。"""
        from app.modules.runtime.service import RuntimeLiveService

        rt = RuntimeLiveService(self._session)
        daemon_id, root_path = await rt._resolve_binding(workspace_id, user_id)
        from app.modules.daemon.ws_hub import DaemonRpcRemoteError, get_daemon_ws_hub
        from app.modules.workspace.service import resolve_root_path_for_daemon

        hub = get_daemon_ws_hub()
        rpc_params: dict = {
            "workspace_id": str(workspace_id),
            "root_path": resolve_root_path_for_daemon(root_path),
            "kind": kind,
        }
        for key in ("from", "to"):
            if isinstance(params.get(key), str):
                rpc_params[key] = params[key]
        try:
            resp = await hub.send_rpc(daemon_id, "knowledge.action", rpc_params, timeout=120)
        except DaemonRpcRemoteError as exc:
            # DaemonRpcRemoteError 刻意非 AppError（要求端点重映射）——动作失败给
            # 可读文案+输出尾部，不落裸 500（评审 P2-② 清偿）
            from app.core.errors import AppError

            raise AppError(
                f"治理动作执行失败（daemon: {exc.details.get('code', 'remote_error') if hasattr(exc, 'details') and isinstance(exc.details, dict) else 'remote_error'}）：{str(exc)[:300]}"
            ) from exc
        return {"output": (resp or {}).get("output", "") if isinstance(resp, dict) else ""}

    async def list_quicklog(self, workspace_id: uuid.UUID) -> QuicklogList:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = await asyncio.to_thread(self._parser.parse_quicklog, root)
        items = [self._to_quicklog_entry(e, include_content=False) for e in entries]
        return QuicklogList(items=items, total=len(items))

    async def get_quicklog(self, workspace_id: uuid.UUID, filename: str) -> QuicklogEntry:
        workspace = await self._ws_service.get(workspace_id)
        root = await self._spec_content_root(workspace)
        entries = await asyncio.to_thread(self._parser.parse_quicklog, root)
        for e in entries:
            if e.filename == filename:
                return self._to_quicklog_entry(e, include_content=True)

        from app.core.errors import WorkspaceNotFound

        raise WorkspaceNotFound(
            "快速日志文件不存在，请刷新文件列表后重试。",
            details={"workspace_id": str(workspace_id), "filename": filename},
        )

    @staticmethod
    def _to_knowledge_entry(
        e: ParsedEntry, *, include_content: bool, use_count: int | None = None
    ) -> KnowledgeEntry:
        # task-01（2026-09-17-knowledge-precipitation）：透传 zone；get_knowledge 按
        # filename（含子目录段后值天然唯一）精确匹配，消除跨 zone 同名歧义。
        # task-03（2026-09-20-knowledge-effect-panel）：use_count 由 list 透传真实
        # 聚合值（get_knowledge 维持缺省 None，详情侧不查 hits）。
        return KnowledgeEntry(
            zone=e.zone,
            filename=e.filename,
            path=e.path,
            title=e.title,
            content=e.content if include_content else None,
            last_modified_at=e.last_modified_at,
            use_count=use_count,
        )

    @staticmethod
    def _to_quicklog_entry(e: ParsedEntry, *, include_content: bool) -> QuicklogEntry:
        return QuicklogEntry(
            filename=e.filename,
            path=e.path,
            title=e.title,
            content=e.content if include_content else None,
            last_modified_at=e.last_modified_at,
        )


# ── 治理信号计算（模块级纯函数，2026-09-27-knowledge-governance-cards）────────
# 与 CLI 侧 sillyspec knowledge digest 同构：rot 待复核行按域计数（阈 100）、
# uncategorized.md 收件箱（阈 20）、auto-* 伪域条目（阈 0 恒报）。只读扫描，
# 阈内静默（安静即健康态，防仪式化）。
GOV_ROT_THRESHOLD = 100
GOV_INBOX_THRESHOLD = 20


def _compute_governance_signals(content_root: Path) -> dict:
    fr_dir = content_root / "knowledge" / "fr"
    rot_by_domain: dict[str, int] = {}
    pseudo_by_domain: dict[str, int] = {}
    totals = {"rot": 0, "inbox": 0, "pseudo": 0, "unmapped_pool": 0}

    if fr_dir.is_dir():
        for f in sorted(fr_dir.glob("*.md")):
            domain = f.stem
            text = f.read_text(encoding="utf-8", errors="replace")
            rot = 0
            entries = 0
            for line in text.splitlines():
                if line.startswith("## "):
                    entries += 1
                elif line.startswith("待复核："):
                    rot += 1
            if rot:
                rot_by_domain[domain] = rot
                totals["rot"] += rot
            if domain.startswith("auto-") or domain.startswith("auto_"):
                if entries:
                    pseudo_by_domain[domain] = entries
                    totals["pseudo"] += entries
            elif domain == "unmapped":
                totals["unmapped_pool"] = entries  # 大池只进 totals 不当警报（无基线可读）

    inbox_titles: list[str] = []
    unc = content_root / "knowledge" / "uncategorized.md"
    if unc.is_file():
        for line in unc.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"^## (.+)$", line)
            if m:
                inbox_titles.append(m.group(1).strip())
        totals["inbox"] = len(inbox_titles)

    signals: list[dict] = []

    def _add(kind: str, title: str, count: int, detail: str, suggestion: str) -> None:
        signals.append(
            {
                "kind": kind,
                "title": title,
                "count": count,
                "detail": detail,
                "suggestion": suggestion,
            }
        )

    if totals["rot"] > GOV_ROT_THRESHOLD:
        top = sorted(rot_by_domain.items(), key=lambda kv: -kv[1])[:5]
        _add(
            "rot",
            f"rot 待复核批量标记（{totals['rot']} 条 > {GOV_ROT_THRESHOLD}）",
            totals["rot"],
            "、".join(f"{d} {n}" for d, n in top),
            "批量复核：文案漂移类可批量承接，行为类逐条对账（sillyspec knowledge digest 同口径）",
        )
    if totals["inbox"] > GOV_INBOX_THRESHOLD:
        _add(
            "inbox",
            f"知识收件箱积压（{totals['inbox']} 条 > {GOV_INBOX_THRESHOLD}）",
            totals["inbox"],
            "；".join(inbox_titles[:5]) + (" 等" if len(inbox_titles) > 5 else ""),
            "sillyspec knowledge inbox 逐条 classify 清账",
        )
    if totals["pseudo"] > 0:
        _add(
            "pseudo-domain",
            f"伪域在库（auto-* 共 {totals['pseudo']} 条）",
            totals["pseudo"],
            "、".join(f"{d} {n}" for d, n in sorted(pseudo_by_domain.items())),
            "按交付路径建议域迁移（sillyspec knowledge digest 附建议；redomain 动作 v2）",
        )

    return {
        "healthy": not signals,
        "signals": signals,
        "totals": totals,
    }
