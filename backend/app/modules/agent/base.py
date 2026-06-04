"""Abstract base class for agent adapters."""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class WorkspaceSpecSummary:
    """Lightweight summary of a related workspace's spec material.

    This is a runtime-only structure — it is never persisted. The context
    builder populates it by following WorkspaceRelation edges and reading
    spec files from the related workspace's spec_root.
    """

    workspace_id: uuid.UUID
    name: str
    slug: str
    component_key: str | None
    relation_type: str  # depends_on, consumes_api_from, ...
    direction: str  # "outgoing" or "incoming"
    spec_root: str | None  # from SpecWorkspace.spec_root
    doc_summaries: dict[str, str] = field(default_factory=dict)  # doc_type -> content snippet


@dataclass
class TaskContext:
    """Context injected into the agent before execution.

    .. deprecated::
        Use ``AgentSpecBundle`` instead.  This dataclass is retained for
        backward compatibility and will be removed in a future release.
    """

    change_title: str
    task_title: str
    task_key: str
    proposal: str | None = None
    requirements: str | None = None
    design: str | None = None
    plan: str | None = None
    conventions: str | None = None
    allowed_paths: list[str] = field(default_factory=list)
    denied_paths: list[str] = field(default_factory=list)


@dataclass
class AgentSpecBundle:
    """Complete specification package consumed by Agent adapters.

    This is the primary data structure that the context builder produces
    and that adapters consume.  It bundles together all spec documents,
    constraints, profile metadata, and platform extensions needed for a
    single agent run.
    """

    # --- Core context ---
    change_summary: str  # change title (+ description when available)
    task_key: str
    task_title: str

    # --- Spec documents (full content, not just paths) ---
    proposal: str | None = None
    requirements: str | None = None
    design: str | None = None
    plan: str | None = None
    task_markdown: str | None = None

    # --- Constraints ---
    allowed_paths: list[str] = field(default_factory=list)
    denied_paths: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)

    # --- Profile metadata ---
    profile_version: str | None = None
    spec_strategy: str | None = None
    profile_gates: list[dict[str, Any]] = field(default_factory=list)

    # --- Platform extensions ---
    available_tools: list[str] = field(default_factory=lambda: ["sillyspec"])
    platform_metadata: dict[str, Any] = field(default_factory=dict)

    # --- Cross-workspace context (runtime-only) ---
    referenced_workspaces: list[WorkspaceSpecSummary] = field(default_factory=list)

    # --- Stage dispatch extension ---
    stage_dispatch: bool = False  # True = stage-level dispatch (not task-level)
    change_key: str | None = None  # change key (e.g. "agent-stage-dispatch")
    stage: str | None = None  # target SillySpec stage (e.g. "propose")
    spec_root: str | None = None  # .sillyspec/ root directory path
    runtime_root: str | None = None  # runtime dir (scan-runs, workflow-runs, etc.)
    step_prompt: str | None = None  # SillySpec CLI current step prompt
    read_only: bool = False  # read-only mode (analyze only, no writes)


@dataclass
class AgentRunResult:
    """Result returned after agent execution."""

    exit_code: int
    stdout: str
    stderr: str
    redacted_output: str
    timed_out: bool = False


class AgentAdapter(ABC):
    """Abstract base class for agent execution adapters."""

    # ------------------------------------------------------------------
    # Legacy interface (retained for backward compatibility)
    # ------------------------------------------------------------------

    @abstractmethod
    async def run(
        self,
        run_id: uuid.UUID,
        task_context: TaskContext,
        lease_path: Path,
        timeout: int = 600,
    ) -> AgentRunResult:
        """Execute the agent and return results.

        .. deprecated::
            Override ``run_with_bundle`` in new adapters.  The default
            implementation of ``run`` raises ``NotImplementedError`` when
            neither method is overridden.
        """

    # ------------------------------------------------------------------
    # New interface — consumes AgentSpecBundle
    # ------------------------------------------------------------------

    async def run_with_bundle(
        self,
        run_id: uuid.UUID,
        bundle: AgentSpecBundle,
        lease_path: Path,
        timeout: int = 600,
    ) -> AgentRunResult:
        """Execute the agent using a structured spec bundle.

        Adapters that adopt the new ``AgentSpecBundle`` interface should
        override this method.  By default it delegates to the legacy
        ``run`` method for backward compatibility.
        """
        ctx = TaskContext(
            change_title=bundle.change_summary,
            task_title=bundle.task_title,
            task_key=bundle.task_key,
            proposal=bundle.proposal,
            requirements=bundle.requirements,
            design=bundle.design,
            plan=bundle.plan,
            allowed_paths=bundle.allowed_paths,
            denied_paths=bundle.denied_paths,
        )
        return await self.run(run_id, ctx, lease_path, timeout=timeout)

    # ------------------------------------------------------------------
    # Common helpers
    # ------------------------------------------------------------------

    @abstractmethod
    def supported_tools(self) -> list[str]:
        """Return the list of tool names this adapter can use."""

    def validate_context(self, ctx: TaskContext) -> list[str]:
        """Validate the task context. Returns list of violations."""
        violations: list[str] = []
        if not ctx.task_title:
            violations.append("Task title is required.")
        if not ctx.change_title:
            violations.append("Change title is required.")
        return violations

    def validate_bundle(self, bundle: AgentSpecBundle) -> list[str]:
        """Validate the spec bundle. Returns list of violations."""
        violations: list[str] = []
        if not bundle.task_title:
            violations.append("Task title is required.")
        if not bundle.change_summary:
            violations.append("Change summary is required.")
        if not bundle.task_key:
            violations.append("Task key is required.")
        return violations
