"""Context builder — assembles TaskContext / AgentSpecBundle from change/task/component data."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ChangeNotFound, WorkspaceNotFound
from app.core.logging import get_logger
from app.modules.agent.base import AgentSpecBundle, TaskContext, WorkspaceSpecSummary
from app.modules.change.model import Change, ChangeDocument
from app.modules.scan_docs.model import ScanDocument
from app.modules.spec_profile.provider import SpecProfileProvider
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.task.model import Task
from app.modules.workspace.model import Workspace, WorkspaceRelation

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Legacy builder — retained for backward compatibility
# ---------------------------------------------------------------------------


async def build_task_context(
    session: AsyncSession,
    change_id: uuid.UUID,
    task_id: uuid.UUID,
) -> TaskContext:
    """Build a TaskContext from DB records for agent injection."""
    # Load task
    task = await session.get(Task, task_id)
    if task is None or task.change_id != change_id:
        msg = f"Task '{task_id}' not found for change '{change_id}'."
        raise ValueError(msg)

    # Load change
    change = await session.get(Change, change_id)
    if change is None:
        msg = f"Change '{change_id}' not found."
        raise ValueError(msg)

    # Load documents
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change_id,
        col(ChangeDocument.exists).is_(True),
    )
    docs = list((await session.execute(stmt)).scalars().all())
    doc_map: dict[str, str] = {}
    for doc in docs:
        # Try to read file content from path
        doc_map[doc.doc_type] = doc.path

    ctx = TaskContext(
        change_title=change.title or "",
        task_title=task.title or "",
        task_key=task.task_key,
        proposal=doc_map.get("proposal"),
        requirements=doc_map.get("requirements"),
        design=doc_map.get("design"),
        plan=doc_map.get("plan"),
        allowed_paths=task.allowed_paths or [],
        denied_paths=[],
    )
    return ctx


# ---------------------------------------------------------------------------
# New builder — produces AgentSpecBundle
# ---------------------------------------------------------------------------


async def _fetch_referenced_workspaces(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    max_depth: int = 1,
    snippet_max_chars: int = 2000,
) -> list[WorkspaceSpecSummary]:
    """Traverse WorkspaceRelation graph and collect spec summaries.

    Args:
        session: Async DB session.
        workspace_id: The primary workspace whose relations to traverse.
        max_depth: Graph traversal depth. Default 1 = immediate neighbours only.
            Must be >= 1. Values > 1 may cause performance issues on large graphs.
        snippet_max_chars: Maximum characters to read from each spec doc file.

    Returns:
        List of WorkspaceSpecSummary for all reachable workspaces, deduplicated
        by workspace_id (first encounter wins).
    """
    if max_depth < 1:
        raise ValueError("max_depth must be >= 1")

    visited: set[uuid.UUID] = {workspace_id}
    results: list[WorkspaceSpecSummary] = []

    # BFS frontier: each entry is (related_ws_id, relation_type, direction)
    frontier: list[tuple[uuid.UUID, str, str]] = []

    # -- Initial pass: find all direct relations of the primary workspace ------
    rel_stmt = select(WorkspaceRelation).where(
        (col(WorkspaceRelation.source_id) == workspace_id)
        | (col(WorkspaceRelation.target_id) == workspace_id),
    )
    relations = list((await session.execute(rel_stmt)).scalars().all())

    for rel in relations:
        if rel.source_id == workspace_id:
            related_id = rel.target_id
            direction = "outgoing"
        else:
            related_id = rel.source_id
            direction = "incoming"

        if related_id in visited:
            continue
        visited.add(related_id)
        frontier.append((related_id, rel.relation_type, direction))

    # -- Process frontier (BFS for depth > 1) ---------------------------------
    depth = 1
    while frontier and depth < max_depth:
        next_frontier: list[tuple[uuid.UUID, str, str]] = []
        for related_id, _rt, _dir in frontier:
            sub_rel_stmt = select(WorkspaceRelation).where(
                (col(WorkspaceRelation.source_id) == related_id)
                | (col(WorkspaceRelation.target_id) == related_id),
            )
            sub_rels = list((await session.execute(sub_rel_stmt)).scalars().all())
            for sr in sub_rels:
                nid = sr.target_id if sr.source_id == related_id else sr.source_id
                if nid in visited:
                    continue
                visited.add(nid)
                # Direction is always from the perspective of the primary workspace
                # For deeper hops, treat them as outgoing from the chain
                next_frontier.append((nid, sr.relation_type, "outgoing"))
        frontier.extend(next_frontier)
        depth += 1

    # -- Build summaries for all discovered workspaces -------------------------
    for related_id, relation_type, direction in frontier:
        # Fetch workspace row
        ws = await session.get(Workspace, related_id)
        if ws is None:
            continue
        # Skip soft-deleted workspaces
        if ws.deleted_at is not None or ws.status == "deleted":
            continue

        # Fetch SpecWorkspace (may not exist)
        sw_stmt = select(SpecWorkspace).where(
            col(SpecWorkspace.workspace_id) == related_id,
        )
        spec_ws = (await session.execute(sw_stmt)).scalar_one_or_none()
        spec_root: str | None = spec_ws.spec_root if spec_ws else None

        # Fetch scan documents with content
        doc_stmt = (
            select(ScanDocument)
            .where(
                col(ScanDocument.workspace_id) == related_id,
                col(ScanDocument.exists).is_(True),
            )
            .order_by(col(ScanDocument.doc_type))
        )
        docs = list((await session.execute(doc_stmt)).scalars().all())

        doc_summaries: dict[str, str] = {}
        for doc in docs:
            # Prefer the content column, fall back to reading file from path
            raw_content: str | None = doc.content
            if raw_content is None:
                raw_content = _read_file_safe(doc.path)
            if raw_content is not None:
                if snippet_max_chars <= 0:
                    doc_summaries[doc.doc_type] = ""
                else:
                    doc_summaries[doc.doc_type] = raw_content[:snippet_max_chars]

        results.append(
            WorkspaceSpecSummary(
                workspace_id=ws.id,
                name=ws.name,
                slug=ws.slug,
                component_key=ws.component_key,
                relation_type=relation_type,
                direction=direction,
                spec_root=spec_root,
                doc_summaries=doc_summaries,
            )
        )

    return results


async def build_spec_bundle(
    session: AsyncSession,
    change_id: uuid.UUID,
    task_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> AgentSpecBundle:
    """Build an ``AgentSpecBundle`` from DB records.

    This is the primary entry point for the new agent execution pipeline.
    It loads change/task info, reads spec document content, resolves the
    workspace's spec strategy and profile version, and fetches profile
    gates via ``SpecProfileProvider``.
    """
    # -- 1. Load task & change -------------------------------------------------
    task = await session.get(Task, task_id)
    if task is None or task.change_id != change_id:
        msg = f"Task '{task_id}' not found for change '{change_id}'."
        raise ValueError(msg)

    change = await session.get(Change, change_id)
    if change is None:
        msg = f"Change '{change_id}' not found."
        raise ValueError(msg)

    # -- 2. Load document content ----------------------------------------------
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change_id,
        col(ChangeDocument.exists).is_(True),
    )
    docs = list((await session.execute(stmt)).scalars().all())

    doc_content: dict[str, str | None] = {}
    for doc in docs:
        doc_content[doc.doc_type] = _read_file_safe(doc.path)

    # -- 3. Resolve SpecWorkspace (strategy, profile version) ------------------
    sw_stmt = select(SpecWorkspace).where(
        col(SpecWorkspace.workspace_id) == workspace_id,
    )
    spec_ws = (await session.execute(sw_stmt)).scalar_one_or_none()

    spec_strategy: str | None = None
    profile_version: str | None = None
    if spec_ws is not None:
        spec_strategy = spec_ws.strategy
        profile_version = spec_ws.profile_version

    # -- 4. Profile gates (currently stub) -------------------------------------
    provider = SpecProfileProvider()
    manifest = await provider.get_active_manifest()
    profile_gates: list[dict[str, Any]] = []
    if manifest is not None:
        profile_gates = list(manifest.gates)

    # -- 4b. Cross-workspace context via WorkspaceRelation --------------------
    referenced = await _fetch_referenced_workspaces(
        session,
        workspace_id,
        max_depth=1,
    )

    # -- 5. Assemble bundle ----------------------------------------------------
    change_summary = change.title or ""
    task_title = task.title or ""

    # Task markdown content
    task_markdown: str | None = task.content

    # Acceptance criteria — extracted from task content if present.
    # In the current data model there is no dedicated column, so we
    # leave it empty for now.  A future task can parse the task markdown
    # for an acceptance-criteria section.
    acceptance_criteria: list[str] = []

    bundle = AgentSpecBundle(
        change_summary=change_summary,
        task_key=task.task_key,
        task_title=task_title,
        proposal=doc_content.get("proposal"),
        requirements=doc_content.get("requirements"),
        design=doc_content.get("design"),
        plan=doc_content.get("plan"),
        task_markdown=task_markdown,
        allowed_paths=task.allowed_paths or [],
        denied_paths=[],
        acceptance_criteria=acceptance_criteria,
        profile_version=profile_version,
        spec_strategy=spec_strategy,
        profile_gates=profile_gates,
        available_tools=["sillyspec"],
        platform_metadata={
            "workspace_id": str(workspace_id),
            "change_id": str(change_id),
            "task_id": str(task_id),
            "change_key": change.change_key,
        },
        referenced_workspaces=referenced,
    )

    log.info(
        "spec_bundle_built",
        task_key=bundle.task_key,
        spec_strategy=bundle.spec_strategy,
        profile_version=bundle.profile_version,
        doc_types=list(doc_content.keys()),
    )
    return bundle


# ---------------------------------------------------------------------------
# Stage-level bundle builder
# ---------------------------------------------------------------------------


async def build_stage_bundle(
    session: AsyncSession,
    change_id: uuid.UUID,
    stage: str,
    workspace_id: uuid.UUID,
    *,
    read_only: bool = False,
    step_prompt: str | None = None,
) -> AgentSpecBundle:
    """构造阶段级 AgentSpecBundle，用于 SillySpec 阶段调度。

    Args:
        session: 异步数据库会话。
        change_id: 变更 ID。
        stage: 目标 SillySpec 阶段名称（如 "propose"、"plan"）。
        workspace_id: 工作区 ID。
        read_only: 是否只读模式。默认 False。
        step_prompt: SillySpec CLI 当前 step 输出的 prompt。默认 None。

    Returns:
        完整的 AgentSpecBundle，stage_dispatch=True。

    Raises:
        WorkspaceNotFound: workspace_id 对应的 Workspace 不存在。
        ChangeNotFound: change_id 对应的 Change 记录不存在。
    """
    # Step 1 — 校验 Workspace 存在性
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise WorkspaceNotFound(f"Workspace '{workspace_id}' not found.")

    # Step 2 — 加载 Change 记录
    change = await session.get(Change, change_id)
    if change is None:
        raise ChangeNotFound(f"Change '{change_id}' not found.")

    # Step 3 — 加载已有文档内容
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change_id,
        col(ChangeDocument.exists).is_(True),
    )
    docs = list((await session.execute(stmt)).scalars().all())

    doc_content: dict[str, str | None] = {}
    for doc in docs:
        doc_content[doc.doc_type] = _read_file_safe(doc.path)

    # Step 4 — 读取 spec_root 路径
    sw_stmt = select(SpecWorkspace).where(
        col(SpecWorkspace.workspace_id) == workspace_id,
    )
    spec_ws = (await session.execute(sw_stmt)).scalar_one_or_none()
    spec_root: str | None = spec_ws.spec_root if spec_ws else None

    # Step 5 — 组装 AgentSpecBundle
    bundle = AgentSpecBundle(
        # 核心 context
        change_summary=change.title or change.change_key,
        task_key=f"stage:{stage}",
        task_title=f"Stage dispatch: {stage}",
        # 已有文档内容
        proposal=doc_content.get("proposal"),
        requirements=doc_content.get("requirements"),
        design=doc_content.get("design"),
        plan=doc_content.get("plan"),
        task_markdown=doc_content.get("tasks"),
        # 约束（阶段级调度无 task 级 allowed_paths）
        allowed_paths=[],
        denied_paths=[],
        # 工具
        available_tools=["sillyspec"],
        # 元数据
        platform_metadata={
            "workspace_id": str(workspace_id),
            "change_id": str(change_id),
            "change_key": change.change_key,
            "stage": stage,
        },
        # Stage dispatch 扩展字段（task-02 新增）
        stage_dispatch=True,
        change_key=change.change_key,
        stage=stage,
        spec_root=spec_root,
        step_prompt=step_prompt,
        read_only=read_only,
    )

    # Step 6 — 记录日志并返回
    log.info(
        "stage_bundle_built",
        change_key=bundle.change_key,
        stage=bundle.stage,
        spec_root=bundle.spec_root,
        doc_types=list(doc_content.keys()),
        read_only=read_only,
    )
    return bundle


# ---------------------------------------------------------------------------
# Scan bundle builder — workspace-level scan (no Change dependency)
# ---------------------------------------------------------------------------


async def build_scan_bundle(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    spec_root: str,
    root_path: str,
    *,
    run_id: uuid.UUID,
    runtime_root: str | None = None,
) -> AgentSpecBundle:
    """构建 scan 模式的 AgentSpecBundle，不依赖 change_id。

    用于 workspace scan-generate 场景：agent 对项目目录只读扫描，
    产出写入平台托管的 spec_root 路径。

    Args:
        session: 异步数据库会话。
        workspace_id: 工作区 ID。
        spec_root: 平台托管 spec 目录路径。
        root_path: 用户项目根目录路径（只读）。
        run_id: AgentRun 记录 ID，用于 --scan-run-id 参数。
        runtime_root: 平台运行时目录路径。默认从 spec_root 推导。

    Returns:
        scan 模式的 AgentSpecBundle，stage="scan"。

    Raises:
        WorkspaceNotFound: workspace_id 对应的 Workspace 不存在。
    """
    # Step 1 — 校验 Workspace 存在性
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise WorkspaceNotFound(f"Workspace '{workspace_id}' not found.")

    # Step 1b — 推导 runtime_root
    if runtime_root is None:
        runtime_root = str(Path(spec_root) / "runtime")

    # Step 2 — 构建 scan 执行指令（分步交互式，含平台参数）
    ws_id = str(workspace_id)
    run_id_str = str(run_id)
    # 完整命令行（单行，避免 LLM 忽略续行）
    init_cmd = f"sillyspec init --dir {spec_root}"
    scan_start_cmd = (
        f"sillyspec run scan"
        f" --dir {spec_root}"
        f" --spec-root {spec_root}"
        f" --runtime-root {runtime_root}"
        f" --workspace-id {ws_id}"
        f" --scan-run-id {run_id_str}"
    )
    scan_done_cmd = (
        f'sillyspec run scan --done --change default --dir {spec_root}'
        f' --input "步骤描述" --output "步骤摘要"'
    )
    step_prompt = (
        f"你是一个项目分析 agent。请对项目目录 {root_path} 执行 sillyspec scan。\n\n"
        f"## ⚠️ 命令模板（严格复制，不要省略任何参数）\n\n"
        f"**第 1 步 — 初始化（仅一次）：**\n"
        f"```\n{init_cmd}\n```\n\n"
        f"**第 2 步 — 启动 scan（仅一次，必须包含全部平台参数）：**\n"
        f"```\n{scan_start_cmd}\n```\n\n"
        f"**第 3-N 步 — 逐步推进（每次完成后执行）：**\n"
        f"```\n{scan_done_cmd}\n"
        f"```\n\n"
        f"## 执行流程\n"
        f"1. 执行 init 命令\n"
        f"2. 执行 scan 启动命令（包含全部平台参数）\n"
        f"3. CLI 输出 step prompt → 执行扫描操作 → 用 done 命令推进\n"
        f"4. 重复 step 3 直到 10/10 步全部完成\n\n"
        f"## 规则\n"
        f"- 对 {root_path} 目录只读，不要修改任何项目文件\n"
        f"- 所有产出写入 {spec_root} 目录\n"
        f"- 启动 scan 命令必须包含 --spec-root/--runtime-root/--workspace-id/--scan-run-id\n"
        f"- done 命令不需要重复平台参数\n"
        f"- 每个步骤必须用 done 完成，不要跳过"
    )

    # Step 3 — 组装 AgentSpecBundle
    bundle = AgentSpecBundle(
        # 核心 context
        change_summary="Scan workspace project structure",
        task_key="stage:scan",
        task_title="Stage dispatch: scan",
        # 约束
        allowed_paths=[spec_root],
        denied_paths=[root_path],
        # 工具
        available_tools=["sillyspec"],
        # 元数据
        platform_metadata={
            "workspace_id": str(workspace_id),
            "mode": "scan",
            "root_path": root_path,
            "spec_root": spec_root,
            "runtime_root": runtime_root,
            "scan_run_id": str(run_id),
        },
        # Stage dispatch 扩展字段
        stage_dispatch=True,
        change_key=None,
        stage="scan",
        spec_root=spec_root,
        runtime_root=runtime_root,
        step_prompt=step_prompt,
        read_only=True,
    )

    # Step 4 — 记录日志并返回
    log.info(
        "scan_bundle_built",
        workspace_id=str(workspace_id),
        run_id=str(run_id),
        spec_root=bundle.spec_root,
        runtime_root=runtime_root,
        root_path=root_path,
        read_only=True,
    )
    return bundle


# ---------------------------------------------------------------------------
# CLAUDE.md renderers
# ---------------------------------------------------------------------------


def render_claude_md(ctx: TaskContext) -> str:
    """Render a CLAUDE.md file from the task context."""
    lines: list[str] = [
        f"# Task: {ctx.task_key} — {ctx.task_title}",
        f"# Change: {ctx.change_title}",
        "",
    ]
    if ctx.proposal:
        lines.append("## Proposal")
        lines.append(f"See: {ctx.proposal}")
        lines.append("")
    if ctx.requirements:
        lines.append("## Requirements")
        lines.append(f"See: {ctx.requirements}")
        lines.append("")
    if ctx.design:
        lines.append("## Design")
        lines.append(f"See: {ctx.design}")
        lines.append("")
    if ctx.plan:
        lines.append("## Plan")
        lines.append(f"See: {ctx.plan}")
        lines.append("")
    if ctx.allowed_paths:
        lines.append("## Allowed Paths")
        for p in ctx.allowed_paths:
            lines.append(f"- {p}")
        lines.append("")
    if ctx.conventions:
        lines.append("## Conventions")
        lines.append(ctx.conventions)
    return "\n".join(lines)


def render_bundle_to_claude_md(bundle: AgentSpecBundle) -> str:
    """Render a full CLAUDE.md from an ``AgentSpecBundle``.

    Unlike the legacy ``render_claude_md`` which only writes file paths as
    references, this renderer inlines the full document content so that the
    agent has immediate access to all spec material.
    """
    lines: list[str] = [
        f"# Task: {bundle.task_key} — {bundle.task_title}",
        f"# Change: {bundle.change_summary}",
        "",
    ]

    # -- Spec documents (inlined) ---
    for label, content in [
        ("Proposal", bundle.proposal),
        ("Requirements", bundle.requirements),
        ("Design", bundle.design),
        ("Plan", bundle.plan),
        ("Task", bundle.task_markdown),
    ]:
        if content:
            lines.append(f"## {label}")
            lines.append(content)
            lines.append("")

    # -- Constraints ---
    if bundle.allowed_paths:
        lines.append("## Allowed Paths")
        for p in bundle.allowed_paths:
            lines.append(f"- {p}")
        lines.append("")

    if bundle.denied_paths:
        lines.append("## Denied Paths")
        for p in bundle.denied_paths:
            lines.append(f"- {p}")
        lines.append("")

    if bundle.acceptance_criteria:
        lines.append("## Acceptance Criteria")
        for criterion in bundle.acceptance_criteria:
            lines.append(f"- [ ] {criterion}")
        lines.append("")

    # -- Profile ---
    if bundle.spec_strategy or bundle.profile_version:
        lines.append("## Profile")
        if bundle.spec_strategy:
            lines.append(f"- **Strategy**: {bundle.spec_strategy}")
        if bundle.profile_version:
            lines.append(f"- **Profile version**: {bundle.profile_version}")
        lines.append("")

    if bundle.profile_gates:
        lines.append("## Profile Gates")
        for gate in bundle.profile_gates:
            name = gate.get("name", "unnamed")
            gate_type = gate.get("type", "")
            lines.append(f"- {name} ({gate_type})")
        lines.append("")

    # -- Referenced Workspaces ---
    if bundle.referenced_workspaces:
        lines.append("## Referenced Workspaces")
        for ws in bundle.referenced_workspaces:
            direction_label = "→" if ws.direction == "outgoing" else "←"
            lines.append(f"### {direction_label} {ws.name} ({ws.relation_type})")
            if ws.component_key:
                lines.append(f"- **component_key**: {ws.component_key}")
            if ws.spec_root:
                lines.append(f"- **spec_root**: {ws.spec_root}")
            for doc_type, snippet in ws.doc_summaries.items():
                lines.append(f"- **{doc_type}**:")
                # Indent snippet lines
                for snippet_line in snippet.splitlines():
                    lines.append(f"  {snippet_line}")
            lines.append("")

    # -- Available Tools ---
    if bundle.available_tools:
        lines.append("## Available Tools")
        for tool in bundle.available_tools:
            if tool == "sillyspec":
                lines.append(
                    "- **sillyspec**: Use `sillyspec init --dir <spec_root>` to"
                    " initialize spec space, then `sillyspec run scan --dir"
                    " <spec_root>` to scan. Do NOT write .sillyspec files"
                    " directly — always use the CLI."
                )
            else:
                lines.append(f"- {tool}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_file_safe(path: str | None) -> str | None:
    """Read a file and return its content, or ``None`` on any failure."""
    if not path:
        return None
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        log.warning("spec_bundle_read_failed", path=path)
        return None
